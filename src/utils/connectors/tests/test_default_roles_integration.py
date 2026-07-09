"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
All rights reserved.

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

import json
import unittest
from typing import Any, Dict, List, cast

from src.tests.common import fixtures
from src.utils import connectors
from src.utils.connectors import postgres


class TestDefaultRoleIntegration(
    fixtures.PostgresFixture,
    fixtures.OsmoTestFixture,
):
    """Exercise default-role repair against PostgreSQL, including its CTEs."""

    database: postgres.PostgresConnector

    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.database = postgres.PostgresConnector(
            postgres.PostgresConfig(
                postgres_host=cls.postgres_container.get_container_host_ip(),
                postgres_port=cls.postgres_container.get_database_port(),
                postgres_password=cls.postgres_container.password,
                postgres_database_name=cls.postgres_container.dbname,
                postgres_user=cls.postgres_container.username,
                method='dev',
            )
        )

    @classmethod
    def tearDownClass(cls) -> None:
        try:
            if postgres.PostgresConnector._instance:  # pylint: disable=protected-access
                cls.database.close()
                # Avoid leaking the singleton if other tests share this process.
                postgres.PostgresConnector._instance = None  # pylint: disable=protected-access
        finally:
            super().tearDownClass()

    def _fetch_role_history(self) -> List[Dict[str, Any]]:
        rows = self.database.execute_fetch_command(
            '''
                SELECT revision, name, username, tags, description, data
                FROM config_history
                WHERE config_type = %s
                ORDER BY revision;
            ''',
            (connectors.ConfigHistoryType.ROLE.value.lower(),),
            True,
        )
        return cast(List[Dict[str, Any]], rows)

    def _fetch_delegator_row_version(self) -> str:
        rows = self.database.execute_fetch_command(
            'SELECT xmin::text AS row_version FROM roles WHERE name = %s;',
            (connectors.MCP_DELEGATOR_ROLE_NAME,),
            True,
        )
        self.assertEqual(len(rows), 1)
        return cast(str, rows[0]['row_version'])

    def test_compromised_delegator_is_restored_once(self) -> None:
        role_name = connectors.MCP_DELEGATOR_ROLE_NAME
        canonical_role = connectors.DEFAULT_ROLES[role_name]
        compromised_policy = {
            'effect': 'Allow',
            'actions': ['*:*'],
            'resources': ['*'],
        }

        initial_history = self._fetch_role_history()
        self.assertEqual([entry['revision'] for entry in initial_history], [1])

        # Seed every security-sensitive field with a non-canonical value. Direct
        # SQL keeps this precondition independent from the CTE under test.
        self.database.execute_commit_command(
            '''
                UPDATE roles
                SET description = %s,
                    policies = %s::jsonb[],
                    immutable = FALSE,
                    sync_mode = 'import'
                WHERE name = %s;
            ''',
            ('Compromised role', [json.dumps(compromised_policy)], role_name),
        )
        self.database.execute_commit_command(
            '''
                INSERT INTO role_external_mappings (role_name, external_role)
                VALUES (%s, %s);
            ''',
            (role_name, 'idp-admin'),
        )

        compromised_role = connectors.Role.fetch_from_db(self.database, role_name)
        self.assertEqual(compromised_role.description, 'Compromised role')
        self.assertEqual(
            [policy.to_dict() for policy in compromised_role.policies],
            [compromised_policy],
        )
        self.assertFalse(compromised_role.immutable)
        self.assertEqual(compromised_role.sync_mode.value, 'import')
        self.assertEqual(compromised_role.external_roles, ['idp-admin'])

        self.database.create_default_roles()

        restored_role = connectors.Role.fetch_from_db(self.database, role_name)
        self.assertEqual(restored_role, canonical_role)
        self.assertEqual(restored_role.external_roles, [])
        mappings = self.database.execute_fetch_command(
            '''
                SELECT external_role
                FROM role_external_mappings
                WHERE role_name = %s;
            ''',
            (role_name,),
            True,
        )
        self.assertEqual(mappings, [])

        history_after_repair = self._fetch_role_history()
        self.assertEqual(
            [entry['revision'] for entry in history_after_repair],
            [1, 2],
        )
        repair_history = history_after_repair[-1]
        self.assertEqual(repair_history['name'], '')
        self.assertEqual(repair_history['username'], 'system')
        self.assertIsNone(repair_history['tags'])
        self.assertEqual(repair_history['description'], 'Updated roles')
        expected_payload = [
            role.model_dump(mode='json')
            for role in connectors.Role.list_from_db(self.database)
        ]
        self.assertEqual(repair_history['data'], expected_payload)
        self.assertEqual(
            next(role for role in repair_history['data'] if role['name'] == role_name),
            canonical_role.model_dump(mode='json'),
        )

        row_version_after_repair = self._fetch_delegator_row_version()
        self.database.create_default_roles()

        self.assertEqual(
            connectors.Role.fetch_from_db(self.database, role_name),
            canonical_role,
        )
        self.assertEqual(
            self._fetch_delegator_row_version(),
            row_version_after_repair,
        )
        self.assertEqual(self._fetch_role_history(), history_after_repair)


if __name__ == '__main__':
    unittest.main()
