"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
import asyncio
import datetime
import json
import logging
from typing import Dict, Optional

import fastapi
import pydantic
import redis  # type: ignore
import redis.asyncio  # type: ignore

from src.lib.data import storage
from src.lib.utils import common, osmo_errors
from src.utils.job import common as job_common, workflow, task, task_io
from src.utils import connectors


class MetricsOptions(pydantic.BaseModel):
    """ Credential options """
    group_metrics: Optional[task.TaskGroupMetrics] = pydantic.Field(
        description='Metrics for group')
    task_io_metrics: Optional[task_io.TaskIOMetrics] = pydantic.Field(
        description='Metrics for task io')

    @pydantic.root_validator(pre=True)
    def validate(cls, values):  # pylint: disable=no-self-argument
        """ A valid metric can only be one of the two types """
        num_fields_set = sum(1 for value in values.values()
                             if value is not None)
        if num_fields_set != 1:
            raise osmo_errors.OSMOUserError(
                f'Exactly one of the following must be set {cls.__fields__.keys()}')
        return values


def update_metrics(
        name: str,
        task_name: str,
        metrics_options: MetricsOptions,
    ):
    """ Updates the metrics with the given workflow and group_name in the database. """
    database = connectors.PostgresConnector.get_instance()
    metrics = getattr(metrics_options, metrics_options.__fields_set__.pop())
    if isinstance(metrics, task.TaskGroupMetrics):
        task.TaskGroup.patch_metrics_in_db(
            database=database,
            workflow_id=name,
            task_name=task_name,
            retry_id=metrics.retry_id,
            metrics_type=metrics.type_of_metrics,
            start_time=metrics.start_time,
            end_time=metrics.end_time
        )
    elif isinstance(metrics, task_io.TaskIOMetrics):
        task_io.TaskIO(
            database=database,
            workflow_id=name,
            group_name=metrics.group_name,
            task_name=metrics.task_name,
            retry_id=metrics.retry_id,
            url=metrics.url,
            uuid=common.generate_unique_id(),
            storage_bucket=storage.construct_storage_backend(
                metrics.url).container_uri if metrics.url else '',
            type=metrics.type,
            start_time=metrics.start_time,
            end_time=metrics.end_time,
            size=common.convert_resource_value_str(f'{metrics.size_in_bytes}B', target='GiB'),
            operation_type=metrics.operation_type,
            download_type=metrics.download_type,
            number_of_files=metrics.number_of_files
        ).insert_to_db()


async def update_barrier(database, redis_client, workflow_id: str, group_name: str, task_name: str,
                         barrier_name: str, count: int, total_timeout: int):
    key = job_common.barrier_key(workflow_id, group_name, barrier_name)
    if count <= 0:
        count = task.TaskGroup.fetch_active_group_size(database, workflow_id, group_name)

    logging.info('Add member %s from barrier %s', task_name, key)
    await redis_client.sadd(key, task_name)
    await redis_client.expire(key, total_timeout, nx=True)
    barrier_set = await redis_client.smembers(key)

    # Notify waiting tasks
    if len(barrier_set) >= count:
        key = f'barrier-{common.generate_unique_id()}'
        attributes: Dict[str, str] = {'action': 'barrier'}
        await redis_client.set(key, json.dumps(attributes))
        await redis_client.expire(key, total_timeout, nx=True)
        for name in barrier_set:
            task_obj = task.Task.fetch_from_db(database, workflow_id, name.decode())
            logging.info('Notify %s:%s for barrier count meeting %d',
                         workflow_id, task_obj.name, count)
            queue_name = workflow.action_queue_name(workflow_id, task_obj.name, task_obj.retry_id)
            await redis_client.lpush(queue_name, key)


