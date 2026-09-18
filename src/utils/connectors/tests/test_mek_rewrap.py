"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import types
import typing
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.utils.connectors import postgres

_CURRENT_VALUE = 'wrapped:kid-new'
_STALE_VALUE = 'wrapped:kid-old'
_BROKEN_VALUE = 'wrapped:broken'
_GHOST_VALUE = 'wrapped:kid-ghost'
_ADVISORY_UNLOCK = 'SELECT pg_advisory_unlock(%s);'


def _authenticate_wrapper(value: str, slot: str) -> str:
    """Stand-in for SecretManager.authenticate_uek_wrapper keyed off the wrapper value."""
    del slot
    if value == _BROKEN_VALUE:
        raise osmo_errors.OSMOError('wrapper authentication failed')
    return value.split(':', 1)[1]


def _page(rows: list, cursor_uid: str, cursor_key: str, limit: int) -> list:
    """Return the keyset-paginated slice the reconciler queries ask for."""
    return [row for row in rows if (row[0], row[1]) > (cursor_uid, cursor_key)][:limit]


class _UekStore:
    """Paginated `ueks` rows with per-inventory control over stale wrappers.

    Rows are ``(uid, slot, wrapper_value)`` triples. ``stale_inventories`` names the
    zero-based inventory passes that report every wrapper as still held by the old
    MEK, and ``extra_inventory_rows`` models rows that only the inventory query sees
    (a concurrent insert landing after the rewrap pass).
    """

    def __init__(self, rows: list, stale_inventories: tuple = (),
                 extra_inventory_rows: list | None = None):
        self.rows = sorted(rows)
        self.stale_inventories = set(stale_inventories)
        self.extra_inventory_rows = list(extra_inventory_rows or [])
        self.inventory_count = 0
        self.rewrap_pages = 0

    def fetch(self, command: str, args: tuple, return_raw: bool = False) -> list:
        """Serve either the inventory query or the rewrap query for one page."""
        del return_raw
        cursor_uid, cursor_key, limit = args
        if 'entry.value' in command:
            return self.inventory_page(cursor_uid, cursor_key, limit)
        self.rewrap_pages += 1
        return [{'uid': uid, 'key': key}
                for uid, key, _ in _page(self.rows, cursor_uid, cursor_key, limit)]

    def inventory_page(self, cursor_uid: str, cursor_key: str, limit: int) -> list:
        """Serve one inventory page, counting restarts from the zero cursor."""
        if (cursor_uid, cursor_key) == ('', ''):
            self.inventory_count += 1
        stale = self.inventory_count - 1 in self.stale_inventories
        rows = sorted(self.rows + self.extra_inventory_rows)
        return [{'uid': uid, 'key': key, 'value': _STALE_VALUE if stale else value}
                for uid, key, value in _page(rows, cursor_uid, cursor_key, limit)]

    def rewrap(self, uid: str, slot: str, snapshot: typing.Any) -> None:
        self.rows = [
            (owner, key, f'wrapped:{snapshot.current_mek_id}')
            if (owner, key) == (uid, slot) and value == _STALE_VALUE
            else (owner, key, value)
            for owner, key, value in self.rows
        ]


class _FakeCursor:
    """Cursor stand-in recording statements and answering the advisory-lock probe."""

    def __init__(self, lock_granted: bool = True, unlock_error: Exception | None = None):
        self.lock_granted = lock_granted
        self.unlock_error = unlock_error
        self.statements: list = []

    def __enter__(self) -> '_FakeCursor':
        return self

    def __exit__(self, *exc_info) -> None:
        del exc_info

    def execute(self, command: str, args: tuple | None = None) -> None:
        self.statements.append((command, args))
        if command == _ADVISORY_UNLOCK and self.unlock_error is not None:
            raise self.unlock_error

    def fetchone(self) -> tuple:
        return (self.lock_granted,)


class _FakeConnection:
    """Connection stand-in handing out one shared cursor and recording session resets."""

    def __init__(self, cursor: _FakeCursor, set_session_error: Exception | None = None):
        self.shared_cursor = cursor
        self.set_session_error = set_session_error
        self.autocommit_settings: list = []
        self.closed = False

    def close(self) -> None:
        self.closed = True

    def cursor(self) -> _FakeCursor:
        return self.shared_cursor

    def rollback(self) -> None:
        if self.closed:
            raise RuntimeError('connection is closed')

    def set_session(self, autocommit: bool) -> None:
        self.autocommit_settings.append(autocommit)
        if self.set_session_error is not None and not autocommit:
            raise self.set_session_error


class _FakePool:
    """ThreadedConnectionPool stand-in serving the reserved reconciler connection."""

    def __init__(self, connection: typing.Any):
        self.connection = connection
        self.getconn_calls = 0
        self.putconn_closes: list = []

    def getconn(self) -> typing.Any:
        self.getconn_calls += 1
        return self.connection

    def putconn(self, connection: typing.Any, close: bool = False) -> None:
        self.putconn_closes.append(close)
        if close:
            connection.close()


