"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
"""

import json
import logging
import os
import socket
import sys
import time
import traceback

import pydantic
import redis  # type: ignore

from src.lib.utils import common, osmo_errors
import src.lib.utils.logging
from src.service.agent import helpers
from src.service.core.workflow import objects
from src.utils import connectors, backend_messages, static_config
from src.utils.metrics import metrics
from src.utils.progress_check import progress


# Redis Stream name for operator messages from backends
OPERATOR_STREAM_NAME = '{osmo}:{message-queue}:operator_messages'
# Consumer group name for message workers
CONSUMER_GROUP_NAME = 'message_workers'
# Time in milliseconds before a pending message is considered abandoned (5 minutes)
MESSAGE_CLAIM_IDLE_TIME_MS = 300000


class MessageWorkerConfig(static_config.StaticConfig, connectors.RedisConfig,
                          connectors.PostgresConfig, src.lib.utils.logging.LoggingConfig,
                          metrics.MetricsCreatorConfig):
    """Configuration for the message worker."""
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/tmp/osmo/service/last_progress_message_worker',
        description='The file to write progress timestamps to (For liveness/startup probes)')
    progress_iter_frequency: str = pydantic.Field(
        command_line='progress_iter_frequency',
        env='OSMO_PROGRESS_ITER_FREQUENCY',
        default='15s',
        description='How often to write to progress file when processing tasks in a loop ('
                    'e.g. write to progress every 1 minute processed, like uploaded to DB). '
                    'Format needs to be <int><unit> where unit can be either s (seconds) and '
                    'm (minutes).')


class MessageWorker:
    """
    A Message Worker subscribes to the operator Redis Stream and processes messages
    from all backend agents using consumer groups for reliability.
    """
    def __init__(self, config: MessageWorkerConfig):
        self.config = config
        self.postgres = connectors.PostgresConnector(self.config).get_instance()
        self.redis_client = connectors.RedisConnector.get_instance().client
        self.metric_creator = metrics.MetricCreator.get_meter_instance()
        # Get workflow config once during initialization
        self.workflow_config = self.postgres.get_workflow_configs()
        objects.WorkflowServiceContext.set(
            objects.WorkflowServiceContext(config=config, database=self.postgres))

        # Redis Stream configuration
        self.stream_name = OPERATOR_STREAM_NAME
        self.group_name = CONSUMER_GROUP_NAME
        self.consumer_name = f'worker-{socket.gethostname()}-{os.getpid()}'

        # Progress writer for liveness/readiness probes
        self._progress_writer = progress.ProgressWriter(config.progress_file)

        # Create consumer group if it doesn't exist
        self._ensure_consumer_group()

        logging.info('Message worker initialized: stream=%s, group=%s, consumer=%s',
                    self.stream_name, self.group_name, self.consumer_name)

    def _ensure_consumer_group(self):
        """Create the consumer group if it doesn't exist."""
        try:
            self.redis_client.xgroup_create(
                self.stream_name,
                self.group_name,
                id='0',
                mkstream=True
            )
            logging.info('Created consumer group %s for stream %s',
                        self.group_name, self.stream_name)
        except redis.exceptions.ResponseError as e:
            if 'BUSYGROUP' in str(e):
                # Group already exists, this is fine
                logging.debug('Consumer group %s already exists', self.group_name)
            else:
                raise

    def process_message(self, message_id: str, message_json: str, backend_name: str):
        """
        Process a message from the operator stream.

        Args:
            message_id: The Redis Stream message ID
            message_json: The message JSON string from the backend
            backend_name: The name of the backend that sent this message
        """
        try:
            # Parse the protobuf JSON message
            protobuf_msg = json.loads(message_json)

            # Determine message type from oneof field
            message_type = None
            body_data = None

            # Check which oneof field is set
            if 'update_pod' in protobuf_msg:
                message_type = backend_messages.MessageType.UPDATE_POD
                body_data = protobuf_msg['update_pod']
            elif 'resource' in protobuf_msg:
                message_type = backend_messages.MessageType.RESOURCE
                body_data = protobuf_msg['resource']
            elif 'resource_usage' in protobuf_msg:
                message_type = backend_messages.MessageType.RESOURCE_USAGE
                body_data = protobuf_msg['resource_usage']
            else:
                logging.error('Unknown message type in protobuf message id=%s', message_id)
                # Ack invalid message to prevent infinite retries
                self.redis_client.xack(self.stream_name, self.group_name, message_id)
                return

            # Convert protobuf format to MessageBody format for consistent handling
            message_body_dict = {
                'type': message_type.value,
                'body': body_data,
                'uuid': protobuf_msg.get('uuid'),
                'timestamp': protobuf_msg.get('timestamp')
            }
            message = backend_messages.MessageBody(**message_body_dict)

            logging.info('Processing message id=%s type=%s uuid=%s',
                        message_id, message.type.value, message.uuid)

            # Process the message based on type
            message_options = {message.type.value: message.body}
            message_body = backend_messages.MessageOptions(**message_options)

            if message_body.update_pod:
                helpers.queue_update_group_job(self.postgres, message_body.update_pod)
            elif message_body.resource:
                helpers.update_resource(self.postgres, backend_name, message_body.resource)
            elif message_body.resource_usage:
                helpers.update_resource_usage(
                    self.postgres, backend_name, message_body.resource_usage)
            else:
                logging.error('Ignoring invalid backend listener message type %s, uuid %s',
                              message.type.value, message.uuid)

            # Acknowledge the message (remove from pending)
            self.redis_client.xack(self.stream_name, self.group_name, message_id)
            logging.debug('Acknowledged message id=%s', message_id)

            # Record metrics
            processing_time = (common.current_time() - message.timestamp).total_seconds()
            self.metric_creator.send_counter(
                name='osmo_backend_event_processing_time', value=processing_time,
                unit='seconds',
                description='Time taken to process an event from a backend.',
                tags={'type': message.type.value}
            )
            self.metric_creator.send_counter(
                name='osmo_backend_event_count', value=1, unit='count',
                description='Number of event sent from the backend',
                tags={'type': message.type.value}
            )

            # Report progress after successful message processing
            self._progress_writer.report_progress()

        except json.JSONDecodeError as err:
            logging.error('Invalid JSON in message id=%s: %s, raw: %s',
                         message_id, str(err), message_json)
            # Ack invalid JSON to prevent infinite retries
            self.redis_client.xack(self.stream_name, self.group_name, message_id)
        except pydantic.ValidationError as err:
            logging.error('Invalid message format id=%s: %s, raw: %s',
                         message_id, str(err), message_json)
            # Ack invalid messages to prevent infinite retries
            self.redis_client.xack(self.stream_name, self.group_name, message_id)
        except osmo_errors.OSMODatabaseError as db_err:
            logging.error(
                'Database error processing message id=%s: %s',
                message_id, db_err.message)
            # Don't ack - let it be retried by another worker
        except Exception as error:  # pylint: disable=broad-except
            error_message = f'{type(error).__name__}: {error}'
            logging.error('Fatal exception processing message id=%s: %s\n%s',
                         message_id, error_message, traceback.format_exc())
            # Don't ack - let it be retried by another worker

    def _claim_abandoned_messages(self):
        """
        Claim messages that have been pending for too long (worker crashed/stuck).
        This provides automatic recovery without a separate reaper job.
        """
        try:
            # Claim messages pending for more than the configured idle time
            result = self.redis_client.xautoclaim(
                self.stream_name,
                self.group_name,
                self.consumer_name,
                min_idle_time=MESSAGE_CLAIM_IDLE_TIME_MS,
                start_id='0-0',
                count=10
            )

            # result is (next_id, claimed_messages, deleted_message_ids)
            if result and result[1]:
                claimed_messages = result[1]
                logging.warning('Claimed %d abandoned messages from other workers',
                              len(claimed_messages))

                # Process claimed messages
                for message_id, message_data in claimed_messages:
                    if b'message' in message_data and b'backend' in message_data:
                        message_json = message_data[b'message'].decode('utf-8')
                        backend_name = message_data[b'backend'].decode('utf-8')
                        self.process_message(message_id.decode('utf-8'), message_json, backend_name)

                # Report progress after claiming and processing abandoned messages
                if claimed_messages:
                    self._progress_writer.report_progress()

        except Exception as error:  # pylint: disable=broad-except
            logging.error('Error claiming abandoned messages: %s', error)

    def run(self):
        """
        Main loop to consume messages from Redis Stream.
        Uses consumer groups for reliability and load balancing across workers.
        """
        logging.info('Message worker starting, listening on stream: %s', self.stream_name)

        iteration = 0
        while True:
            try:
                iteration += 1

                # Periodically try to claim abandoned messages (every 10th iteration)
                # This provides automatic recovery from worker crashes
                if iteration % 10 == 0:
                    self._claim_abandoned_messages()

                # Read new messages from the stream
                # '>' means only new messages not yet delivered to any consumer
                messages = self.redis_client.xreadgroup(
                    groupname=self.group_name,
                    consumername=self.consumer_name,
                    streams={self.stream_name: '>'},
                    count=1,
                    block=1000  # Block for 1 second if no messages
                )

                if not messages:
                    continue

                # Process each message
                for _, stream_messages in messages:
                    for message_id, message_data in stream_messages:
                        if b'message' in message_data and b'backend' in message_data:
                            message_json = message_data[b'message'].decode('utf-8')
                            backend_name = message_data[b'backend'].decode('utf-8')
                            self.process_message(
                                message_id.decode('utf-8'),
                                message_json,
                                backend_name
                            )

            except KeyboardInterrupt:
                logging.info('Received interrupt signal, shutting down...')
                break
            except redis.exceptions.ConnectionError as error:
                logging.error('Redis connection error: %s', error)
                time.sleep(1)  # Brief pause before retrying
            except Exception as error:  # pylint: disable=broad-except
                logging.error('Error in worker main loop: %s\n%s',
                            error, traceback.format_exc())
                time.sleep(1)  # Brief pause before retrying
            finally:
                # Always report progress to show worker is alive
                self._progress_writer.report_progress()

        logging.info('Message worker stopped')


def main():
    config = MessageWorkerConfig.load()
    src.lib.utils.logging.init_logger('message_worker', config)

    # Initialize connectors (except Postgres, which MessageWorker will create)
    connectors.RedisConnector(config)
    metrics.MetricCreator(config=config)

    logging.info('Starting operator message worker...')

    try:
        worker = MessageWorker(config)
        worker.run()
    except KeyboardInterrupt:
        logging.info('Operator message worker shutting down...')
        sys.exit(0)


if __name__ == '__main__':
    main()
