# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

"""
Smoke test for different execution modes.
"""

import logging
import os
import shutil
import tempfile
import unittest
import uuid

from src.lib.data import storage


logger = logging.getLogger(__name__)


class ExecutionSmokeTest(unittest.TestCase):
    """
    Smoke test for different execution modes.
    """

    storage_uri = 'swift://pdx.s8k.io/AUTH_team-osmo-ops/dev/client-library/tests/1Mx10'

    test_logging_level = logging.INFO

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.remote_test_folder = str(uuid.uuid4())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_download_single_thread_in_process(self):
        """
        Tests downloading a directory with single-threaded in-process execution.
        """
        # Arrange
        client = storage.Client.create(
            storage_uri=self.storage_uri,
            logging_level=self.test_logging_level,
            enable_progress_tracker=True,
        )

        # Arrange / Act
        results = client.download_objects(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_multi_thread_in_process(self):
        """
        Tests downloading a directory with multi-threaded in-process execution.
        """
        # Arrange
        client = storage.Client.create(
            storage_uri=self.storage_uri,
            logging_level=self.test_logging_level,
            executor_params=storage.ExecutorParameters(
                num_threads=10,
            ),
            enable_progress_tracker=True,
        )

        # Arrange / Act
        results = client.download_objects(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_single_thread_multi_process(self):
        """
        Tests downloading a directory with single-threaded multi-process execution.
        """
        # Arrange
        client = storage.Client.create(
            storage_uri=self.storage_uri,
            logging_level=self.test_logging_level,
            executor_params=storage.ExecutorParameters(
                num_processes=2,
                num_threads=1,
            ),
            enable_progress_tracker=True,
        )

        # Arrange / Act
        results = client.download_objects(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_multi_thread_multi_process(self):
        """
        Tests downloading a directory with multi-threaded multi-process execution.
        """
        # Arrange
        client = storage.Client.create(
            storage_uri=self.storage_uri,
            logging_level=self.test_logging_level,
            executor_params=storage.ExecutorParameters(
                num_processes=2,
                num_threads=5,
            ),
            enable_progress_tracker=True,
        )

        # Arrange / Act
        results = client.download_objects(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)

    def test_download_no_progress_tracker(self):
        """
        Tests downloading a directory with multi-threaded multi-process execution.
        """
        # Arrange
        client = storage.Client.create(
            storage_uri=self.storage_uri,
            logging_level=self.test_logging_level,
            executor_params=storage.ExecutorParameters(
                num_processes=2,
                num_threads=5,
            ),
            enable_progress_tracker=False,
        )

        # Arrange / Act
        results = client.download_objects(self.temp_dir)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(os.listdir(self.temp_dir)), 10)


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
