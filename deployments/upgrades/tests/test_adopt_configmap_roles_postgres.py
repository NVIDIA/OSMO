"""Real PostgreSQL transaction and idempotence coverage for role adoption."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import shutil
import socket
import subprocess
import tempfile
import time
import unittest

import psycopg2
import psycopg2.extras

from deployments.upgrades import adopt_configmap_roles as adoption


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


class RoleAdoptionPostgresTest(unittest.TestCase):

    temporary_directory: tempfile.TemporaryDirectory
    socket_directory: str
    data_directory: str
    port: int
    process: subprocess.Popen

    @classmethod
    def setUpClass(cls) -> None:
        initdb = shutil.which('initdb')
        postgres = shutil.which('postgres')
        if not initdb or not postgres:
            raise unittest.SkipTest('PostgreSQL server binaries are not installed')
        cls.temporary_directory = tempfile.TemporaryDirectory()
        cls.socket_directory = f'{cls.temporary_directory.name}/socket'
        cls.data_directory = f'{cls.temporary_directory.name}/data'
        cls.port = _available_port()
        subprocess.run(
            ['mkdir', cls.socket_directory], check=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(
            [initdb, '-D', cls.data_directory, '-A', 'trust', '-U', 'postgres'],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        cls.process = subprocess.Popen(
            [postgres, '-D', cls.data_directory, '-F', '-p', str(cls.port),
             '-k', cls.socket_directory],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 10
        while True:
            try:
                with cls._connect():
                    break
            except psycopg2.OperationalError:
                if time.monotonic() >= deadline:
                    cls.process.terminate()
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.process.terminate()
        cls.process.wait(timeout=10)
        cls.temporary_directory.cleanup()

    @classmethod
    def _connect(cls):
        return psycopg2.connect(
            host=cls.socket_directory, port=cls.port, dbname='postgres',
            user='postgres', cursor_factory=psycopg2.extras.RealDictCursor)

    def setUp(self) -> None:
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute('DROP TABLE IF EXISTS access_token_roles, user_roles, '
                           'role_external_mappings, config_history, roles CASCADE;')
            cursor.execute('''CREATE TABLE roles (
                name TEXT PRIMARY KEY, description TEXT, policies JSONB[],
                immutable BOOLEAN, sync_mode TEXT NOT NULL);''')
            cursor.execute('''CREATE TABLE role_external_mappings (
                role_name TEXT REFERENCES roles(name) ON DELETE CASCADE,
                external_role TEXT, PRIMARY KEY(role_name, external_role));''')
            cursor.execute('''CREATE TABLE user_roles (
                id BIGSERIAL PRIMARY KEY, user_id TEXT, role_name TEXT,
                assigned_by TEXT, assigned_at TIMESTAMPTZ DEFAULT NOW());''')
            cursor.execute('''CREATE TABLE access_token_roles (
                user_name TEXT, token_name TEXT, user_role_id BIGINT,
                assigned_by TEXT, assigned_at TIMESTAMPTZ DEFAULT NOW());''')
            cursor.execute('''CREATE TABLE config_history (
                config_type TEXT, revision INT, name TEXT, username TEXT,
                created_at TIMESTAMPTZ, tags TEXT[], description TEXT, data JSONB);''')

    @staticmethod
    def _desired() -> list[dict]:
        return [{
            'name': 'osmo-default',
            'description': 'default role',
            'policies': [{
                'effect': 'Allow', 'actions': ['auth:Login'], 'resources': [],
            }],
            'immutable': True,
            'sync_mode': 'force',
            'external_roles': ['osmo-default'],
        }]

    def test_write_is_idempotent_and_preserves_immutable(self):
        with self._connect() as connection, connection.cursor() as cursor:
            cursor.execute('''
                INSERT INTO roles
                    (name, description, policies, immutable, sync_mode)
                VALUES ('osmo-default', 'stale', ARRAY[]::jsonb[], FALSE, 'import');
            ''')
            adoption._write_roles(cursor, self._desired())
            adoption._write_roles(cursor, self._desired())
            self.assertEqual(adoption._read_db_roles(cursor), self._desired())

    def test_transaction_rolls_back_partial_adoption(self):
        with self.assertRaisesRegex(RuntimeError, 'abort'):
            with self._connect() as connection, connection.cursor() as cursor:
                adoption._write_roles(cursor, self._desired())
                raise RuntimeError('abort')
        with self._connect() as connection, connection.cursor() as cursor:
            self.assertEqual(adoption._read_db_roles(cursor), [])


if __name__ == '__main__':
    unittest.main()
