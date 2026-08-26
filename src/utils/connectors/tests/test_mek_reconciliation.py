"""Unit coverage for stateless, restart-from-zero MEK reconciliation."""

# SPDX-License-Identifier: Apache-2.0

import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils.connectors.postgres import PostgresConnector


def _database() -> tuple[PostgresConnector, mock.Mock]:
    database = PostgresConnector.__new__(PostgresConnector)
    manager = mock.Mock()
    database.secret_manager = manager
    return database, manager


class TestMekReconciliation(unittest.TestCase):
    def test_uek_rewrap_restarts_from_zero_and_uses_cas_primitive(self):
        database, manager = _database()
        database.execute_fetch_command = mock.Mock(side_effect=[
            [{"uid": "a", "key": "u1"}, {"uid": "b", "key": "u2"}],
        ])  # type: ignore[method-assign]
        manager.rewrap_uek.return_value = mock.Mock(status="rewrapped")
        self.assertTrue(database._rewrap_ueks(mock.sentinel.snapshot))
        self.assertEqual(manager.rewrap_uek.call_count, 2)
        query = database.execute_fetch_command.call_args.args[0]
        self.assertIn("entry.key <> 'current'", query)
        self.assertNotIn("mek_rewrap", query)

    def test_uek_authentication_failure_blocks_immediately(self):
        database, manager = _database()
        database.execute_fetch_command = mock.Mock(return_value=[
            {"uid": "a", "key": "u1"},
        ])  # type: ignore[method-assign]
        manager.rewrap_uek.side_effect = osmo_errors.OSMOError("bad")
        with self.assertRaisesRegex(osmo_errors.OSMOError, "authentication"):
            database._rewrap_ueks(mock.sentinel.snapshot)

    def test_unknown_config_path_is_never_mutated(self):
        database, manager = _database()
        value = {"known": "not-a-jwe", "extension": "opaque"}
        replacement, changed = database._rewrap_config_value(
            value, frozenset({"known"}), mock.sentinel.snapshot)
        self.assertEqual(replacement, value)
        self.assertFalse(changed)
        manager.rewrap_direct_mek.assert_not_called()

    def test_registered_config_path_uses_explicit_rewrap(self):
        database, manager = _database()
        database._jwe_header = mock.Mock(return_value={"kid": "key1"})  # type: ignore[method-assign]
        manager.meks = {"key1": mock.sentinel.key}
        manager.rewrap_direct_mek.return_value = mock.Mock(
            value="replacement", status="rewrapped")
        replacement, changed = database._rewrap_config_value(
            "ciphertext", frozenset({"secret"}), mock.sentinel.snapshot, "secret")
        self.assertEqual(replacement, "replacement")
        self.assertTrue(changed)

    def test_inventory_blocker_never_becomes_completion(self):
        database, manager = _database()
        manager.rewrap_snapshot.return_value = mock.Mock(
            generation="generation", current_mek_id="key2",
            fingerprints={"key1": "a", "key2": "b"})
        manager.rewrap_snapshot_digest.return_value = "digest"
        database._get_reserved_reconciler_connection = mock.Mock(  # type: ignore[method-assign]
            side_effect=osmo_errors.OSMOError("lock unavailable"))
        with self.assertRaisesRegex(osmo_errors.OSMOError, "lock unavailable"):
            database.rewrap_mek_references(
                expected_generation="generation",
                expected_current_kid="key2",
                expected_registry_digest="digest")


if __name__ == "__main__":
    unittest.main()
