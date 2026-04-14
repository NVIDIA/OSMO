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

# pylint: disable=protected-access

import logging
import os
import tempfile
import unittest
from typing import Any, Dict
from unittest import mock

import yaml

from src.lib.utils import osmo_errors
from src.service.core.config import configmap_guard, configmap_loader
from src.utils import configmap_state


class TestConfigmapGuard(unittest.TestCase):
    """Tests for the global ConfigMap mode guard."""

    def setUp(self):
        configmap_state.set_configmap_mode(False)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)

    def test_reject_when_configmap_mode_active(self):
        configmap_state.set_configmap_mode(True)
        with self.assertRaises(osmo_errors.OSMOUserError) as context:
            configmap_guard.reject_if_configmap_mode('some-user')
        self.assertEqual(context.exception.status_code, 409)
        self.assertIn('ConfigMap', str(context.exception))

    def test_allow_when_configmap_mode_inactive(self):
        configmap_guard.reject_if_configmap_mode('some-user')

    def test_bypass_for_configmap_sync_user(self):
        configmap_state.set_configmap_mode(True)
        configmap_guard.reject_if_configmap_mode(
            configmap_guard.CONFIGMAP_SYNC_USERNAME)

    def test_is_configmap_mode(self):
        self.assertFalse(configmap_guard.is_configmap_mode())
        configmap_state.set_configmap_mode(True)
        self.assertTrue(configmap_guard.is_configmap_mode())


class TestConfigmapState(unittest.TestCase):
    """Tests for the module-level config snapshot."""

    def setUp(self):
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_parsed_configs(None)

    def test_snapshot_initially_none(self):
        self.assertIsNone(configmap_state.get_snapshot())

    def test_set_and_get_snapshot(self):
        configs = {'service': {'key': 'value'}}
        configmap_state.set_parsed_configs(configs)
        self.assertEqual(configmap_state.get_snapshot(), configs)

    def test_atomic_swap_preserves_old_reference(self):
        old: Dict[str, Any] = {'service': {'version': 1}}
        configmap_state.set_parsed_configs(old)
        snapshot_ref = configmap_state.get_snapshot()
        assert snapshot_ref is not None

        new: Dict[str, Any] = {'service': {'version': 2}}
        configmap_state.set_parsed_configs(new)

        # Old reference still valid
        self.assertEqual(snapshot_ref['service']['version'], 1)
        # New snapshot has new data
        new_snapshot = configmap_state.get_snapshot()
        assert new_snapshot is not None
        self.assertEqual(new_snapshot['service']['version'], 2)


