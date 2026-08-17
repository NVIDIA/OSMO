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

import ast
import inspect
import json
import threading
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils import connectors
import src.utils.connectors.postgres as postgres_module


def _connector():
    database = object.__new__(connectors.PostgresConnector)
    database.config = mock.Mock(allow_existing_mek_adoption=False)
    database.secret_manager = mock.Mock()
    database.secret_manager.current_mek_id = "new"
    database.secret_manager.generation = "generation"
    database.secret_manager.meks = {"old": object(), "new": object()}
    database._mek_reconciler_stop = threading.Event()
    database.execute_commit_commands = mock.Mock()
    return database


class TestMekReconciliation(unittest.TestCase):
    """Fail-closed adoption, authenticated inventory, and CAS behavior."""

    def test_empty_registry_does_not_adopt_unauthenticated_database(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {"new": "fingerprint"}
        database.execute_fetch_command = mock.Mock(return_value=[])
        database.execute_commit_command = mock.Mock()

        with mock.patch.object(
            database, "_mek_write_epoch", return_value=0
        ), mock.patch.object(
            database, "_scan_mek_references", return_value=({}, ["blocked"])
        ), self.assertRaisesRegex(osmo_errors.OSMOError, "failed authentication"):
            database._init_mek_key_registry()

        database.execute_commit_command.assert_not_called()

    def test_existing_ciphertext_adoption_requires_legacy_writer_shutdown_ack(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {"new": "fingerprint"}
        database.execute_fetch_command = mock.Mock(return_value=[])

        with mock.patch.object(
            database, "_mek_write_epoch", return_value=0
        ), mock.patch.object(
            database, "_scan_mek_references", return_value=({"new": 1}, [])
        ), self.assertRaisesRegex(osmo_errors.OSMOError, "legacy OSMO writers"):
            database._init_mek_key_registry()

    def test_registered_nonretired_key_must_remain_mounted(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {"new": "new-fingerprint"}
        database.execute_fetch_command = mock.Mock(side_effect=[
            [{"kid": "old", "fingerprint": "old-fingerprint", "state": "current"}],
            [{
                "generation": "old-generation",
                "current_kid": "old",
                "loaded_kids": ["old"],
                "ready": True,
            }],
        ])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "missing registered keys"):
            database._init_mek_key_registry()

    def test_cold_adoption_loser_rechecks_canonical_bundle(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {
            "a": "fingerprint-a",
            "new": "fingerprint-new",
        }
        database.execute_fetch_command = mock.Mock(side_effect=[
            [],
            [],
            [{"kid": "a", "fingerprint": "fingerprint-a", "state": "current"}],
            [{"generation": "other", "current_kid": "a", "loaded_kids": ["a"]}],
        ])
        database._adopt_initial_mek_keyring = mock.Mock(return_value="existing")

        with mock.patch.object(
            database, "_mek_write_epoch", return_value=0
        ), mock.patch.object(
            database, "_scan_mek_references", return_value=({}, [])
        ), self.assertRaisesRegex(osmo_errors.OSMOError, "different initial MEK keyring"):
            database._init_mek_key_registry()

        database.execute_commit_commands.assert_called_once()

    def test_committed_adoption_fence_is_released_before_local_mount_rejection(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {
            "new": "wrong-local-fingerprint",
        }
        database.execute_fetch_command = mock.Mock(side_effect=[
            [{"kid": "new", "fingerprint": "canonical-fingerprint", "state": "current"}],
            [{
                "generation": "generation",
                "current_kid": "new",
                "loaded_kids": ["new"],
                "ready": False,
            }],
        ])

        with self.assertRaisesRegex(osmo_errors.OSMOError, "does not match"):
            database._init_mek_key_registry()

        database.execute_commit_commands.assert_called_once()
        commands = database.execute_commit_commands.call_args.args[0]
        self.assertTrue(any("writes_allowed = TRUE" in command for command, _ in commands))

    def test_scan_authenticates_uek_and_registered_config_secrets(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [{"uid": "user", "key": "uek", "value": "wrapped-uek"}],
                [
                    {
                        "key": "workflow_alerts",
                        "type": "WORKFLOW",
                        "value": json.dumps(
                            {
                                "slack_token": "slack-jwe",
                                "smtp_settings": {
                                    "host": "",
                                    "sender": "",
                                    "password": "smtp-jwe",
                                },
                            }
                        ),
                    }
                ],
            ]
        )
        database.secret_manager.authenticate_uek_wrapper.return_value = "old"
        database.secret_manager.authenticate_mek_encrypted.side_effect = ["old", "new"]

        counts, blockers = database._scan_mek_references()

        self.assertEqual(counts, {"old": 2, "new": 1})
        self.assertEqual(blockers, [])
        database.secret_manager.authenticate_uek_wrapper.assert_called_once_with(
            "wrapped-uek", "uek")
        self.assertEqual(database.secret_manager.authenticate_mek_encrypted.call_count, 2)

    def test_plaintext_registered_config_secret_is_a_blocker(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [],
                [
                    {
                        "key": "workflow_alerts",
                        "type": "WORKFLOW",
                        "value": json.dumps(
                            {
                                "slack_token": "plaintext",
                                "smtp_settings": {
                                    "host": "",
                                    "sender": "",
                                    "password": "plaintext",
                                },
                            }
                        ),
                    }
                ],
            ]
        )
        database.secret_manager.authenticate_mek_encrypted.side_effect = osmo_errors.OSMOError(
            "authentication failed"
        )

        _, blockers = database._scan_mek_references()

        self.assertEqual(len(blockers), 2)
        self.assertTrue(all("authentication failed" in blocker for blocker in blockers))

    def test_unregistered_plaintext_config_type_is_ignored(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [],
                [{"key": "default_bucket", "type": "DATASET", "value": "sandbox"}],
            ]
        )

        counts, blockers = database._scan_mek_references()

        self.assertEqual(counts, {"old": 0, "new": 0})
        self.assertEqual(blockers, [])

    def test_unregistered_config_type_with_compact_jwe_is_a_blocker(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [],
                [{"key": "legacy", "type": "DATASET", "value": '"compact-jwe"'}],
            ]
        )

        with mock.patch.object(
            database, "_walk_jwe_values", return_value=iter([("legacy.secret", "compact-jwe")])
        ):
            _, blockers = database._scan_mek_references()

        self.assertEqual(
            blockers,
            ["configs/DATASET/legacy.secret: unregistered compact JWE"],
        )

    def test_unregistered_config_type_with_malformed_compact_jwe_is_a_blocker(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [],
                [{"key": "legacy", "type": "DATASET", "value": '"a.b.c.d.e"'}],
            ]
        )

        _, blockers = database._scan_mek_references()

        self.assertEqual(
            blockers,
            ["configs/DATASET/legacy: malformed compact JWE"],
        )

    def test_adoption_without_fingerprint_registry_is_corruption(self):
        database = _connector()
        database.secret_manager.key_fingerprints.return_value = {"new": "fingerprint-new"}
        database.execute_fetch_command = mock.Mock(side_effect=[
            [],
            [{
                "generation": "generation",
                "current_kid": "new",
                "loaded_kids": ["new"],
            }],
            [],
            [{
                "generation": "generation",
                "current_kid": "new",
                "loaded_kids": ["new"],
            }],
        ])
        database._adopt_initial_mek_keyring = mock.Mock(return_value="existing")

        with mock.patch.object(
            database, "_mek_write_epoch", return_value=0
        ), mock.patch.object(
            database, "_scan_mek_references", return_value=({}, [])
        ), self.assertRaisesRegex(osmo_errors.OSMOError, "registry are inconsistent"):
            database._init_mek_key_registry()

    def test_config_rewrap_rereads_and_retries_after_cas_loss(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(
            side_effect=[
                [{"key": "workflow_alerts", "type": "WORKFLOW", "value": '"old"'}],
                [{"value": '"concurrent"'}],
            ]
        )
        database.execute_commit_command = mock.Mock(side_effect=[0, 1])
        database._rewrap_config_value = mock.Mock(side_effect=[("new", True), ("newer", True)])
        database._mek_progress = mock.Mock(return_value=("", "", False, 7))
        database._update_mek_progress = mock.Mock(return_value=False)

        database._rewrap_configs()

        self.assertEqual(database.execute_commit_command.call_count, 2)
        second_args = database.execute_commit_command.call_args_list[1].args[1]
        self.assertEqual(second_args[-1], '"concurrent"')

    def test_uek_rewrap_uses_durable_bounded_batches(self):
        database = _connector()
        rows = [
            {"uid": f"user-{index:03d}", "key": "uek"}
            for index in range(connectors.MEK_RECONCILE_BATCH_SIZE)
        ]
        database._mek_progress = mock.Mock(return_value=("", "", False, 7))
        database._update_mek_progress = mock.Mock(return_value=False)
        database.execute_fetch_command = mock.Mock(return_value=rows)

        completed = database._rewrap_ueks()

        self.assertFalse(completed)
        self.assertEqual(database.secret_manager.get_uek.call_count, len(rows))
        database._update_mek_progress.assert_called_once_with(
            "ueks", rows[-1]["uid"], "uek", False, 7)
        query_args = database.execute_fetch_command.call_args.args[1]
        self.assertEqual(query_args[-1], connectors.MEK_RECONCILE_BATCH_SIZE)

        database._mek_progress.return_value = (rows[-1]["uid"], "uek", True, 7)
        database.execute_fetch_command.reset_mock()
        self.assertTrue(database._rewrap_ueks())
        database.execute_fetch_command.assert_not_called()

    def test_uek_rewrap_records_bad_row_and_advances_cursor(self):
        database = _connector()
        rows = [{"uid": "bad-user", "key": "bad-key"}]
        database._mek_progress = mock.Mock(return_value=("", "", False, 7))
        database._update_mek_progress = mock.Mock(return_value=True)
        database._record_mek_blocker = mock.Mock()
        database.execute_fetch_command = mock.Mock(return_value=rows)
        database.secret_manager.get_uek.side_effect = osmo_errors.OSMOError("bad wrapper")

        self.assertTrue(database._rewrap_ueks())

        database._record_mek_blocker.assert_called_once_with(
            "A persisted UEK wrapper failed authentication; inspect service logs.")
        database._update_mek_progress.assert_called_once_with(
            "ueks", "bad-user", "bad-key", True, 7)

    def test_config_rewrap_records_bad_ciphertext_without_stalling(self):
        database = _connector()
        database._record_mek_blocker = mock.Mock()
        with mock.patch.object(database, "_jwe_header", side_effect=ValueError("malformed")):
            replacement, changed = database._rewrap_config_value("a.b.c.d.e")

        self.assertEqual(replacement, "a.b.c.d.e")
        self.assertFalse(changed)
        database._record_mek_blocker.assert_called_once_with(
            "A persisted config ciphertext is malformed; inspect service logs.")

    def test_scan_status_persists_only_redacted_blocker_summary(self):
        database = _connector()
        database.execute_commit_command = mock.Mock()

        database._record_mek_scan(
            {"old": 1, "new": 0}, ["configs/WORKFLOW/private-user-path: failed"])

        status_args = database.execute_commit_command.call_args_list[0].args[1]
        self.assertEqual(
            status_args[-1],
            "1 ciphertext authentication blocker(s); inspect service logs.",
        )
        self.assertNotIn("private-user-path", status_args[-1])

    def test_reconciliation_waits_for_every_live_consumer_to_activate(self):
        database = _connector()
        database.execute_fetch_command = mock.Mock(return_value=[
            {
                "generation": "generation",
                "current_kid": "new",
                "loaded_kids": ["old", "new"],
            },
            {
                "generation": "old-generation",
                "current_kid": "old",
                "loaded_kids": ["old"],
            },
        ])

        self.assertFalse(database._all_live_mek_consumers_current())
        database.execute_fetch_command.return_value[1].update(
            generation="generation", current_kid="new", loaded_kids=["old", "new"])
        self.assertTrue(database._all_live_mek_consumers_current())

    def test_close_waits_for_reconciler_before_closing_pool(self):
        database = _connector()
        events = []
        database._mek_reconciler_thread = mock.Mock()
        database._mek_reconciler_thread.join.side_effect = lambda: events.append("joined")
        database._pool_lock = threading.Lock()
        database._pool = mock.Mock()
        database._pool.closeall.side_effect = lambda: events.append("closed")

        database.close()

        self.assertEqual(events, ["joined", "closed"])
        database._mek_reconciler_thread.join.assert_called_once_with()

    def test_reconciler_is_limited_to_long_lived_control_plane_consumers(self):
        self.assertEqual(
            connectors.MEK_RECONCILER_CONSUMERS,
            frozenset({"agent", "api", "delayed-job-monitor", "logger", "router", "worker"}),
        )
        self.assertNotIn("unknown", connectors.MEK_RECONCILER_CONSUMERS)

    def test_direct_mek_encrypt_call_sites_are_registry_backed(self):
        class DirectMekCallVisitor(ast.NodeVisitor):
            def __init__(self):
                self.scope = []
                self.call_sites = set()

            def visit_ClassDef(self, node):  # pylint: disable=invalid-name
                self.scope.append(node.name)
                self.generic_visit(node)
                self.scope.pop()

            def visit_FunctionDef(self, node):  # pylint: disable=invalid-name
                self.scope.append(node.name)
                self.generic_visit(node)
                self.scope.pop()

            def visit_Call(self, node):  # pylint: disable=invalid-name
                if (
                    isinstance(node.func, ast.Attribute)
                    and node.func.attr == "encrypt"
                    and len(node.args) >= 2
                    and isinstance(node.args[1], ast.Constant)
                    and node.args[1].value == ""
                ):
                    self.call_sites.add(tuple(self.scope))
                self.generic_visit(node)

        visitor = DirectMekCallVisitor()
        visitor.visit(ast.parse(inspect.getsource(postgres_module)))

        self.assertEqual(
            visitor.call_sites,
            {
                ("DynamicConfig", "deserialize", "_decrypt"),
                ("DynamicConfig", "serialize_helper"),
            },
        )
        self.assertEqual(connectors.MEK_PERSISTENCE_REGISTRY_VERSION, 1)


if __name__ == "__main__":
    unittest.main()