def _reconciler(store: _UekStore, cursor: _FakeCursor,
                connection: _FakeConnection | None = None,
                rewrap_error: Exception | None = None,
                current_kid: str = 'kid-new') -> typing.Any:
    """Build a PostgresConnector shell wired to fake pool, cursor and secret manager."""
    connector: typing.Any = postgres.PostgresConnector.__new__(postgres.PostgresConnector)
    manager = mock.Mock()
    manager.meks = {'kid-old': 'old-key', 'kid-new': 'new-key'}
    manager.rewrap_snapshot.return_value = types.SimpleNamespace(
        generation='gen-2', current_mek_id=current_kid)
    manager.rewrap_snapshot_digest.return_value = 'digest-2'
    manager.authenticate_uek_wrapper.side_effect = _authenticate_wrapper
    manager.rewrap_uek.side_effect = rewrap_error or store.rewrap
    connector.secret_manager = manager
    connector.execute_fetch_command = store.fetch
    connector._pool = _FakePool(  # pylint: disable=protected-access
        connection if connection is not None else _FakeConnection(cursor))
    return connector


class TestRewrapSnapshotCompareAndSwap(unittest.TestCase):
    """Covers the keyring CAS guard in rewrap_mek_references (lines 1426-1427)."""

    def test_generation_mismatch_refuses_to_rewrap(self):
        cursor = _FakeCursor()
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'does not match'):
            connector.rewrap_mek_references(expected_generation='gen-1')

        self.assertEqual(cursor.statements, [])

    def test_current_kid_mismatch_refuses_to_rewrap(self):
        cursor = _FakeCursor()
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'does not match'):
            connector.rewrap_mek_references(expected_current_kid='kid-other')

        self.assertEqual(cursor.statements, [])

    def test_registry_digest_mismatch_refuses_to_rewrap(self):
        cursor = _FakeCursor()
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'does not match'):
            connector.rewrap_mek_references(expected_registry_digest='digest-1')

        self.assertEqual(cursor.statements, [])

    def test_matching_snapshot_expectations_are_accepted(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        counts = connector.rewrap_mek_references(
            expected_generation='gen-2', expected_current_kid='kid-new',
            expected_registry_digest='digest-2')

        self.assertEqual(counts, {'kid-old': 0, 'kid-new': 1})


class TestRewrapMutualExclusion(unittest.TestCase):
    """Covers the advisory-lock fence and reserved connection handling
    (lines 402-409, 411-416, 1430-1433, 1471-1472)."""

    def test_held_advisory_lock_rejects_a_second_reconciler(self):
        cursor = _FakeCursor(lock_granted=False)
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'already running'):
            connector.rewrap_mek_references()

        self.assertNotIn(_ADVISORY_UNLOCK, [statement for statement, _ in cursor.statements])

    def test_advisory_lock_is_released_after_a_rewrap_failure(self):
        cursor = _FakeCursor()
        connector = _reconciler(
            _UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor,
            rewrap_error=osmo_errors.OSMOError('wrapper mismatch'))

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'failed authentication'):
            connector.rewrap_mek_references()

        self.assertIn(_ADVISORY_UNLOCK, [statement for statement, _ in cursor.statements])

    def test_reserved_connection_toggles_autocommit_around_the_rewrap(self):
        cursor = _FakeCursor()
        connection = _FakeConnection(cursor)
        connector = _reconciler(
            _UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor, connection=connection)

        connector.rewrap_mek_references()

        self.assertEqual(connection.autocommit_settings, [True, False])

    def test_reserved_connection_is_closed_when_its_reset_fails(self):
        cursor = _FakeCursor()
        connection = _FakeConnection(cursor, set_session_error=RuntimeError('reset failed'))
        connector = _reconciler(
            _UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor, connection=connection)

        connector.rewrap_mek_references()

        self.assertEqual(
            connector._pool.putconn_closes, [True])  # pylint: disable=protected-access

    def test_unlock_failure_discards_the_session_holding_the_lock(self):
        cursor = _FakeCursor(unlock_error=RuntimeError('unlock cancelled'))
        connection = _FakeConnection(cursor)
        connector = _reconciler(_UekStore([]), cursor, connection=connection)

        with self.assertRaisesRegex(RuntimeError, 'unlock cancelled'):
            connector.rewrap_mek_references()

        self.assertTrue(connection.closed)
        self.assertEqual(
            connector._pool.putconn_closes, [True])  # pylint: disable=protected-access

    def test_missing_pool_reports_an_uninitialized_connection(self):
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), _FakeCursor())
        connector._pool = None  # pylint: disable=protected-access

        with self.assertRaisesRegex(osmo_errors.OSMOConnectionError, 'not initialized'):
            connector.rewrap_mek_references()