class TestResolveSecretFileReferences(unittest.TestCase):
    """Tests for _resolve_secret_file_references (unchanged logic)."""

    def test_resolve_dataset_secret_files_success(self):
        secret_data = {
            'access_key_id': 'AKIAIOSFODNN7EXAMPLE',
            'access_key': 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            'region': 'us-west-2',
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data: Dict[str, Any] = {
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
            self.assertEqual(credential['access_key_id'], 'AKIAIOSFODNN7EXAMPLE')
            self.assertNotIn('secret_file', credential)
        finally:
            os.unlink(secret_path)

    def test_resolve_missing_secret_file(self):
        config_data: Dict[str, Any] = {
            'buckets': {
                'primary': {
                    'default_credential': {
                        'secret_file': '/nonexistent/secret.yaml',
                    },
                },
            },
        }
        with self.assertLogs(level=logging.ERROR):
            configmap_loader._resolve_secret_file_references(config_data)
        # secret_file key still present (not corrupted)
        credential = config_data['buckets']['primary']['default_credential']
        self.assertIn('secret_file', credential)

    def test_resolve_simple_string_secret(self):
        secret_data = {'value': 'xoxb-slack-token'}
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as secret_file:
            yaml.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data: Dict[str, Any] = {
                'alerts': {
                    'slack_token': {'secret_file': secret_path},
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)
            self.assertEqual(
                config_data['alerts']['slack_token'], 'xoxb-slack-token')
        finally:
            os.unlink(secret_path)

    def test_resolve_secret_name_converted_to_path(self):
        config_data: Dict[str, Any] = {
            'credential': {'secretName': 'my-cred'},
        }
        with self.assertLogs(level=logging.ERROR):
            configmap_loader._resolve_secret_file_references(config_data)


class TestValidateConfigs(unittest.TestCase):
    """Tests for _validate_configs."""

    def test_valid_named_config_section(self):
        configs: Dict[str, Any] = {
            'pod_templates': {'tmpl1': {'spec': {}}},
        }
        errors = configmap_loader._validate_configs(configs)
        self.assertEqual(errors, [])

    def test_invalid_section_type(self):
        configs: Dict[str, Any] = {
            'pod_templates': 'not_a_dict',
        }
        errors = configmap_loader._validate_configs(configs)
        self.assertEqual(len(errors), 1)
        self.assertIn('pod_templates', errors[0])

    def test_unknown_keys_logged(self):
        configs: Dict[str, Any] = {
            'unknown_section': {'config': {}},
        }
        with self.assertLogs(level=logging.WARNING) as log_context:
            configmap_loader._validate_configs(configs)
        self.assertTrue(
            any('Unknown config key' in msg for msg in log_context.output))

    def test_empty_configs_valid(self):
        errors = configmap_loader._validate_configs({})
        self.assertEqual(errors, [])


class TestConfigMapWatcherLoadAndApply(unittest.TestCase):
    """Tests for ConfigMapWatcher._load_and_apply."""

    def setUp(self):
        self.mock_postgres = mock.MagicMock()
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def _write_config_file(self, config: Dict[str, Any]) -> str:
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp:
            yaml.dump(config, temp)
            return temp.name

    def test_load_file_not_found(self):
        watcher = configmap_loader.ConfigMapWatcher(
            '/nonexistent/path.yaml', self.mock_postgres)
        result = watcher._load_and_apply()
        self.assertFalse(result)
        self.assertIsNone(configmap_state.get_snapshot())

    def test_load_empty_file(self):
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp:
            temp.write('')
            path = temp.name
        try:
            watcher = configmap_loader.ConfigMapWatcher(
                path, self.mock_postgres)
            result = watcher._load_and_apply()
            self.assertFalse(result)
        finally:
            os.unlink(path)

    def test_load_valid_config_populates_snapshot(self):
        config: Dict[str, Any] = {
            'pod_templates': {
                'default_ctrl': {'spec': {'containers': []}},
            },
        }
        path = self._write_config_file(config)
        try:
            mock_service_config = mock.MagicMock()
            mock_service_config.plaintext_dict.return_value = {
                'service_auth': {'keys': {}},
                'service_base_url': 'https://example.com',
            }
            self.mock_postgres.get_service_configs.return_value = (
                mock_service_config)

            watcher = configmap_loader.ConfigMapWatcher(
                path, self.mock_postgres)
            result = watcher._load_and_apply()
            self.assertTrue(result)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            self.assertIn('pod_templates', snapshot)
            self.assertIn('default_ctrl', snapshot['pod_templates'])
        finally:
            os.unlink(path)

    def test_load_injects_runtime_fields(self):
        config: Dict[str, Any] = {
            'service': {
                'max_pod_restart_limit': '30m',
            },
        }
        path = self._write_config_file(config)
        try:
            mock_service_config = mock.MagicMock()
            mock_service_config.plaintext_dict.return_value = {
                'service_auth': {'keys': {'key1': 'value1'}},
                'service_base_url': 'https://example.com',
            }
            self.mock_postgres.get_service_configs.return_value = (
                mock_service_config)

            watcher = configmap_loader.ConfigMapWatcher(
                path, self.mock_postgres)
            result = watcher._load_and_apply()
            self.assertTrue(result)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            service_config = snapshot['service']
            self.assertEqual(
                service_config['max_pod_restart_limit'], '30m')
            self.assertIn('service_auth', service_config)
            self.assertIn('service_base_url', service_config)
        finally:
            os.unlink(path)

    def test_validation_failure_keeps_previous_config(self):
        # First load succeeds
        good_config: Dict[str, Any] = {
            'pod_templates': {'tmpl': {'spec': {}}},
        }
        good_path = self._write_config_file(good_config)
        mock_service_config = mock.MagicMock()
        mock_service_config.plaintext_dict.return_value = {}
        self.mock_postgres.get_service_configs.return_value = (
            mock_service_config)

        watcher = configmap_loader.ConfigMapWatcher(
            good_path, self.mock_postgres)
        watcher._load_and_apply()

        old_snapshot = configmap_state.get_snapshot()
        self.assertIsNotNone(old_snapshot)

        # Second load with invalid section type
        bad_config: Dict[str, Any] = {
            'pod_templates': 'not_a_dict',
        }
        bad_path = self._write_config_file(bad_config)
        try:
            watcher2 = configmap_loader.ConfigMapWatcher(
                bad_path, self.mock_postgres)
            result = watcher2._load_and_apply()
            self.assertFalse(result)

            # Previous snapshot preserved
            self.assertIs(configmap_state.get_snapshot(), old_snapshot)
        finally:
            os.unlink(good_path)
            os.unlink(bad_path)


class TestConfigFileEventHandler(unittest.TestCase):
    """Tests for the watchdog event handler."""

    def test_ignores_unrelated_events(self):
        callback = mock.MagicMock()
        handler = configmap_loader.ConfigFileEventHandler(
            'config.yaml', callback)

        event = mock.MagicMock()
        event.src_path = '/some/other/file.txt'
        handler.on_any_event(event)

        callback.assert_not_called()

    def test_reacts_to_config_file_events(self):
        callback = mock.MagicMock()
        handler = configmap_loader.ConfigFileEventHandler(
            'config.yaml', callback)
        handler._debounce_delay = 0.01  # speed up test

        event = mock.MagicMock()
        event.src_path = '/etc/osmo/config/config.yaml'
        handler.on_any_event(event)

        # Timer should be set
        self.assertIsNotNone(handler._debounce_timer)

    def test_reacts_to_data_symlink_events(self):
        callback = mock.MagicMock()
        handler = configmap_loader.ConfigFileEventHandler(
            'config.yaml', callback)
        handler._debounce_delay = 0.01

        event = mock.MagicMock()
        event.src_path = '/etc/osmo/config/..data'
        handler.on_any_event(event)

        self.assertIsNotNone(handler._debounce_timer)


if __name__ == '__main__':
    unittest.main()
