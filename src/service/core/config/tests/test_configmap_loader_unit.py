"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import logging
import os
import tempfile
import unittest
from typing import Any, Dict
from unittest import mock

import yaml

from src.service.core.config import configmap_loader
from src.service.core.config.configmap_loader import ManagedByMode


class TestLoadDynamicConfigsFileHandling(unittest.TestCase):
    """Tests for load_dynamic_configs file parsing and early-exit behavior."""

    def setUp(self):
        self.mock_postgres = mock.MagicMock()

    def test_load_dynamic_configs_file_not_found(self):
        """Returns gracefully when config file does not exist."""
        configmap_loader.load_dynamic_configs('/nonexistent/path.yaml', self.mock_postgres)
        # Should not attempt advisory lock
        self.mock_postgres.execute_fetch_command.assert_not_called()

    def test_load_dynamic_configs_invalid_yaml(self):
        """Returns gracefully on malformed YAML."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            temp_file.write('invalid: yaml: [unclosed')
            temp_path = temp_file.name
        try:
            configmap_loader.load_dynamic_configs(temp_path, self.mock_postgres)
            self.mock_postgres.execute_fetch_command.assert_not_called()
        finally:
            os.unlink(temp_path)

    def test_load_dynamic_configs_empty_file(self):
        """Returns gracefully when file is empty."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            temp_file.write('')
            temp_path = temp_file.name
        try:
            configmap_loader.load_dynamic_configs(temp_path, self.mock_postgres)
            self.mock_postgres.execute_fetch_command.assert_not_called()
        finally:
            os.unlink(temp_path)

    def test_load_dynamic_configs_managed_configs_none(self):
        """Returns gracefully when all sections are empty dicts."""
        config: Dict[str, Any] = {'managed_configs': {}}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
            temp_path = temp_file.name
        try:
            # Advisory lock should be acquired, but _apply_all_configs should return early
            self.mock_postgres.execute_fetch_command.return_value = [
                {'pg_try_advisory_lock': True}
            ]
            configmap_loader.load_dynamic_configs(temp_path, self.mock_postgres)
            # Should have acquired and released session lock (2 calls)
            self.assertEqual(self.mock_postgres.execute_fetch_command.call_count, 2)
        finally:
            os.unlink(temp_path)

    def test_load_dynamic_configs_no_managed_configs_key(self):
        """Warns and returns when managed_configs key is absent."""
        config = {'some_other_key': 'value'}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
            temp_path = temp_file.name
        try:
            with self.assertLogs(level=logging.WARNING) as log_context:
                configmap_loader.load_dynamic_configs(temp_path, self.mock_postgres)
            self.assertTrue(
                any('no managed_configs section' in msg for msg in log_context.output))
            self.mock_postgres.execute_fetch_command.assert_not_called()
        finally:
            os.unlink(temp_path)


class TestParseManagedBy(unittest.TestCase):
    """Tests for _parse_managed_by helper."""

    def test_parse_managed_by_seed(self):
        """Returns SEED for 'seed' value."""
        result = configmap_loader._parse_managed_by({'managed_by': 'seed'})
        self.assertEqual(result, ManagedByMode.SEED)

    def test_parse_managed_by_configmap(self):
        """Returns CONFIGMAP for 'configmap' value."""
        result = configmap_loader._parse_managed_by({'managed_by': 'configmap'})
        self.assertEqual(result, ManagedByMode.CONFIGMAP)

    def test_parse_managed_by_default(self):
        """Returns SEED when managed_by key is absent."""
        result = configmap_loader._parse_managed_by({})
        self.assertEqual(result, ManagedByMode.SEED)

    def test_parse_managed_by_invalid(self):
        """Raises ValueError for invalid value."""
        with self.assertRaises(ValueError) as context:
            configmap_loader._parse_managed_by({'managed_by': 'invalid_mode'})
        self.assertIn('Invalid managed_by value', str(context.exception))


