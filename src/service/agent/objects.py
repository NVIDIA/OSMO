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
import asyncio.queues
import dataclasses
import enum
import json
import logging
import threading
import time
from typing import Callable, Optional, Dict, List, Set

import fastapi
import kombu  # type: ignore
import kombu.mixins  # type: ignore
import kombu.transport.redis  # type: ignore
import kombu.transport.virtual  # type: ignore
import pydantic
import redis  # type: ignore
import websockets
import websockets.exceptions

from src.lib.utils import common, osmo_errors
from src.service.agent import helpers
from src.service.core.workflow import objects as workflow_objects
from src.utils import connectors, backend_messages
from src.utils.job import backend_jobs, jobs, jobs_base, task, workflow
from src.utils.metrics import metrics
from src.utils.progress_check import progress


class BackendDeleteType(enum.Enum):
    FINISH_WORKFLOWS = 'FINISH_WORKFLOWS' # Finish any workflows
    CANCEL_WORKFLOWS = 'CANCEL_WORKFLOWS' # Cancel all workflows
    FORCE = 'FORCE' # Delete the backend without waiting for workflows


# How long to keep uuids for deduplicating jobs
UNIQUE_JOB_TTL = 5 * 24 * 60 * 60


class ListBackendsResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Object storing info for all backends. """
    backends: List[connectors.Backend]

@dataclasses.dataclass
class CurrentJobContext:
    job: jobs.FrontendJob | backend_jobs.BackendJob
    start_time: float
    log_redis: redis.Redis | None
    workflow: workflow.Workflow | None


class WebsocketWorker(kombu.mixins.ConsumerMixin):
    """A Worker subscribes to the job queue and executes jobs.
    """
    def __init__(self, config: workflow_objects.WorkflowServiceConfig,
                 connection: kombu.connection.Connection,
                 worker_websocket: fastapi.WebSocket):
        self.connection = connection
        self.config = config
        self.context = jobs.JobExecutionContext(
            postgres=connectors.PostgresConnector.get_instance(),
            redis=config)
        self.redis_client = redis.from_url(config.redis_url)
        self._worker_metrics = metrics.MetricCreator.get_meter_instance()
        self.websocket = worker_websocket
        self._job_queue: asyncio.Queue[Dict] = asyncio.Queue()
        self._result: Optional[jobs.JobResult] = None
        self._result_ready = threading.Event()
        self._current_job: Optional[CurrentJobContext] = None
        self._event_loop = asyncio.get_event_loop()
        self._task_uuid: Optional[str] = None
        self._task_cred_values: Set[str] = set()
        self._progress_writer = progress.ProgressWriter(config.progress_file)
        try:
            self._progress_iter_freq = common.to_timedelta(config.progress_iter_frequency)
        except ValueError:
            self._progress_iter_freq = common.to_timedelta('15s')


    def get_consumers(self, consumer: Callable, channel: kombu.transport.redis.Channel):
        # pylint: disable=unused-argument, arguments-renamed
        return [consumer(queues=connectors.redis.BACKEND_JOBS, accept=['json'],
                         callbacks=[self.run_job])]

    def run_job(self, job_spec: Dict, message: kombu.transport.virtual.base.Message):
        # Enqueue the job so the corroutine can take care of it
        asyncio.run_coroutine_threadsafe(self._job_queue.put(job_spec), self._event_loop).result()

        # Wait for the result
        self._result_ready.wait()
        result = self._result or jobs.JobResult(status=jobs_base.JobStatus.FAILED_RETRY)

        # Clear the currently stored result
        self._result = None
        self._result_ready.clear()

        # Either reject or ack the job from the job queue
        if result.retry:
            message.reject(requeue=True)
        else:
            message.ack()
        extra = {}
        if 'workflow_uuid' in job_spec:
            extra['workflow_uuid'] = job_spec['workflow_uuid']
        logging.info('Completed job (type=%s, id=%s) with status %s',
                     job_spec['job_type'], job_spec['job_id'],
                     result,extra=extra)

    async def run_jobs(self, backend_name: str):
        worker_thread = threading.Thread(target=self.run, daemon=True)
        worker_thread.start()
        try:
            # Keep pumping events until the websocket disconnects
            await self.handle_events(backend_name)

        # If we fail due to a websocket disconnect, retry the job when the connection is remade
        except (fastapi.WebSocketDisconnect,
                websockets.exceptions.ConnectionClosedOK,
                websockets.exceptions.ConnectionClosedError) as err:
            if isinstance(err, fastapi.WebSocketDisconnect) and err.code == 1009:
                base_msg = 'Disconnected because message is too big, set as FAILED_NO_RETRY'
                if self._current_job:
                    logging.error(base_msg, extra=self._current_job.job.log_labels())
                logging.error(base_msg)
            else:
                await self.finish_current_job(
                    jobs.JobResult(status=jobs_base.JobStatus.FAILED_RETRY))

        # Any remaining jobs at this point encountered an exception, do not retry them
        finally:
            # Mark the current job as finished and set should_stop so the worker stops
            await self.finish_current_job(jobs.JobResult(
                status=jobs_base.JobStatus.FAILED_NO_RETRY))
            self.should_stop = True

    async def handle_events(self, backend_name: str):
        # Concurrently wait for a new job, and a new websocket message
        async def get_job_fn():
            job = await self._job_queue.get()
            self._job_queue.task_done()
            return job

        get_job = asyncio.create_task(get_job_fn())
        get_message = asyncio.create_task(self.websocket.receive_json())
        try:
            while True:
                # Wait for one of the the tasks to finish
                done, _ = await asyncio.wait([get_job, get_message],
                    return_when=asyncio.FIRST_COMPLETED)

                for completed_task in done:
                    if completed_task is get_job:
                        await self.handle_job(completed_task.result())
                        get_job = asyncio.create_task(get_job_fn())
                    if completed_task is get_message:
                        await self.handle_message(completed_task.result(), backend_name)
                        get_message = asyncio.create_task(self.websocket.receive_json())
        finally:
            get_job.cancel()
            get_message.cancel()


    async def handle_job(self, job_spec: Dict):
        # Verify we are not currently running a job
        if self._current_job is not None:
            raise osmo_errors.OSMOError('Got job while already running a job!')
        job: jobs.FrontendJob | backend_jobs.BackendJob
        if job_spec['super_type'] == 'frontend':
            job = jobs.FRONTEND_JOBS[job_spec['job_type']](**job_spec)
        else:
            job = backend_jobs.BACKEND_JOBS[job_spec['job_type']](**job_spec)
        logging.info('Starting job %s from the queue', job, extra=job.log_labels())

        # If this is the first copy of the job, store the uuid in the database.
        key_name = f'dedupe:{job.job_id}'
        self.redis_client.setnx(key_name, job.job_uuid)
        self.redis_client.expire(key_name, UNIQUE_JOB_TTL, nx=True)

        # If this job was not the first to write into the database, it should not execute.
        job_uuid = self.redis_client.get(key_name).decode()
        if job_uuid != job.job_uuid:
            logging.info('Skipping job %s because it is a duplicate', job, extra=job.log_labels())
            self._current_job = None
            self._result = jobs.JobResult()
            self._result_ready.set()
        else:
            # Check if the job has exceeded the maximum retry limit.
            job_retry_count = self.redis_client.incr(f'retry:{job.job_id}')
            self.redis_client.expire(f'retry:{job.job_id}', UNIQUE_JOB_TTL, nx=True)
            workflow_config = self.context.postgres.get_workflow_configs()
            job_retry_limit = workflow_config.max_retry_per_job
            if job_retry_count > job_retry_limit:
                error_message = f'Job {job} failed after retrying {job_retry_limit} times'
                logging.info(error_message, extra=job.log_labels())
                self._current_job = CurrentJobContext(
                    workflow=None,
                    log_redis=None,
                    job=job,
                    start_time=time.time())
                result = jobs.JobResult(status=jobs_base.JobStatus.FAILED_NO_RETRY,
                                        message=error_message)
                await self.handle_failure(result)
                await self.finish_current_job(result)
                return
            # Send the job to the backend worker
            if isinstance(job, jobs.WorkflowJob):
                # Initialize workflow object and redis connections
                job_workflow = workflow.Workflow.fetch_from_db(
                    self.context.postgres, job.workflow_id)
                log_redis = None
                try:
                    log_redis = redis.from_url(job_workflow.logs)
                except ValueError:
                    logging.warning('Redis path has been changed: %s',
                                    job_workflow.logs, extra=job.log_labels())
                self._current_job = CurrentJobContext(
                    workflow=job_workflow,
                    log_redis=log_redis,
                    job=job,
                    start_time=time.time())

                # Do not Create the Group unless the status is Scheduling
                pre_complete, message = job.prepare_execute(
                    self.context, self._progress_writer, self._progress_iter_freq)
                if not pre_complete:
                    result = jobs.JobResult(
                        status=jobs_base.JobStatus.FAILED_NO_RETRY,
                        message=message)
                    await self.finish_current_job(result)
                    return
            else:
                self._current_job = CurrentJobContext(
                    workflow=None,
                    log_redis=None,
                    job=job,
                    start_time=time.time())

            await self.websocket.send_text(job.json())


    async def handle_message(self, message_json: Dict, backend_name:str):
        # Decode the message
        message_body = backend_messages.MessageBody(**message_json)
        message_options = {
            message_body.type.value: message_body.body
        }
        message_option = backend_messages.MessageOptions(**message_options)

        if message_body.type == backend_messages.MessageType.LOGGING:
            if message_option.logging is None:
                raise osmo_errors.OSMOServerError('Message type LOGGING did not have ' \
                    'corresponding body')
            helpers.log('backend_worker', backend_name, self.config, message_option.logging)
            return

        # Verify we are currently running a job
        if self._current_job is None:
            raise ValueError('Not currently in a job')

        # If we got a log message, send the logs to redis
        if message_body.type == backend_messages.MessageType.POD_LOG and \
            isinstance(self._current_job.job, (jobs.CleanupGroup, jobs.RescheduleTask)):
            if message_option.pod_log is None:
                raise osmo_errors.OSMOServerError('Message type POD_LOG did not have ' \
                    'corresponding body')

            # Fetch task secrets
            if self._task_uuid != message_option.pod_log.task and \
                message_option.pod_log.task and message_option.pod_log.mask:
                self._task_uuid = message_option.pod_log.task
                if self._current_job.workflow is not None:
                    self._task_cred_values = task.TaskGroup.fetch_task_secrets_uuid(
                        self.context.postgres,
                        self._current_job.workflow.workflow_id,
                        message_option.pod_log.task,
                        self._current_job.workflow.user,
                        message_option.pod_log.retry_id)

            if message_option.pod_log.mask:
                message_option.pod_log.text = common.mask_string(message_option.pod_log.text,
                                                                 self._task_cred_values)

            # Send log to redis
            logs = connectors.redis.LogStreamBody(
                time=common.current_time(), io_type=connectors.redis.IOType.DUMP,
                source='OSMO', retry_id=message_option.pod_log.retry_id,
                text=message_option.pod_log.text)
            if self._current_job.log_redis and self._current_job.workflow:
                workflow_config = self.context.postgres.get_workflow_configs()
                self._current_job.log_redis.xadd(
                    f'{self._current_job.workflow.workflow_id}-' +\
                    f'{message_option.pod_log.task}-{message_option.pod_log.retry_id}-error-logs',
                    json.loads(logs.json()),
                    maxlen=workflow_config.max_log_lines)
                self._current_job.log_redis.expire(
                    f'{self._current_job.workflow.workflow_id}-' +\
                    f'{message_option.pod_log.task}-{message_option.pod_log.retry_id}-error-logs',
                    connectors.MAX_LOG_TTL, nx=True)

        # For success and failure, update the status to the DB and mark the job as done
        elif message_body.type == backend_messages.MessageType.JOB_STATUS:
            if message_option.job_status is None:
                raise osmo_errors.OSMOServerError('Message type did not have ' \
                    'corresponding body')
            result = message_option.job_status
            if isinstance(self._current_job.job, jobs.WorkflowJob):
                if result.status == jobs_base.JobStatus.SUCCESS:
                    try:
                        result = await asyncio.to_thread(self._current_job.job.execute,
                                                        self.context,
                                                        self._progress_writer,
                                                        self._progress_iter_freq)
                    except Exception as error:  # pylint: disable=broad-except
                        error_message = f'{type(error).__name__}: {error}'
                        logging.exception('Fatal exception %s when running job %s',
                            error_message, self._current_job.job,
                            extra={'workflow_uuid': self._current_job.job.workflow_uuid})
                        result = jobs.JobResult(status=jobs_base.JobStatus.FAILED_NO_RETRY,
                            message=f'Got exception when running frontend execute: {error_message}')

                if result.status == jobs_base.JobStatus.FAILED_NO_RETRY:
                    await self.handle_failure(result)
            await self.finish_current_job(result)
        else:
            raise osmo_errors.OSMOServerError(
                f'Invalid Worker Message Type: {message_body.type.value}')

    async def handle_failure(self, result: jobs.JobResult):
        job: jobs.WorkflowJob = self._current_job.job  # type: ignore
        try:
            await asyncio.to_thread(job.handle_failure, self.context, result.message or '')
        except Exception as error:  # pylint: disable=broad-except
            error_message = f'{type(error).__name__}: {error}'
            logging.exception(
                'Fatal exception %s when trying to handle failure for job %s',
                error_message, job,
                extra={'workflow_uuid': job.workflow_uuid})

    async def finish_current_job(self, result: jobs.JobResult):
        # Do nothing if this has already been called
        if self._current_job is None:
            return

        # Record metrics
        execute_processing_time = time.time() - self._current_job.start_time
        job_metadata = self._current_job.job.get_metadata()
        job_metadata['job_status'] = str(result.status.name)
        self._worker_metrics.send_histogram(name='osmo_worker_job_processing_time',
                                            value=execute_processing_time,
                                            description='job processing time',
                                            unit='seconds',
                                            tags=job_metadata)

        # Send the result back to the worker thread
        self._current_job = None
        self._task_cred_values = set()
        self._task_uuid = None
        self._result = result
        self._result_ready.set()
