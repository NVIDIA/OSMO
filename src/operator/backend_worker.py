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
import json
import logging
import threading
import time
import traceback
from typing import Dict, Optional
from urllib.parse import urlparse

import pydantic
import websockets
from kubernetes import client
from kubernetes import config as kube_config  # type: ignore

import src.lib.utils.logging
from src.lib.utils import common, version
from src.operator.utils import login, objects
from src.utils import backend_messages
from src.utils.job import jobs_base, backend_jobs
from src.utils.metrics import metrics
from src.utils.progress_check import progress


# How long to keep uuids for deduplicating jobs
UNIQUE_JOB_TTL = 5 * 24 * 60 * 60
QUEUE_RETRY_INTERVAL = 0.05
COMMAND_QUEUE_SIZE = 256
MAX_MESSAGE_SIZE = 10 * 1024 * 1024


class JobContext(backend_jobs.BackendJobExecutionContext):
    """Context from the backend worker process, needed for executing jobs"""

    def __init__(self, namespace: str, test_runner_namespace: str| None,
        test_runner_cronjob_spec_template: str| None, kb_client: client.ApiClient):
        self._kb_client = kb_client
        self._namespace = namespace
        self._test_runner_namespace = test_runner_namespace
        self._test_runner_cronjob_spec_template = test_runner_cronjob_spec_template
        self.message_queue: asyncio.Queue[backend_messages.MessageBody] = \
            asyncio.Queue(maxsize=COMMAND_QUEUE_SIZE)

    def get_kb_client(self) -> client.ApiClient:
        return self._kb_client

    def get_kb_namespace(self) -> str:
        return self._namespace

    def get_test_runner_namespace(self) -> str| None:
        return self._test_runner_namespace

    def get_test_runner_cronjob_spec_file(self) -> str| None:
        return self._test_runner_cronjob_spec_template

    def send_message(self, message: backend_messages.MessageBody):
        while True:
            try:
                self.message_queue.put_nowait(message)
                return
            except asyncio.QueueFull:
                time.sleep(QUEUE_RETRY_INTERVAL)

    async def send_async_message(self, message: backend_messages.MessageBody):
        await self.message_queue.put(message)

    async def forward_messages(self, websocket):
        while True:
            message = await self.message_queue.get()
            await websocket.send(message.json())
            self.message_queue.task_done()

    async def clear_queue(self):
        while not self.message_queue.empty():
            try:
                # Remove and return an item from the queue without blocking.
                self.message_queue.get_nowait()
            except asyncio.QueueEmpty: # Safety Catch
                break


class BackendWorker():
    """A Worker subscribes to the job queue and executes jobs.
    """
    def __init__(self, config: objects.BackendWorkerConfig):
        self.config = config
        self._progress_writer = progress.ProgressWriter(config.worker_job_progress_file)
        try:
            self._progress_iter_freq = common.to_timedelta(config.progress_iter_frequency)
        except ValueError:
            self._progress_iter_freq = common.to_timedelta('15s')
        self._current_job: Optional[jobs_base.Job] = None
        self._last_progress_check_job: Optional[jobs_base.Job] = None
        self._progress_thread = threading.Thread(
            name='progress_check_thread', target=self._monitor_progress, daemon=True)
        self._progress_thread.start()
        self.backend_metrics = metrics.MetricCreator(config=self.config).get_meter_instance()

    async def run_job(self, job_spec: Dict, context: JobContext):
        try:
            job = backend_jobs.BACKEND_JOBS[job_spec['job_type']](**job_spec)
        except pydantic.ValidationError as err:
            err_message = f'Invalid job spec received from the queue: {err}\n{job_spec}'
            logging.error(err_message)
            message = backend_messages.MessageBody(
                type=backend_messages.MessageType.JOB_STATUS,
                body=jobs_base.JobResult(
                    status=jobs_base.JobStatus.FAILED_NO_RETRY, message=err_message))
            await context.send_async_message(message)
            return
        self._current_job = job

        workflow_uuid = job.workflow_uuid if \
            isinstance(job, backend_jobs.BackendWorkflowJob) else ''
        logging.info('Starting job %s from the queue', job, extra={'workflow_uuid': workflow_uuid})
        job_start_time = time.time()
        try:
            result = await asyncio.to_thread(
                job.execute, context, self._progress_writer, self._progress_iter_freq)
            if result.status != jobs_base.JobStatus.SUCCESS:
                result.message = f'Backend execution failed: {result.message}'
            message = backend_messages.MessageBody(
                type=backend_messages.MessageType.JOB_STATUS, body=result)
        except Exception as error:  # pylint: disable=broad-except
            error_message = f'{type(error).__name__}: {error}'
            logging.exception('Fatal exception of type %s when running job %s',
                            error_message, job, extra={'workflow_uuid': workflow_uuid})
            message = backend_messages.MessageBody(
                type=backend_messages.MessageType.JOB_STATUS,
                body=jobs_base.JobResult(
                    status=jobs_base.JobStatus.FAILED_NO_RETRY,
                    message=f'Got exception when running backend execute: {error_message}\n' + \
                            f'Traceback: {traceback.format_exc()}'))

        await context.send_async_message(message)

        logging.info('Completed job %s with status %s', job, message.body,
                     extra={'workflow_uuid': workflow_uuid})
        job_duration = time.time() - job_start_time
        self.backend_metrics.send_histogram(
            name='backend_job_execution_time', value=job_duration, unit='seconds',
            description=f'Job execution time for {job.job_type}',
            tags={'job_type': job.job_type, 'namespace': self.config.namespace}
        )
        self._current_job = None

    def _monitor_progress(self):
        while True:
            # The worker is not stuck if either
            # - It is currently waiting for a new job from the queue
            # - it is working on a different job that it was the last time we checked
            if self._current_job is None or self._current_job != self._last_progress_check_job:
                self._progress_writer.report_progress()
            self._last_progress_check_job = self._current_job
            time.sleep(10)