async def run_websocket(websocket: fastapi.WebSocket, name: str, task_name: str, retry_id: int):
    """ Websocket for osmo-ctrl for sending workflow logs and metrics. """
    await websocket.accept()

    try:
        database = connectors.PostgresConnector.get_instance()
        workflow_config = database.get_workflow_configs()
        workflow_obj = workflow.Workflow.fetch_from_db(database, name)
        group_name = task.Task.fetch_group_name(database, workflow_obj.workflow_id, task_name)

        task_cred_values = task.TaskGroup.fetch_task_secrets(database,
                                                             workflow_obj.workflow_id,
                                                             task_name,
                                                             workflow_obj.user,
                                                             retry_id)

        total_timeout = job_common.calculate_total_timeout(
            workflow_obj.workflow_id,
            workflow_obj.timeout.queue_timeout, workflow_obj.timeout.exec_timeout)

        async with redis.asyncio.from_url(workflow_obj.logs) as redis_client:
            # Continue receiving logs until connection is closed
            async def get_logs(websocket):
                first_run = True
                last_heartbeat_check = datetime.datetime.now()
                workflow_configs = database.get_workflow_configs()
                heartbeat_freq_dt = datetime.timedelta(minutes=10)
                try:
                    heartbeat_freq_dt = \
                        common.to_timedelta(workflow_configs.task_heartbeat_frequency)
                except ValueError:
                    logging.error('Task heartbeat frequency has invalid value %s',
                                    workflow_configs.task_heartbeat_frequency)
                while True:
                    logs_json = await websocket.receive_json()
                    loaded_json = {k.lower(): v for k, v in json.loads(logs_json).items()}
                    io_type = connectors.IOType(loaded_json.get('iotype'))
                    if io_type == connectors.IOType.METRICS:
                        metrics_options = {
                            loaded_json['metrictype']: loaded_json.get('metric')
                        }
                        try:
                            update_metrics(
                                workflow_obj.workflow_id,
                                task_name,
                                MetricsOptions(**metrics_options)
                            )
                        except Exception as e:  # pylint: disable=broad-except
                            logging.error('Error updating metrics: %s', e)
                            raise e
                    elif io_type == connectors.IOType.LOG_DONE:
                        await websocket.send_text(json.dumps({'action': 'log_done'}))
                    elif io_type == connectors.IOType.BARRIER:
                        await update_barrier(database, redis_client,
                                            workflow_obj.workflow_id, group_name, task_name,
                                            loaded_json.get('name'),  # type: ignore[arg-type]
                                            loaded_json.get('count'),  # type: ignore[arg-type]
                                            total_timeout)
                    else:
                        if io_type.workflow_logs() and (first_run or\
                            datetime.datetime.now() - last_heartbeat_check > heartbeat_freq_dt):
                            last_heartbeat_check = datetime.datetime.now()
                            cmd = '''
                                UPDATE tasks SET last_heartbeat = %s
                                WHERE name = %s AND workflow_id = %s AND retry_id = %s;
                            '''
                            database.execute_commit_command(
                                cmd, (last_heartbeat_check, task_name,
                                      workflow_obj.workflow_id, retry_id))
                        loaded_json['text'] = common.mask_string(loaded_json.get('text', ''),
                                                                task_cred_values)
                        logs = connectors.LogStreamBody(
                            source=loaded_json['source'],
                            retry_id=retry_id,
                            time=loaded_json['time'],
                            text=loaded_json['text'],
                            io_type=loaded_json['iotype'])
                        # Use logs.json() instead of logs.dict() to convert enum and datetime to
                        # strings
                        await redis_client.xadd(f'{workflow_obj.workflow_id}-logs',
                                                json.loads(logs.json()),
                                                maxlen=workflow_config.max_log_lines)
                        await redis_client.xadd(
                            common.get_redis_task_log_name(
                                workflow_obj.workflow_id, task_name, retry_id),
                            json.loads(logs.json()),
                            maxlen=workflow_config.max_task_log_lines)
                    # Set expiration on first log message
                    if first_run:
                        first_run = False
                        await redis_client.expire(f'{workflow_obj.workflow_id}-logs',
                                                connectors.MAX_LOG_TTL)
                        await redis_client.expire(
                            common.get_redis_task_log_name(
                                workflow_obj.workflow_id, task_name, retry_id),
                            connectors.MAX_LOG_TTL)

            # If there is an action request (i.e. exec and port-forward), pull it from the queue
            #  and relay that request to osmo-ctrl through this websocket connection
            async def get_action(websocket: fastapi.WebSocket):
                while True:
                    queue_name = workflow.action_queue_name(
                        workflow_obj.workflow_id, task_name, retry_id)
                    _, key = await redis_client.brpop(queue_name)
                    logging.info('Send action to task %s from queue: %s with key: %s',
                                 task_name, queue_name, key)
                    json_fields = await redis_client.get(key)
                    await websocket.send_text(json_fields)

            loop = asyncio.get_event_loop()
            tasks = [
                    loop.create_task(get_logs(websocket)),
                    loop.create_task(get_action(websocket))
                ]
            await common.gather_cancel(*tasks)

    except osmo_errors.OSMODatabaseError as err:
        logging.info(
            'Closing websocket connection for workflow %s due to %s', name, err.message)
        await websocket.close(code=4000, reason=err.message)
    except fastapi.WebSocketDisconnect as err:  # The websocket is closed by client
        logging.info(
            'Client websocket disconnected for workflow %s task %s with code %s',
            name, task_name, str(err))
        pass
    except ValueError:
        logging.info('Logs have been moved out of Redis for %s:%s', name, task_name)
        pass
