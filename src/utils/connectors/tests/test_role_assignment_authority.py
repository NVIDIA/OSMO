"""Tests for ConfigMap-owned role validation at DB assignment boundaries."""

import contextlib
import datetime
import unittest
from unittest import mock

from src.utils import configmap_state, connectors


class TestRoleAssignmentAuthority(unittest.TestCase):

    def setUp(self):
        configmap_state.set_parsed_configs({
            'roles': {
                'configmap-admin': {
                    'description': 'ConfigMap-only administrator',
                    'policies': [],
                },
            },
        })

    def tearDown(self):
        configmap_state.set_parsed_configs(None)

    def test_assignment_does_not_read_or_require_db_role_row(self):
        postgres = object.__new__(connectors.PostgresConnector)
        connection = mock.MagicMock()
        cursor = connection.cursor.return_value
        cursor.fetchall.return_value = [{
            'id': 1,
            'assigned_by': 'System',
            'assigned_at': datetime.datetime.now(datetime.timezone.utc),
        }]
        with mock.patch.object(
                postgres, '_get_connection',
                return_value=contextlib.nullcontext(connection)):
            assignment_method = getattr(
                connectors.PostgresConnector.assign_user_role, '__wrapped__')
            result = assignment_method(
                postgres, 'admin@example.com', 'configmap-admin', 'System',
                datetime.datetime.now(datetime.timezone.utc))

        self.assertEqual(len(result), 1)
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(len(statements), 1)
        self.assertIn('INSERT INTO user_roles', statements[0])
        self.assertNotIn('FROM roles', statements[0])

    def test_db_only_role_is_rejected_before_database_access(self):
        postgres = object.__new__(connectors.PostgresConnector)
        with mock.patch.object(postgres, '_get_connection') as get_connection:
            assignment_method = getattr(
                connectors.PostgresConnector.assign_user_role, '__wrapped__')
            result = assignment_method(
                postgres, 'admin@example.com', 'db-only-role', 'System',
                datetime.datetime.now(datetime.timezone.utc))

        self.assertEqual(result, [])
        get_connection.assert_not_called()

    def test_empty_external_roles_disables_mapping(self):
        configmap_state.set_parsed_configs({
            'roles': {
                'self-mapped': {
                    'description': 'Self mapped role',
                    'policies': [],
                    'external_roles': [],
                },
            },
        })

        resolved = connectors.Role.get_roles_by_external_roles(
            mock.MagicMock(), ['self-mapped'])

        self.assertEqual(resolved, [])


if __name__ == '__main__':
    unittest.main()
