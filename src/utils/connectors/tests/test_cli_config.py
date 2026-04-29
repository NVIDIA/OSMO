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
import unittest

from src.lib.utils import osmo_errors
from src.utils import connectors


class TestCliConfig(unittest.TestCase):
    """ Validation tests for the CliConfig pydantic model. """

    def test_accepts_valid_versions(self):
        connectors.CliConfig()
        connectors.CliConfig(latest_version='1.2.3')
        connectors.CliConfig(latest_version='1.2.3.abc123')
        connectors.CliConfig(min_supported_version='0.0.1')
        connectors.CliConfig(latest_version='1.2.3', min_supported_version='1.0.0')

    def test_accepts_none_and_empty(self):
        connectors.CliConfig(latest_version=None, min_supported_version=None)
        connectors.CliConfig(latest_version='', min_supported_version='')

    def test_rejects_malformed_latest_version(self):
        for bad in ['test-cli', 'v1.2.3', '1.2.3-rc1', '1.2', 'latest', '1.2.3.4.5']:
            with self.subTest(bad=bad), self.assertRaises(osmo_errors.OSMOUserError):
                connectors.CliConfig(latest_version=bad)

    def test_rejects_malformed_min_supported_version(self):
        for bad in ['test-cli', 'v1.2.3', '1.2.3-rc1', '1.2', 'latest']:
            with self.subTest(bad=bad), self.assertRaises(osmo_errors.OSMOUserError):
                connectors.CliConfig(min_supported_version=bad)


if __name__ == '__main__':
    unittest.main()
