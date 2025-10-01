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
import pathlib
import shutil
import tempfile
import unittest
import uuid

from typing import Generator

from src.lib.data import storage
from src.lib.data.storage import common, downloading, mux


logger = logging.getLogger(__name__)


class MuxSmokeTest(unittest.TestCase):
    """
    Smoke test for multiplexed storage clients.
    """

    storage_uris = [
        'azure://osmotest/osmo-test/client-library/tests/1Mx10/file1',
        'gs://osmo-test-bucket/client-library/tests/1Mx10/file1',
        's3://osmo-s3-test-bucket/client-library/tests/1Mx10/file1',
        'swift://pdx.s8k.io/AUTH_team-osmo-ops/dev/client-library/tests/1Mx10/file1',
        'tos://tos-s3-cn-shanghai.volces.com/nv-osmo-bucket/client-library/tests/1Mx10/file1',
    ]

    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.remote_test_folder = str(uuid.uuid4())

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_download_multiplexed(self):
        """
        Tests downloading a directory with multiplexed storage clients.
        """
        # Arrange
        mux_client_factory = mux.MuxStorageClientFactory()

        def _mux_worker_input_gen() -> Generator[mux.MuxThreadWorkerInput, None, None]:
            for i, storage_uri in enumerate(self.storage_uris):

                storage_backend = storage.construct_storage_backend(storage_uri)

                yield mux.MuxThreadWorkerInput(
                    storage_profile=storage_backend.profile,
                    worker_input=storage.DownloadWorkerInput(
                        container=storage_backend.container,
                        source=storage_backend.path,
                        destination=os.path.join(
                            self.temp_dir,
                            str(i),
                            os.path.basename(storage_uri),
                        ),
                        size=1024 * 1024,
                    ),
                )

        # Act
        job_ctx = mux.run_multiplexed_job(
            downloading.download_worker,
            _mux_worker_input_gen(),
            mux_client_factory,
            enable_progress_tracker=True,
            executor_params=storage.ExecutorParameters(
                num_processes=2,
                num_threads=5,
            ),
        )
        results = common.TransferSummary.from_job_context(job_ctx)

        # Assert
        self.assertEqual(len(results.failures), 0, results.failures)
        self.assertEqual(len(list(pathlib.Path(self.temp_dir).rglob('file1'))), 5)


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
