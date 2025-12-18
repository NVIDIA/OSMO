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

from functools import partial
import logging
import sys
import threading
import time
import traceback
from typing import Callable, Dict, Iterable, Optional

import kombu  # type: ignore
import kombu.mixins  # type: ignore
import kombu.transport.redis  # type: ignore
import kombu.transport.virtual  # type: ignore
import opentelemetry.metrics as otelmetrics
import pydantic

from src.lib.utils import common, osmo_errors
import src.lib.utils.logging
from src.utils.job import jobs, jobs_base
from src.utils.metrics import metrics
from src.utils import connectors, static_config
from src.utils.progress_check import progress


# How long to keep uuids for deduplicating jobs
UNIQUE_JOB_TTL = 5 * 24 * 60 * 60

class WorkerConfig(connectors.RedisConfig, connectors.PostgresConfig,
                   src.lib.utils.logging.LoggingConfig, static_config.StaticConfig,
                   metrics.MetricsCreatorConfig):
    progress_file: str = pydantic.Field(
        command_line='progress_file',
        env='OSMO_PROGRESS_FILE',
        default='/var/run/osmo/last_progress',
        description='The file to write progress timestamps to (For liveness/startup probes)')
    progress_iter_frequency: str = pydantic.Field(
        command_line='progress_iter_frequency',
        env='OSMO_PROGRESS_ITER_FREQUENCY',
        default='15s',
        description='How often to write to progress file when processing tasks in a loop ('
                    'e.g. write to progress every 1 minute processed, like uploaded to DB). '
                    'Format needs to be <int><unit> where unit can be either s (seconds) and '
                    'm (minutes).')


class Worker(kombu.mixins.ConsumerMixin):
    """A Worker subscribes to the job queue and executes jobs.
    """
    def __init__(self, config: WorkerConfig, connection: kombu.connection.Connection):
        self.config = config
        self.connection = connection
        self.context = jobs.JobExecutionContext(
            postgres=connectors.PostgresConnector(self.config),
            redis=self.config)
        self.redis_client = connectors.RedisConnector.get_instance().client
        self._worker_metrics = metrics.MetricCreator.get_meter_instance()
        self._progress_writer = progress.ProgressWriter(config.progress_file)
        try:
            self._progress_iter_freq = common.to_timedelta(config.progress_iter_frequency)
        except ValueError:
            self._progress_iter_freq = common.to_timedelta('15s')
        self._current_job: Optional[jobs.Job] = None
        self._last_progress_check_job: Optional[jobs.Job] = None
        self._progress_thread = threading.Thread(
            name='progress_check_thread', target=self._monitor_progress, daemon=True)
        self._progress_thread.start()

    def get_consumers(self, consumer: Callable, channel: kombu.transport.redis.Channel):
        # pylint: disable=unused-argument, arguments-renamed
        return [consumer(queues=connectors.redis.JOBS, accept=['json'], callbacks=[self.run_job])]

    def run_job(self, job_spec: Dict, message: kombu.transport.virtual.base.Message):
        try:
            job = jobs.FRONTEND_JOBS[job_spec['job_type']](**job_spec)
        except pydantic.ValidationError as e:
            logging.error('Error creating job %s, %s', job_spec, e)
            message.ack()
            return
        self._current_job = job

        workflow_uuid = job.workflow_uuid if isinstance(job, jobs.WorkflowJob) else ''
        with src.lib.utils.logging.WorkflowLogContext(workflow_uuid):
            logging.info('Starting job %s from the queue', job)
            job_metadata = job.get_metadata()

            # If this is the first copy of the job, store the uuid in the database.
            key_name = f'dedupe:{job.job_id}'
            self.redis_client.setnx(key_name, job.job_uuid)
            self.redis_client.expire(key_name, UNIQUE_JOB_TTL, nx=True)
            # If this job was not the first to write into the database, it should not execute.
            job_uuid = self.redis_client.get(key_name).decode()

            result = jobs.JobResult()
            if job_uuid == job.job_uuid:
                start_time = time.time()
                try:
                    if job.job_id:
                        self._check_job_retry_limit(job.job_id)
                    result = job.execute(self.context, self._progress_writer,
                                         self._progress_iter_freq)
                    logging.info('Completed job %s with status %s', job, result)
                    if job.job_id and result.status == jobs_base.JobStatus.SUCCESS:
                        self._clear_retry_limit(job.job_id)
                except Exception as error:  # pylint: disable=broad-except
                    error_message = f'{type(error).__name__}: {error}'
                    logging.error('Fatal exception %s when running job %s, %s',
                        error_message, job, traceback.format_exc())
                    try:
                        job.handle_failure(self.context, error_message)
                    except Exception as handle_error:  # pylint: disable=broad-except
                        handle_error_message = f'{type(handle_error).__name__}: {handle_error}'
                        logging.error(
                            'Fatal exception %s when trying to handle failure for job %s, %s',
                            handle_error_message, job, traceback.format_exc())

                    result = jobs.JobResult(status=jobs_base.JobStatus.FAILED_NO_RETRY,
                        message=f'Job failed with exception {error_message}')
                finally:
                    execute_processing_time = time.time() - start_time
                    job_metadata['job_status'] = str(result.status.name)
                    self._worker_metrics.send_histogram(name='osmo_worker_job_processing_time',
                                                        value=execute_processing_time,
                                                        description='job processing time',
                                                        unit='seconds',
                                                        tags=job_metadata)
            else:
                logging.info('Skipping job %s because it is a duplicate', job)

            # Send the job back into the queue if it needs to be retried
            if result.retry:
                message.requeue()
            else:
                message.ack()

            self._current_job = None

    def _check_job_retry_limit(self, job_id: str):
        """
        Check if the job has exceeded the maximum retry limit.

        Raise: OSMOServerError: retry limit is reached for the job
        """
        job_retry_count = self.redis_client.incr(f'retry:{job_id}')
        workflow_config = self.context.postgres.get_workflow_configs()
        job_retry_limit = workflow_config.max_retry_per_job
        if job_retry_count > job_retry_limit:
            raise osmo_errors.OSMOServerError(
                f'Job {job_id} has exceeded the maximum retry limit of {job_retry_limit}')

    def _clear_retry_limit(self, job_id: str):
        """
        Clear the retry limit for the job.
        """
        self.redis_client.delete(f'retry:{job_id}')

    def _monitor_progress(self):
        while True:
            # The worker is not stuck if either
            # - It is currently waiting for a new job from the queue
            # - it is working on a different job that it was the last time we checked
            if self._current_job is None or self._current_job != self._last_progress_check_job:
                self._progress_writer.report_progress()
            self._last_progress_check_job = self._current_job
            time.sleep(10)


