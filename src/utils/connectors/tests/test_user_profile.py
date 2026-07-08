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
from unittest import mock

from src.utils import connectors


class UserProfileTest(unittest.TestCase):

    def setUp(self) -> None:
        self.database = mock.create_autospec(
            connectors.PostgresConnector, instance=True)
        self.database.execute_fetch_command.return_value = []

    def test_read_only_fetch_returns_defaults_without_inserting(self) -> None:
        with mock.patch.object(
            connectors.UserProfile, 'insert_default_profile',
        ) as insert_default_profile:
            profile = connectors.UserProfile.fetch_from_db(
                self.database, 'alice', create_if_missing=False)

        self.assertEqual(
            profile, connectors.UserProfile.default_profile('alice'))
        insert_default_profile.assert_not_called()

    def test_default_fetch_preserves_lazy_profile_creation(self) -> None:
        with mock.patch.object(
            connectors.UserProfile, 'insert_default_profile',
        ) as insert_default_profile:
            profile = connectors.UserProfile.fetch_from_db(
                self.database, 'alice')

        self.assertEqual(
            profile, connectors.UserProfile.default_profile('alice'))
        insert_default_profile.assert_called_once_with(self.database, 'alice')


if __name__ == '__main__':
    unittest.main()
