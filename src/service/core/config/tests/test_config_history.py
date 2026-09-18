"""Config history endpoints are disabled for ConfigMap-owned configuration."""

import datetime
import unittest
from typing import Any, Callable
from unittest import mock

from src.lib.utils import config_history, osmo_errors
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


class TestConfigHistoryQueryParams(unittest.TestCase):
    """Test suite for ConfigHistoryQueryParams validation."""

    def test_valid_config_types(self):
        """Test validation of valid config types."""
        params = objects.ConfigHistoryQueryParams(
            config_types=list(config_history.ConfigHistoryType)
        )
        self.assertEqual(
            params.config_types, list(config_history.ConfigHistoryType)
        )

    def test_operable_config_history_type_excludes_history_only_types(self):
        """Operable config history types are derived from history-readable types."""
        expected_operable_values = {
            config_type.value
            for config_type in connectors.ConfigHistoryType
            if config_type not in connectors.HISTORY_ONLY_CONFIG_HISTORY_TYPES
        }

        self.assertEqual(
            {config_type.value for config_type in connectors.OperableConfigHistoryType},
            expected_operable_values,
        )
        self.assertNotIn(
            connectors.ConfigHistoryType.DATASET.value,
            {config_type.value for config_type in connectors.OperableConfigHistoryType},
        )

    def test_invalid_config_types(self):
        """Test validation of invalid config types."""
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(config_types=['invalid_type'])
        self.assertIn('config_types', str(context.exception))
        self.assertIn('Input should be', str(context.exception))

    def test_at_timestamp_with_created_before(self):
        """Test validation of at_timestamp with created_before."""
        timestamp = datetime.datetime(2024, 1, 1, 12, 0, 0)
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(at_timestamp=timestamp, created_before=timestamp)
        self.assertIn('Cannot specify both at_timestamp and created_before', str(context.exception))

    def test_at_timestamp_with_created_after(self):
        """Test validation of at_timestamp with created_after."""
        timestamp = datetime.datetime(2024, 1, 1, 12, 0, 0)
        with self.assertRaises(ValueError) as context:
            objects.ConfigHistoryQueryParams(at_timestamp=timestamp, created_after=timestamp)
        self.assertIn('Cannot specify both at_timestamp and created_after', str(context.exception))


if __name__ == '__main__':
    unittest.main()
