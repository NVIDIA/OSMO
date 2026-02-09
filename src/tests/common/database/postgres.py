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

import dataclasses
import logging
import os
import unittest

from psycopg2 import extensions  # type: ignore
from testcontainers import postgres as test_postgres  # type: ignore
from testcontainers.core import labels  # type: ignore

from src.utils.connectors import postgres
from src.tests.common.core import network, utils

logger = logging.getLogger(__name__)

POSTGRES_NAME = f'postgres-{labels.SESSION_ID}'
POSTGRES_IMAGE = f'{utils.DOCKER_HUB_REGISTRY}/postgres:15.1'
POSTGRES_DBNAME = 'osmo_db'
POSTGRES_USERNAME = 'postgres'
POSTGRES_PASSWORD = os.environ.get('OSMO_POSTGRES_PASSWORD', 'osmo_pass')
POSTGRES_PORT = 5432


class NetworkAwarePostgresContainer(network.NetworkAwareContainer,
                                    test_postgres.PostgresContainer):
    def start(self):
        return super(test_postgres.PostgresContainer, self).start()

    def get_database_port(self):
        return self.get_exposed_port(self.port)


@dataclasses.dataclass
class PostgresFixtureParams:
    image: str = POSTGRES_IMAGE
    dbname: str = POSTGRES_DBNAME
    username: str = POSTGRES_USERNAME
    password: str = POSTGRES_PASSWORD
    port: int = POSTGRES_PORT


class PostgresFixture(network.NetworkFixture):
    """
    A fixture for testing Postgres databases.
    """

    postgres_params: PostgresFixtureParams = PostgresFixtureParams()
    postgres_container: NetworkAwarePostgresContainer

    @classmethod
    def setUpClass(cls):
        super().setUpClass()

        cls.postgres_container = NetworkAwarePostgresContainer(
            **dataclasses.asdict(cls.postgres_params))
        cls.postgres_container.with_name(POSTGRES_NAME)
        cls.postgres_container.with_exposed_ports(
            cls.postgres_params.port)
        cls.postgres_container.with_network(cls.network)
        cls.postgres_container.with_network_aliases(POSTGRES_NAME)
        cls.postgres_container.with_kwargs(
            mem_limit='512m',
            memswap_limit='512m'
        )

        logger.info(
            'Waiting for Postgres database testcontainer to be ready ...')
        cls.postgres_container.start()
        logger.info('Postgres database testcontainer is ready.')

    @classmethod
    def tearDownClass(cls):
        logger.info('Tearing down Postgres database testcontainer.')
        try:
            cls.postgres_container.stop()
        finally:
            super().tearDownClass()


class PostgresTestIsolationFixture(unittest.TestCase):
    """
    Test fixture that ensures Postgres database operations are isolated to
    individual test methods.
    """

    def setUp(self):
        postgres_instance = postgres.PostgresConnector.get_instance()

        cmd = """
            SELECT tablename::name
            FROM pg_tables
            WHERE schemaname = 'public'
        """
        self.tables = [
            r.tablename for r in postgres_instance.execute_fetch_command(cmd, ())
        ]

        cmd = """
            CREATE SCHEMA IF NOT EXISTS backup;
            DROP SCHEMA backup CASCADE;
            CREATE SCHEMA backup;
        """
        postgres_instance.execute_commit_command(cmd, ())

        # Copy tables to backup schema
        for table in self.tables:
            cmd = """
                CREATE TABLE backup.%s
                (LIKE public.%s INCLUDING ALL);

                INSERT INTO backup.%s
                SELECT * FROM public.%s;
            """
            postgres_instance.execute_commit_command(
                cmd, (extensions.AsIs(table),) * 4)

        # Run database isolation step first before other setups
        super().setUp()

    def tearDown(self):
        try:
            postgres_instance = postgres.PostgresConnector.get_instance()

            # Terminate other connections before restoring tables
            cmd = """
                SELECT pg_terminate_backend(pid)
                FROM pg_stat_activity
                WHERE datname = current_database()
                  AND pid <> pg_backend_pid()
                  AND backend_type = 'client backend';
            """
            postgres_instance.execute_commit_command(cmd, ())

            cmd = """
                BEGIN;
                SET session_replication_role = 'replica';
            """
            postgres_instance.execute_commit_command(cmd, ())

            for table in self.tables:
                cmd = """
                    -- Drop and recreate table to ensure all properties match
                    DROP TABLE IF EXISTS public.%s CASCADE;

                    CREATE TABLE public.%s
                    (LIKE backup.%s INCLUDING ALL);

                    INSERT INTO public.%s
                    SELECT * FROM backup.%s;
                """
                postgres_instance.execute_commit_command(
                    cmd, (extensions.AsIs(table),) * 5)

            cmd = """
                SET session_replication_role = 'origin';
                COMMIT;
            """
            postgres_instance.execute_commit_command(cmd, ())

            # Clean up backup schema
            cmd = 'DROP SCHEMA backup CASCADE;'
            postgres_instance.execute_commit_command(cmd, ())

        finally:
            super().tearDown()
