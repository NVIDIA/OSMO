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
Tests for client_configs module.
"""

import os
import tempfile
import unittest
from unittest import mock

import yaml

from src.lib.utils import client_configs, credentials, osmo_errors


class TestGetCredentials(unittest.TestCase):
    """Tests for get_credentials function."""

    def setUp(self):
        """Clear LRU cache before each test."""
        client_configs.get_credentials.cache_clear()

    def test_get_credentials_with_none_access_keys(self):
        """Test that credentials with None access keys are returned for environment-based auth."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = os.path.join(tmpdir, 'config.yaml')
            config = {
                'auth': {
                    'data': {
                        'azure://mystorageaccount': {
                            'access_key_id': None,
                            'access_key': None,
                            'region': 'eastus',
                        }
                    }
                }
            }
            with open(config_file, 'w', encoding='utf-8') as f:
                yaml.dump(config, f)

            with mock.patch.object(client_configs, 'get_client_config_dir', return_value=tmpdir):
                client_configs.get_credentials.cache_clear()
                url = 'azure://mystorageaccount'
                cred = client_configs.get_credentials(url)

                self.assertIsInstance(cred, credentials.DataCredential)
                self.assertIsNone(cred.access_key_id)
                self.assertIsNone(cred.get_access_key_value())
                self.assertEqual(cred.endpoint, url)
                self.assertEqual(cred.region, 'eastus')

    def test_get_credentials_with_explicit_keys(self):
        """Test that credentials with explicit access keys are returned correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = os.path.join(tmpdir, 'config.yaml')
            config = {
                'auth': {
                    'data': {
                        's3://mybucket': {
                            'access_key_id': 'my_key_id',
                            'access_key': 'my_secret_key',
                            'region': 'us-west-2',
                        }
                    }
                }
            }
            with open(config_file, 'w', encoding='utf-8') as f:
                yaml.dump(config, f)

            with mock.patch.object(client_configs, 'get_client_config_dir', return_value=tmpdir):
                client_configs.get_credentials.cache_clear()
                url = 's3://mybucket'
                cred = client_configs.get_credentials(url)

                self.assertIsInstance(cred, credentials.DataCredential)
                self.assertEqual(cred.access_key_id, 'my_key_id')
                self.assertEqual(cred.get_access_key_value(), 'my_secret_key')
                self.assertEqual(cred.endpoint, url)
                self.assertEqual(cred.region, 'us-west-2')

    def test_get_credentials_missing_raises_error(self):
        """Test that missing credentials raise error with helpful message."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with mock.patch.object(client_configs, 'get_client_config_dir', return_value=tmpdir):
                client_configs.get_credentials.cache_clear()
                url = 's3://mybucket'
                with self.assertRaises(osmo_errors.OSMOError) as context:
                    client_configs.get_credentials(url)

                self.assertIn('Credential not set', str(context.exception))
                self.assertIn('osmo credential set', str(context.exception))


if __name__ == '__main__':
    unittest.main()
