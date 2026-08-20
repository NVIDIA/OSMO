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
import threading
import time
import unittest

import psycopg2  # type: ignore
from python import runfiles  # type: ignore

from src.tests.common import fixtures
from src.utils.connectors import postgres


MIGRATION_RUNFILE_PREFIX = 'osmo_workspace/deployments/charts/service/migrations'
SCHEMA_MIGRATION = '007_v6_4_0_user_identities_schema.json'
DATA_MIGRATION = '008_v6_4_0_user_identities_data.json'


class UserIdentitiesMigrationTest(
        fixtures.PostgresFixture, fixtures.OsmoTestFixture):
    """Runs the shipped identity migrations against a legacy schema."""

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
        with self.connection.cursor() as cursor:
            cursor.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
            cursor.execute(
                '''
                CREATE TABLE users (
                    id TEXT PRIMARY KEY,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    created_by TEXT
                );
                CREATE TABLE workflows (
                    workflow_uuid TEXT PRIMARY KEY,
                    submitted_by TEXT
                );
                CREATE TABLE apps (
                    uuid TEXT PRIMARY KEY,
                    owner TEXT
                );
                CREATE TABLE app_versions (
                    uuid TEXT,
                    version INTEGER,
                    created_by TEXT,
                    PRIMARY KEY (uuid, version)
                );
                CREATE TABLE credential (
                    user_name TEXT,
                    cred_name TEXT,
                    PRIMARY KEY (user_name, cred_name)
                );
                ''')

    def tearDown(self):
        try:
            if postgres.PostgresConnector._instance:  # pylint: disable=protected-access
                postgres.PostgresConnector._instance.close()  # pylint: disable=protected-access
                postgres.PostgresConnector._instance = None  # pylint: disable=protected-access
            self.connection.close()
        finally:
            super().tearDown()

    @staticmethod
    def _migration_sql(filename: str) -> str:
        runfiles_environment = runfiles.Create()
        if runfiles_environment is None:
            raise RuntimeError('Bazel runfiles environment is unavailable')
        runfile = runfiles_environment.Rlocation(
            f'{MIGRATION_RUNFILE_PREFIX}/{filename}')
        if not runfile:
            raise FileNotFoundError(filename)
        with open(runfile, encoding='utf-8') as migration_file:
            migration = json.load(migration_file)
        return migration['operations'][0]['sql']['up']

    def _run_migrations(self):
        with self.connection.cursor() as cursor:
            cursor.execute(self._migration_sql(SCHEMA_MIGRATION))
            cursor.execute(self._migration_sql(DATA_MIGRATION))

    def test_backfills_references_adds_constraints_and_is_idempotent(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO users (id) VALUES ('active@nvidia.com')")
            cursor.execute(
                "INSERT INTO workflows VALUES ('workflow', 'historical@nvidia.com')")
            cursor.execute(
                "INSERT INTO apps VALUES ('app', 'owner@nvidia.com')")
            cursor.execute(
                "INSERT INTO app_versions VALUES ('app', 1, 'creator@nvidia.com')")
            cursor.execute(
                "INSERT INTO credential VALUES ('active@nvidia.com', 'active')")
            cursor.execute(
                "INSERT INTO credential VALUES ('orphan@nvidia.com', 'orphan')")

        self._run_migrations()
        self._run_migrations()

        with self.connection.cursor() as cursor:
            cursor.execute('SELECT id FROM user_identities ORDER BY id')
            self.assertEqual(
                [row[0] for row in cursor.fetchall()],
                [
                    'active@nvidia.com',
                    'creator@nvidia.com',
                    'historical@nvidia.com',
                    'owner@nvidia.com',
                ],
            )
            cursor.execute('SELECT user_name FROM credential ORDER BY user_name')
            self.assertEqual(cursor.fetchall(), [('active@nvidia.com',)])
            cursor.execute(
                '''
                SELECT conname, convalidated
                FROM pg_constraint
                WHERE conname = ANY(%s)
                ORDER BY conname
                ''',
                ([
                    'app_versions_created_by_identity_fkey',
                    'apps_owner_identity_fkey',
                    'credential_user_name_fkey',
                    'users_identity_fkey',
                    'workflows_submitted_by_identity_fkey',
                ],),
            )
            self.assertEqual(
                cursor.fetchall(),
                [
                    ('app_versions_created_by_identity_fkey', True),
                    ('apps_owner_identity_fkey', True),
                    ('credential_user_name_fkey', True),
                    ('users_identity_fkey', True),
                    ('workflows_submitted_by_identity_fkey', True),
                ],
            )
            cursor.execute(
                'SELECT COUNT(*) FROM pg_indexes WHERE indexname = %s',
                ('users_base_username_id_idx',),
            )
            self.assertEqual(cursor.fetchone()[0], 1)

    def test_rejects_empty_persistent_identity(self):
        with self.connection.cursor() as cursor:
            cursor.execute("INSERT INTO workflows VALUES ('workflow', '')")
            cursor.execute(self._migration_sql(SCHEMA_MIGRATION))
            with self.assertRaisesRegex(
                    psycopg2.Error, 'empty persistent user identity'):
                cursor.execute(self._migration_sql(DATA_MIGRATION))

    def test_data_migration_blocks_concurrent_persistent_writes(self):
        with self.connection.cursor() as cursor:
            cursor.execute(self._migration_sql(SCHEMA_MIGRATION))

        connection_parameters = {
            'host': self.postgres_container.get_container_host_ip(),
            'port': self.postgres_container.get_database_port(),
            'database': self.postgres_container.dbname,
            'user': self.postgres_container.username,
            'password': self.postgres_container.password,
        }
        blocker = psycopg2.connect(**connection_parameters)
        migrator = psycopg2.connect(**connection_parameters)
        writer = psycopg2.connect(**connection_parameters)
        migration_errors: list[Exception] = []
        migration_thread: threading.Thread | None = None
        try:
            with blocker.cursor() as cursor:
                cursor.execute(
                    'LOCK TABLE user_identities IN ACCESS EXCLUSIVE MODE')
            with migrator.cursor() as cursor:
                cursor.execute('SELECT pg_backend_pid()')
                migrator_process_id = cursor.fetchone()[0]

            def run_data_migration() -> None:
                try:
                    with migrator.cursor() as cursor:
                        cursor.execute(self._migration_sql(DATA_MIGRATION))
                    migrator.commit()
                except Exception as error:  # pylint: disable=broad-exception-caught
                    migration_errors.append(error)

            migration_thread = threading.Thread(target=run_data_migration)
            migration_thread.start()
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                with self.connection.cursor() as cursor:
                    cursor.execute(
                        '''
                        SELECT wait_event_type
                        FROM pg_stat_activity
                        WHERE pid = %s
                        ''',
                        (migrator_process_id,),
                    )
                    row = cursor.fetchone()
                if row and row[0] == 'Lock':
                    break
                time.sleep(0.01)
            else:
                self.fail('data migration did not reach the controlled lock wait')

            with writer.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '200ms'")
                with self.assertRaises(psycopg2.Error) as lock_error:
                    cursor.execute(
                        "INSERT INTO workflows VALUES ('concurrent', 'writer@nvidia.com')")
                self.assertEqual(lock_error.exception.pgcode, '55P03')
            writer.rollback()

            blocker.rollback()
            migration_thread.join(timeout=5)
            self.assertFalse(migration_thread.is_alive())
            self.assertEqual(migration_errors, [])
        finally:
            writer.rollback()
            blocker.rollback()
            if migration_thread:
                migration_thread.join(timeout=5)
            migrator.rollback()
            blocker.close()
            migrator.close()
            writer.close()

    def test_fresh_database_schema_has_identity_relationships(self):
        with self.connection.cursor() as cursor:
            cursor.execute('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')

        postgres.PostgresConnector(
            postgres.PostgresConfig(
                postgres_host=self.postgres_container.get_container_host_ip(),
                postgres_port=self.postgres_container.get_database_port(),
                postgres_password=self.postgres_container.password,
                postgres_database_name=self.postgres_container.dbname,
                postgres_user=self.postgres_container.username,
                method='dev',
            ))

        with self.connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('public.user_identities')")
            self.assertEqual(cursor.fetchone()[0], 'user_identities')
            cursor.execute(
                '''
                SELECT conname
                FROM pg_constraint
                WHERE conname = ANY(%s)
                ORDER BY conname
                ''',
                ([
                    'app_versions_created_by_identity_fkey',
                    'apps_owner_identity_fkey',
                    'credential_user_name_fkey',
                    'users_identity_fkey',
                    'workflows_submitted_by_identity_fkey',
                ],),
            )
            self.assertEqual(
                [row[0] for row in cursor.fetchall()],
                [
                    'app_versions_created_by_identity_fkey',
                    'apps_owner_identity_fkey',
                    'credential_user_name_fkey',
                    'users_identity_fkey',
                    'workflows_submitted_by_identity_fkey',
                ],
            )
            cursor.execute(
                'SELECT COUNT(*) FROM pg_indexes WHERE indexname = %s',
                ('users_base_username_id_idx',),
            )
            self.assertEqual(cursor.fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
