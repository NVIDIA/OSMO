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
import unittest

from src.lib.utils import common


class TestCommon(unittest.TestCase):
    def test_convert_resource_value(self):
        self.assertEqual(common.convert_resource_value_str('10Gi', target='TiB'), 10.0 / 1024)
        self.assertEqual(common.convert_resource_value_str('1.5Ti', target='GiB'), 1.5 * 1024)
        self.assertEqual(common.convert_resource_value_str(
            '1.5Ti', target='MiB'), 1.5 * 1024 * 1024)
        self.assertEqual(common.convert_resource_value_str('1000', target='KiB'), 1000.0 / 1024)


if __name__ == '__main__':
    unittest.main()
