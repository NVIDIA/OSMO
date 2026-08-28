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

    def test_resource_tokens_derive_units_after_defaults_are_merged(self):
        cases = [
            (connectors.ResourceSpec(memory='512Mi', storage='100Mi'),
             {'USER_MEMORY': '1Gi', 'USER_STORAGE': '1Gi'}, 0.5, 100 / 1024),
            (connectors.ResourceSpec(),
             {'USER_MEMORY': '1Gi', 'USER_STORAGE': '1Gi'}, 1.0, 1.0),
            (connectors.ResourceSpec(),
             {'USER_MEMORY': '64Gi', 'USER_STORAGE': '64Gi'}, 64.0, 64.0),
        ]

        for resource_spec, defaults, memory_gi, storage_gi in cases:
            with self.subTest(defaults=defaults, resource_spec=resource_spec):
                tokens = resource_spec.get_allocatable_tokens(defaults)
                self.assertEqual(tokens['USER_MEMORY_Gi'], memory_gi)
                self.assertEqual(tokens['USER_STORAGE_Gi'], storage_gi)

    def test_cache_uses_explicit_storage_not_default_storage(self):
        cases = [
            (connectors.ResourceSpec(storage='10Gi'), {}, '50%', '5Gi'),
            (connectors.ResourceSpec(storage='10Gi'), {}, None, '9Gi'),
            (connectors.ResourceSpec(), {'USER_STORAGE': '1Gi'}, '50%', '0None'),
            (connectors.ResourceSpec(), {'USER_STORAGE': '1Gi'}, None, '0MiB'),
        ]

        for resource_spec, defaults, cache_size, expected_cache in cases:
            with self.subTest(resource_spec=resource_spec, cache_size=cache_size):
                tokens = resource_spec.get_allocatable_tokens(defaults, cache_size)
                self.assertEqual(tokens['USER_CACHE'], expected_cache)

if __name__ == '__main__':
    unittest.main()