# Instrumentation
def get_service_job_queue_length(url: str, *args) \
        -> Iterable[otelmetrics.Observation]:
    '''Callback to send queue lengths for osmo service job queue'''
    # pylint: disable=unused-argument
    redis_client = connectors.RedisConnector.get_instance().client
    for job_queue in connectors.JOBS:
        length = redis_client.llen(f'{connectors.JOB_QUEUE_PREFIX}:{job_queue.name}')
        yield otelmetrics.Observation(length, {'job_type': job_queue.name})

def get_backend_job_queue_length(url: str, *args) \
        -> Iterable[otelmetrics.Observation]:
    '''Callback to send queue lengths for osmo backend job queue'''
    # pylint: disable=unused-argument
    database = connectors.PostgresConnector.get_instance()
    redis_client = connectors.RedisConnector.get_instance().client
    for backend in connectors.Backend.list_names_from_db(database):
        for job_queue in connectors.BACKEND_JOBS:
            length = redis_client.llen(
                f'{connectors.BACKEND_JOB_QUEUE_PREFIX}:{backend}:{job_queue.name}')
            yield otelmetrics.Observation(length, {'job_type': f'{backend}:{job_queue.name}'})


def main():
    config = WorkerConfig.load()
    src.lib.utils.logging.init_logger('worker', config)
    worker_metrics = metrics.MetricCreator(config=config).get_meter_instance()
    connectors.RedisConnector(config)

    if config.method != 'dev':
        worker_metrics.send_observable_gauge(
            'osmo_service_worker_job_queue_length',
            callbacks=partial(get_service_job_queue_length, config.redis_url),
            description='Job queue lengths for all service job queues',
            unit='count'
        )
        worker_metrics.send_observable_gauge(
            'osmo_backend_worker_job_queue_length',
            callbacks=partial(get_backend_job_queue_length, config.redis_url),
            description='Job queue lengths for all backend job queues',
            unit='count'
        )

    with kombu.Connection(config.redis_url, transport_options=connectors.TRANSPORT_OPTIONS) as conn:
        try:
            worker = Worker(config, conn)
            worker.run()
        except KeyboardInterrupt:
            sys.exit(0)


if __name__ == '__main__':
    main()
