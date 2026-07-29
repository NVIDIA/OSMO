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


def _normalize_sql(command: str) -> str:
    return ' '.join(command.split())


class TestWorkflowLabelSchema(unittest.TestCase):
    """The in-code database bootstrap defines the canonical label schema."""

    commit_commands: list[str]
    autocommit_commands: list[str]

    @classmethod
    def setUpClass(cls) -> None:
        database = object.__new__(connectors.PostgresConnector)
        database.execute_commit_command = mock.Mock()
        database.execute_autocommit_command = mock.Mock()
        database._init_tables()  # pylint: disable=protected-access

        cls.commit_commands = [
            _normalize_sql(call.args[0])
            for call in database.execute_commit_command.call_args_list
        ]
        cls.autocommit_commands = [
            _normalize_sql(call.args[0])
            for call in database.execute_autocommit_command.call_args_list
        ]

    def test_in_code_schema_has_nullable_jsonb_labels(self) -> None:
        workflow_table = next(
            command
            for command in self.commit_commands
            if 'CREATE TABLE IF NOT EXISTS workflows' in command
        )

        self.assertIn('labels JSONB,', workflow_table)
        self.assertNotIn('labels JSONB NOT NULL', workflow_table)
        self.assertNotIn('labels JSONB DEFAULT', workflow_table)

    def test_in_code_schema_has_concurrent_jsonb_ops_gin_index(self) -> None:
        labels_index = next(
            command
            for command in self.autocommit_commands
            if 'workflow_labels_gin_idx' in command
        )

        self.assertIn(
            'CREATE INDEX CONCURRENTLY IF NOT EXISTS '
            'workflow_labels_gin_idx',
            labels_index,
        )
        self.assertIn(
            'ON workflows USING gin (labels jsonb_ops)', labels_index)


if __name__ == '__main__':
    unittest.main()
