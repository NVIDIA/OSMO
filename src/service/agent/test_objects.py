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
# pylint: disable=protected-access

import asyncio
import datetime
import threading
import time
import types
import unittest
from typing import ClassVar, List, cast
from unittest import mock

from src.service.agent import objects
from src.utils.job import jobs
from src.utils.job import jobs_base


class _FakeMetrics:
    """Minimal metrics recorder used by WebsocketWorker.finish_current_job."""

    def send_histogram(self, **kwargs):
        _ = kwargs


class _FakeWorkflowJob(jobs.WorkflowJob):
    """Workflow job test double that records failure handling messages."""

    failure_messages: ClassVar[List[str]] = []

    @classmethod
    def _get_job_id(cls, values):
        return values.get('job_id', 'fake-job')

    def execute(self, context: jobs.JobExecutionContext,
                progress_writer, progress_iter_freq: datetime.timedelta = \
                    datetime.timedelta(seconds=15)) -> jobs.JobResult:
        _ = context
        _ = progress_writer
        _ = progress_iter_freq
        return jobs.JobResult()

    def handle_failure(self, context: jobs.JobExecutionContext, error: str):
        _ = context
        self.failure_messages.append(error)


class WebsocketWorkerRunJobsTest(unittest.TestCase):
    """Regression tests for WebsocketWorker.run_jobs failure handling."""

    def setUp(self):
        _FakeWorkflowJob.failure_messages = []

    def _worker_with_current_job(self):
        worker = objects.WebsocketWorker.__new__(objects.WebsocketWorker)
        worker.context = cast(jobs.JobExecutionContext, types.SimpleNamespace())
        worker._worker_metrics = _FakeMetrics()
        worker._result = None
        worker._result_ready = threading.Event()
        worker._task_cred_values = set()
        worker._task_uuid = None
        worker.should_stop = False
        worker.run = mock.Mock()
        job = _FakeWorkflowJob(
            workflow_id='test-workflow',
            workflow_uuid='a7cce9b153fd4e33b0ad363eed207316')
        worker._current_job = objects.CurrentJobContext(
            workflow=None,
            log_redis=None,
            job=job,
            start_time=time.time())
        return worker

    def test_message_too_big_disconnect_marks_current_workflow_job_failed(self):
        worker = self._worker_with_current_job()
        worker.handle_events = mock.AsyncMock(
            side_effect=objects.fastapi.WebSocketDisconnect(code=1009))

        asyncio.run(worker.run_jobs('test-backend'))

        self.assertEqual(_FakeWorkflowJob.failure_messages, [objects.MESSAGE_TOO_BIG_FAILURE])
        self.assertEqual(worker._result, jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_NO_RETRY,
            message=objects.MESSAGE_TOO_BIG_FAILURE))
        self.assertIsNone(worker._current_job)

    def test_failed_no_retry_without_message_gets_fallback_failure_message(self):
        worker = self._worker_with_current_job()
        message_json = {
            'type': objects.backend_messages.MessageType.JOB_STATUS.value,
            'body': {
                'status': jobs_base.JobStatus.FAILED_NO_RETRY.value,
                'message': None,
            },
        }

        asyncio.run(worker.handle_message(message_json, 'test-backend'))

        expected_message = \
            '(type=_FakeWorkflowJob, id=fake-job) returned FAILED_NO_RETRY without ' +\
            'an error message'
        self.assertEqual(_FakeWorkflowJob.failure_messages, [expected_message])
        self.assertEqual(worker._result, jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_NO_RETRY,
            message=expected_message))
        self.assertIsNone(worker._current_job)


if __name__ == '__main__':
    unittest.main()
