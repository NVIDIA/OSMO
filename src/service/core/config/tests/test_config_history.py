"""Config history endpoints are disabled for ConfigMap-owned configuration."""

import unittest
from typing import Any, Callable
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.config import config_service, objects
from src.utils import connectors


class ConfigHistoryDisabledTestCase(unittest.TestCase):
    """Verify ConfigMap-owned history operations fail before DB access."""

    def _assert_rejected_without_db(self, operation: Callable[[], Any]) -> None:
        with mock.patch.object(
                connectors.PostgresConnector, 'get_instance') as get_postgres:
            with self.assertRaises(osmo_errors.OSMOUserError) as context:
                operation()

        self.assertEqual(context.exception.status_code, 409)
        self.assertIn('managed through GitOps', str(context.exception))
        get_postgres.assert_not_called()

    def test_history_list_is_rejected_before_database_access(self):
        self._assert_rejected_without_db(lambda: config_service.get_configs_history(
            objects.ConfigHistoryQueryParams()))

    def test_role_history_rollback_is_rejected_before_database_access(self):
        self._assert_rejected_without_db(lambda: config_service.rollback_config(
            objects.RollbackConfigRequest(
                config_type=connectors.OperableConfigHistoryType['ROLE'],
                revision=1,
            ),
            username='admin@example.com',
        ))

    def test_role_history_diff_is_rejected_before_database_access(self):
        self._assert_rejected_without_db(lambda: config_service.get_config_diff(
            objects.ConfigDiffRequest(
                config_type=connectors.ConfigHistoryType.ROLE,
                first_revision=1,
                second_revision=2,
            )))

    def test_history_delete_is_rejected_before_database_access(self):
        self._assert_rejected_without_db(
            lambda: config_service.delete_config_history_revision(
                'role', 1, username='admin@example.com'))

    def test_history_tag_update_is_rejected_before_database_access(self):
        self._assert_rejected_without_db(
            lambda: config_service.update_config_history_tags(
                'role', 1, objects.UpdateConfigTagsRequest(set_tags=['test'])))


if __name__ == '__main__':
    unittest.main()