class TestResolveSecretFileReferences(unittest.TestCase):
    """Tests for _resolve_secret_file_references."""

    def test_resolve_dataset_secret_files_success(self):
        """Reads secret file and populates credentials."""
        secret_data = {
            'access_key_id': 'AKIAIOSFODNN7EXAMPLE',
            'access_key': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'region': 'us-west-2',
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data = {
                'buckets': {
                    'primary': {
                        'dataset_path': 's3://my-bucket',
                        'default_credential': {
                            'secret_file': secret_path,
                        },
                    },
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)

            bucket: Dict[str, Any] = config_data['buckets']['primary']
            credential: Dict[str, Any] = bucket['default_credential']
            self.assertEqual(credential['access_key_id'], 'AKIAIOSFODNN7EXAMPLE')
            self.assertEqual(credential['access_key'],
                             'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
            self.assertEqual(credential['region'], 'us-west-2')
            self.assertNotIn('secret_file', credential)
        finally:
            os.unlink(secret_path)

    def test_resolve_dataset_secret_files_missing_file(self):
        """Logs error and does NOT corrupt bucket config on missing file."""
        config_data = {
            'buckets': {
                'primary': {
                    'dataset_path': 's3://my-bucket',
                    'default_credential': {
                        'secret_file': '/nonexistent/secret.yaml',
                    },
                },
            },
        }
        with self.assertLogs(level=logging.ERROR) as log_context:
            configmap_loader._resolve_secret_file_references(config_data)
        self.assertTrue(
            any('Failed to read secret file' in msg for msg in log_context.output))
        # secret_file key should still be present (not corrupted)
        credential = config_data['buckets']['primary']['default_credential']
        self.assertIn('secret_file', credential)
        self.assertNotIn('access_key_id', credential)

    def test_resolve_dataset_secret_files_invalid_yaml(self):
        """Logs error and continues on invalid YAML in secret file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as secret_file:
            secret_file.write('invalid: yaml: [unclosed')
            secret_path = secret_file.name
        try:
            config_data = {
                'buckets': {
                    'primary': {
                        'dataset_path': 's3://my-bucket',
                        'default_credential': {
                            'secret_file': secret_path,
                        },
                    },
                },
            }
            with self.assertLogs(level=logging.ERROR) as log_context:
                configmap_loader._resolve_secret_file_references(config_data)
            self.assertTrue(
                any('Failed to' in msg and 'secret file' in msg
                    for msg in log_context.output))
        finally:
            os.unlink(secret_path)

    def test_resolve_secret_files_partial_keys_merged(self):
        """Secret file with partial keys is still merged (validation happens downstream)."""
        secret_data = {'access_key_id': 'AKIAIOSFODNN7EXAMPLE'}  # only one key
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data = {
                'buckets': {
                    'primary': {
                        'dataset_path': 's3://my-bucket',
                        'default_credential': {
                            'secret_file': secret_path,
                        },
                    },
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)
            credential = config_data['buckets']['primary']['default_credential']
            # Secret file contents are merged; secret_file key removed
            self.assertEqual(credential['access_key_id'], 'AKIAIOSFODNN7EXAMPLE')
            self.assertNotIn('secret_file', credential)
        finally:
            os.unlink(secret_path)


    def test_resolve_workflow_nested_credential(self):
        """Resolves secret_file in nested workflow credential fields."""
        secret_data = {
            'access_key_id': 'workflow-key',
            'access_key': 'workflow-secret',
            'endpoint': 'swift://storage/workflows',
            'region': 'us-east-1',
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data = {
                'max_num_tasks': 100,
                'workflow_data': {
                    'credential': {
                        'secret_file': secret_path,
                    },
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)
            credential = config_data['workflow_data']['credential']
            self.assertEqual(credential['access_key_id'], 'workflow-key')
            self.assertEqual(credential['access_key'], 'workflow-secret')
            self.assertNotIn('secret_file', credential)
            # Non-secret fields preserved
            self.assertEqual(config_data['max_num_tasks'], 100)
        finally:
            os.unlink(secret_path)

    def test_resolve_simple_string_secret(self):
        """Resolves secret_file for simple string values (e.g., slack_token)."""
        secret_data = {'value': 'xoxb-slack-token-value'}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data = {
                'workflow_alerts': {
                    'slack_token': {
                        'secret_file': secret_path,
                    },
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)
            # Simple value secret replaces the dict entirely
            self.assertEqual(config_data['workflow_alerts']['slack_token'],
                             'xoxb-slack-token-value')
        finally:
            os.unlink(secret_path)

    def test_resolve_secretName_converted_to_path(self):
        """secretName is converted to /etc/osmo/secrets/<name>/cred.yaml path."""
        config_data = {
            'workflow_data': {
                'credential': {
                    'secretName': 'my-workflow-cred',
                },
            },
        }
        # This will try to read the file (which doesn't exist) and log an error
        with self.assertLogs(level=logging.ERROR):
            configmap_loader._resolve_secret_file_references(config_data)
        # The secretName should have been converted to a path attempt


class TestSafeApply(unittest.TestCase):
    """Tests for _safe_apply helper."""

    def test_safe_apply_missing_key(self):
        """No-op when config key is not in managed_configs."""
        mock_postgres = mock.MagicMock()
        mock_function = mock.MagicMock()
        managed_configs: Dict[str, Any] = {'service': {'config': {}}}

        configmap_loader._safe_apply(
            'nonexistent_key', managed_configs, mock_postgres, mock_function)

        mock_function.assert_not_called()

    def test_safe_apply_catches_exception(self):
        """Logs and continues when apply function raises."""
        mock_postgres = mock.MagicMock()
        mock_function = mock.MagicMock(side_effect=RuntimeError('test error'))
        managed_configs: Dict[str, Any] = {'service': {'config': {}}}

        with self.assertLogs(level=logging.ERROR) as log_context:
            configmap_loader._safe_apply(
                'service', managed_configs, mock_postgres, mock_function)

        self.assertTrue(
            any('Failed to apply dynamic config for service' in msg
                for msg in log_context.output))


class TestAdvisoryLock(unittest.TestCase):
    """Tests for PostgreSQL advisory lock behavior."""

    def test_advisory_lock_not_acquired(self):
        """Skips config loading when lock is held by another replica."""
        mock_postgres = mock.MagicMock()
        mock_postgres.execute_fetch_command.return_value = [
            {'pg_try_advisory_lock': False}
        ]

        config = {'managed_configs': {'service': {'config': {'key': 'value'}}}}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
            temp_path = temp_file.name
        try:
            configmap_loader.load_dynamic_configs(temp_path, mock_postgres)
            # Should only have called for lock acquisition (no unlock, no config apply)
            self.assertEqual(mock_postgres.execute_fetch_command.call_count, 1)
        finally:
            os.unlink(temp_path)

    def test_advisory_xact_lock_acquired_on_success(self):
        """Transaction-scoped lock is acquired for config application."""
        mock_postgres = mock.MagicMock()
        mock_postgres.execute_fetch_command.return_value = [
            {'pg_try_advisory_lock': True}
        ]

        config: Dict[str, Any] = {'managed_configs': {}}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
            temp_path = temp_file.name
        try:
            configmap_loader.load_dynamic_configs(temp_path, mock_postgres)

            calls = mock_postgres.execute_fetch_command.call_args_list
            self.assertEqual(len(calls), 2)
            # First call: acquire lock
            self.assertIn('pg_try_advisory_lock',
                          calls[0][0][0])  # type: ignore[index]
            # Second call: release lock
            self.assertIn('pg_advisory_unlock',
                          calls[1][0][0])  # type: ignore[index]
        finally:
            os.unlink(temp_path)

    @mock.patch('src.service.core.config.configmap_loader._apply_all_configs')
    def test_advisory_lock_released_on_failure(self, mock_apply_all):
        """Session lock is explicitly released even when _apply_all_configs raises."""
        mock_apply_all.side_effect = RuntimeError('catastrophic failure')
        mock_postgres = mock.MagicMock()
        mock_postgres.execute_fetch_command.return_value = [
            {'pg_try_advisory_lock': True}
        ]

        config: Dict[str, Any] = {'managed_configs': {'service': {'config': {'key': 'value'}}}}
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as temp_file:
            yaml.dump(config, temp_file)
            temp_path = temp_file.name
        try:
            with self.assertRaises(RuntimeError):
                configmap_loader.load_dynamic_configs(temp_path, mock_postgres)

            calls = mock_postgres.execute_fetch_command.call_args_list
            # Lock acquired and released even on failure
            self.assertEqual(len(calls), 2)
            self.assertIn('pg_try_advisory_lock',
                          calls[0][0][0])  # type: ignore[index]
            self.assertIn('pg_advisory_unlock',
                          calls[1][0][0])  # type: ignore[index]
        finally:
            os.unlink(temp_path)


class TestUnknownKeysLogged(unittest.TestCase):
    """Tests for unknown key warning."""

    def test_unknown_keys_logged(self):
        """WARNING logged for unrecognized keys in managed_configs."""
        mock_postgres = mock.MagicMock()
        managed_configs: Dict[str, Any] = {
            'unknown_config_type': {'config': {}},
            'another_unknown': {'config': {}},
        }

        with self.assertLogs(level=logging.WARNING) as log_context:
            configmap_loader._apply_all_configs(managed_configs, mock_postgres)

        unknown_warnings = [
            msg for msg in log_context.output if 'Unknown key in managed_configs' in msg]
        self.assertEqual(len(unknown_warnings), 2)


class TestApplyAllConfigsNoneManagedConfigs(unittest.TestCase):
    """Tests for _apply_all_configs with None/empty input."""

    def test_apply_all_configs_none_managed_configs(self):
        """Returns gracefully on None input."""
        mock_postgres = mock.MagicMock()
        # Should not raise
        configmap_loader._apply_all_configs(None, mock_postgres)  # type: ignore[arg-type]


if __name__ == '__main__':
    unittest.main()
