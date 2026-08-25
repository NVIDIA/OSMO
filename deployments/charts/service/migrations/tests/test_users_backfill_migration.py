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
MIGRATION = '007_v6_4_0_users_backfill.json'


class UsersBackfillMigrationTest(
        fixtures.PostgresFixture, fixtures.OsmoTestFixture):
    """Runs the shipped users backfill migration against a legacy schema."""

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

    def _run_migration(self):
        with self.connection.cursor() as cursor:
            cursor.execute(self._migration_sql(MIGRATION))

    def test_backfills_users_adds_credential_constraint_and_is_idempotent(self):
        with self.connection.cursor() as cursor:
            cursor.execute(
                '''
                INSERT INTO users (id, created_by)
                VALUES ('active@example.com', 'existing-creator')
                ''')
            cursor.execute(
                "INSERT INTO workflows VALUES ('workflow', 'historical@example.com')")
            cursor.execute(
                "INSERT INTO apps VALUES ('app', 'owner@example.com')")
            cursor.execute(
                "INSERT INTO app_versions VALUES ('app', 1, 'creator@example.com')")
            cursor.execute(
                "INSERT INTO credential VALUES ('active@example.com', 'active')")
            cursor.execute(
                "INSERT INTO credential VALUES ('orphan@example.com', 'orphan')")
            cursor.execute("INSERT INTO workflows VALUES ('null-workflow', NULL)")
            cursor.execute("INSERT INTO apps VALUES ('null-app', NULL)")
            cursor.execute("INSERT INTO app_versions VALUES ('null-app', 1, NULL)")

        self._run_migration()
        self._run_migration()

        with self.connection.cursor() as cursor:
            cursor.execute('SELECT id, created_by FROM users ORDER BY id')
            self.assertEqual(
                cursor.fetchall(),
                [
                    ('active@example.com', 'existing-creator'),
                    ('creator@example.com', 'migration'),
                    ('historical@example.com', 'migration'),
                    ('owner@example.com', 'migration'),
                ],
            )
            cursor.execute('SELECT user_name FROM credential ORDER BY user_name')
            self.assertEqual(cursor.fetchall(), [('active@example.com',)])
            cursor.execute(
                '''
                SELECT
                    conname,
                    convalidated,
                    confrelid::regclass::text,
                    confdeltype
                FROM pg_constraint
                WHERE conrelid = 'public.credential'::regclass
                  AND conname = %s
                ''',
                ('credential_user_name_fkey',),
            )
            self.assertEqual(
                cursor.fetchall(),
                [('credential_user_name_fkey', True, 'users', 'c')],
            )
            cursor.execute("SELECT to_regclass('public.user_identities')")
            self.assertIsNone(cursor.fetchone()[0])
            cursor.execute(
                'SELECT COUNT(*) FROM pg_indexes WHERE indexname = %s',
                ('users_base_username_id_idx',),
            )
            self.assertEqual(cursor.fetchone()[0], 1)

    def test_deleting_user_cascades_credentials_but_retains_history(self):
        with self.connection.cursor() as cursor:
            cursor.execute("INSERT INTO users (id) VALUES ('owner@example.com')")
            cursor.execute(
                "INSERT INTO workflows VALUES ('workflow', 'owner@example.com')")
            cursor.execute("INSERT INTO apps VALUES ('app', 'owner@example.com')")
            cursor.execute(
                "INSERT INTO app_versions VALUES ('app', 1, 'owner@example.com')")
            cursor.execute(
                "INSERT INTO credential VALUES ('owner@example.com', 'credential')")

        self._run_migration()

        with self.connection.cursor() as cursor:
            cursor.execute("DELETE FROM users WHERE id = 'owner@example.com'")
            cursor.execute(
                '''
                SELECT
                    (SELECT COUNT(*) FROM credential
                     WHERE user_name = 'owner@example.com'),
                    (SELECT COUNT(*) FROM workflows
                     WHERE submitted_by = 'owner@example.com'),
                    (SELECT COUNT(*) FROM apps
                     WHERE owner = 'owner@example.com'),
                    (SELECT COUNT(*) FROM app_versions
                     WHERE created_by = 'owner@example.com')
                ''')
            self.assertEqual(cursor.fetchone(), (0, 1, 1, 1))

    def test_rejects_empty_persistent_identities(self):
        cases = (
            ("INSERT INTO users (id) VALUES ('')", "DELETE FROM users WHERE id = ''"),
            (
                "INSERT INTO workflows VALUES ('empty-workflow', '')",
                "DELETE FROM workflows WHERE workflow_uuid = 'empty-workflow'",
            ),
            (
                "INSERT INTO apps VALUES ('empty-app', '')",
                "DELETE FROM apps WHERE uuid = 'empty-app'",
            ),
            (
                "INSERT INTO app_versions VALUES ('empty-app', 1, '')",
                "DELETE FROM app_versions WHERE uuid = 'empty-app' AND version = 1",
            ),
        )
        for insert_sql, cleanup_sql in cases:
            with self.subTest(insert_sql=insert_sql):
                with self.connection.cursor() as cursor:
                    cursor.execute(insert_sql)
                    with self.assertRaisesRegex(
                            psycopg2.Error, 'empty persistent user identity'):
                        cursor.execute(self._migration_sql(MIGRATION))
                    cursor.execute(cleanup_sql)

    def test_migration_blocks_concurrent_persistent_writes(self):
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
                cursor.execute('LOCK TABLE credential IN ACCESS EXCLUSIVE MODE')
            with migrator.cursor() as cursor:
                cursor.execute('SELECT pg_backend_pid()')
                migrator_process_id = cursor.fetchone()[0]

            def run_migration() -> None:
                try:
                    with migrator.cursor() as cursor:
                        cursor.execute(self._migration_sql(MIGRATION))
                    migrator.commit()
                except Exception as error:  # pylint: disable=broad-exception-caught
                    migration_errors.append(error)

            migration_thread = threading.Thread(target=run_migration)
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
                self.fail('migration did not reach the controlled lock wait')

            with writer.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '200ms'")
                with self.assertRaises(psycopg2.Error) as lock_error:
                    cursor.execute(
                        "INSERT INTO workflows VALUES ('concurrent', 'writer@example.com')")
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

    def test_fresh_database_schema_uses_users_and_historical_text(self):
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
            self.assertIsNone(cursor.fetchone()[0])
            cursor.execute(
                '''
                SELECT table_name, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'users'
                  AND column_name = 'id'
                ORDER BY table_name
                ''')
            self.assertEqual(
                cursor.fetchall(),
                [('users', 'NO')],
            )
            cursor.execute(
                '''
                SELECT conname
                FROM pg_constraint
                WHERE conname = ANY(%s)
                ORDER BY conname
                ''',
                ([
                    'credential_user_name_fkey',
                    'users_identity_fkey',
                    'app_versions_created_by_identity_fkey',
                    'apps_owner_identity_fkey',
                    'workflows_submitted_by_identity_fkey',
                ],),
            )
            self.assertEqual(
                [row[0] for row in cursor.fetchall()],
                ['credential_user_name_fkey'],
            )
            cursor.execute(
                'SELECT COUNT(*) FROM pg_indexes WHERE indexname = %s',
                ('users_base_username_id_idx',),
            )
            self.assertEqual(cursor.fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
