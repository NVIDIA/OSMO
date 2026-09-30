"""Real PostgreSQL coverage for the stateless MEK rollout contract."""

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES.
# SPDX-License-Identifier: Apache-2.0

import base64
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from unittest import mock

from jwcrypto import jwk  # type: ignore
import psycopg2  # type: ignore

from src.utils import connectors
from src.utils.secret_manager import SecretManager


def _available_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _write_keyring(path: Path, current: str, keys: dict[str, jwk.JWK]) -> None:
    encoded = {}
    for key_id, key in keys.items():
        encoded[key_id] = base64.b64encode(
            json.dumps(key.export(as_dict=True), separators=(",", ":")).encode()
        ).decode()
    path.write_text(
        "currentMek: " + current + "\nmeks:\n" + "".join(
            f"  {key_id}: {value}\n" for key_id, value in encoded.items()
        ),
        encoding="utf-8",
    )


class TestMekReconciliationPostgres(unittest.TestCase):
    """The MEK implementation may inspect/rewrap data, but may not own DB state."""

    temporary_directory: tempfile.TemporaryDirectory
    data_directory: Path
    socket_directory: Path
    postgres_process: subprocess.Popen
    port: int

    @classmethod
    def setUpClass(cls) -> None:
        initdb = shutil.which("initdb")
        postgres = shutil.which("postgres")
        if not initdb or not postgres:
            raise unittest.SkipTest("PostgreSQL server binaries are not installed")
        cls.temporary_directory = tempfile.TemporaryDirectory()
        root = Path(cls.temporary_directory.name)
        cls.data_directory = root / "data"
        cls.socket_directory = root / "socket"
        cls.socket_directory.mkdir()
        cls.port = _available_port()
        subprocess.run(
            [initdb, "-D", str(cls.data_directory), "-A", "trust", "-U", "postgres"],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        cls.postgres_process = subprocess.Popen(
            [
                postgres,
                "-D",
                str(cls.data_directory),
                "-F",
                "-p",
                str(cls.port),
                "-k",
                str(cls.socket_directory),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.monotonic() + 10
        while True:
            try:
                with psycopg2.connect(
                    host=str(cls.socket_directory), port=cls.port,
                    dbname="postgres", user="postgres"
                ):
                    break
            except psycopg2.OperationalError:
                if time.monotonic() >= deadline:
                    cls.postgres_process.terminate()
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.postgres_process.terminate()
        cls.postgres_process.wait(timeout=10)
        cls.temporary_directory.cleanup()

    def setUp(self) -> None:
        self.database = connectors.PostgresConnector.__new__(connectors.PostgresConnector)
        self.database.config = connectors.PostgresConfig(
            postgres_host=str(self.socket_directory),
            postgres_port=self.port,
            postgres_user="postgres",
            postgres_password="",
            postgres_database_name="postgres",
        )
        self.database._pool_lock = threading.Lock()
        self.database._pool = None
        self.database._create_pool()
        for command in (
            "CREATE EXTENSION IF NOT EXISTS hstore;",
            "DROP TABLE IF EXISTS ueks, users CASCADE;",
            "CREATE TABLE users (id TEXT PRIMARY KEY);",
            "CREATE TABLE ueks (uid TEXT PRIMARY KEY, keys HSTORE NOT NULL);",
            "INSERT INTO users(id) VALUES ('user');",
        ):
            self.database.execute_commit_command(command, ())

        self.keyring_path = Path(self.temporary_directory.name) / "integration-mek.yaml"
        self.old_mek = jwk.JWK.generate(kty="oct", size=256, kid="old")
        self.new_mek = jwk.JWK.generate(kty="oct", size=256, kid="new")
        _write_keyring(self.keyring_path, "old", {"old": self.old_mek})
        self.database.secret_manager = SecretManager(
            str(self.keyring_path), self.database.read_uek, self.database.write_uek,
            self.database.read_current_kid, self.database.add_user)
        self.database.secret_manager.add_new_user("user")

    def tearDown(self) -> None:
        assert self.database._pool is not None
        self.database._pool.closeall()

    def test_jsonb_merge_initialization_preserves_existing_function(self) -> None:
        bootstrap = object.__new__(connectors.PostgresConnector)
        bootstrap.config = self.database.config
        with mock.patch.object(bootstrap, "execute_commit_command") as commands, \
                mock.patch.object(bootstrap, "execute_autocommit_command"):
            bootstrap._init_tables()
        command = next(
            call.args[0] for call in commands.call_args_list
            if "CREATE OR REPLACE FUNCTION" in call.args[0]
            and "jsonb_recursive_merge" in call.args[0]
        )
        self.database.execute_commit_command(
            "DROP FUNCTION IF EXISTS public.jsonb_recursive_merge(jsonb, jsonb)", ())
        self.database.execute_commit_command(command, ())
        rows = self.database.execute_fetch_command(
            "SELECT public.jsonb_recursive_merge(%s::jsonb, %s::jsonb) AS merged",
            ('{"nested":{"a":1,"b":2}}', '{"nested":{"b":3}}'), return_raw=True)
        self.assertEqual(rows[0]["merged"], {"nested": {"a": 1, "b": 3}})
        version_query = (
            "SELECT xmin::text AS version FROM pg_proc WHERE oid = "
            "'public.jsonb_recursive_merge(jsonb,jsonb)'::regprocedure")
        before = self.database.execute_fetch_command(version_query, (), return_raw=True)
        self.database.execute_commit_command(command, ())
        self.assertEqual(
            self.database.execute_fetch_command(version_query, (), return_raw=True), before)
        self.database.execute_commit_command(
            "CREATE OR REPLACE FUNCTION public.jsonb_recursive_merge("
            "receivingJson jsonb, givingJson jsonb) "
            "RETURNS jsonb LANGUAGE SQL AS 'SELECT $1'", ())
        self.database.execute_commit_command(command, ())
        rows = self.database.execute_fetch_command(
            "SELECT public.jsonb_recursive_merge(%s::jsonb, %s::jsonb) AS merged",
            ('{"a":1}', '{"b":2}'), return_raw=True)
        self.assertEqual(rows[0]["merged"], {"a": 1})

    def _mek_relations(self) -> list[str]:
        rows = self.database.execute_fetch_command(
            "SELECT tablename FROM pg_tables "
            "WHERE schemaname = 'public' AND tablename LIKE 'mek_%%' ORDER BY tablename;",
            (), return_raw=True)
        return [row["tablename"] for row in rows]

    def test_rewrap_uses_no_mek_tables_or_triggers(self) -> None:
        self.assertEqual(self._mek_relations(), [])
        _write_keyring(
            self.keyring_path, "new", {"old": self.old_mek, "new": self.new_mek})
        self.database.secret_manager = SecretManager(
            str(self.keyring_path), self.database.read_uek, self.database.write_uek,
            self.database.read_current_kid, self.database.add_user)

        before, blockers = self.database._scan_mek_references()
        self.assertEqual(blockers, [])
        self.assertEqual(before["old"], 1)
        snapshot = self.database.secret_manager.rewrap_snapshot()
        result = self.database.rewrap_mek_references(
            expected_generation=snapshot.generation,
            expected_current_kid="new",
            expected_registry_digest=(
                self.database.secret_manager.rewrap_snapshot_digest(snapshot)),
        )
        self.assertEqual(result, {"old": 0, "new": 1})
        self.assertEqual(self._mek_relations(), [])
        trigger_rows = self.database.execute_fetch_command(
            "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%%mek%%';",
            (), return_raw=True)
        self.assertEqual(trigger_rows, [])

    def test_startup_inventory_rejects_a_missing_historical_key(self) -> None:
        _write_keyring(self.keyring_path, "new", {"new": self.new_mek})
        self.database.secret_manager = SecretManager(
            str(self.keyring_path), self.database.read_uek, self.database.write_uek,
            self.database.read_current_kid, self.database.add_user)
        counts, blockers = self.database._scan_mek_references()
        self.assertEqual(counts, {"new": 0})
        self.assertEqual(blockers, [
            "ueks/user/" + self.database.read_current_kid("user")
            + ": authentication failed"
        ])


if __name__ == "__main__":
    unittest.main()
