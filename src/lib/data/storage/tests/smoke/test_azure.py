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
Smoke test for Azure Blob Storage.
"""

import unittest

import pydantic

from src.lib.data import storage
from src.lib.data.storage.tests import smoke
from src.lib.utils import credentials, osmo_errors


class AzureBlobStorageTest(smoke.SmokeTestBase):
    """
    Smoke test for Azure Blob Storage that extends the base test class.

    IMPORTANT: In order to run this test, ensure that azure://osmotest is configured to allow
    networking access from the test machine's IP address.
    """

    storage_uri = 'azure://osmotest/osmo-test/client-library/tests'

    def test_endpoint_remote_uri_mismatch(self):
        """
        Tests that the client initialization fails if the data credential endpoint
        and remote URI mismatch.
        """
        with self.assertRaises(osmo_errors.OSMOCredentialError):
            storage.Client.create(
                storage_uri='azure://expected-account/container',
                data_credential=credentials.DataCredential(
                    endpoint='azure://incorrect-account/container',
                    access_key_id='test',
                    access_key=pydantic.SecretStr('test'),
                    region='us-east-1',
                ),
            )

    def test_remote_path_storage_uri_mismatch(self):
        """
        Tests that the download operation fails if the remote path and storage URI mismatch.
        """
        with self.assertRaises(osmo_errors.OSMOUsageError):
            self.test_storage_client.download_objects(
                self.temp_dir,
                source='azure://osmotest/incorrect-container/file.txt',
            )


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
