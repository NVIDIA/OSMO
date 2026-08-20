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

import types
import unittest
from unittest import mock

import psycopg2  # type: ignore

from src.lib.utils import osmo_errors
from src.utils.connectors import postgres


class _PostgresError(psycopg2.DatabaseError):
    """A psycopg2 error with a deterministic SQLSTATE for retry tests."""

    def __init__(self, sqlstate: str):
        super().__init__(f'postgres error {sqlstate}')
        self._sqlstate = sqlstate

    def __getattribute__(self, name: str) -> object:
        if name == 'pgcode':
            return object.__getattribute__(self, '_sqlstate')
        return super().__getattribute__(name)


class _FakePostgres:
    def __init__(self, outcomes: list[object], attempts: int = 5):
        self.config = types.SimpleNamespace(postgres_reconnect_retry=attempts)
        self.outcomes = outcomes
        self.operation_calls = 0
        self.connect = mock.Mock()

    def operation(self, *_args: object) -> object:
        self.operation_calls += 1
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


@postgres.retry
def _retrying_operation(database: _FakePostgres, *arguments: object) -> object:
    return database.operation(*arguments)


class TestPostgresRetry(unittest.TestCase):
    def _patch_retry_seams(self, random_values: list[float] | None = None):
        sleep = mock.patch.object(postgres, 'time', create=True)
        random = mock.patch.object(postgres, 'random', create=True)
        return sleep, random, random_values or []

    def test_success_does_not_sleep_or_reconnect(self):
        database = _FakePostgres(['success'])

        sleep, random, random_values = self._patch_retry_seams()
        with sleep as time_mock, random as random_mock:
            self.assertEqual(_retrying_operation(database), 'success')

        self.assertEqual(database.operation_calls, 1)
        time_mock.sleep.assert_not_called()
        random_mock.random.assert_not_called()
        database.connect.assert_not_called()

    def test_transient_failures_use_equal_jitter_windows_before_retry(self):
        database = _FakePostgres([
            _PostgresError('40001'),
            _PostgresError('40P01'),
            _PostgresError('40001'),
            _PostgresError('40P01'),
            'success',
        ])

        sleep, random, random_values = self._patch_retry_seams([0.0, 0.0, 0.0, 0.0])
        with sleep as time_mock, random as random_mock:
            random_mock.random.side_effect = random_values
            self.assertEqual(_retrying_operation(database), 'success')

        self.assertEqual(database.operation_calls, 5)
        self.assertEqual(time_mock.sleep.call_args_list, [
            mock.call(0.05),
            mock.call(0.1),
            mock.call(0.2),
            mock.call(0.4),
        ])
        database.connect.assert_not_called()

    def test_final_failure_does_not_sleep_or_reconnect(self):
        database = _FakePostgres([_PostgresError('40001'), _PostgresError('40001')], attempts=2)

        sleep, random, random_values = self._patch_retry_seams([0.0])
        with sleep as time_mock, random as random_mock:
            random_mock.random.side_effect = random_values
            with self.assertRaises(osmo_errors.OSMODatabaseError):
                _retrying_operation(database)

        self.assertEqual(database.operation_calls, 2)
        time_mock.sleep.assert_called_once_with(0.05)
        database.connect.assert_not_called()

    def test_non_transient_database_error_fails_immediately(self):
        database = _FakePostgres([_PostgresError('23505')])

        sleep, random, random_values = self._patch_retry_seams()
        with sleep as time_mock, random as random_mock:
            with self.assertRaises(osmo_errors.OSMODatabaseError):
                _retrying_operation(database)

        self.assertEqual(database.operation_calls, 1)
        time_mock.sleep.assert_not_called()
        random_mock.random.assert_not_called()
        database.connect.assert_not_called()

    def test_serialization_failure_retries_without_reconnect(self):
        database = _FakePostgres([_PostgresError('40001'), 'success'])

        sleep, random, random_values = self._patch_retry_seams([0.0])
        with sleep as time_mock, random as random_mock:
            random_mock.random.side_effect = random_values
            self.assertEqual(_retrying_operation(database), 'success')

        time_mock.sleep.assert_called_once_with(0.05)
        database.connect.assert_not_called()

    def test_connection_failure_sleeps_before_reconnect(self):
        database = _FakePostgres([_PostgresError('08006'), 'success'])

        sleep, random, random_values = self._patch_retry_seams([0.0])
        with sleep as time_mock, random as random_mock:
            random_mock.random.side_effect = random_values
            self.assertEqual(_retrying_operation(database), 'success')

        time_mock.sleep.assert_called_once_with(0.05)
        database.connect.assert_called_once_with()

    def test_reconnect_failure_consumes_attempt_budget(self):
        database = _FakePostgres([_PostgresError('08006'), 'success'], attempts=3)
        database.connect.side_effect = [
            osmo_errors.OSMOConnectionError('connection unavailable'),
            None,
        ]

        sleep, random, random_values = self._patch_retry_seams([0.0, 0.0])
        with sleep as time_mock, random as random_mock:
            random_mock.random.side_effect = random_values
            self.assertEqual(_retrying_operation(database), 'success')

        self.assertEqual(database.operation_calls, 2)
        self.assertEqual(time_mock.sleep.call_args_list, [mock.call(0.05), mock.call(0.1)])
        self.assertEqual(database.connect.call_count, 2)

    def test_one_attempt_disables_retry(self):
        database = _FakePostgres([_PostgresError('08006')], attempts=1)

        sleep, random, random_values = self._patch_retry_seams()
        with sleep as time_mock, random as random_mock:
            with self.assertRaises(osmo_errors.OSMODatabaseError):
                _retrying_operation(database)

        self.assertEqual(database.operation_calls, 1)
        time_mock.sleep.assert_not_called()
        random_mock.random.assert_not_called()
        database.connect.assert_not_called()

    def test_retry_log_excludes_operation_arguments(self):
        database = _FakePostgres([_PostgresError('40001'), 'success'], attempts=2)

        sleep, random, random_values = self._patch_retry_seams([0.0])
        with sleep, random as random_mock, self.assertLogs(level='ERROR') as logs:
            random_mock.random.side_effect = random_values
            self.assertEqual(_retrying_operation(database, 'sensitive-operation-argument'), 'success')

        self.assertTrue(any('_retrying_operation' in message for message in logs.output))
        self.assertTrue(any('attempt 1/2' in message for message in logs.output))
        self.assertFalse(any('sensitive-operation-argument' in message for message in logs.output))


if __name__ == '__main__':
    unittest.main()
