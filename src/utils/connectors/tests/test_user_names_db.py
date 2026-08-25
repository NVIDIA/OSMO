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

from src.lib.utils import osmo_errors
from src.tests.common import fixtures
from src.utils.connectors import postgres


CURRENT_USERS = (
    'alice',
    'alice@example.com',
    'alice@osmo.example.com',
    'exact@example.com',
    'unique@example.com',
)
HISTORICAL_USER = 'historical@example.com'


class UserNamesDatabaseTest(
        fixtures.PostgresFixture,
        fixtures.PostgresTestIsolationFixture,
        fixtures.OsmoTestFixture):
    """Database coverage for current-user identity resolution."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        postgres.PostgresConnector(
            postgres.PostgresConfig(
                postgres_host=cls.postgres_container.get_container_host_ip(),
                postgres_port=cls.postgres_container.get_database_port(),
                postgres_password=cls.postgres_container.password,
                postgres_database_name=cls.postgres_container.dbname,
                postgres_user=cls.postgres_container.username,
                method='dev',
            ))

    @classmethod
    def tearDownClass(cls):
        try:
            if postgres.PostgresConnector._instance:  # pylint: disable=protected-access
                postgres.PostgresConnector._instance.close()  # pylint: disable=protected-access
                postgres.PostgresConnector._instance = None  # pylint: disable=protected-access
        finally:
            super().tearDownClass()

    @property
    def database(self) -> postgres.PostgresConnector:
        return postgres.PostgresConnector.get_instance()

    def setUp(self):
        super().setUp()
        for user_name in CURRENT_USERS:
            postgres.upsert_user(self.database, user_name)

    def _resolver_sql(self) -> str:
        with mock.patch.object(
                self.database, 'execute_fetch_command', return_value=[]) as execute_fetch:
            self.database.fetch_user_names(['capture'])
        return execute_fetch.call_args.args[0]

    def test_qualified_identity_matches_only_itself(self):
        self.assertEqual(
            self.database.fetch_user_names(['alice@example.com']),
            ['alice@example.com'],
        )

    def test_unique_base_identity_resolves_to_qualified_user(self):
        self.assertEqual(
            self.database.fetch_user_names(['unique']),
            ['unique@example.com'],
        )

    def test_ambiguous_base_expands_to_every_current_identity(self):
        self.assertEqual(
            set(self.database.fetch_user_names(['alice'])),
            {
                'alice',
                'alice@example.com',
                'alice@osmo.example.com',
            },
        )

    def test_historical_identity_is_not_a_current_user(self):
        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError,
                r'Invalid user\(s\): historical@example.com not found'):
            self.database.fetch_user_names([HISTORICAL_USER])

    def test_multiple_duplicate_and_overlapping_inputs_are_deduplicated(self):
        resolved = self.database.fetch_user_names([
            'unique',
            'exact@example.com',
            'unique',
            'alice',
            'alice@example.com',
        ])

        self.assertEqual(
            set(resolved),
            set(CURRENT_USERS),
        )
        self.assertEqual(len(resolved), len(set(resolved)))

    def test_all_missing_inputs_are_reported_deterministically(self):
        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError,
                r'Invalid user\(s\): absent not found, missing@example.com not found'):
            self.database.fetch_user_names(['missing@example.com', 'absent', 'absent'])

    def test_resolver_sql_does_not_read_historical_resource_tables(self):
        resolver_sql = self._resolver_sql().lower()
        self.assertIn('from users', resolver_sql)
        self.assertNotIn('from workflows', resolver_sql)
        self.assertNotIn('from apps', resolver_sql)
        self.assertNotIn('from app_versions', resolver_sql)

    def test_exact_and_base_predicates_are_index_eligible(self):
        index_rows = self.database.execute_fetch_command(
            '''
            SELECT indexname, indexdef
            FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'users'
            ''',
            (),
            True,
        )
        primary_index = next(
            row['indexname'] for row in index_rows
            if ' UNIQUE INDEX ' in row['indexdef']
            and 'USING btree (id)' in row['indexdef']
        )
        base_index = next(
            row['indexname'] for row in index_rows
            if 'split_part' in row['indexdef']
        )
        resolver_sql = self._resolver_sql()

        exact_plan = self.database.execute_fetch_command(
            f'''
            SET LOCAL enable_seqscan = off;
            EXPLAIN (FORMAT JSON, COSTS OFF)
            {resolver_sql}
            ''',
            (['exact@example.com'],),
            True,
        )
        base_plan = self.database.execute_fetch_command(
            f'''
            SET LOCAL enable_seqscan = off;
            EXPLAIN (FORMAT JSON, COSTS OFF)
            {resolver_sql}
            ''',
            (['alice'],),
            True,
        )

        self.assertIn(primary_index, str(exact_plan))
        self.assertIn(base_index, str(base_plan))


if __name__ == '__main__':
    unittest.main()
