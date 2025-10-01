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

from src.cli.config import deep_diff


class TestConfigUpdate(unittest.TestCase):
    """Test cases for config_update module."""

    def test_deep_diff_no_changes(self):
        """Test deep_diff when there are no changes."""
        current = {"a": 1, "b": {"c": 2}}
        updated = {"a": 1, "b": {"c": 2}}

        result = deep_diff(current, updated)
        self.assertIsNone(result)

    def test_deep_diff_simple_value_change(self):
        """Test deep_diff with a simple value change."""
        current = {"a": 1, "b": 2}
        updated = {"a": 1, "b": 3}

        result = deep_diff(current, updated)
        expected = {"b": 3}
        self.assertEqual(result, expected)

    def test_deep_diff_nested_dict_change(self):
        """Test deep_diff with nested dictionary changes."""
        current = {"a": 1, "b": {"c": 2, "d": 3}}
        updated = {"a": 1, "b": {"c": 2, "d": 4}}

        result = deep_diff(current, updated)
        expected = {"b": {"d": 4}}
        self.assertEqual(result, expected)

    def test_deep_diff_dict_item_added(self):
        """Test deep_diff when a dictionary item is added."""
        current = {"a": 1, "b": {"c": 2}}
        updated = {"a": 1, "b": {"c": 2, "d": 3}}

        result = deep_diff(current, updated)
        expected = {"b": {"d": 3}}
        self.assertEqual(result, expected)

    def test_deep_diff_dict_item_removed(self):
        """Test deep_diff when a dictionary item is removed."""
        current = {"a": 1, "b": {"c": 2, "d": 3}}
        updated = {"a": 1, "b": {"c": 2}}

        result = deep_diff(current, updated)
        # Removed items should not be included in the patch
        self.assertIsNone(result)

    def test_deep_diff_list_change(self):
        """Test deep_diff when a list changes."""
        current = {"a": 1, "b": [1, 2, 3]}
        updated = {"a": 1, "b": [1, 2, 4]}

        result = deep_diff(current, updated)
        expected = {"b": [1, 2, 4]}
        self.assertEqual(result, expected)

    def test_deep_diff_list_item_added(self):
        """Test deep_diff when a list item is added."""
        current = {"a": 1, "b": [1, 2]}
        updated = {"a": 1, "b": [1, 2, 3]}

        result = deep_diff(current, updated)
        expected = {"b": [1, 2, 3]}
        self.assertEqual(result, expected)

    def test_deep_diff_list_item_removed(self):
        """Test deep_diff when a list item is removed."""
        current = {"a": 1, "b": [1, 2, 3]}
        updated = {"a": 1, "b": [1, 2]}

        result = deep_diff(current, updated)
        expected = {"b": [1, 2]}
        self.assertEqual(result, expected)

    def test_deep_diff_nested_list_change(self):
        """Test deep_diff with nested list changes."""
        current = {"a": 1, "b": [{"c": 1}, {"c": 2}]}
        updated = {"a": 1, "b": [{"c": 1}, {"c": 3}]}

        result = deep_diff(current, updated)
        expected = {"b": [{"c": 1}, {"c": 3}]}
        self.assertEqual(result, expected)

    def test_deep_diff_type_change(self):
        """Test deep_diff when a value type changes."""
        current = {"a": 1, "b": "string"}
        updated = {"a": 1, "b": 123}

        result = deep_diff(current, updated)
        expected = {"b": 123}
        self.assertEqual(result, expected)

    def test_deep_diff_complex_nested_structure(self):
        """Test deep_diff with complex nested structures."""
        current = {
            "config": {
                "pools": {
                    "pool1": {
                        "platforms": ["gpu", "cpu"],
                        "settings": {"max_workers": 10},
                        "description": "same description"
                    }
                },
                "enabled": False
            }
        }
        updated = {
            "config": {
                "pools": {
                    "pool1": {
                        "platforms": ["gpu", "cpu", "fpga"],
                        "settings": {"max_workers": 15},
                        "description": "same description"
                    },
                    "pool2": {
                        "description": "new description"
                    }
                },
                "enabled": True
            }
        }

        result = deep_diff(current, updated)
        expected = {
            "config": {
                "pools": {
                    "pool1": {
                        "platforms": ["gpu", "cpu", "fpga"],
                        "settings": {"max_workers": 15}
                    },
                    "pool2": {
                        "description": "new description"
                    }
                },
                "enabled": True
            }
        }
        self.assertEqual(result, expected)


if __name__ == '__main__':
    unittest.main()
