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

import base64
import json
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
import types
from typing import Any, cast
import unittest
from unittest import mock

from jwcrypto import jwk, jwe  # type: ignore
import psycopg2  # type: ignore

from src.lib.utils import osmo_errors
from src.utils import connectors
from src.utils.secret_manager import SecretManager
from src.utils.secret_manager import mek_lifecycle
from src.utils.secret_manager import mek_schema


def _available_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def _write_keyring(path: Path, current_key_id, keys, legacy=False):
    entries = []
    for key_id, key in keys.items():
        exported = key.export(as_dict=True)
        if legacy:
            padding = "=" * (-len(exported["k"]) % 4)
            key_bytes = base64.urlsafe_b64decode(exported["k"] + padding)
            exported["k"] = base64.b64encode(key_bytes).decode("ascii")
        encoded = base64.b64encode(
            json.dumps(exported, separators=(",", ":")).encode("utf-8")
        ).decode("ascii")
        entries.append(f"  {key_id}: {encoded}")
    time.sleep(0.002)
    path.write_text(
        f"currentMek: {current_key_id}\nmeks:\n" + "\n".join(entries) + "\n",
        encoding="utf-8",
    )


class TestMekReconciliationPostgres(unittest.TestCase):
    """Real PostgreSQL lifecycle coverage for MEK adoption and rewrap."""

    temporary_directory: tempfile.TemporaryDirectory
    data_directory: Path
    socket_directory: Path
    port: int
    postgres_process: subprocess.Popen

    @classmethod
    def setUpClass(cls):
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
                connection = psycopg2.connect(
                    host=str(cls.socket_directory),
                    port=cls.port,
                    dbname="postgres",
                    user="postgres",
                )
                connection.close()
                break
            except psycopg2.OperationalError:
                if time.monotonic() >= deadline:
                    cls.postgres_process.terminate()
                    raise
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.postgres_process.terminate()
        cls.postgres_process.wait(timeout=10)
        cls.temporary_directory.cleanup()

    def setUp(self):
        self.database = object.__new__(connectors.PostgresConnector)
        self.database.config = connectors.PostgresConfig(
            postgres_host=str(self.socket_directory),
            postgres_port=self.port,
            postgres_user="postgres",
            postgres_password="",
            postgres_database_name="postgres",
            allow_existing_mek_adoption=True,
        )
        self.database._pool_lock = threading.Lock()
        self.database._pool = None
        self.database._create_pool()
        self.database._mek_consumer_id = "integration-pod"
        self.database._mek_consumer_name = "integration"
        self.database._last_logged_mek_generation = ""
        self.database._mek_monitor_stop = threading.Event()
        for command in (
            "CREATE EXTENSION IF NOT EXISTS hstore;",
            "DROP TABLE IF EXISTS public.mek_consumer_status, "
            "public.mek_lifecycle_state, public.mek_rewrap_progress, "
            "public.mek_rewrap_status, public.mek_write_epoch, "
            "public.mek_keyring_adoption, public.mek_key_registry, configs, ueks, users CASCADE;",
            "CREATE TABLE users (id TEXT PRIMARY KEY);",
            "CREATE TABLE ueks (uid TEXT REFERENCES users(id), keys HSTORE, PRIMARY KEY(uid));",
            "CREATE TABLE configs (key TEXT, type TEXT, value TEXT, PRIMARY KEY(key, type));",
        ):
            self.database.execute_commit_command(command, ())
        with self.database._get_connection() as connection:
            with connection.cursor() as cursor:
                mek_schema.ensure_mek_schema(cursor)
            connection.commit()
        self.database.execute_commit_command("INSERT INTO users(id) VALUES ('user');", ())

        self.keyring_path = Path(self.temporary_directory.name) / "mek-integration.yaml"
        self.old_mek = jwk.JWK.generate(kty="oct", size=256, kid="old")
        self.new_mek = jwk.JWK.generate(kty="oct", size=256, kid="new")
        _write_keyring(self.keyring_path, "old", {"old": self.old_mek}, legacy=True)
        self.database.secret_manager = SecretManager(
            str(self.keyring_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )

    def tearDown(self):
        assert self.database._pool is not None
        self.database._pool.closeall()

    def _raw_connection(self):
        return psycopg2.connect(
            host=str(self.socket_directory),
            port=self.port,
            dbname="postgres",
            user="postgres",
        )

    def _ensure_schema(self) -> None:
        with self._raw_connection() as connection:
            with connection.cursor() as cursor:
                mek_schema.ensure_mek_schema(cursor)

    def test_historical_adoption_rotation_rewrap_resume_and_leadership(self):
        self.database.secret_manager.add_new_user("user")
        user_key_id = self.database.read_current_kid("user")
        old_wrapper = self.database.read_uek("user", user_key_id)
        slack = self.database.secret_manager.encrypt("slack", "").value
        smtp = self.database.secret_manager.encrypt("smtp", "").value
        alerts = json.dumps(
            {
                "slack_token": slack,
                "smtp_settings": {"host": "", "sender": "", "password": smtp},
            }
        )
        self.database.execute_commit_command(
            "INSERT INTO configs(key, type, value) VALUES (%s, %s, %s);",
            ("workflow_alerts", "WORKFLOW", alerts),
        )

        self.database._init_mek_key_registry()
        self.database._record_mek_consumer()
        consumer = self.database.execute_fetch_command(
            "SELECT consumer_id, current_kid, loaded_kids "
            "FROM public.mek_consumer_status WHERE consumer_id = %s;",
            ("integration-pod",),
            return_raw=True,
        )[0]
        self.assertEqual(consumer["current_kid"], "old")
        self.assertEqual(consumer["loaded_kids"], ["old"])
        _write_keyring(self.keyring_path, "old", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        self.database._init_mek_key_registry()

        disconnected_path = Path(self.temporary_directory.name) / "mek-disconnected.yaml"
        _write_keyring(disconnected_path, "old", {"old": self.old_mek})
        disconnected = SecretManager(
            str(disconnected_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )
        _write_keyring(disconnected_path, "new", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(disconnected.reload_if_changed())

        _write_keyring(self.keyring_path, "new", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        active_registry = self.database.execute_fetch_command(
            "SELECT kid FROM public.mek_key_registry WHERE state = 'current';",
            (), return_raw=True)
        self.assertEqual(active_registry, [{"kid": "new"}])
        self.database.rewrap_mek_references()
        counts, blockers = self.database._scan_mek_references()
        self.assertEqual(blockers, [])
        self.assertEqual(counts["old"], 0)
        self.assertGreaterEqual(counts["new"], 3)

        with self.database._get_connection(autocommit=True) as first, self.database._get_connection(
            autocommit=True
        ) as second:
            with first.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s);", (1234567,))
                self.assertTrue(cursor.fetchone()[0])

            with second.cursor() as cursor:
                cursor.execute("SELECT pg_try_advisory_lock(%s);", (1234567,))
                self.assertFalse(cursor.fetchone()[0])
            with first.cursor() as cursor:
                cursor.execute("SELECT pg_advisory_unlock(%s);", (1234567,))

        wrapper = self.database.execute_fetch_command(
            "SELECT value FROM ueks CROSS JOIN LATERAL each(keys) entry "
            "WHERE entry.key <> 'current';",
            (),
            return_raw=True,
        )[0]["value"]
        token = jwe.JWE()
        token.deserialize(wrapper)
        self.assertEqual(token.jose_header["kid"], "new")

        # A lagging old-key write is swept by a new restart-from-zero invocation.
        self.database.execute_commit_command(
            "UPDATE ueks SET keys = keys || hstore(%s, %s) WHERE uid = 'user';",
            (user_key_id, old_wrapper),
        )
        self.database.rewrap_mek_references()
        wrapper = self.database.read_uek("user", user_key_id)
        token.deserialize(wrapper)
        self.assertEqual(token.jose_header["kid"], "new")

    def test_external_prepare_activate_and_rewrap_needs_no_process_restart(self):
        self.database.secret_manager.add_new_user("user")
        user_key_id = self.database.read_current_kid("user")
        old_wrapper = self.database.read_uek("user", user_key_id)
        self.database._init_mek_key_registry()

        _write_keyring(
            self.keyring_path, "old", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        prepared = self.database.execute_fetch_command(
            "SELECT kid, state FROM public.mek_key_registry ORDER BY kid;",
            (), return_raw=True)
        self.assertEqual(
            prepared,
            [{"kid": "new", "state": "prepared"},
             {"kid": "old", "state": "current"}],
        )

        _write_keyring(
            self.keyring_path, "new", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        activated = self.database.execute_fetch_command(
            "SELECT kid, state FROM public.mek_key_registry ORDER BY kid;",
            (), return_raw=True)
        self.assertEqual(
            activated,
            [{"kid": "new", "state": "current"},
             {"kid": "old", "state": "prepared"}],
        )

        self.database.rewrap_mek_references()
        replacement = self.database.read_uek("user", user_key_id)
        self.assertNotEqual(replacement, old_wrapper)
        protected = jwe.JWE()
        protected.deserialize(replacement, key=self.new_mek)
        self.assertEqual(json.loads(protected.payload)["kid"], user_key_id)

    def test_managed_bootstrap_persists_fence_until_binding_is_finalized(self):
        keyring = mek_lifecycle._new_keyring("bootstrap")
        secret = types.SimpleNamespace(
            metadata=types.SimpleNamespace(
                uid="secret-uid", resource_version="1",
                annotations={
                    mek_lifecycle._MANAGED_ANNOTATION: "osmo",
                    mek_lifecycle._INSTALLATION_ANNOTATION: "osmo/release",
                }),
            data={
                "mek.yaml": base64.b64encode(keyring.encoded).decode("ascii")
            },
        )
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = cast(Any, types.SimpleNamespace(
            namespace="osmo", secret_name="mek", secret_key="mek.yaml",
            installation_id="osmo/release", postgres_host=str(self.socket_directory),
            postgres_port=self.port, postgres_user="postgres", postgres_password="",
            postgres_database_name="postgres"))
        lifecycle.__dict__["_check_deadline"] = mock.Mock()
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=secret)

        lifecycle._reserve_bootstrap(keyring, secret, allow_patch=False)
        pending = self.database.execute_fetch_command(
            "SELECT a.ready, a.management_mode, e.writes_allowed "
            "FROM public.mek_lifecycle_state a CROSS JOIN public.mek_write_epoch e "
            "WHERE a.singleton AND e.singleton;", (), return_raw=True)[0]
        self.assertEqual(pending, {
            "ready": False, "management_mode": "osmo", "writes_allowed": False})
        with self.assertRaises(osmo_errors.OSMODatabaseError):
            self.database.execute_commit_command(
                "INSERT INTO configs(key, type, value) VALUES ('late', 'TEST', 'value');", ())

        lifecycle._finalize_bootstrap(keyring, secret)

        finalized = self.database.execute_fetch_command(
            "SELECT a.ready, e.writes_allowed FROM public.mek_lifecycle_state a "
            "CROSS JOIN public.mek_write_epoch e WHERE a.singleton AND e.singleton;",
            (), return_raw=True)[0]
        self.assertEqual(finalized, {"ready": True, "writes_allowed": True})

    def test_unregistered_valid_config_jwe_is_never_rewritten(self):
        self.database._init_mek_key_registry()
        unknown_jwe = self.database.secret_manager.encrypt("unknown", "").value
        unknown_value = json.dumps({"unregistered": unknown_jwe})
        self.database.execute_commit_command(
            "INSERT INTO configs(key, type, value) VALUES (%s, %s, %s);",
            ("legacy", "DATASET", unknown_value))
        _write_keyring(
            self.keyring_path, "old", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        self.database._init_mek_key_registry()
        _write_keyring(
            self.keyring_path, "new", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        self.database._init_mek_key_registry()

        self.database._rewrap_configs(
            self.database.secret_manager.rewrap_snapshot())

        persisted = self.database.execute_fetch_command(
            "SELECT value FROM configs WHERE key = 'legacy' AND type = 'DATASET';",
            (), return_raw=True)[0]["value"]
        self.assertEqual(unknown_value, persisted)
        _, blockers = self.database._scan_mek_references()
        self.assertIn(
            "configs/DATASET/legacy.unregistered: unregistered compact JWE", blockers)

    def test_committed_adoption_fence_self_heals_before_bad_mount_is_rejected(self):
        self.database._init_mek_key_registry()
        self.database.execute_commit_commands([
            ("UPDATE public.mek_lifecycle_state SET ready = FALSE;", ()),
            ("UPDATE public.mek_write_epoch SET writes_allowed = FALSE;", ()),
        ])
        original_manager = self.database.secret_manager
        bad_path = Path(self.temporary_directory.name) / "mek-bad-mount.yaml"
        different_old = jwk.JWK.generate(kty="oct", size=256, kid="old")
        _write_keyring(bad_path, "old", {"old": different_old})
        self.database.secret_manager = SecretManager(
            str(bad_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )
        try:
            with self.assertRaisesRegex(osmo_errors.OSMOError, "does not match"):
                self.database._init_mek_key_registry()
        finally:
            self.database.secret_manager = original_manager

        state = self.database.execute_fetch_command(
            "SELECT a.ready, e.writes_allowed FROM public.mek_lifecycle_state a "
            "CROSS JOIN public.mek_write_epoch e WHERE a.singleton AND e.singleton;",
            (),
            return_raw=True,
        )[0]
        self.assertEqual(state, {"ready": True, "writes_allowed": True})

    def test_established_external_rewrap_fence_is_not_reopened_by_consumer_init(self):
        self.database._init_mek_key_registry()
        self.database.execute_commit_command(
            "UPDATE public.mek_write_epoch SET writes_allowed = FALSE;", ())

        self.database._init_mek_key_registry()

        state = self.database.execute_fetch_command(
            "SELECT writes_allowed FROM public.mek_write_epoch WHERE singleton;",
            (), return_raw=True)[0]
        self.assertEqual(state, {"writes_allowed": False})
        self.database.execute_commit_command(
            "UPDATE public.mek_write_epoch SET writes_allowed = TRUE;", ())

    def test_external_from_day_one_is_bound_once_by_first_explicit_rewrap(self):
        self.database._init_mek_key_registry()
        keyring = mek_lifecycle._parse_keyring(self.keyring_path.read_bytes())
        secret = types.SimpleNamespace(
            metadata=types.SimpleNamespace(
                uid="secret-uid", resource_version="7", annotations={}),
            data={
                "mek.yaml": base64.b64encode(keyring.encoded).decode("ascii")
            },
        )
        lifecycle = mek_lifecycle.MekLifecycle.__new__(mek_lifecycle.MekLifecycle)
        lifecycle.config = cast(Any, types.SimpleNamespace(
            request_id="rewrap-1", namespace="osmo", secret_name="mek",
            secret_key="mek.yaml", installation_id="osmo/release",
            mek_management_mode="external"))
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=secret)
        lifecycle.__dict__["_database"] = self._raw_connection
        lifecycle.__dict__["_wait_for_acknowledgements"] = mock.Mock()
        run_rewrap = mock.Mock()
        lifecycle.__dict__["_run_rewrap"] = run_rewrap

        lifecycle.rewrap()

        binding = self.database.execute_fetch_command(
            "SELECT bound_secret_name, bound_secret_key, bound_secret_uid, installation_id "
            "FROM public.mek_lifecycle_state WHERE singleton;",
            (), return_raw=True)[0]
        self.assertEqual(binding, {
            "bound_secret_name": "mek", "bound_secret_key": "mek.yaml",
            "bound_secret_uid": "secret-uid", "installation_id": "osmo/release",
        })
        run_rewrap.assert_called_once_with(keyring)

        recreated = types.SimpleNamespace(
            metadata=types.SimpleNamespace(
                uid="different-uid", resource_version="8", annotations={}),
            data=secret.data,
        )
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=recreated)
        with self.assertRaisesRegex(osmo_errors.OSMOError, "installation binding"):
            lifecycle.rewrap()

        lifecycle.rebind()
        rebound = self.database.execute_fetch_command(
            "SELECT bound_secret_uid FROM public.mek_lifecycle_state WHERE singleton;",
            (), return_raw=True)[0]
        self.assertEqual(rebound["bound_secret_uid"], "different-uid")
        lifecycle.rewrap()

        different_keyring = mek_lifecycle._new_keyring("different")
        mismatched = types.SimpleNamespace(
            metadata=types.SimpleNamespace(
                uid="third-uid", resource_version="9", annotations={}),
            data={
                "mek.yaml": base64.b64encode(different_keyring.encoded).decode("ascii")
            },
        )
        lifecycle.__dict__["_secret"] = mock.Mock(return_value=mismatched)
        with self.assertRaisesRegex(osmo_errors.OSMOError, "not identical"):
            lifecycle.rebind()

    def test_atomic_concurrent_registration_rejects_divergent_fingerprint(self):
        self.database._init_mek_key_registry()
        barrier = threading.Barrier(2)
        results = []
        registered_bundle = self.database.secret_manager.key_fingerprints()

        def register(fingerprint):
            barrier.wait()
            results.append(self.database.prepare_meks({
                **registered_bundle,
                "shared": fingerprint,
            }))

        threads = [
            threading.Thread(target=register, args=("a" * 64,)),
            threading.Thread(target=register, args=("b" * 64,)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)

        self.assertEqual(sorted(results), [False, True])
        rows = self.database.execute_fetch_command(
            "SELECT fingerprint FROM public.mek_key_registry WHERE kid = 'shared';",
            (),
            return_raw=True,
        )
        self.assertEqual(len(rows), 1)
        self.assertIn(rows[0]["fingerprint"], {"a" * 64, "b" * 64})

    def test_skipped_prepare_cannot_poison_complete_registered_bundle(self):
        self.database._init_mek_key_registry()
        skipped_path = Path(self.temporary_directory.name) / "mek-skipped-prepare.yaml"
        _write_keyring(skipped_path, "old", {"old": self.old_mek})
        skipped = SecretManager(
            str(skipped_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )

        _write_keyring(
            self.keyring_path, "old", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())
        expected_registry = self.database.secret_manager.key_fingerprints()

        divergent = jwk.JWK.generate(kty="oct", size=256, kid="divergent")
        exported_new = self.new_mek.export(as_dict=True)
        alias = jwk.JWK(kty="oct", kid="alias", k=exported_new["k"])
        for candidate_id, candidate_key in (
            ("divergent", divergent),
            ("alias", alias),
        ):
            with self.subTest(candidate_id=candidate_id):
                _write_keyring(
                    skipped_path,
                    "old",
                    {"old": self.old_mek, candidate_id: candidate_key},
                )
                self.assertFalse(skipped.reload_if_changed())
                rows = self.database.execute_fetch_command(
                    "SELECT kid, fingerprint FROM public.mek_key_registry ORDER BY kid;",
                    (),
                    return_raw=True,
                )
                self.assertEqual(
                    {row["kid"]: row["fingerprint"] for row in rows},
                    expected_registry,
                )

                _write_keyring(
                    skipped_path,
                    "old",
                    {"old": self.old_mek, "new": self.new_mek},
                )
                self.assertTrue(skipped.reload_if_changed())
                self.assertEqual(set(skipped.meks), {"old", "new"})

                # Reset the simulated lagging pod to its pre-PREPARE LKG for the
                # next divergent revision without touching the durable registry.
                _write_keyring(skipped_path, "old", {"old": self.old_mek})
                skipped = SecretManager(
                    str(skipped_path),
                    self.database.read_uek,
                    self.database.write_uek,
                    self.database.read_current_kid,
                    self.database.add_user,
                    prepare_meks=self.database.prepare_meks,
                    can_activate_mek=self.database.can_activate_mek,
                )

    def test_skipped_activate_requires_exact_registered_bundle(self):
        self.database._init_mek_key_registry()
        skipped_path = Path(self.temporary_directory.name) / "mek-skipped-activate.yaml"
        _write_keyring(skipped_path, "old", {"old": self.old_mek})
        skipped = SecretManager(
            str(skipped_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )
        _write_keyring(
            self.keyring_path, "old", {"old": self.old_mek, "new": self.new_mek})
        self.assertTrue(self.database.secret_manager.reload_if_changed())

        divergent = jwk.JWK.generate(kty="oct", size=256, kid="divergent")
        _write_keyring(
            skipped_path,
            "divergent",
            {"old": self.old_mek, "divergent": divergent},
        )
        self.assertFalse(skipped.reload_if_changed())
        self.assertEqual(skipped.current_mek_id, "old")
        rows = self.database.execute_fetch_command(
            "SELECT kid FROM public.mek_key_registry ORDER BY kid;", (), return_raw=True)
        self.assertEqual([row["kid"] for row in rows], ["new", "old"])

    def test_concurrent_cold_adoption_elects_one_complete_bundle(self):
        candidates = {
            "small": ({"a": "a" * 64}, "a", "1" * 16),
            "large": (
                {"a": "a" * 64, "b": "b" * 64},
                "b",
                "2" * 16,
            ),
        }
        barrier = threading.Barrier(2)
        results = {}

        def adopt(name):
            fingerprints, current_key_id, generation = candidates[name]
            expected_write_epoch = self.database._mek_write_epoch()
            barrier.wait()
            results[name] = self.database._adopt_initial_mek_keyring(
                fingerprints, current_key_id, generation, expected_write_epoch)

        threads = [threading.Thread(target=adopt, args=(name,)) for name in candidates]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)

        self.assertEqual(sorted(results.values()), ["adopted", "existing"])
        winner = next(name for name, result in results.items() if result == "adopted")
        expected_fingerprints, expected_current, expected_generation = candidates[winner]
        adoption = self.database.execute_fetch_command(
            "SELECT adopted_generation, adopted_current_kid, adopted_kids "
            "FROM public.mek_lifecycle_state WHERE singleton;",
            (),
            return_raw=True,
        )[0]
        self.assertEqual(adoption["adopted_generation"], expected_generation)
        self.assertEqual(adoption["adopted_current_kid"], expected_current)
        self.assertEqual(adoption["adopted_kids"], sorted(expected_fingerprints))
        rows = self.database.execute_fetch_command(
            "SELECT kid, fingerprint FROM public.mek_key_registry ORDER BY kid;",
            (),
            return_raw=True,
        )
        self.assertEqual(
            {row["kid"]: row["fingerprint"] for row in rows}, expected_fingerprints)

    def test_cold_adoption_retries_when_write_lands_after_scan(self):
        old_ciphertext = self.database.secret_manager.encrypt("old-secret", "").value
        candidate_path = Path(self.temporary_directory.name) / "mek-candidate.yaml"
        _write_keyring(candidate_path, "new", {"new": self.new_mek})
        self.database.secret_manager = SecretManager(
            str(candidate_path),
            self.database.read_uek,
            self.database.write_uek,
            self.database.read_current_kid,
            self.database.add_user,
            prepare_meks=self.database.prepare_meks,
            can_activate_mek=self.database.can_activate_mek,
        )

        expected_write_epoch = self.database._mek_write_epoch()
        _, blockers = self.database._scan_mek_references()
        self.assertEqual(blockers, [])
        alerts = json.dumps(
            {
                "slack_token": old_ciphertext,
                "smtp_settings": {
                    "host": "",
                    "sender": "",
                    "password": old_ciphertext,
                },
            }
        )
        self.database.execute_commit_command(
            "INSERT INTO configs(key, type, value) VALUES (%s, %s, %s);",
            ("workflow_alerts", "WORKFLOW", alerts),
        )

        result = self.database._adopt_initial_mek_keyring(
            self.database.secret_manager.key_fingerprints(),
            self.database.secret_manager.current_mek_id,
            self.database.secret_manager.generation,
            expected_write_epoch,
        )

        self.assertEqual(result, "write_epoch_changed")
        self.assertEqual(
            self.database.execute_fetch_command(
                "SELECT kid FROM public.mek_key_registry;", (), return_raw=True),
            [],
        )
        with self.assertRaisesRegex(osmo_errors.OSMOError, "failed authentication"):
            self.database._init_mek_key_registry()

    def test_cold_adoption_fence_rejects_write_blocked_until_commit(self):
        self.database.execute_commit_command('''
            CREATE OR REPLACE FUNCTION public.pause_mek_adoption_for_test()
            RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN
                PERFORM pg_sleep(1);
                RETURN NEW;
            END;
            $$;
        ''', ())
        self.database.execute_commit_command('''
            CREATE TRIGGER pause_mek_adoption_for_test
            BEFORE INSERT ON public.mek_lifecycle_state
            FOR EACH ROW EXECUTE FUNCTION public.pause_mek_adoption_for_test();
        ''', ())
        expected_epoch = self.database._mek_write_epoch()
        adoption_results = []
        adoption_errors = []

        def adopt():
            try:
                adoption_results.append(self.database._adopt_initial_mek_keyring(
                    self.database.secret_manager.key_fingerprints(),
                    self.database.secret_manager.current_mek_id,
                    self.database.secret_manager.generation,
                    expected_epoch,
                ))
            except Exception as error:  # pylint: disable=broad-except
                adoption_errors.append(error)

        adoption_thread = threading.Thread(target=adopt)
        adoption_thread.start()
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            paused = self.database.execute_fetch_command('''
                SELECT 1 FROM pg_stat_activity
                WHERE state = 'active' AND wait_event = 'PgSleep'
                  AND query LIKE '%%INSERT INTO public.mek_lifecycle_state%%';
            ''', (), return_raw=True)
            if paused:
                break
            time.sleep(0.02)
        else:
            self.fail('adoption did not reach the fenced transaction pause')
        writer = psycopg2.connect(
            host=str(self.socket_directory),
            port=self.port,
            dbname="postgres",
            user="postgres",
        )
        writer_error = []

        def write_while_fenced():
            try:
                with writer.cursor() as cursor:
                    cursor.execute(
                        "INSERT INTO configs(key, type, value) VALUES ('late', 'TEST', 'value');")
                writer.commit()
            except psycopg2.DatabaseError as error:
                writer.rollback()
                writer_error.append(error)

        writer_thread = threading.Thread(target=write_while_fenced)
        writer_thread.start()
        adoption_thread.join(timeout=5)
        writer_thread.join(timeout=5)
        writer.close()

        self.assertEqual(adoption_errors, [])
        self.assertEqual(adoption_results, ["adopted"])
        self.assertEqual(len(writer_error), 1)
        self.assertIn("write fence is active", str(writer_error[0]))
        self.assertEqual(
            self.database.execute_fetch_command(
                "SELECT key FROM configs WHERE key = 'late';", (), return_raw=True),
            [],
        )

    def test_schema_constraints_reject_invalid_direct_sql(self):
        self.database._init_mek_key_registry()
        fingerprint = next(iter(self.database.secret_manager.key_fingerprints().values()))
        invalid_commands = (
            (
                "INSERT INTO public.mek_key_registry(kid, fingerprint, state) "
                "VALUES ('alias', %s, 'prepared');",
                (fingerprint,),
            ),
            (
                "INSERT INTO public.mek_key_registry(kid, fingerprint, state) "
                "VALUES ('second-current', %s, 'current');",
                ("f" * 64,),
            ),
            (
                "UPDATE public.mek_key_registry SET remaining_references = -1 "
                "WHERE state = 'current';",
                (),
            ),
            (
                "UPDATE public.mek_lifecycle_state SET phase = 'unknown' WHERE singleton;",
                (),
            ),
            (
                "UPDATE public.mek_lifecycle_state SET bound_secret_name = 'partial' "
                "WHERE singleton;",
                (),
            ),
            (
                "UPDATE public.mek_write_epoch SET epoch = -1 WHERE singleton;",
                (),
            ),
        )
        for command, arguments in invalid_commands:
            with self.subTest(command=command), self._raw_connection() as connection:
                with connection.cursor() as cursor:
                    with self.assertRaises(psycopg2.DatabaseError):
                        cursor.execute(command, arguments)

    def test_scan_and_blocker_cannot_create_lifecycle_state(self):
        with self.assertRaisesRegex(osmo_errors.OSMOError, "initialized lifecycle binding"):
            self.database._record_mek_blocker("redacted blocker")
        rows = self.database.execute_fetch_command(
            "SELECT singleton FROM public.mek_lifecycle_state;", (), return_raw=True)
        self.assertEqual(rows, [])

    def test_schema_rejects_legacy_pr_tables_without_dropping_them(self):
        self.database.execute_commit_command(
            "CREATE TABLE public.mek_rewrap_status(singleton BOOLEAN PRIMARY KEY);", ())

        with self.assertRaisesRegex(mek_schema.MekSchemaError, "pre-merge MEK schema"):
            self._ensure_schema()

        self.assertEqual(
            self.database.execute_fetch_command(
                "SELECT to_regclass('public.mek_rewrap_status') AS relation;",
                (), return_raw=True)[0]["relation"],
            "mek_rewrap_status",
        )

    def test_schema_rejects_same_columns_with_missing_constraint(self):
        self.database.execute_commit_command(
            "ALTER TABLE public.mek_lifecycle_state "
            "DROP CONSTRAINT mek_lifecycle_phase_valid;", ())

        with self.assertRaisesRegex(mek_schema.MekSchemaError, "unsupported"):
            self._ensure_schema()

    def test_schema_rejects_same_name_wrong_partial_index(self):
        self.database.execute_commit_command(
            "DROP INDEX public.mek_key_registry_one_current;", ())
        self.database.execute_commit_command(
            "CREATE UNIQUE INDEX mek_key_registry_one_current "
            "ON public.mek_key_registry(kid);", ())

        with self.assertRaisesRegex(mek_schema.MekSchemaError, "unsupported"):
            self._ensure_schema()

    def test_schema_installs_missing_trigger_without_recreating_valid_trigger(self):
        trigger_query = '''
            SELECT trigger.oid
            FROM pg_trigger trigger
            JOIN pg_class relation ON relation.oid = trigger.tgrelid
            WHERE relation.oid = 'public.configs'::regclass
              AND trigger.tgname = 'bump_mek_write_epoch';
        '''
        original_oid = self.database.execute_fetch_command(
            trigger_query, (), return_raw=True)[0]["oid"]
        self._ensure_schema()
        retained_oid = self.database.execute_fetch_command(
            trigger_query, (), return_raw=True)[0]["oid"]
        self.assertEqual(original_oid, retained_oid)

        self.database.execute_commit_command(
            "DROP TRIGGER bump_mek_write_epoch ON public.configs;", ())
        self._ensure_schema()
        replacement_oid = self.database.execute_fetch_command(
            trigger_query, (), return_raw=True)[0]["oid"]
        self.assertNotEqual(original_oid, replacement_oid)

    def test_schema_rejects_disabled_or_wrong_write_fence_trigger(self):
        self.database.execute_commit_command(
            "ALTER TABLE public.configs DISABLE TRIGGER bump_mek_write_epoch;", ())
        with self.assertRaisesRegex(mek_schema.MekSchemaError, "disabled or invalid"):
            self._ensure_schema()

        self.database.execute_commit_command(
            "ALTER TABLE public.configs ENABLE TRIGGER bump_mek_write_epoch;", ())
        self.database.execute_commit_command(
            "DROP TRIGGER bump_mek_write_epoch ON public.configs;", ())
        self.database.execute_commit_command('''
            CREATE OR REPLACE FUNCTION public.wrong_mek_trigger()
            RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END; $$;
        ''', ())
        self.database.execute_commit_command('''
            CREATE TRIGGER bump_mek_write_epoch AFTER INSERT ON public.configs
            FOR EACH STATEMENT EXECUTE FUNCTION public.wrong_mek_trigger();
        ''', ())
        with self.assertRaisesRegex(mek_schema.MekSchemaError, "disabled or invalid"):
            self._ensure_schema()

    def test_concurrent_schema_initializers_preserve_exact_triggers(self):
        barrier = threading.Barrier(2)
        errors = []

        def initialize():
            try:
                barrier.wait()
                self._ensure_schema()
            except Exception as error:  # pylint: disable=broad-except
                errors.append(error)

        threads = [threading.Thread(target=initialize) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=5)

        self.assertEqual(errors, [])
        triggers = self.database.execute_fetch_command('''
            SELECT relation.relname, trigger.tgenabled, trigger.tgtype,
                   procedure.oid = 'public.bump_mek_write_epoch()'::regprocedure AS valid_function
            FROM pg_trigger trigger
            JOIN pg_class relation ON relation.oid = trigger.tgrelid
            JOIN pg_proc procedure ON procedure.oid = trigger.tgfoid
            WHERE relation.relname IN ('configs', 'ueks')
              AND trigger.tgname = 'bump_mek_write_epoch'
            ORDER BY relation.relname;
        ''', (), return_raw=True)
        self.assertEqual(
            [(row["relname"], row["tgenabled"], row["tgtype"], row["valid_function"])
             for row in triggers],
            [("configs", "O", 60, True), ("ueks", "O", 60, True)],
        )

    def test_protected_writes_do_not_lock_lifecycle_state(self):
        self.database._init_mek_key_registry()
        lifecycle_lock = self._raw_connection()
        writer = self._raw_connection()
        try:
            with lifecycle_lock.cursor() as cursor:
                cursor.execute(
                    "SELECT singleton FROM public.mek_lifecycle_state "
                    "WHERE singleton FOR UPDATE;")
            with writer.cursor() as cursor:
                cursor.execute("SET LOCAL statement_timeout = '1s';")
                cursor.execute(
                    "INSERT INTO configs(key, type, value) "
                    "VALUES ('independent-fence', 'TEST', 'value');")
            writer.commit()
        finally:
            lifecycle_lock.rollback()
            lifecycle_lock.close()
            writer.close()

        rows = self.database.execute_fetch_command(
            "SELECT key FROM configs WHERE key = 'independent-fence';",
            (), return_raw=True)
        self.assertEqual(rows[0]["key"], "independent-fence")


if __name__ == "__main__":
    unittest.main()
