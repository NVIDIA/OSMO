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
import unittest

from jwcrypto import jwk, jwe  # type: ignore
import psycopg2  # type: ignore

from src.lib.utils import osmo_errors
from src.utils import connectors
from src.utils.secret_manager import SecretManager


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
        self.database._mek_reconciler_stop = threading.Event()
        for command in (
            "CREATE EXTENSION IF NOT EXISTS hstore;",
            "DROP TABLE IF EXISTS public.mek_consumer_status, "
            "public.mek_rewrap_progress, public.mek_rewrap_status, public.mek_write_epoch, "
            "public.mek_keyring_adoption, public.mek_key_registry, configs, ueks, users CASCADE;",
            "CREATE TABLE users (id TEXT PRIMARY KEY);",
            "CREATE TABLE ueks (uid TEXT REFERENCES users(id), keys HSTORE, PRIMARY KEY(uid));",
            "CREATE TABLE configs (key TEXT, type TEXT, value TEXT, PRIMARY KEY(key, type));",
            "CREATE TABLE public.mek_key_registry ("
            "kid TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, "
            "state TEXT NOT NULL CHECK (state IN ('prepared','current')), "
            "remaining_references INTEGER, last_scan_started_at TIMESTAMPTZ, "
            "last_scan_completed_at TIMESTAMPTZ, first_seen_at TIMESTAMPTZ DEFAULT NOW());",
            "CREATE TABLE public.mek_keyring_adoption ("
            "singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), generation TEXT NOT NULL, "
            "current_kid TEXT NOT NULL, loaded_kids TEXT[] NOT NULL, "
            "ready BOOLEAN NOT NULL DEFAULT FALSE, adopted_at TIMESTAMPTZ DEFAULT NOW());",
            "CREATE TABLE public.mek_rewrap_status ("
            "singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), "
            "generation TEXT NOT NULL, current_kid TEXT NOT NULL, "
            "persistence_registry_version INTEGER NOT NULL DEFAULT 1, "
            "last_started_at TIMESTAMPTZ, last_completed_at TIMESTAMPTZ, "
            "blocker TEXT NOT NULL DEFAULT '');",
            "CREATE TABLE public.mek_write_epoch ("
            "singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton), epoch BIGINT NOT NULL, "
            "writes_allowed BOOLEAN NOT NULL DEFAULT TRUE);",
            "INSERT INTO public.mek_write_epoch(singleton, epoch, writes_allowed) "
            "VALUES(TRUE, 0, TRUE);",
            "CREATE TABLE public.mek_rewrap_progress ("
            "resource TEXT PRIMARY KEY, generation TEXT NOT NULL, "
            "cursor_primary TEXT NOT NULL DEFAULT '', cursor_secondary TEXT NOT NULL DEFAULT '', "
            "completed BOOLEAN NOT NULL DEFAULT FALSE, start_write_epoch BIGINT NOT NULL DEFAULT 0, "
            "updated_at TIMESTAMPTZ DEFAULT NOW());",
            "CREATE TABLE public.mek_consumer_status ("
            "consumer_id TEXT PRIMARY KEY, consumer_name TEXT NOT NULL, generation TEXT NOT NULL, "
            "current_kid TEXT NOT NULL, loaded_kids TEXT[] NOT NULL, "
            "last_seen_at TIMESTAMPTZ DEFAULT NOW());",
            "CREATE OR REPLACE FUNCTION public.bump_mek_write_epoch() RETURNS trigger "
            "LANGUAGE plpgsql AS $$ BEGIN UPDATE public.mek_write_epoch SET epoch = epoch + 1 "
            "WHERE singleton AND writes_allowed; IF NOT FOUND THEN RAISE EXCEPTION "
            "'MEK registry adoption write fence is active'; END IF; RETURN NULL; END; $$;",
            "CREATE TRIGGER bump_mek_write_epoch AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE "
            "ON ueks FOR EACH STATEMENT EXECUTE FUNCTION public.bump_mek_write_epoch();",
            "CREATE TRIGGER bump_mek_write_epoch AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE "
            "ON configs FOR EACH STATEMENT EXECUTE FUNCTION public.bump_mek_write_epoch();",
        ):
            self.database.execute_commit_command(command, ())
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

    def _complete_rewrap(self, callback, label):
        for _ in range(20):
            if callback():
                return
        self.fail(f"{label} did not complete within 20 bounded batches")

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
        self.database._init_mek_key_registry()
        self._complete_rewrap(self.database._rewrap_ueks, "UEK rewrap")
        self._complete_rewrap(self.database._rewrap_configs, "config rewrap")
        counts, blockers = self.database._scan_mek_references()
        self.assertEqual(blockers, [])
        self.assertEqual(counts["old"], 0)
        self.assertGreaterEqual(counts["new"], 3)

        progress = self.database.execute_fetch_command(
            "SELECT resource, completed FROM public.mek_rewrap_progress ORDER BY resource;",
            (),
            return_raw=True,
        )
        self.assertEqual(
            progress,
            [
                {"resource": "configs", "completed": True},
                {"resource": "ueks", "completed": True},
            ],
        )

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

        # A lagging write behind an in-progress cursor invalidates the pass and is swept.
        epoch = self.database._mek_write_epoch()
        self.database.execute_commit_command(
            "UPDATE public.mek_rewrap_progress SET completed = FALSE, "
            "cursor_primary = 'zzzz', cursor_secondary = 'zzzz', start_write_epoch = %s "
            "WHERE resource = 'ueks';",
            (epoch,),
        )
        self.database.execute_commit_command(
            "UPDATE ueks SET keys = keys || hstore(%s, %s) WHERE uid = 'user';",
            (user_key_id, old_wrapper),
        )
        self.assertFalse(self.database._rewrap_ueks())
        self._complete_rewrap(self.database._rewrap_ueks, "lagging UEK rewrap")

        # A lagging write after completion also reopens the same generation.
        self.database.execute_commit_command(
            "UPDATE ueks SET keys = keys || hstore(%s, %s) WHERE uid = 'user';",
            (user_key_id, old_wrapper),
        )
        self._complete_rewrap(self.database._rewrap_ueks, "completed UEK rewrap")
        wrapper = self.database.read_uek("user", user_key_id)
        token.deserialize(wrapper)
        self.assertEqual(token.jose_header["kid"], "new")

    def test_committed_adoption_fence_self_heals_before_bad_mount_is_rejected(self):
        self.database._init_mek_key_registry()
        self.database.execute_commit_commands([
            ("UPDATE public.mek_keyring_adoption SET ready = FALSE;", ()),
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
            "SELECT a.ready, e.writes_allowed FROM public.mek_keyring_adoption a "
            "CROSS JOIN public.mek_write_epoch e WHERE a.singleton AND e.singleton;",
            (),
            return_raw=True,
        )[0]
        self.assertEqual(state, {"ready": True, "writes_allowed": True})

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
            threading.Thread(target=register, args=("fingerprint-a",)),
            threading.Thread(target=register, args=("fingerprint-b",)),
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
        self.assertIn(rows[0]["fingerprint"], {"fingerprint-a", "fingerprint-b"})

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
            "small": ({"a": "fingerprint-a"}, "a", "small-generation"),
            "large": (
                {"a": "fingerprint-a", "b": "fingerprint-b"},
                "b",
                "large-generation",
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
            "SELECT generation, current_kid, loaded_kids "
            "FROM public.mek_keyring_adoption WHERE singleton;",
            (),
            return_raw=True,
        )[0]
        self.assertEqual(adoption["generation"], expected_generation)
        self.assertEqual(adoption["current_kid"], expected_current)
        self.assertEqual(adoption["loaded_kids"], sorted(expected_fingerprints))
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
            BEFORE INSERT ON public.mek_keyring_adoption
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
                  AND query LIKE '%%INSERT INTO public.mek_keyring_adoption%%';
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


if __name__ == "__main__":
    unittest.main()