class TestRewrapCompletionEvidence(unittest.TestCase):
    """Covers paginated rewrap/inventory completion and its retries
    (lines 1341, 1351, 1353-1363, 1383, 1393, 1406, 1434-1447, 1453-1469)."""

    def test_all_current_wrappers_report_a_per_key_inventory(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE),
                           ('bob', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        counts = connector.rewrap_mek_references()

        self.assertEqual(counts, {'kid-old': 0, 'kid-new': 2})

    def test_paged_scans_advance_the_keyset_cursor_across_every_row(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _STALE_VALUE),
                           ('alice', 'slot-2', _STALE_VALUE),
                           ('bob', 'slot-1', _STALE_VALUE)])
        connector = _reconciler(store, cursor)

        with mock.patch.object(postgres, 'MEK_RECONCILE_BATCH_SIZE', 1):
            counts = connector.rewrap_mek_references()

        self.assertEqual(counts, {'kid-old': 0, 'kid-new': 3})
        snapshot = connector.secret_manager.rewrap_snapshot.return_value
        self.assertEqual(connector.secret_manager.rewrap_uek.call_args_list, [
            mock.call('alice', 'slot-1', snapshot),
            mock.call('alice', 'slot-2', snapshot),
            mock.call('bob', 'slot-1', snapshot),
        ])
        self.assertEqual(store.inventory_count, 2)
        self.assertEqual(cursor.statements, [
            ('SELECT pg_try_advisory_lock(%s);', (0x4F534D4F4D454B,)),
            (_ADVISORY_UNLOCK, (0x4F534D4F4D454B,)),
        ])

    def test_confirmation_inventory_authentication_failure_blocks_completion(self):
        cursor = _FakeCursor()
        connector = _reconciler(_UekStore([('alice', 'slot-1', _CURRENT_VALUE)]), cursor)
        connector.secret_manager.authenticate_uek_wrapper.side_effect = [
            'kid-new', osmo_errors.OSMOError('wrapper changed'),
        ]

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'coverage blockers'):
            connector.rewrap_mek_references()

        self.assertEqual(cursor.statements[-1], (_ADVISORY_UNLOCK, (0x4F534D4F4D454B,)))

    def test_noncurrent_inventory_triggers_another_rewrap_round(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)], stale_inventories=(0,))
        connector = _reconciler(store, cursor)

        counts = connector.rewrap_mek_references()

        self.assertEqual(counts, {'kid-old': 0, 'kid-new': 1})
        self.assertEqual(connector.secret_manager.rewrap_uek.call_count, 2)

    def test_noncurrent_confirmation_inventory_is_never_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)], stale_inventories=(1,))
        connector = _reconciler(store, cursor)

        counts = connector.rewrap_mek_references()

        self.assertEqual(counts, {'kid-old': 0, 'kid-new': 1})
        self.assertEqual(store.inventory_count, 4)

    def test_unauthenticated_wrapper_blocks_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _BROKEN_VALUE)])
        connector = _reconciler(store, cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'coverage blockers'):
            connector.rewrap_mek_references()

    def test_wrapper_held_by_an_unmounted_key_blocks_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _GHOST_VALUE)])
        connector = _reconciler(store, cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'coverage blockers'):
            connector.rewrap_mek_references()

    def test_inventory_row_limit_blocks_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)],
                          extra_inventory_rows=[('bob', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        with mock.patch.object(postgres, 'MEK_MAX_UEK_ROWS', 1):
            with self.assertRaisesRegex(osmo_errors.OSMOError, 'coverage blockers'):
                connector.rewrap_mek_references()

    def test_rewrap_row_limit_aborts_the_reconciler(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE),
                           ('bob', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        with mock.patch.object(postgres, 'MEK_MAX_UEK_ROWS', 1):
            with mock.patch.object(postgres, 'MEK_RECONCILE_BATCH_SIZE', 1):
                with self.assertRaisesRegex(osmo_errors.OSMOError, 'row limit exceeded'):
                    connector.rewrap_mek_references()

    def test_exhausted_deadline_never_reports_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        with self.assertRaisesRegex(osmo_errors.OSMOError, 'deadline exceeded'):
            connector.rewrap_mek_references(deadline_seconds=0)

        self.assertEqual(store.rewrap_pages, 0)

    def test_deadline_reached_during_the_rewrap_pass_aborts_it(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        with mock.patch.object(postgres.time, 'monotonic', side_effect=[0.0, 1.0, 400.0]):
            with self.assertRaisesRegex(osmo_errors.OSMOError, 'UEK rewrap deadline exceeded'):
                connector.rewrap_mek_references(deadline_seconds=300)

    def test_deadline_reached_during_the_inventory_pass_blocks_completion(self):
        cursor = _FakeCursor()
        store = _UekStore([('alice', 'slot-1', _CURRENT_VALUE)])
        connector = _reconciler(store, cursor)

        with mock.patch.object(postgres.time, 'monotonic', side_effect=[0.0, 1.0, 2.0, 400.0]):
            with self.assertRaisesRegex(osmo_errors.OSMOError, 'coverage blockers'):
                connector.rewrap_mek_references(deadline_seconds=300)


if __name__ == '__main__':
    unittest.main()
