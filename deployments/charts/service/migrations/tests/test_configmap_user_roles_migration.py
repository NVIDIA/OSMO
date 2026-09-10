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

import json
import unittest

import psycopg2  # type: ignore
from python import runfiles  # type: ignore

from src.tests.common import fixtures


MIGRATION_RUNFILE_PREFIX = 'osmo_workspace/deployments/charts/service/migrations'
MIGRATION = '008_v6_4_0_configmap_user_roles.json'


class ConfigmapUserRolesMigrationTest(
        fixtures.PostgresFixture, fixtures.OsmoTestFixture):
    """Runs the user roles migration against known legacy schemas."""

    def setUp(self):
        super().setUp()
        self.connection = psycopg2.connect(
            host=self.postgres_container.get_container_host_ip(),
            port=self.postgres_container.get_database_port(),
            database=self.postgres_container.dbname,
            user=self.postgres_container.username,
            password=self.postgres_container.password,
        )
        self.connection.autocommit = True

    def tearDown(self):
        try:
            self.connection.close()
        finally:
            super().tearDown()

    @staticmethod
    def _migration_sql() -> str:
        runfiles_environment = runfiles.Create()
        if runfiles_environment is None:
            raise RuntimeError('Bazel runfiles environment is unavailable')
        runfile = runfiles_environment.Rlocation(
            f'{MIGRATION_RUNFILE_PREFIX}/{MIGRATION}')
        if not runfile:
            raise FileNotFoundError(MIGRATION)
        with open(runfile, encoding='utf-8') as migration_file:
            migration = json.load(migration_file)
        return migration['operations'][0]['sql']['up']

    def _create_legacy_schema(self, role_constraint_name: str) -> None:
        with self.connection.cursor() as cursor:
            cursor.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
            cursor.execute(
                f'''
                CREATE TABLE roles (
                    name TEXT PRIMARY KEY
                );
                CREATE TABLE users (
                    id TEXT PRIMARY KEY
                );
                CREATE TABLE user_roles (
                    user_id TEXT NOT NULL,
                    role_name TEXT NOT NULL,
                    CONSTRAINT {role_constraint_name}
                        FOREIGN KEY (role_name) REFERENCES roles(name),
                    CONSTRAINT user_roles_user_id_role_name_key
                        UNIQUE (user_id, role_name)
                );
                INSERT INTO roles VALUES ('admin');
                INSERT INTO users VALUES ('user@example.com');
                INSERT INTO user_roles VALUES ('user@example.com', 'admin');
                ''')

    def test_drops_known_role_foreign_keys_and_preserves_pair_uniqueness(self):
        for role_constraint_name in (
                'fk_user_roles_role', 'user_roles_role_name_fkey'):
            with self.subTest(role_constraint_name=role_constraint_name):
                self._create_legacy_schema(role_constraint_name)

                with self.connection.cursor() as cursor:
                    cursor.execute(self._migration_sql())
                    cursor.execute(self._migration_sql())
                    cursor.execute(
                        '''
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid = 'public.user_roles'::regclass
                          AND conname = ANY(%s)
                        ORDER BY conname
                        ''',
                        ([
                            'fk_user_roles_role',
                            'user_roles_role_name_fkey',
                        ],),
                    )
                    self.assertEqual(cursor.fetchall(), [])
                    cursor.execute(
                        '''
                        SELECT conname
                        FROM pg_constraint
                        WHERE conrelid = 'public.user_roles'::regclass
                          AND conname = 'user_roles_user_id_role_name_key'
                        ''')
                    self.assertEqual(
                        cursor.fetchall(),
                        [('user_roles_user_id_role_name_key',)],
                    )
                    with self.assertRaises(psycopg2.Error) as duplicate_error:
                        cursor.execute(
                            'INSERT INTO user_roles VALUES (%s, %s)',
                            ('user@example.com', 'admin'))
                    self.assertEqual(duplicate_error.exception.pgcode, '23505')


if __name__ == '__main__':
    unittest.main()
