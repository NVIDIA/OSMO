"""Default-admin bootstrap uses ConfigMap-owned role definitions."""

import types
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core import service


class DefaultAdminConfigMapTestCase(unittest.TestCase):
    """Verify default-admin bootstrap uses only ConfigMap role authority."""

    def _config(self):
        return types.SimpleNamespace(
            default_admin_username='admin@example.com',
            default_admin_password='x' * 43,
        )

    @mock.patch.object(service.auth_objects.AccessToken, 'insert_into_db')
    @mock.patch.object(service.connectors, 'upsert_user')
    def test_configmap_only_admin_role_bootstraps_without_db_role_lookup(
        self, upsert_user, insert_access_token,
    ):
        postgres = mock.MagicMock()
        postgres.assign_user_role.return_value = [{'role_name': 'osmo-admin'}]
        postgres.execute_fetch_command.return_value = []

        service.setup_default_admin(postgres, self._config())

        upsert_user.assert_called_once_with(postgres, 'admin@example.com')
        postgres.assign_user_role.assert_called_once()
        query = postgres.execute_fetch_command.call_args.args[0]
        self.assertIn('FROM access_token', query)
        self.assertNotIn('FROM roles', query)
        insert_access_token.assert_called_once()
        self.assertEqual(
            insert_access_token.call_args.kwargs['roles'], ['osmo-admin'])

    @mock.patch.object(service.connectors, 'upsert_user')
    def test_missing_configmap_admin_role_fails_before_token_access(
        self, upsert_user,
    ):
        postgres = mock.MagicMock()
        postgres.assign_user_role.return_value = []

        with self.assertRaisesRegex(
                osmo_errors.OSMOUserError,
                'requires the osmo-admin role in the mounted ConfigMap'):
            service.setup_default_admin(postgres, self._config())

        upsert_user.assert_called_once_with(postgres, 'admin@example.com')
        postgres.assign_user_role.assert_called_once()
        postgres.execute_fetch_command.assert_not_called()


if __name__ == '__main__':
    unittest.main()
