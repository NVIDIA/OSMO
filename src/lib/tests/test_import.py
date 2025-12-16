
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

# pyright: reportMissingImports=false

import unittest

import osmo
import osmo.data


class ImportTestCase(unittest.TestCase):
    """
    Tests that osmo library can be imported correctly
    """

    def test_import(self):
        self.assertEqual(osmo.__name__, 'osmo')

    def test_data_import(self):
        self.assertEqual(osmo.data.__name__, 'osmo.data')


if __name__ == '__main__':
    runner = unittest.TextTestRunner(verbosity=2)
    unittest.main(testRunner=runner)
