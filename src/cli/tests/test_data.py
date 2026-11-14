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

import argparse
import datetime
import logging
import unittest
from unittest import mock

from src.cli import data
from src.lib.data.storage import uploading
from src.lib.utils import osmo_errors


def _make_upload_args() -> argparse.Namespace:
    return argparse.Namespace(
        remote_uri='s3://test-bucket/prefix',
        local_path=['/tmp/output'],
        regex=None,
        benchmark_out=None,
        processes=1,
        threads=1,
        log_level=mock.Mock(value=logging.INFO),
    )


class TestRunUploadCommand(unittest.TestCase):
    """Test cases for the `osmo data upload` command handler."""

    def setUp(self):
        patcher = mock.patch('src.cli.data.storage.Client.create')
        self.mock_create = patcher.start()
        self.addCleanup(patcher.stop)
        self.mock_storage_client = self.mock_create.return_value

    def test_upload_without_failures_returns(self):
        self.mock_storage_client.upload_objects.return_value = uploading.UploadSummary(
            start_time=datetime.datetime.now(),
            count=1,
            count_transferred=1,
        )

        # pylint: disable=protected-access
        data._run_upload_command(mock.Mock(), _make_upload_args())

        self.mock_storage_client.upload_objects.assert_called_once_with(
            ['/tmp/output'],
            regex=None,
        )

    def test_upload_with_failures_raises(self):
        failure = '/tmp/output/marker.txt: OSMODataStorageClientError: NoSuchBucket'
        self.mock_storage_client.upload_objects.return_value = uploading.UploadSummary(
            start_time=datetime.datetime.now(),
            failures=[failure],
        )

        with self.assertRaises(osmo_errors.OSMODataStorageError) as context:
            # pylint: disable=protected-access
            data._run_upload_command(mock.Mock(), _make_upload_args())

        self.assertIn('1 file(s)', context.exception.message)


if __name__ == '__main__':
    unittest.main()
