"""Credential rotations must not reload immutable service configuration.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

# Tests exercise private polling and publication boundaries directly.
# pylint: disable=protected-access

import base64
import concurrent.futures
import copy
import os
from pathlib import Path
import tempfile
import threading
from typing import Any
import unittest
from unittest import mock

import yaml

from src.service.core.config import configmap_loader, secret_snapshot
from src.utils import auth, configmap_state, connectors
from src.utils.job import task


class SecretRefreshTest(unittest.TestCase):
    """Real loader and validators with Kubernetes-style projected file fixtures."""

    service_auth: auth.AuthenticationConfig

    @classmethod
    def setUpClass(cls):
        cls.service_auth = auth.AuthenticationConfig.generate_default()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()  # pylint: disable=consider-using-with
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.secret = self.root / 'storage'
        self.config_path = self.root / 'config.yaml'
        self.generation = 0
        self.project('A')
        self.config: dict[str, Any] = {
            name: {} for name in configmap_loader._EXPECTED_CONFIG_KEYS}
        self.config['roles'] = {'osmo-default': {'description': 'Default role', 'policies': [{
            'effect': 'Allow', 'actions': ['system:Health'], 'resources': ['*']}],
            'external_roles': []}}
        self.config['workflow'] = {'workflow_data': {'credential': {
            'secretName': 'storage', 'secretKey': 'cred.yaml'}}}
        self.config['service'] = {'max_pod_restart_limit': '30m'}
        self.write_config()
        root_patch = mock.patch.object(configmap_loader, 'SECRETS_ROOT', str(self.root))
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.postgres = mock.Mock()
        self.postgres.get_service_auth.return_value = self.service_auth
        self.postgres.execute_fetch_command.return_value = []
        self.watcher = configmap_loader.ConfigMapWatcher(str(self.config_path), self.postgres)
        self.addCleanup(self.watcher.stop)
        self.addCleanup(configmap_state.set_parsed_configs, None)
        self.addCleanup(configmap_state.set_configmap_mode, False)

    def payload(self, revision):
        return {'endpoint': 's3://test-bucket', 'region': 'us-west-2',
                'access_key_id': f'fake-id-{revision}', 'access_key': f'fake-key-{revision}'}

    def project(self, revision, *, payload=None, fields=None, root=None):
        root = root or self.secret
        root.mkdir(exist_ok=True)
        self.generation += 1
        generation = root / f'..generation-{self.generation}'
        generation.mkdir()
        if fields is None:
            fields = {'cred.yaml': yaml.safe_dump(
                self.payload(revision) if payload is None else payload)}
        for key, value in fields.items():
            (generation / key).write_text(value, encoding='utf-8')
            target = root / key
            if not target.is_symlink():
                target.symlink_to(f'..data/{key}')
        temporary = root / '..data_tmp'
        temporary.symlink_to(generation.name)
        os.replace(temporary, root / '..data')
        for entry in root.iterdir():
            if entry.is_symlink() and not entry.name.startswith('..') and entry.name not in fields:
                entry.unlink()

    def write_config(self):
        temporary = self.root / 'candidate.yaml'
        temporary.write_text(yaml.safe_dump(self.config), encoding='utf-8')
        os.replace(temporary, self.config_path)

    def load(self):
        self.assertEqual(self.watcher._load_and_apply(), configmap_loader.LoadResult.SUCCESS)

    def snapshot(self):
        snapshot = configmap_state.get_snapshot()
        assert snapshot is not None
        return snapshot

    def credential(self):
        return self.snapshot()['workflow']['workflow_data']['credential']

    def test_rotation_updates_task_serialization_without_mutating_old_snapshot(self):
        self.load()
        previous = self.snapshot()
        self.project('B')
        self.assertTrue(self.watcher.refresh_status.stale)
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
        self.assertEqual(previous['workflow']['workflow_data']['credential']['access_key_id'],
                         'fake-id-A')
        config = connectors.WorkflowConfig(**self.snapshot()['workflow'])
        credential = config.workflow_data.credential
        assert credential is not None
        generated = task.create_config_dict({'s3://test-bucket': credential})
        self.assertEqual(generated['auth']['data']['s3://test-bucket']['access_key'], 'fake-key-B')
        self.assertEqual(self.watcher.refresh_status.sequence, 2)
        self.assertFalse(self.watcher.refresh_status.stale)

    def test_configmap_rewrite_and_deletion_do_not_change_startup_semantics(self):
        self.load()
        original = copy.deepcopy(self.snapshot())
        self.config['service']['max_pod_restart_limit'] = '45m'
        self.config['workflow']['workflow_data']['credential']['secretName'] = 'replacement'
        self.config['roles']['osmo-default']['description'] = 'new config must require restart'
        self.write_config()
        self.project('C', root=self.root / 'replacement')
        self.watcher._check_dependencies()
        self.assertEqual(self.watcher.refresh_status.sequence, 1)
        self.project('B')
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
        self.config_path.unlink()
        self.project('C')
        self.watcher._check_dependencies()
        expected = copy.deepcopy(original)
        expected['workflow']['workflow_data']['credential'] = self.payload('C')
        self.assertEqual(self.snapshot(), expected)

    def test_generic_config_secret_is_never_reloaded(self):
        self.project('A', payload={'value': '30m'}, root=self.root / 'generic')
        self.config['service']['max_pod_restart_limit'] = {
            'secretName': 'generic', 'secretKey': 'cred.yaml'}
        self.write_config()
        self.load()
        self.project('B', payload={'value': '45m'}, root=self.root / 'generic')
        with mock.patch.object(self.watcher, '_refresh_secrets') as refresh:
            self.watcher._check_dependencies()
            refresh.assert_not_called()
        self.project('B')
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
        self.assertEqual(self.snapshot()['service']['max_pod_restart_limit'], '30m')

    def test_same_secret_cannot_change_roles_or_routing_configuration(self):
        role = copy.deepcopy(self.config['roles']['osmo-default'])
        self.config['roles']['osmo-default'] = {'secretName': 'storage', 'secretKey': 'role.yaml'}
        self.write_config()
        self.project('A', fields={'cred.yaml': yaml.safe_dump(self.payload('A')),
                                  'role.yaml': yaml.safe_dump(role)})
        self.load()
        changed_role = {**role, 'description': 'ignored until restart'}
        self.project('B', fields={'cred.yaml': yaml.safe_dump(self.payload('B')),
                                  'role.yaml': yaml.safe_dump(changed_role)})
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
        self.assertEqual(self.snapshot()['roles']['osmo-default'], role)

    def test_storage_routing_and_auth_mode_changes_require_restart(self):
        self.load()
        original = self.snapshot()
        for changes in ({'endpoint': 's3://other-bucket'}, {'region': 'eu-west-1'},
                        {'override_url': 'https://storage.example.test'},
                        {'addressing_style': 'path'}):
            with self.subTest(changes=changes):
                self.project('B', payload={**self.payload('B'), **changes})
                self.watcher._check_dependencies()
                self.assertIs(self.snapshot(), original)
                self.assertTrue(self.watcher.refresh_status.stale)
        self.project('default-auth', payload={
            'endpoint': 's3://test-bucket', 'region': 'us-west-2'})
        self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)
        self.project('C')
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-C')

    def test_default_auth_cannot_silently_switch_to_static(self):
        self.project('default', payload={'endpoint': 's3://test-bucket', 'region': 'us-west-2'})
        self.load()
        original = self.snapshot()
        self.project('B')
        self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)

    def test_invalid_missing_and_incomplete_rotation_keeps_last_good(self):
        self.load()
        original = self.snapshot()
        invalid_payloads: tuple[dict[str, Any], ...] = (
                            {}, {'endpoint': 's3://test-bucket', 'access_key_id': 'only-id'},
                            {**self.payload('B'), 'access_key': ''},
                            {**self.payload('B'), 'access_key': '  '}, {'value': 'invalid'})
        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                self.project('invalid', payload=payload)
                self.watcher._check_dependencies()
                self.assertIs(self.snapshot(), original)
        self.project('missing', fields={})
        self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)
        self.project('C')
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-C')

    def test_shared_reference_updates_all_storage_credentials_atomically(self):
        self.config['workflow'] = {name: {'credential': {
            'secretName': 'storage', 'secretKey': 'cred.yaml'}}
            for name in ('workflow_data', 'workflow_log', 'workflow_app')}
        self.write_config()
        self.load()
        self.project('B')
        self.watcher._check_dependencies()
        for name in self.config['workflow']:
            self.assertEqual(self.snapshot()['workflow'][name]['credential'], self.payload('B'))

    def test_one_bad_secret_prevents_partial_multi_secret_publication(self):
        self.project('A', root=self.root / 'logs')
        self.config['workflow']['workflow_log'] = {'credential': {
            'secretName': 'logs', 'secretKey': 'cred.yaml'}}
        self.write_config()
        self.load()
        original = self.snapshot()
        self.project('B')
        self.project('invalid', payload={}, root=self.root / 'logs')
        self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)
        self.project('B', root=self.root / 'logs')
        self.watcher._check_dependencies()
        for name in ('workflow_data', 'workflow_log'):
            self.assertEqual(self.snapshot()['workflow'][name]['credential'], self.payload('B'))

    def test_refresh_has_no_database_or_reconciliation_side_effects(self):
        self.watcher._enable_reconciliation = True
        self.watcher._reconciliation_state_store = mock.Mock()
        self.watcher._reconciliation_state_store.load_reconciliation_state.return_value = None
        with mock.patch.object(configmap_loader, '_reconcile_backend_side_effects',
                               return_value=True) as reconcile:
            self.load()
            self.assertEqual(reconcile.call_count, 1)
            self.postgres.reset_mock()
            self.watcher._reconciliation_state_store.reset_mock()
            original_auth = copy.deepcopy(self.snapshot()['service']['service_auth'])
            self.project('B')
            self.watcher._check_dependencies()
            self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
            self.assertEqual(reconcile.call_count, 1)
            self.assertEqual(self.postgres.mock_calls, [])
            self.assertEqual(self.watcher._reconciliation_state_store.mock_calls, [])
            self.assertEqual(self.snapshot()['service']['service_auth'], original_auth)

    def test_unchanged_dependencies_do_not_parse(self):
        self.load()
        with mock.patch.object(self.watcher, '_refresh_secrets') as refresh:
            self.watcher._check_dependencies()
            refresh.assert_not_called()

    def test_plain_file_replacement_is_detected(self):
        path = self.root / 'plain.yaml'
        path.write_text(yaml.safe_dump(self.payload('A')))
        self.config['workflow']['workflow_data']['credential'] = {'secret_file': str(path)}
        self.write_config()
        self.load()
        replacement = self.root / 'next.yaml'
        replacement.write_text(yaml.safe_dump(self.payload('B')))
        replacement.replace(path)
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')

    def test_registry_rotation_preserves_image_and_registry_location(self):
        self.config['workflow']['backend_images'] = {'client': 'example.test/client:fixed',
            'credential': {'secretName': 'registry', 'secretKey': 'cred.yaml'}}
        self.write_config()
        for revision in ('A', 'B'):
            encoded = base64.b64encode(f'user:fake-{revision}'.encode()).decode()
            self.project(revision, payload={'auths': {'example.test': {'auth': encoded}}},
                         root=self.root / 'registry')
            if revision == 'A':
                self.load()
            else:
                self.watcher._check_dependencies()
            result = self.snapshot()['workflow']['backend_images']
            self.assertEqual(result['client'], 'example.test/client:fixed')
            self.assertEqual(result['credential']['username'], 'user')
            self.assertEqual(result['credential']['auth'], f'fake-{revision}')
        original = self.snapshot()
        self.project('C', payload={'auths': {'other.test': {'auth': encoded}}},
                     root=self.root / 'registry')
        self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)

    def test_projected_reads_cannot_mix_generations(self):
        dependency = secret_snapshot.DependencySnapshot()
        dependency.read_file(str(self.secret / 'cred.yaml'))
        self.project('B')
        with self.assertRaises(secret_snapshot.DependencyReadError):
            dependency.read_file(str(self.secret / 'cred.yaml'))

    def test_rotation_during_validation_is_not_published(self):
        self.load()
        original = self.snapshot()
        self.project('B')
        validate = configmap_loader.validate_configmap_snapshot

        def rotating_validate(config):
            self.project('C')
            return validate(config)

        with mock.patch.object(configmap_loader, 'validate_configmap_snapshot',
                               side_effect=rotating_validate):
            self.watcher._check_dependencies()
        self.assertIs(self.snapshot(), original)
        self.watcher._check_dependencies()
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-C')

    def test_real_polling_loop_and_event_failure_recovery(self):
        failed = threading.Event()
        recovered = threading.Event()
        recorder = mock.Mock()

        def fail_notification(message):
            del message
            failed.set()
            raise TimeoutError('TOP-SECRET-CANARY')

        def recover_notification(message):
            del message
            recovered.set()
            raise TimeoutError('TOP-SECRET-CANARY')

        recorder.emit_reload_failed.side_effect = fail_notification
        recorder.emit_reload_succeeded.side_effect = recover_notification
        self.watcher._event_recorder = recorder
        with mock.patch.object(configmap_loader, '_DEPENDENCY_CHECK_INTERVAL_S', 0.01), \
             self.assertLogs(level='WARNING') as logs:
            self.watcher.start()
            self.project('invalid', fields={'cred.yaml': 'access_key: [TOP-SECRET-CANARY'})
            self.assertTrue(failed.wait(5), 'Secret-only failure never detected')
            self.assertEqual(self.credential()['access_key_id'], 'fake-id-A')
            self.project('B')
            self.assertTrue(recovered.wait(5), 'Secret-only rotation never refreshed the snapshot')
            self.assertEqual(self.credential()['access_key_id'], 'fake-id-B')
            self.watcher.stop()
            assert self.watcher._dependency_thread is not None
            self.assertFalse(self.watcher._dependency_thread.is_alive())
        self.assertNotIn('TOP-SECRET-CANARY', '\n'.join(logs.output))

    def test_default_interval_is_thirty_seconds(self):
        self.assertEqual(configmap_loader._DEPENDENCY_CHECK_INTERVAL_S, 30)

    def test_stop_prevents_future_publication(self):
        self.load()
        original = self.snapshot()
        self.watcher.stop()
        self.project('B')
        self.watcher._check_dependencies()
        self.watcher._load_and_apply()
        self.assertIs(self.snapshot(), original)

    def test_concurrent_callbacks_are_serialized(self):
        self.load()
        entered = threading.Event()
        release = threading.Event()
        validate = configmap_loader.validate_configmap_snapshot

        def slow_validate(config):
            entered.set()
            self.assertTrue(release.wait(5))
            return validate(config)

        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            with mock.patch.object(configmap_loader, 'validate_configmap_snapshot',
                                   side_effect=slow_validate):
                self.project('B')
                first = executor.submit(self.watcher._check_dependencies)
                self.assertTrue(entered.wait(5))
                self.project('C')
                second = executor.submit(self.watcher._check_dependencies)
                release.set()
                first.result(timeout=5)
                second.result(timeout=5)
        self.assertEqual(self.credential()['access_key_id'], 'fake-id-C')


if __name__ == '__main__':
    unittest.main()
