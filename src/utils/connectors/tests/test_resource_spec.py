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

from src.lib.utils import osmo_errors
from src.utils import connectors


class TestResourceSpec(unittest.TestCase):
    def test_resource_spec_bad_inputs(self):
        """ Make sure resource spec throws exceptions for bad inputs. """
        # Should not throw an error
        connectors.ResourceSpec(cpu=2, storage='10Gi', memory='10Mi', platform='test')
        # Decimals should work
        connectors.ResourceSpec(cpu=2, storage='10.5Gi', memory='10Mi', platform='test')
        with self.assertRaises(osmo_errors.OSMOResourceError):
            # Bad value for unit (storage)
            connectors.ResourceSpec(cpu=2, storage='10A', memory='10Mi', platform='test')
        with self.assertRaises(osmo_errors.OSMOResourceError):
            # Bad value for unit (memory)
            connectors.ResourceSpec(cpu=2, storage='10Gi', memory='10A', platform='test')
        with self.assertRaises(osmo_errors.OSMOResourceError):
            # No numerical value for storage
            connectors.ResourceSpec(cpu=2, storage='Gi', memory='10Mi', platform='test')

if __name__ == '__main__':
    unittest.main()
