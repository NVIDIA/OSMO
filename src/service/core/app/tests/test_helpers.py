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

import datetime
import unittest
from unittest import mock

from src.service.core.app import helpers
from src.tests.common import runner
from src.utils import connectors
from src.utils.job import app as job_app


def _app_row(name='my_app', uuid='app-uuid-1', owner='alice@example.com', latest_version=1):
    """Build a raw apps row shaped like what execute_fetch_command returns."""
    return {
        'uuid': uuid,
        'name': name,
        'description': 'desc',
        'created_date': datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        'owner': owner,
        'latest_version': latest_version,
    }


def _version_row(version=1, created_by='alice@example.com', status='READY'):
    """Build a raw app_versions row shaped like what execute_fetch_command returns."""
    return {
        'version': version,
        'created_by': created_by,
        'created_date': datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        'status': status,
    }


def _fake_database(rows):
    """A PostgresConnector stand-in that records the SQL it was handed."""
    database = mock.MagicMock()
    database.execute_fetch_command.return_value = rows
    database.fetch_user_names.return_value = ['alice@example.com']
    return database


def _executed_command(database):
    """The SQL string passed to execute_fetch_command."""
    return database.execute_fetch_command.call_args.args[0]


def _executed_input(database):
    """The bound parameter tuple passed to execute_fetch_command."""
    return database.execute_fetch_command.call_args.args[1]


class TestListApps(unittest.TestCase):
    """list_apps: visibility predicate composition, owner filter, and LIKE escaping."""

    def test_list_apps_no_filters_omits_where_clause(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=5, limit=10, order=connectors.ListOrder.DESC)

        command = _executed_command(database)
        # Only the base query's `WHERE status = %s` should remain.
        self.assertEqual(command.count('WHERE'), 1)
        self.assertEqual(
            _executed_input(database),
            (job_app.AppStatus.READY.value, 10, 5))

    def test_list_apps_username_filters_authored_and_submitted_apps(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name=None, username='alice@example.com', users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command = _executed_command(database)
        self.assertIn('SELECT uuid from app_versions WHERE created_by = %s', command)
        self.assertIn('SELECT app_uuid from workflows WHERE submitted_by = %s', command)
        self.assertEqual(
            _executed_input(database),
            (job_app.AppStatus.READY.value, 'alice@example.com', 'alice@example.com', 20, 0))

    def test_list_apps_users_filters_by_resolved_owner_names(self):
        database = _fake_database([_app_row()])
        database.fetch_user_names.return_value = ['alice@example.com', 'bob@example.com']

        helpers.list_apps(database, name=None, username=None, users=['alice', 'bob'],
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        database.fetch_user_names.assert_called_once_with(['alice', 'bob'])
        self.assertIn('apps.owner IN %s', _executed_command(database))
        self.assertEqual(
            _executed_input(database),
            (job_app.AppStatus.READY.value,
             ('alice@example.com', 'bob@example.com'), 20, 0))

    def test_list_apps_username_takes_precedence_over_users(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name=None, username='alice@example.com', users=['bob'],
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        self.assertNotIn('apps.owner IN %s', _executed_command(database))
        database.fetch_user_names.assert_not_called()

    def test_list_apps_name_escapes_postgres_wildcards(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name='a_b%c', username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        self.assertIn('apps.name LIKE %s', _executed_command(database))
        self.assertEqual(
            _executed_input(database),
            (job_app.AppStatus.READY.value, r'%a\_b\%c%', 20, 0))

    def test_list_apps_username_and_name_are_joined_with_and(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name='sim', username='alice@example.com', users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command = _executed_command(database)
        self.assertIn('WHERE', command)
        self.assertIn(' AND apps.name LIKE %s', command)
        self.assertEqual(
            _executed_input(database),
            (job_app.AppStatus.READY.value, 'alice@example.com', 'alice@example.com',
             '%sim%', 20, 0))

    def test_list_apps_ascending_order_sorts_outer_query_ascending(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.ASC)

        self.assertIn('ORDER BY created_date ASC;', _executed_command(database))

    def test_list_apps_descending_order_sorts_outer_query_descending(self):
        database = _fake_database([_app_row()])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        self.assertIn('ORDER BY created_date DESC;', _executed_command(database))

    def test_list_apps_returns_list_entries_for_each_row(self):
        database = _fake_database([
            _app_row(name='first_app', uuid='uuid-1', latest_version=3),
            _app_row(name='second_app', uuid='uuid-2', latest_version=7),
        ])

        result = helpers.list_apps(database, name=None, username=None, users=None,
                                   offset=0, limit=20, order=connectors.ListOrder.DESC)

        self.assertEqual([entry.name for entry in result], ['first_app', 'second_app'])
        self.assertEqual([entry.latest_version for entry in result], [3, 7])

    def test_list_apps_empty_result_returns_empty_list(self):
        database = _fake_database([])

        result = helpers.list_apps(database, name=None, username=None, users=None,
                                   offset=0, limit=20, order=connectors.ListOrder.DESC)

        self.assertEqual(result, [])


class TestGetAppVersions(unittest.TestCase):
    """get_app_versions: optional version filter and sort direction."""

    def test_get_app_versions_without_version_binds_uuid_and_limit(self):
        database = _fake_database([_version_row()])

        helpers.get_app_versions(database, app_uuid='app-uuid-1', limit=5,
                                 order=connectors.ListOrder.DESC)

        self.assertNotIn('AND version = %s', _executed_command(database))
        self.assertEqual(_executed_input(database), ('app-uuid-1', 5))

    def test_get_app_versions_with_version_adds_version_predicate(self):
        database = _fake_database([_version_row(version=4)])

        helpers.get_app_versions(database, app_uuid='app-uuid-1', limit=5,
                                 order=connectors.ListOrder.DESC, version=4)

        self.assertIn('AND version = %s', _executed_command(database))
        self.assertEqual(_executed_input(database), ('app-uuid-1', 4, 5))

    def test_get_app_versions_ascending_order_sorts_outer_query_ascending(self):
        database = _fake_database([_version_row()])

        helpers.get_app_versions(database, app_uuid='app-uuid-1', limit=5,
                                 order=connectors.ListOrder.ASC)

        self.assertIn('ORDER BY created_date ASC;', _executed_command(database))

    def test_get_app_versions_descending_order_sorts_outer_query_descending(self):
        database = _fake_database([_version_row()])

        helpers.get_app_versions(database, app_uuid='app-uuid-1', limit=5,
                                 order=connectors.ListOrder.DESC)

        self.assertIn('ORDER BY created_date DESC;', _executed_command(database))

    def test_get_app_versions_returns_version_entries_for_each_row(self):
        database = _fake_database([
            _version_row(version=1, created_by='alice@example.com'),
            _version_row(version=2, created_by='bob@example.com'),
        ])

        result = helpers.get_app_versions(database, app_uuid='app-uuid-1', limit=5,
                                          order=connectors.ListOrder.DESC)

        self.assertEqual([entry.version for entry in result], [1, 2])
        self.assertEqual([entry.created_by for entry in result],
                         ['alice@example.com', 'bob@example.com'])


if __name__ == '__main__':
    runner.run_test()
