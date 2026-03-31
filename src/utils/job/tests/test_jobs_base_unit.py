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
import datetime
import unittest
from unittest import mock

from src.utils.job import jobs_base


# ---------------------------------------------------------------------------
# JobStatus
# ---------------------------------------------------------------------------
class JobStatusTest(unittest.TestCase):
    def test_values(self):
        self.assertEqual(jobs_base.JobStatus.SUCCESS.value, 'SUCCESS')
        self.assertEqual(jobs_base.JobStatus.FAILED_RETRY.value, 'FAILED_RETRY')
        self.assertEqual(jobs_base.JobStatus.FAILED_NO_RETRY.value, 'FAILED_NO_RETRY')


# ---------------------------------------------------------------------------
# JobResult
# ---------------------------------------------------------------------------
class JobResultTest(unittest.TestCase):
    def test_success_result(self):
        result = jobs_base.JobResult(status=jobs_base.JobStatus.SUCCESS, message=None)
        self.assertFalse(result.retry)

    def test_retry_result(self):
        result = jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_RETRY, message='network error')
        self.assertTrue(result.retry)

    def test_no_retry_result(self):
        result = jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_NO_RETRY, message='bad input')
        self.assertFalse(result.retry)

    def test_str_with_message(self):
        result = jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_RETRY, message='timeout')
        self.assertEqual(str(result), 'FAILED_RETRY: timeout')

    def test_str_without_message(self):
        result = jobs_base.JobResult(
            status=jobs_base.JobStatus.SUCCESS, message=None)
        self.assertEqual(str(result), 'SUCCESS')


# ---------------------------------------------------------------------------
# update_progress_writer
# ---------------------------------------------------------------------------
class UpdateProgressWriterTest(unittest.TestCase):
    def test_does_not_report_when_time_not_elapsed(self):
        writer = mock.MagicMock()
        last = datetime.datetime.now()
        freq = datetime.timedelta(hours=1)
        result = jobs_base.update_progress_writer(writer, last, freq)
        writer.report_progress.assert_not_called()
        self.assertEqual(result, last)


# ---------------------------------------------------------------------------
# UNIQUE_JOB_TTL constant
# ---------------------------------------------------------------------------
class UniqueJobTtlTest(unittest.TestCase):
    def test_value(self):
        self.assertEqual(jobs_base.UNIQUE_JOB_TTL, 5 * 24 * 60 * 60)


if __name__ == '__main__':
    unittest.main()