class WebsocketLogHandler(logging.StreamHandler):
    """ Sends logs to a queue to be processed """

    def __init__(self, queue: asyncio.Queue[backend_messages.MessageBody]):
        super().__init__()
        self.queue = queue

    def emit(self, record):
        try:
            workflow_uuid = record.workflow_uuid if hasattr(
                record, 'workflow_uuid') and record.workflow_uuid else None
            self.queue.put_nowait(backend_messages.MessageBody(
                type=backend_messages.MessageType.LOGGING,
                body=backend_messages.LoggingBody(
                    type=record.levelno,
                    text=record.getMessage(),
                    workflow_uuid=workflow_uuid)))  # type : ignore
        except asyncio.QueueFull:
            pass


async def receive_messages(websocket,
                           config: objects.BackendWorkerConfig,
                           job_queue: asyncio.Queue):
    progress_writer = progress.ProgressWriter(config.worker_heartbeat_progress_file)
    while True:
        value = await websocket.recv()
        service_job = json.loads(value)
        if service_job.get('type', '') == 'heartbeat':
            progress_writer.report_progress()
        else:
            await job_queue.put(service_job)


async def run_backend_job(worker: BackendWorker,
                          job_queue: asyncio.Queue,
                          context: JobContext):
    while True:
        try:
            service_job = await job_queue.get()
            await worker.run_job(service_job, context)
            job_queue.task_done()
        except asyncio.exceptions.TimeoutError:
            pass


async def main():
    config = objects.BackendWorkerConfig.load()

    if config.method == 'dev':
        kube_config.load_kube_config()
    else:
        kube_config.load_incluster_config()
    cluster_api = client.ApiClient()
    context = JobContext(
        config.namespace, config.test_runner_namespace, config.test_runner_cronjob_spec_file,
        cluster_api)

    log_handler = WebsocketLogHandler(context.message_queue)
    src.lib.utils.logging.init_logger('worker', config, extra_handlers=[log_handler])
    logging.getLogger('websockets.client').setLevel(logging.ERROR)

    uid = client.CoreV1Api().read_namespace(name='kube-system').metadata.uid

    backend_name: str = config.backend
    endpoint = f'api/agent/worker/backend/{backend_name}'
    parsed_uri = urlparse(config.service_url)
    scheme = 'ws'
    if parsed_uri.scheme == 'https':
        scheme = 'wss'
    url = f'{scheme}://{parsed_uri.netloc}/{endpoint}'

    _, headers = await login.get_headers(config)

    job_queue: asyncio.Queue = asyncio.Queue()
    worker = BackendWorker(config)
    while True:
        try:
            async with websockets.connect( # type: ignore
                url, extra_headers=headers, max_size=MAX_MESSAGE_SIZE) as websocket:
                logging.info('Successfully connected to %s', url)
                await context.send_async_message(backend_messages.MessageBody(
                    type=backend_messages.MessageType.INIT,
                    body=backend_messages.InitBody(
                        k8s_uid=uid,
                        k8s_namespace=config.namespace,
                        version=str(version.VERSION),
                        node_condition_prefix=config.node_condition_prefix
                    )))
                await asyncio.gather(
                    receive_messages(websocket, config, job_queue),
                    run_backend_job(worker, job_queue, context),
                    context.forward_messages(websocket))
        except (websockets.ConnectionClosed,  # type: ignore
                ConnectionRefusedError,
                websockets.exceptions.InvalidStatusCode,  # type: ignore
                asyncio.exceptions.TimeoutError) as err:
            logging.info('WebSocket connection closed due to: %s\nReconnecting...', err)

            # Reset the queue when there is a disconnect
            await context.clear_queue()
            # Wait before reconnecting
            await asyncio.sleep(5)

            _, headers = await login.get_headers(config)


if __name__ == '__main__':
    asyncio.run(main())
