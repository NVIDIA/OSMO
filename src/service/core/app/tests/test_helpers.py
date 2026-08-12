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
from src.utils import connectors
from src.utils.job import app as job_app


def _app_row(name='my_app', uuid='app-uuid-1', owner='alice@example.com',
             latest_version=3):
    """A row shaped like the SELECT result consumed by objects.ListEntry."""
    return {
        'uuid': uuid,
        'name': name,
        'description': 'desc',
        'created_date': datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        'owner': owner,
        'latest_version': latest_version,
    }


def _version_row(version=2, created_by='alice@example.com', status='READY'):
    """A row shaped like the SELECT result consumed by objects.GetVersionEntry."""
    return {
        'version': version,
        'created_by': created_by,
        'created_date': datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc),
        'status': status,
    }


def _fake_database(rows):
    database = mock.MagicMock()
    database.execute_fetch_command.return_value = rows
    return database


class ListAppsQueryTest(unittest.TestCase):
    """Covers the WHERE-clause assembly and pagination in helpers.list_apps."""

    def test_list_apps_no_filters_omits_where_clause(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertNotIn('WHERE apps.', command)
        self.assertEqual(parameters, (job_app.AppStatus.READY.value, 20, 0))

    def test_list_apps_joins_only_ready_versions(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('MAX(version) as version', command)
        self.assertIn('WHERE status = %s', command)
        self.assertEqual(parameters[0], job_app.AppStatus.READY.value)

    def test_list_apps_username_scopes_to_authored_and_submitted_apps(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username='alice@example.com',
                          users=None, offset=0, limit=20,
                          order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('apps.uuid IN (SELECT uuid from app_versions WHERE created_by = %s)',
                      command)
        self.assertIn('apps.uuid IN (SELECT app_uuid from workflows WHERE submitted_by = %s)',
                      command)
        self.assertEqual(parameters[1], 'alice@example.com')
        self.assertEqual(parameters[2], 'alice@example.com')

    def test_list_apps_username_takes_precedence_over_users(self):
        database = _fake_database([])
        database.fetch_user_names.return_value = ['bob@example.com']

        helpers.list_apps(database, name=None, username='alice@example.com',
                          users=['bob'], offset=0, limit=20,
                          order=connectors.ListOrder.DESC)

        command, _, _ = database.execute_fetch_command.call_args.args
        self.assertNotIn('apps.owner IN %s', command)
        database.fetch_user_names.assert_not_called()

    def test_list_apps_users_filters_on_resolved_owner_names(self):
        database = _fake_database([])
        database.fetch_user_names.return_value = ['bob@example.com', 'carol@example.com']

        helpers.list_apps(database, name=None, username=None,
                          users=['bob', 'carol'], offset=0, limit=20,
                          order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('apps.owner IN %s', command)
        database.fetch_user_names.assert_called_once_with(['bob', 'carol'])
        self.assertEqual(parameters[1], ('bob@example.com', 'carol@example.com'))

    def test_list_apps_name_search_uses_like_with_wildcards(self):
        database = _fake_database([])

        helpers.list_apps(database, name='train', username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('apps.name LIKE %s', command)
        self.assertEqual(parameters[1], '%train%')

    def test_list_apps_name_search_escapes_underscore(self):
        database = _fake_database([])

        helpers.list_apps(database, name='my_app', username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        _, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertEqual(parameters[1], r'%my\_app%')

    def test_list_apps_name_search_escapes_percent(self):
        database = _fake_database([])

        helpers.list_apps(database, name='50%off', username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        _, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertEqual(parameters[1], r'%50\%off%')

    def test_list_apps_username_and_name_conditions_are_anded(self):
        database = _fake_database([])

        helpers.list_apps(database, name='train', username='alice@example.com',
                          users=None, offset=5, limit=10,
                          order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('AND apps.name LIKE %s', command)
        self.assertEqual(
            parameters,
            (job_app.AppStatus.READY.value, 'alice@example.com',
             'alice@example.com', '%train%', 10, 5),
        )

    def test_list_apps_appends_limit_and_offset_last(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=40, limit=25, order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('ORDER BY apps.created_date DESC LIMIT %s OFFSET %s', command)
        self.assertEqual(parameters[-2:], (25, 40))

    def test_list_apps_asc_order_sorts_outer_query_ascending(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.ASC)

        command, _, _ = database.execute_fetch_command.call_args.args
        self.assertTrue(command.endswith('ORDER BY created_date ASC;'))

    def test_list_apps_desc_order_sorts_outer_query_descending(self):
        database = _fake_database([])

        helpers.list_apps(database, name=None, username=None, users=None,
                          offset=0, limit=20, order=connectors.ListOrder.DESC)

        command, _, _ = database.execute_fetch_command.call_args.args
        self.assertTrue(command.endswith('ORDER BY created_date DESC;'))

    def test_list_apps_returns_list_entries_for_each_row(self):
        database = _fake_database([_app_row(name='first'), _app_row(name='second')])

        entries = helpers.list_apps(database, name=None, username=None,
                                    users=None, offset=0, limit=20,
                                    order=connectors.ListOrder.ASC)

        self.assertEqual([entry.name for entry in entries], ['first', 'second'])
        self.assertEqual(entries[0].latest_version, 3)


class GetAppVersionsQueryTest(unittest.TestCase):
    """Covers version filtering and ordering in helpers.get_app_versions."""

    def test_get_app_versions_without_version_filters_on_uuid_only(self):
        database = _fake_database([])

        helpers.get_app_versions(database, 'app-uuid-1', limit=10,
                                 order=connectors.ListOrder.DESC)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertNotIn('AND version = %s', command)
        self.assertEqual(parameters, ('app-uuid-1', 10))

    def test_get_app_versions_with_version_adds_version_predicate(self):
        database = _fake_database([])

        helpers.get_app_versions(database, 'app-uuid-1', limit=10,
                                 order=connectors.ListOrder.DESC, version=7)

        command, parameters, _ = database.execute_fetch_command.call_args.args
        self.assertIn('AND version = %s', command)
        self.assertEqual(parameters, ('app-uuid-1', 7, 10))

    def test_get_app_versions_asc_order_sorts_outer_query_ascending(self):
        database = _fake_database([])

        helpers.get_app_versions(database, 'app-uuid-1', limit=10,
                                 order=connectors.ListOrder.ASC)

        command, _, _ = database.execute_fetch_command.call_args.args
        self.assertTrue(command.endswith('ORDER BY created_date ASC;'))

    def test_get_app_versions_desc_order_sorts_outer_query_descending(self):
        database = _fake_database([])

        helpers.get_app_versions(database, 'app-uuid-1', limit=10,
                                 order=connectors.ListOrder.DESC)

        command, _, _ = database.execute_fetch_command.call_args.args
        self.assertTrue(command.endswith('ORDER BY created_date DESC;'))

    def test_get_app_versions_returns_version_entries_for_each_row(self):
        database = _fake_database([_version_row(version=1), _version_row(version=2)])

        entries = helpers.get_app_versions(database, 'app-uuid-1', limit=10,
                                           order=connectors.ListOrder.ASC)

        self.assertEqual([entry.version for entry in entries], [1, 2])
        self.assertEqual(entries[0].status, 'READY')


if __name__ == '__main__':
    unittest.main()
