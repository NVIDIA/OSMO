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

import base64
import json
import logging
import os
import tempfile
import threading
import time
import unittest
from typing import Any, Dict
from unittest import mock

import yaml

from src.lib.utils import osmo_errors
from src.service.core.config import (
    configmap_events, configmap_guard, configmap_loader,
)
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

    def test_resolve_dockerconfigjson_prefers_password(self):
        """The worker treats RegistryCredential.auth as the raw password
        and re-encodes username:auth. If the loader fed it the
        already-base64-encoded composite, the resulting pull-secret
        would be double-encoded and registries reject it.
        """
        secret_data = {
            'auths': {
                'nvcr.io': {
                    'username': '$oauthtoken',
                    'password': 'raw-token-value',
                    'auth': base64.b64encode(
                        b'$oauthtoken:raw-token-value').decode(),
                },
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.json', delete=False) as secret_file:
            json.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data: Dict[str, Any] = {
                'backend_images': {
                    'credential': {'secret_file': secret_path},
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)

            credential = config_data['backend_images']['credential']
            self.assertEqual(credential['registry'], 'nvcr.io')
            self.assertEqual(credential['username'], '$oauthtoken')
            self.assertEqual(credential['auth'], 'raw-token-value')
        finally:
            os.unlink(secret_path)

    def test_resolve_dockerconfigjson_falls_back_to_decoding_auth(self):
        """When `password` is missing, decode `auth` and strip username."""
        secret_data = {
            'auths': {
                'nvcr.io': {
                    'username': '$oauthtoken',
                    'auth': base64.b64encode(
                        b'$oauthtoken:fallback-token').decode(),
                },
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.json', delete=False) as secret_file:
            json.dump(secret_data, secret_file)
            secret_path = secret_file.name
        try:
            config_data: Dict[str, Any] = {
                'backend_images': {
                    'credential': {'secret_file': secret_path},
                },
            }
            configmap_loader._resolve_secret_file_references(config_data)

            credential = config_data['backend_images']['credential']
            self.assertEqual(credential['auth'], 'fallback-token')
        finally:
            os.unlink(secret_path)


class TestResolveSecretDirectory(unittest.TestCase):
    """Tests for per-field Secret mount support (--from-literal)."""

    def _write_field(self, directory: str, name: str, value: str) -> None:
        with open(os.path.join(directory, name), 'w', encoding='utf-8') as fh:
            fh.write(value)

    def test_per_field_mount_loads_all_fields(self):
        """Secret created with --from-literal loads each file as a field."""
        with tempfile.TemporaryDirectory() as secret_dir:
            self._write_field(secret_dir, 'access_key_id', 'AKIAEXAMPLE')
            self._write_field(
                secret_dir, 'access_key', 'wJalrXUtnFEMI/EXAMPLE')
            self._write_field(secret_dir, 'region', 'us-west-2')

            config_data: Dict[str, Any] = {'credential': {}}
            configmap_loader._resolve_secret_directory(
                config_data['credential'], secret_dir, 'credential')

            credential = config_data['credential']
            self.assertEqual(credential['access_key_id'], 'AKIAEXAMPLE')
            self.assertEqual(credential['access_key'], 'wJalrXUtnFEMI/EXAMPLE')
            self.assertEqual(credential['region'], 'us-west-2')

    def test_per_field_mount_strips_trailing_newlines(self):
        with tempfile.TemporaryDirectory() as secret_dir:
            self._write_field(secret_dir, 'token', 'abc123\n')

            config_data: Dict[str, Any] = {'credential': {}}
            configmap_loader._resolve_secret_directory(
                config_data['credential'], secret_dir, 'credential')

            self.assertEqual(config_data['credential']['token'], 'abc123')

    def test_per_field_mount_skips_kubelet_internals(self):
        """..data and timestamped ..YYYY_MM_DD... entries must be ignored."""
        with tempfile.TemporaryDirectory() as secret_dir:
            # Real kubelet mount: actual file + a ..data symlink to a
            # timestamped hidden dir. We only care that `..`-prefixed
            # entries are skipped, regardless of type.
            self._write_field(secret_dir, 'access_key', 'real-value')
            self._write_field(secret_dir, '..data', 'should-be-ignored')
            os.makedirs(os.path.join(secret_dir, '..2024_01_01_00_00_00'))

            config_data: Dict[str, Any] = {'credential': {}}
            configmap_loader._resolve_secret_directory(
                config_data['credential'], secret_dir, 'credential')

            credential = config_data['credential']
            self.assertEqual(credential, {'access_key': 'real-value'})

    def test_per_field_mount_removes_reference_fields(self):
        """secretName/secretKey keys are stripped after resolution."""
        with tempfile.TemporaryDirectory() as secret_dir:
            self._write_field(secret_dir, 'access_key', 'value')

            current = {'secretName': 'my-cred'}
            configmap_loader._resolve_secret_directory(
                current, secret_dir, 'credential')

            self.assertNotIn('secretName', current)
            self.assertNotIn('secretKey', current)
            self.assertEqual(current['access_key'], 'value')

    def test_per_field_mount_empty_directory_logs_error(self):
        with tempfile.TemporaryDirectory() as secret_dir:
            current: Dict[str, Any] = {}
            with self.assertLogs(level=logging.ERROR):
                configmap_loader._resolve_secret_directory(
                    current, secret_dir, 'credential')

    def test_secret_name_falls_back_to_per_field(self):
        """secretName with no cred.yaml loads per-field files from the mount."""
        with tempfile.TemporaryDirectory() as tmp_root:
            secret_dir = os.path.join(tmp_root, 'my-cred')
            os.makedirs(secret_dir)
            self._write_field(secret_dir, 'access_key_id', 'AKIA')
            self._write_field(secret_dir, 'access_key', 'SECRET')

            config_data: Dict[str, Any] = {
                'credential': {'secretName': 'my-cred'},
            }
            with mock.patch.object(
                    configmap_loader, 'SECRETS_ROOT', tmp_root):
                configmap_loader._resolve_secret_file_references(config_data)

            credential = config_data['credential']
            self.assertEqual(credential['access_key_id'], 'AKIA')
            self.assertEqual(credential['access_key'], 'SECRET')
            self.assertNotIn('secretName', credential)

    def test_secret_name_prefers_cred_yaml_when_present(self):
        """With both cred.yaml and per-field files, cred.yaml wins."""
        with tempfile.TemporaryDirectory() as tmp_root:
            secret_dir = os.path.join(tmp_root, 'my-cred')
            os.makedirs(secret_dir)
            self._write_field(secret_dir, 'access_key_id', 'stale-value')
            with open(os.path.join(secret_dir, 'cred.yaml'),
                      'w', encoding='utf-8') as fh:
                yaml.dump({'access_key_id': 'fresh-value'}, fh)

            config_data: Dict[str, Any] = {
                'credential': {'secretName': 'my-cred'},
            }
            with mock.patch.object(
                    configmap_loader, 'SECRETS_ROOT', tmp_root):
                configmap_loader._resolve_secret_file_references(config_data)

            self.assertEqual(
                config_data['credential']['access_key_id'], 'fresh-value')

    def test_secretkey_explicit_does_not_fall_back(self):
        """Explicit secretKey uses the single-file path (no directory scan)."""
        with tempfile.TemporaryDirectory() as tmp_root:
            secret_dir = os.path.join(tmp_root, 'my-cred')
            os.makedirs(secret_dir)
            # Per-field files exist but should be ignored because
            # secretKey is explicit and points to a (missing) single file.
            self._write_field(secret_dir, 'access_key_id', 'value')

            config_data: Dict[str, Any] = {
                'credential': {
                    'secretName': 'my-cred',
                    'secretKey': 'typo.yaml',
                },
            }
            with mock.patch.object(
                    configmap_loader, 'SECRETS_ROOT', tmp_root):
                with self.assertLogs(level=logging.ERROR):
                    configmap_loader._resolve_secret_file_references(
                        config_data)

            # Per-field fallback did NOT happen — config still has the
            # reference keys, not loaded field values.
            credential = config_data['credential']
            self.assertNotIn('access_key_id', credential)
            self.assertIn('secretName', credential)


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


class TestValidationErrorFormatting(unittest.TestCase):
    """Pydantic validation errors must never echo input values.

    Policy (see `_format_validation_error` docstring): only the field
    path and Pydantic's reason are included in the error message. The
    submitted value is never echoed back — this eliminates the whole
    class of 'did we remember every sensitive field?' leak bugs.
    """

    def _make_error(
        self, *field_errors,
    ) -> configmap_loader.pydantic.ValidationError:
        """Build a ValidationError by running extra fields through a
        strict model so each one is rejected with extra_forbidden."""
        class FakeModel(configmap_loader.pydantic.BaseModel):
            model_config = {'extra': 'forbid'}
            name: str = ''

        try:
            FakeModel(**dict(field_errors))
        except configmap_loader.pydantic.ValidationError as error:
            return error
        raise AssertionError('Expected a ValidationError')

    def test_output_contains_field_path_reason_and_input_type(self):
        """Operators need loc + msg + input_type to diagnose quickly;
        all three are kept, value is NOT."""
        error = self._make_error(('extra_field', 'anything'))
        formatted = configmap_loader._format_validation_error(error)
        self.assertIn('extra_field', formatted)
        self.assertIn('Extra inputs are not permitted', formatted)
        self.assertIn('input_type=str', formatted)
        self.assertNotIn('anything', formatted)

    def test_input_type_reflects_actual_python_type(self):
        """A non-string input should be reported with its Python type."""
        class IntModel(configmap_loader.pydantic.BaseModel):
            port: int = 80

        try:
            IntModel(port='not-a-number')
        except configmap_loader.pydantic.ValidationError as error:
            formatted = configmap_loader._format_validation_error(error)
            self.assertIn('port', formatted)
            self.assertIn('input_type=str', formatted)
            # The submitted value itself is NEVER echoed
            self.assertNotIn('not-a-number', formatted)

    def test_output_never_contains_input_value(self):
        """Submitted values — sensitive or not — must not appear."""
        error = self._make_error(
            ('access_key', 'ACCESS_KEY_CANARY'),
            ('password', 'PASSWORD_CANARY'),
            ('private_key', 'PRIVATE_KEY_CANARY'),
            ('endpoint', 'ENDPOINT_CANARY'),
            ('_comment', 'COMMENT_CANARY'),
        )
        formatted = configmap_loader._format_validation_error(error)
        for canary in (
            'ACCESS_KEY_CANARY', 'PASSWORD_CANARY',
            'PRIVATE_KEY_CANARY', 'ENDPOINT_CANARY', 'COMMENT_CANARY',
        ):
            self.assertNotIn(canary, formatted)

    def test_real_models_never_leak_any_value(self):
        """End-to-end: drive _validate_configs with the exact shape
        that caused the staging leak (nested credential dict with a
        secret and an extra field that trips Pydantic). No submitted
        value appears in the output; field path is retained."""
        configs: Dict[str, Any] = {
            'workflow': {
                'workflow_data': {
                    'credential': {
                        'access_key': 'LEAKED_IF_BUG_PRESENT',
                        'access_key_id': 'team-osmo-ops',
                        'endpoint': 'swift://host/bucket',
                        'region': 'us-east-1',
                        '_comment': 'docs',
                    },
                },
            },
        }
        errors = configmap_loader._validate_configs(configs)
        combined = '; '.join(errors)
        # No submitted values leak — sensitive or otherwise.
        for value in (
            'LEAKED_IF_BUG_PRESENT', 'team-osmo-ops',
            'swift://host/bucket', 'us-east-1', 'docs',
        ):
            self.assertNotIn(value, combined)
        # The field path is still visible so operators can locate it
        self.assertIn('workflow_data', combined)
        self.assertIn('credential', combined)


class TestConfigMapWatcherStart(unittest.TestCase):
    """Tests for ConfigMapWatcher.start() startup behavior."""

    def setUp(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def test_start_raises_on_invalid_configmap(self):
        """Bad ConfigMap at startup raises RuntimeError — pod crashes,
        rolling update stalls, old pods keep serving."""
        watcher = configmap_loader.ConfigMapWatcher(
            '/nonexistent/path.yaml', postgres=None)
        with self.assertRaises(RuntimeError) as context:
            watcher.start()
        self.assertIn('ConfigMap load failed', str(context.exception))
        # Watcher must not have been started before the raise
        self.assertIsNone(watcher._observer)
        # ConfigMap mode must not be left half-activated
        self.assertFalse(configmap_guard.is_configmap_mode())

    def test_start_succeeds_on_valid_configmap(self):
        """Valid ConfigMap at startup: activates mode, starts watcher."""
        config: Dict[str, Any] = {
            'pod_templates': {'default_ctrl': {'spec': {'containers': []}}},
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp:
            yaml.dump(config, temp)
            path = temp.name
        try:
            watcher = configmap_loader.ConfigMapWatcher(path, postgres=None)
            watcher.start()
            self.assertTrue(configmap_guard.is_configmap_mode())
            self.assertIsNotNone(watcher._observer)
            watcher.stop()
        finally:
            os.unlink(path)


class _FakeEventRecorder:
    """Captures emit calls for assertions; conforms to EventRecorder protocol."""

    def __init__(self):
        self.failures: list[str] = []
        self.successes: list[str] = []

    def emit_reload_failed(self, message: str) -> None:
        self.failures.append(message)

    def emit_reload_succeeded(self, message: str) -> None:
        self.successes.append(message)


class TestConfigMapWatcherEvents(unittest.TestCase):
    """Reload failures/recoveries emit K8s Events for operator visibility."""

    def setUp(self):
        self.mock_postgres = mock.MagicMock()
        mock_service_config = mock.MagicMock()
        mock_service_config.plaintext_dict.return_value = {}
        self.mock_postgres.get_service_configs.return_value = (
            mock_service_config)
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def _write(self, config: Dict[str, Any]) -> str:
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp:
            yaml.dump(config, temp)
            return temp.name

    def test_emits_warning_on_missing_file(self):
        recorder = _FakeEventRecorder()
        watcher = configmap_loader.ConfigMapWatcher(
            '/nonexistent/path.yaml', self.mock_postgres,
            event_recorder=recorder)
        watcher._load_and_apply()
        self.assertEqual(len(recorder.failures), 1)
        self.assertIn('/nonexistent/path.yaml', recorder.failures[0])
        self.assertEqual(recorder.successes, [])

    def test_emits_warning_on_validation_failure(self):
        bad_path = self._write({'pod_templates': 'not-a-dict'})
        try:
            recorder = _FakeEventRecorder()
            watcher = configmap_loader.ConfigMapWatcher(
                bad_path, self.mock_postgres, event_recorder=recorder)
            watcher._load_and_apply()
            self.assertEqual(len(recorder.failures), 1)
            self.assertIn('pod_templates', recorder.failures[0])
        finally:
            os.unlink(bad_path)

    def test_no_success_event_on_first_time_success(self):
        """Successful reloads with no prior failure must not emit — noise."""
        good_path = self._write(
            {'pod_templates': {'ctrl': {'spec': {'containers': []}}}})
        try:
            recorder = _FakeEventRecorder()
            watcher = configmap_loader.ConfigMapWatcher(
                good_path, self.mock_postgres, event_recorder=recorder)
            result = watcher._load_and_apply()
            self.assertEqual(result, configmap_loader.LoadResult.SUCCESS)
            self.assertEqual(recorder.failures, [])
            self.assertEqual(recorder.successes, [])
        finally:
            os.unlink(good_path)

    def test_success_event_emitted_on_recovery(self):
        """After a failed reload, the next successful one emits Normal."""
        bad_path = self._write({'pod_templates': 'not-a-dict'})
        good_path = self._write(
            {'pod_templates': {'ctrl': {'spec': {'containers': []}}}})
        try:
            recorder = _FakeEventRecorder()
            watcher = configmap_loader.ConfigMapWatcher(
                bad_path, self.mock_postgres, event_recorder=recorder)
            watcher._load_and_apply()  # fails
            watcher._config_file_path = good_path
            watcher._load_and_apply()  # recovers
            self.assertEqual(len(recorder.failures), 1)
            self.assertEqual(len(recorder.successes), 1)
            self.assertIn('after previous failure', recorder.successes[0])
        finally:
            os.unlink(bad_path)
            os.unlink(good_path)

    def test_no_recorder_does_not_break_reload(self):
        """Recorder is optional — service must work without one."""
        bad_path = self._write({'pod_templates': 'not-a-dict'})
        try:
            watcher = configmap_loader.ConfigMapWatcher(
                bad_path, self.mock_postgres, event_recorder=None)
            # Must not raise despite the failure
            result = watcher._load_and_apply()
            self.assertNotEqual(result, configmap_loader.LoadResult.SUCCESS)
        finally:
            os.unlink(bad_path)


class TestConfigMapEventRecorder(unittest.TestCase):
    """Unit tests for the K8s Event emission helper."""

    def test_falls_back_silently_when_no_kubeconfig(self):
        """Local dev / test environments won't have incluster or kubeconfig.
        The recorder must degrade to a no-op instead of crashing."""
        with mock.patch(
                'src.service.core.config.configmap_events.'
                'kube_config.load_incluster_config',
                side_effect=configmap_events.kube_config.ConfigException()), \
            mock.patch(
                'src.service.core.config.configmap_events.'
                'kube_config.load_kube_config',
                side_effect=Exception('no config')):
            recorder = configmap_events.ConfigMapEventRecorder(
                namespace='ns', configmap_name='osmo-configs')
            # No raise — both emits are no-ops
            recorder.emit_reload_failed('any error')
            recorder.emit_reload_succeeded('any success')

    @staticmethod
    def _not_found_api_exception():
        return configmap_events.ApiException(status=404, reason='Not Found')

    @staticmethod
    def _stub_configmap_read(mock_api, uid='cm-uid-12345'):
        """Default mock: ConfigMap fetch returns a UID."""
        fake_configmap = mock.MagicMock()
        fake_configmap.metadata.uid = uid
        mock_api.read_namespaced_config_map.return_value = fake_configmap

    @classmethod
    def _build_recorder(cls, mock_api):
        cls._stub_configmap_read(mock_api)
        with mock.patch(
                'src.service.core.config.configmap_events.'
                'kube_config.load_incluster_config'), \
            mock.patch(
                'src.service.core.config.configmap_events.client.CoreV1Api',
                return_value=mock_api):
            return configmap_events.ConfigMapEventRecorder(
                namespace='osmo', configmap_name='osmo-service-configs')

    def test_emit_creates_event_with_deterministic_name_on_first_call(self):
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            self._not_found_api_exception())
        recorder = self._build_recorder(mock_api)
        recorder.emit_reload_failed('pod_templates: must be a dict')

        mock_api.create_namespaced_event.assert_called_once()
        namespace_arg, event = mock_api.create_namespaced_event.call_args.args
        self.assertEqual(namespace_arg, 'osmo')
        # Deterministic name enables dedup via GET→PATCH on subsequent emits
        self.assertEqual(
            event.metadata.name,
            'osmo-service-configs.configmapreloadfailed')
        self.assertEqual(event.type, 'Warning')
        self.assertEqual(event.reason, 'ConfigMapReloadFailed')
        self.assertIn('pod_templates', event.message)
        self.assertEqual(event.involved_object.kind, 'ConfigMap')
        self.assertEqual(event.involved_object.name, 'osmo-service-configs')
        # UID must be populated so events appear in `kubectl describe configmap`
        self.assertEqual(event.involved_object.uid, 'cm-uid-12345')
        self.assertEqual(event.count, 1)

    def test_configmap_uid_is_cached_across_emits(self):
        """UID is fetched once on first emit, reused thereafter."""
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            self._not_found_api_exception())
        recorder = self._build_recorder(mock_api)
        recorder.emit_reload_failed('first')
        recorder.emit_reload_failed('second')
        recorder.emit_reload_failed('third')
        self.assertEqual(mock_api.read_namespaced_config_map.call_count, 1)

    def test_event_emitted_even_if_configmap_uid_fetch_fails(self):
        """If fetching the ConfigMap UID fails, still emit the event (with
        no UID). Operators still see it via `kubectl get events
        --field-selector`."""
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            self._not_found_api_exception())
        mock_api.read_namespaced_config_map.side_effect = (
            RuntimeError('cannot read configmap'))
        with mock.patch(
                'src.service.core.config.configmap_events.'
                'kube_config.load_incluster_config'), \
            mock.patch(
                'src.service.core.config.configmap_events.client.CoreV1Api',
                return_value=mock_api):
            recorder = configmap_events.ConfigMapEventRecorder(
                namespace='osmo', configmap_name='osmo-service-configs')
            recorder.emit_reload_failed('any error')

        mock_api.create_namespaced_event.assert_called_once()
        event = mock_api.create_namespaced_event.call_args.args[1]
        self.assertIsNone(event.involved_object.uid)

    def test_emit_patches_existing_event_on_repeat(self):
        """Second emit for same reason finds the existing event and PATCHes
        it — no duplicate create. Count is incremented, message refreshed."""
        existing = mock.MagicMock()
        existing.count = 3
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.return_value = existing
        recorder = self._build_recorder(mock_api)
        recorder.emit_reload_failed('pod_templates: must be a dict')

        mock_api.create_namespaced_event.assert_not_called()
        mock_api.patch_namespaced_event.assert_called_once()
        name, namespace, patch = (
            mock_api.patch_namespaced_event.call_args.args)
        self.assertEqual(
            name, 'osmo-service-configs.configmapreloadfailed')
        self.assertEqual(namespace, 'osmo')
        self.assertEqual(patch['count'], 4)
        self.assertIn('pod_templates', patch['message'])
        self.assertIn('lastTimestamp', patch)

    def test_emit_truncates_long_messages_on_create(self):
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            self._not_found_api_exception())
        recorder = self._build_recorder(mock_api)
        recorder.emit_reload_failed('x' * 5000)

        event = mock_api.create_namespaced_event.call_args.args[1]
        self.assertLessEqual(len(event.message), 1000)
        self.assertTrue(event.message.endswith('...'))

    def test_emit_truncates_long_messages_on_patch(self):
        existing = mock.MagicMock()
        existing.count = 1
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.return_value = existing
        recorder = self._build_recorder(mock_api)
        recorder.emit_reload_failed('y' * 5000)

        patch = mock_api.patch_namespaced_event.call_args.args[2]
        self.assertLessEqual(len(patch['message']), 1000)
        self.assertTrue(patch['message'].endswith('...'))

    def test_read_non_404_error_is_swallowed(self):
        """Observability must never take down the service."""
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            configmap_events.ApiException(status=500, reason='Internal'))
        recorder = self._build_recorder(mock_api)
        # Must not raise; create/patch not attempted when read fails
        recorder.emit_reload_failed('any error')
        mock_api.create_namespaced_event.assert_not_called()
        mock_api.patch_namespaced_event.assert_not_called()

    def test_create_exception_is_swallowed(self):
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.side_effect = (
            self._not_found_api_exception())
        mock_api.create_namespaced_event.side_effect = (
            RuntimeError('apiserver down'))
        recorder = self._build_recorder(mock_api)
        # Must not raise
        recorder.emit_reload_failed('any error')

    def test_patch_exception_is_swallowed(self):
        existing = mock.MagicMock()
        existing.count = 1
        mock_api = mock.MagicMock()
        mock_api.read_namespaced_event.return_value = existing
        mock_api.patch_namespaced_event.side_effect = (
            RuntimeError('apiserver down'))
        recorder = self._build_recorder(mock_api)
        # Must not raise
        recorder.emit_reload_failed('any error')


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
        self.assertEqual(
            result, configmap_loader.LoadResult.TRANSIENT_FAILURE)
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
            self.assertEqual(
                result, configmap_loader.LoadResult.PERMANENT_FAILURE)
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
            self.assertEqual(result, configmap_loader.LoadResult.SUCCESS)

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
            self.assertEqual(result, configmap_loader.LoadResult.SUCCESS)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            service_config = snapshot['service']
            self.assertEqual(
                service_config['max_pod_restart_limit'], '30m')
            # Only service_auth is injected from DB now. service_base_url
            # is sourced from the ConfigMap (Helm template auto-derives
            # it from services.service.hostname); falling back to DB
            # silently masked ConfigMap misconfiguration.
            self.assertIn('service_auth', service_config)
            self.assertNotIn('service_base_url', service_config)
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
            self.assertEqual(
                result, configmap_loader.LoadResult.PERMANENT_FAILURE)

            # Previous snapshot preserved
            self.assertIs(configmap_state.get_snapshot(), old_snapshot)
        finally:
            os.unlink(good_path)
            os.unlink(bad_path)


class TestResolvePoolComputedFields(unittest.TestCase):
    """Tests for _resolve_pool_computed_fields."""

    def test_resolves_common_pod_template(self):
        configs: Dict[str, Any] = {
            'pod_templates': {
                'default_user': {
                    'spec': {
                        'containers': [
                            {'name': '{{USER_CONTAINER_NAME}}',
                             'resources': {'limits': {'cpu': '{{USER_CPU}}'}}}
                        ],
                    },
                },
                'default_ctrl': {
                    'spec': {
                        'containers': [
                            {'name': 'osmo-ctrl',
                             'resources': {'limits': {'cpu': '100m'}}}
                        ],
                    },
                },
            },
            'pools': {
                'default': {
                    'common_pod_template': ['default_user', 'default_ctrl'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu-a100': {
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        pool = configs['pools']['default']
        # Pool-level parsed_pod_template should have merged templates
        self.assertIn('spec', pool['parsed_pod_template'])

        # Platform should inherit pool's template
        platform = pool['platforms']['gpu-a100']
        self.assertIn('spec', platform['parsed_pod_template'])
        containers = platform['parsed_pod_template']['spec']['containers']
        names = [c['name'] for c in containers]
        self.assertIn('{{USER_CONTAINER_NAME}}', names)
        self.assertIn('osmo-ctrl', names)

    def test_resolves_platform_override_templates(self):
        configs: Dict[str, Any] = {
            'pod_templates': {
                'default_user': {
                    'spec': {
                        'containers': [
                            {'name': '{{USER_CONTAINER_NAME}}',
                             'resources': {'limits': {'cpu': '1'}}}
                        ],
                    },
                },
                'gpu_override': {
                    'spec': {
                        'nodeSelector': {'gpu': 'a100'},
                    },
                },
            },
            'pools': {
                'default': {
                    'common_pod_template': ['default_user'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu-a100': {
                            'override_pod_template': ['gpu_override'],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        platform = configs['pools']['default']['platforms']['gpu-a100']
        # Should have both the common template and the override merged
        self.assertIn('containers',
                      platform['parsed_pod_template']['spec'])
        self.assertEqual(
            platform['parsed_pod_template']['spec']['nodeSelector'],
            {'gpu': 'a100'})

    def test_resolves_resource_validations(self):
        configs: Dict[str, Any] = {
            'resource_validations': {
                'default_cpu': [
                    {'operator': 'LE',
                     'left_operand': '{{USER_CPU}}',
                     'right_operand': '{{K8_CPU}}'},
                ],
                'extra_gpu': [
                    {'operator': 'GE',
                     'left_operand': '{{USER_GPU}}',
                     'right_operand': '0'},
                ],
            },
            'pools': {
                'default': {
                    'common_pod_template': [],
                    'common_resource_validations': ['default_cpu'],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu': {
                            'override_pod_template': [],
                            'resource_validations': ['extra_gpu'],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        pool = configs['pools']['default']
        # Pool-level should have common validations
        self.assertEqual(len(pool['parsed_resource_validations']), 1)

        # Platform should have common + platform validations
        platform = pool['platforms']['gpu']
        self.assertEqual(len(platform['parsed_resource_validations']), 2)

    def test_always_resolves_from_references(self):
        """Pre-existing parsed_* fields are overwritten by resolution."""
        configs: Dict[str, Any] = {
            'pod_templates': {
                'tmpl': {'spec': {'containers': []}},
            },
            'resource_validations': {
                'cpu_check': [
                    {'operator': 'LE', 'left_operand': 'cpu'},
                ],
            },
            'pools': {
                'default': {
                    'common_pod_template': ['tmpl'],
                    'common_resource_validations': ['cpu_check'],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu': {
                            'override_pod_template': [],
                            'resource_validations': [],
                            'parsed_pod_template': {
                                'spec': {'stale': True},
                            },
                            'labels': {'stale': 'yes'},
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        platform = configs['pools']['default']['platforms']['gpu']
        # Stale pre-existing data overwritten by resolution
        self.assertNotIn(
            'stale', platform['parsed_pod_template'].get('spec', {}))
        self.assertIn('containers',
                      platform['parsed_pod_template']['spec'])
        # Resource validations also resolved
        self.assertEqual(
            len(platform['parsed_resource_validations']), 1)
        # Stale labels overwritten (unconditional, not setdefault)
        self.assertNotIn('stale', platform['labels'])

    def test_no_pools_is_noop(self):
        configs: Dict[str, Any] = {
            'pod_templates': {'tmpl': {'spec': {}}},
        }
        configmap_loader._resolve_pool_computed_fields(configs)
        self.assertNotIn('pools', configs)

    def test_derives_default_mounts_from_template(self):
        configs: Dict[str, Any] = {
            'pod_templates': {
                'mount_tmpl': {
                    'spec': {
                        'containers': [
                            {'name': '{{USER_CONTAINER_NAME}}',
                             'volumeMounts': [
                                 {'name': 'shm', 'mountPath': '/dev/shm'},
                                 {'name': 'data', 'mountPath': '/mnt/data'},
                             ]},
                            {'name': 'osmo-ctrl',
                             'volumeMounts': [
                                 {'name': 'ctrl', 'mountPath': '/ctrl'},
                             ]},
                        ],
                    },
                },
            },
            'pools': {
                'default': {
                    'common_pod_template': ['mount_tmpl'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu': {
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        platform = configs['pools']['default']['platforms']['gpu']
        # Only non-osmo-ctrl mounts should be included
        self.assertEqual(
            platform['default_mounts'], ['/dev/shm', '/mnt/data'])

    def test_group_templates_merge_by_key(self):
        """Group templates with same (apiVersion, kind, name) are merged."""
        configs: Dict[str, Any] = {
            'group_templates': {
                'base_pg': {
                    'apiVersion': 'scheduling.x-k8s.io/v1beta1',
                    'kind': 'PodGroup',
                    'metadata': {'name': 'default'},
                    'spec': {'minMember': 1},
                },
                'override_pg': {
                    'apiVersion': 'scheduling.x-k8s.io/v1beta1',
                    'kind': 'PodGroup',
                    'metadata': {'name': 'default'},
                    'spec': {'minMember': 4, 'queue': 'high'},
                },
            },
            'pools': {
                'default': {
                    'common_pod_template': [],
                    'common_resource_validations': [],
                    'common_group_templates': [
                        'base_pg', 'override_pg'],
                    'platforms': {},
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        pool = configs['pools']['default']
        # Should merge into one entry, not two
        self.assertEqual(len(pool['parsed_group_templates']), 1)
        merged = pool['parsed_group_templates'][0]
        self.assertEqual(merged['spec']['minMember'], 4)
        self.assertEqual(merged['spec']['queue'], 'high')

    def test_derives_labels_from_node_selector(self):
        configs: Dict[str, Any] = {
            'pod_templates': {
                'gpu_tmpl': {
                    'spec': {
                        'nodeSelector': {'gpu': 'a100', 'arch': 'amd64'},
                    },
                },
            },
            'pools': {
                'default': {
                    'common_pod_template': ['gpu_tmpl'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'gpu': {
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        platform = configs['pools']['default']['platforms']['gpu']
        self.assertEqual(
            platform['labels'], {'gpu': 'a100', 'arch': 'amd64'})

    def test_pre_renders_jinja_in_ctrl_resources_for_accounting(self):
        """parsed_pod_template_for_accounting renders Jinja in osmo-ctrl
        resources with the merged pool+platform default variables, while
        parsed_pod_template stays templated for per-workflow rendering.

        Two platforms exercise both invariants: 'default' inherits pool
        defaults (USER_CPU=1 → else-branch); 'big' overrides via its own
        default_variables (USER_CPU=8 → if-branch clamps to 2).
        """
        configs: Dict[str, Any] = {
            'pod_templates': {
                'default_ctrl': {
                    'spec': {
                        'containers': [
                            {
                                'name': 'osmo-ctrl',
                                'resources': {
                                    'requests': {
                                        'cpu': (
                                            '{% if USER_CPU > 2 %}2'
                                            '{% else %}{{USER_CPU}}'
                                            '{% endif %}'),
                                        'memory': '{{USER_MEMORY}}',
                                    },
                                    'limits': {
                                        'cpu': '{{USER_CPU}}',
                                    },
                                },
                            },
                        ],
                    },
                },
            },
            'pools': {
                'default': {
                    'common_default_variables': {
                        'USER_CPU': 1,
                        'USER_MEMORY': '1Gi',
                    },
                    'common_pod_template': ['default_ctrl'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'default': {
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                        'big': {
                            'default_variables': {'USER_CPU': 8},
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        configmap_loader._resolve_pool_computed_fields(configs)

        pool = configs['pools']['default']

        # Original stays templated for substitute_pod_template_tokens.
        ctrl_orig = pool['parsed_pod_template']['spec']['containers'][0]
        self.assertIn(
            '{% if', ctrl_orig['resources']['requests']['cpu'])

        # Pool-level accounting copy renders with pool defaults.
        ctrl_pool = (pool['parsed_pod_template_for_accounting']
                     ['spec']['containers'][0])
        self.assertEqual(
            ctrl_pool['resources']['requests']['cpu'], '1')
        self.assertEqual(
            ctrl_pool['resources']['requests']['memory'], '1Gi')
        self.assertEqual(
            ctrl_pool['resources']['limits']['cpu'], '1')

        # Platform inheriting pool defaults gets the else-branch ('1').
        ctrl_default = (pool['platforms']['default']
                        ['parsed_pod_template_for_accounting']
                        ['spec']['containers'][0])
        self.assertEqual(
            ctrl_default['resources']['requests']['cpu'], '1')

        # Platform overriding USER_CPU=8 trips the if-branch ('2').
        ctrl_big = (pool['platforms']['big']
                    ['parsed_pod_template_for_accounting']
                    ['spec']['containers'][0])
        self.assertEqual(
            ctrl_big['resources']['requests']['cpu'], '2')

    def test_load_and_apply_resolves_pool_fields(self):
        """End-to-end: _load_and_apply resolves pool computed fields."""
        config: Dict[str, Any] = {
            'pod_templates': {
                'user_tmpl': {
                    'spec': {
                        'containers': [
                            {'name': 'user', 'image': 'test:latest'}
                        ],
                    },
                },
            },
            'pools': {
                'test-pool': {
                    'backend': 'default',
                    'common_pod_template': ['user_tmpl'],
                    'common_resource_validations': [],
                    'common_group_templates': [],
                    'platforms': {
                        'default': {
                            'override_pod_template': [],
                            'resource_validations': [],
                        },
                    },
                },
            },
        }
        with tempfile.NamedTemporaryFile(
                mode='w', suffix='.yaml', delete=False) as temp:
            yaml.dump(config, temp)
            path = temp.name

        mock_postgres = mock.MagicMock()
        mock_service_config = mock.MagicMock()
        mock_service_config.plaintext_dict.return_value = {}
        mock_postgres.get_service_configs.return_value = mock_service_config

        try:
            configmap_state.set_parsed_configs(None)
            watcher = configmap_loader.ConfigMapWatcher(path, mock_postgres)
            result = watcher._load_and_apply()
            self.assertEqual(result, configmap_loader.LoadResult.SUCCESS)

            snapshot = configmap_state.get_snapshot()
            assert snapshot is not None
            platform = snapshot['pools']['test-pool']['platforms']['default']
            self.assertIn('spec', platform['parsed_pod_template'])
            self.assertIn('user',
                          [c['name'] for c in
                           platform['parsed_pod_template']['spec']['containers']])
        finally:
            os.unlink(path)
            configmap_state.set_parsed_configs(None)


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


class TestStartConfigWatcher(unittest.TestCase):
    """Tests for the start_config_watcher convenience helper."""

    def setUp(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def tearDown(self):
        configmap_state.set_configmap_mode(False)
        configmap_state.set_parsed_configs(None)

    def test_returns_none_when_config_file_unset(self):
        watcher = configmap_loader.start_config_watcher(
            None, mock.MagicMock(), is_api_service=True)
        self.assertIsNone(watcher)
        self.assertFalse(configmap_state.is_configmap_mode())

    def test_non_api_service_skips_event_recorder_but_injects_runtime(self):
        """Worker/agent/logger must NOT emit K8s reload events (replicas
        would race on the same Event object) but MUST still inject
        service_auth from DB on first load — otherwise the worker falls
        through to ServiceConfig's default_factory and signs workflow
        JWTs with a freshly-generated keypair the API can't validate.
        """
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = os.path.join(tmp_dir, 'config.yaml')
            with open(config_path, 'w', encoding='utf-8') as f:
                yaml.dump({'service': {}}, f)

            postgres = mock.MagicMock()
            with mock.patch.object(
                configmap_events, 'ConfigMapEventRecorder',
            ) as mock_recorder:
                watcher = configmap_loader.start_config_watcher(
                    config_path, postgres, is_api_service=False)
                assert watcher is not None
                try:
                    self.assertIsNone(watcher._event_recorder)
                    mock_recorder.assert_not_called()
                    postgres.get_service_configs.assert_called()
                finally:
                    watcher.stop()

    def test_cold_start_retry_succeeds_when_file_appears(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = os.path.join(tmp_dir, 'config.yaml')

            def write_file_late():
                time.sleep(0.15)
                with open(config_path, 'w', encoding='utf-8') as f:
                    yaml.dump({'service': {}}, f)

            # Speed up the retry loop so the test runs in <1s.
            with mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_DEADLINE_S', 5.0,
            ), mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_INTERVAL_S', 0.05,
            ), mock.patch.object(
                configmap_loader.ConfigMapWatcher,
                '_load_and_apply',
                autospec=True,
                wraps=configmap_loader.ConfigMapWatcher._load_and_apply,
            ) as load_spy:
                writer = threading.Thread(target=write_file_late)
                writer.start()
                watcher = None
                try:
                    watcher = configmap_loader.start_config_watcher(
                        config_path, mock.MagicMock(),
                        is_api_service=False)
                    self.assertIsNotNone(watcher)
                    # First call(s) must fail (file not yet present), then
                    # the writer thread creates the file and a later call
                    # succeeds. Anything less than 2 invocations means the
                    # retry path was never exercised.
                    self.assertGreaterEqual(load_spy.call_count, 2)
                finally:
                    writer.join()
                    if watcher is not None:
                        watcher.stop()

    def test_cold_start_raises_after_deadline(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            missing_path = os.path.join(tmp_dir, 'never-appears.yaml')

            with mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_DEADLINE_S', 0.2,
            ), mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_INTERVAL_S', 0.05,
            ):
                with self.assertRaises(RuntimeError) as ctx:
                    configmap_loader.start_config_watcher(
                        missing_path, mock.MagicMock(),
                        is_api_service=False)
                self.assertIn('failed at startup', str(ctx.exception))
                self.assertIn('never became readable', str(ctx.exception))

    def test_cold_start_fails_fast_on_permanent_error(self):
        """Bad YAML must not consume the full retry deadline."""
        with tempfile.TemporaryDirectory() as tmp_dir:
            config_path = os.path.join(tmp_dir, 'config.yaml')
            with open(config_path, 'w', encoding='utf-8') as f:
                f.write('not: [valid: yaml')

            with mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_DEADLINE_S', 60.0,
            ), mock.patch.object(
                configmap_loader, '_STARTUP_RETRY_INTERVAL_S', 1.0,
            ):
                start = time.monotonic()
                with self.assertRaises(RuntimeError) as ctx:
                    configmap_loader.start_config_watcher(
                        config_path, mock.MagicMock(),
                        is_api_service=False)
                elapsed = time.monotonic() - start
                # Should bail out essentially immediately (single attempt).
                # Bound generously to absorb CI jitter; the point is that
                # we don't sit through the 60s deadline.
                self.assertLess(elapsed, 5.0)
                self.assertIn('malformed or invalid', str(ctx.exception))


if __name__ == '__main__':
    unittest.main()
