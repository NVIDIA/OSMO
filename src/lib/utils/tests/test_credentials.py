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
Unit tests for the credentials module.
"""

import unittest

import pydantic

from src.lib.utils import credentials


class TestBasicDataCredential(unittest.TestCase):
    """
    Tests for BasicDataCredential class.
    """

    def test_get_access_key_value_returns_value_when_set(self):
        """Test that get_access_key_value returns the secret value when access_key is set."""
        # Arrange
        cred = credentials.BasicDataCredential(
            access_key_id='test-key-id',
            access_key=pydantic.SecretStr('test-secret'),
        )

        # Act
        result = cred.get_access_key_value()

        # Assert
        self.assertEqual(result, 'test-secret')

    def test_get_access_key_value_returns_none_when_not_set(self):
        """Test that get_access_key_value returns None when access_key is None."""
        # Arrange
        cred = credentials.BasicDataCredential()

        # Act
        result = cred.get_access_key_value()

        # Assert
        self.assertIsNone(result)

    def test_optional_fields_default_to_none(self):
        """Test that both access_key_id and access_key default to None."""
        # Arrange & Act
        cred = credentials.BasicDataCredential()

        # Assert
        self.assertIsNone(cred.access_key_id)
        self.assertIsNone(cred.access_key)

    def test_fields_accept_explicit_values(self):
        """Test that fields accept and store explicit values correctly."""
        # Arrange & Act
        cred = credentials.BasicDataCredential(
            access_key_id='my-key-id',
            access_key=pydantic.SecretStr('my-secret'),
        )

        # Assert
        self.assertEqual(cred.access_key_id, 'my-key-id')
        self.assertIsNotNone(cred.access_key)
        self.assertEqual(cred.get_access_key_value(), 'my-secret')


if __name__ == '__main__':
    unittest.main()
