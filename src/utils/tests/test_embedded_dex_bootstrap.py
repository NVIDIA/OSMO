"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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

import base64
import contextlib
import copy
import io
import types
import unittest
from unittest import mock

import bcrypt
from kubernetes import client as kubernetes_client
from kubernetes.client import exceptions as kubernetes_exceptions

from src.utils import embedded_dex_bootstrap


class FakeCoreApi:
    """Minimal in-memory Kubernetes Secret API."""

    def __init__(self) -> None:
        self.secrets: dict[str, kubernetes_client.V1Secret] = {}
        self.pods: dict[str, kubernetes_client.V1Pod] = {}
        self.deleted_pods: list[str] = []
        self.replace_deleted_pods = True

    def read_namespaced_secret(
        self, name: str, namespace: str,
    ) -> kubernetes_client.V1Secret:
        del namespace
        if name not in self.secrets:
            raise kubernetes_exceptions.ApiException(status=404, reason='Not Found')
        return copy.deepcopy(self.secrets[name])

    def create_namespaced_secret(
        self, namespace: str, body: kubernetes_client.V1Secret,
    ) -> kubernetes_client.V1Secret:
        del namespace
        name = body.metadata.name
        if name in self.secrets:
            raise kubernetes_exceptions.ApiException(status=409, reason='Conflict')
        body.metadata.resource_version = '1'
        self.secrets[name] = copy.deepcopy(body)
        return copy.deepcopy(body)

    def list_namespaced_pod(
        self, namespace: str, label_selector: str,
    ) -> kubernetes_client.V1PodList:
        del namespace
        labels = dict(item.split('=', 1) for item in label_selector.split(','))
        return kubernetes_client.V1PodList(items=[
            copy.deepcopy(pod)
            for pod in self.pods.values()
            if all((pod.metadata.labels or {}).get(key) == value
                   for key, value in labels.items())
        ])

    def delete_namespaced_pod(
        self,
        name: str,
        namespace: str,
        body: kubernetes_client.V1DeleteOptions,
    ) -> None:
        del namespace, body
        if name not in self.pods:
            raise kubernetes_exceptions.ApiException(status=404, reason='Not Found')
        deleted = self.pods.pop(name)
        self.deleted_pods.append(name)
        if self.replace_deleted_pods:
            replacement_name = f'{name}-replacement'
            self.pods[replacement_name] = kubernetes_client.V1Pod(
                metadata=kubernetes_client.V1ObjectMeta(
                    name=replacement_name,
                    uid=f'{replacement_name}-uid',
                    labels=copy.deepcopy(deleted.metadata.labels),
                ),
                status=kubernetes_client.V1PodStatus(conditions=[
                    kubernetes_client.V1PodCondition(
                        type='Ready', status='True'),
                ]),
            )

    def replace_namespaced_secret(
        self, name: str, body: kubernetes_client.V1Secret, namespace: str,
    ) -> kubernetes_client.V1Secret:
        del namespace
        if name not in self.secrets:
            raise kubernetes_exceptions.ApiException(status=404, reason='Not Found')
        if body.metadata.resource_version != self.secrets[name].metadata.resource_version:
            raise kubernetes_exceptions.ApiException(status=409, reason='Conflict')
        body.metadata.resource_version = str(int(body.metadata.resource_version) + 1)
        self.secrets[name] = copy.deepcopy(body)
        return copy.deepcopy(body)


class ConcurrentCreateCoreApi(FakeCoreApi):
    """Simulate another bootstrap pod winning both Secret creates."""

    def create_namespaced_secret(
        self, namespace: str, body: kubernetes_client.V1Secret,
    ) -> kubernetes_client.V1Secret:
        name = body.metadata.name
        if name not in self.secrets:
            created = copy.deepcopy(body)
            created.metadata.resource_version = '1'
            self.secrets[name] = created
            raise kubernetes_exceptions.ApiException(status=409, reason='Conflict')
        return super().create_namespaced_secret(namespace, body)


class ConcurrentReplaceCoreApi(FakeCoreApi):
    """Simulate another bootstrap pod winning the first Secret replacement."""

    def __init__(self) -> None:
        super().__init__()
        self.conflicted = False

    def replace_namespaced_secret(
        self, name: str, body: kubernetes_client.V1Secret, namespace: str,
    ) -> kubernetes_client.V1Secret:
        if not self.conflicted:
            self.conflicted = True
            winner = copy.deepcopy(body)
            winner.metadata.resource_version = str(
                int(self.secrets[name].metadata.resource_version) + 1)
            self.secrets[name] = winner
            raise kubernetes_exceptions.ApiException(status=409, reason='Conflict')
        return super().replace_namespaced_secret(name, body, namespace)


class PartialRotationFailureCoreApi(FakeCoreApi):
    """Fail one OAuth Secret rotation after the admin Secret advances."""

    def __init__(self) -> None:
        super().__init__()
        self.failed_oauth_rotation = False

    def replace_namespaced_secret(
        self, name: str, body: kubernetes_client.V1Secret, namespace: str,
    ) -> kubernetes_client.V1Secret:
        if name.endswith('-dex-oauth') and not self.failed_oauth_rotation:
            self.failed_oauth_rotation = True
            raise kubernetes_exceptions.ApiException(
                status=500, reason='Temporary failure')
        return super().replace_namespaced_secret(name, body, namespace)


class ScaleDownDuringRestartCoreApi(FakeCoreApi):
    """Replace only two of three deleted Pods to simulate an HPA scale-down."""

    def __init__(self) -> None:
        super().__init__()
        self.deleted_count = 0

    def delete_namespaced_pod(
        self,
        name: str,
        namespace: str,
        body: kubernetes_client.V1DeleteOptions,
    ) -> None:
        self.replace_deleted_pods = self.deleted_count < 2
        super().delete_namespaced_pod(name, namespace, body)
        self.deleted_count += 1


class FailingReadCoreApi(FakeCoreApi):
    """Return an API error whose reason must never reach Job logs."""

    def read_namespaced_secret(
        self, name: str, namespace: str,
    ) -> kubernetes_client.V1Secret:
        del name, namespace
        raise kubernetes_exceptions.ApiException(
            status=500, reason='credential-canary-must-not-be-logged')


class EmbeddedDexBootstrapTest(unittest.TestCase):

    def setUp(self) -> None:
        self.api = FakeCoreApi()

    def reconcile(
        self,
        *,
        allow_initial_generation: bool = True,
        password_generation: int = 1,
        client_generation: int = 1,
        cookie_generation: int = 1,
    ) -> 'embedded_dex_bootstrap.BootstrapResult':
        return embedded_dex_bootstrap.reconcile(
            self.api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='release',
            admin_secret_name='release-dex-admin',
            oauth_secret_name='release-dex-oauth',
            allow_initial_generation=allow_initial_generation,
            password_generation=password_generation,
            client_generation=client_generation,
            cookie_generation=cookie_generation,
        )

    @staticmethod
    def decode(secret: kubernetes_client.V1Secret, key: str) -> bytes:
        return base64.b64decode(secret.data[key], validate=True)

    def test_initial_generation_creates_valid_independent_credentials(self) -> None:
        self.reconcile()

        admin = self.api.secrets['release-dex-admin']
        oauth = self.api.secrets['release-dex-oauth']
        password = self.decode(admin, 'password')
        password_hash = self.decode(admin, 'password-hash')
        self.assertGreaterEqual(len(password), 43)
        self.assertTrue(bcrypt.checkpw(password, password_hash))
        self.assertEqual(int(password_hash.split(b'$')[2]), 12)
        self.assertEqual(len(base64.urlsafe_b64decode(
            self.decode(oauth, 'cookie-secret'))), 32)
        self.assertNotEqual(
            self.decode(oauth, 'browser-client-secret'),
            self.decode(oauth, 'cookie-secret'),
        )
        self.assertEqual(
            admin.metadata.labels['app.kubernetes.io/managed-by'],
            'osmo-embedded-dex-bootstrap',
        )

    def test_equal_generations_preserve_all_secret_bytes(self) -> None:
        self.reconcile()
        original = copy.deepcopy(self.api.secrets)

        self.reconcile()

        self.assertEqual(self.api.secrets, original)

    def test_generations_rotate_only_the_requested_credential(self) -> None:
        self.reconcile()
        old_admin = copy.deepcopy(self.api.secrets['release-dex-admin'])
        old_oauth = copy.deepcopy(self.api.secrets['release-dex-oauth'])

        self.reconcile(password_generation=2, client_generation=1,
                       cookie_generation=2)

        new_admin = self.api.secrets['release-dex-admin']
        new_oauth = self.api.secrets['release-dex-oauth']
        self.assertNotEqual(self.decode(new_admin, 'password'),
                            self.decode(old_admin, 'password'))
        self.assertNotEqual(self.decode(new_admin, 'password-hash'),
                            self.decode(old_admin, 'password-hash'))
        self.assertEqual(self.decode(new_oauth, 'browser-client-secret'),
                         self.decode(old_oauth, 'browser-client-secret'))
        self.assertNotEqual(self.decode(new_oauth, 'cookie-secret'),
                            self.decode(old_oauth, 'cookie-secret'))

    def test_missing_secret_is_rejected_when_initial_generation_is_disabled(self) -> None:
        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'release-dex-admin is missing',
        ):
            self.reconcile(allow_initial_generation=False)

    def test_foreign_or_rolled_back_secret_is_rejected(self) -> None:
        self.reconcile(password_generation=2)
        self.api.secrets['release-dex-admin'].metadata.labels[
            'app.kubernetes.io/instance'
        ] = 'other-release'
        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'is not owned by this release',
        ):
            self.reconcile(password_generation=2)

        self.api.secrets['release-dex-admin'].metadata.labels[
            'app.kubernetes.io/instance'
        ] = 'release'
        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'generation cannot decrease',
        ):
            self.reconcile(password_generation=1)

    def test_malformed_existing_secret_is_rejected_without_replacement(self) -> None:
        self.reconcile()
        original = copy.deepcopy(self.api.secrets['release-dex-admin'])
        self.api.secrets['release-dex-admin'].data['password-hash'] = base64.b64encode(
            b'not-bcrypt').decode('ascii')

        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'contains invalid credentials',
        ):
            self.reconcile()
        self.assertEqual(
            self.api.secrets['release-dex-admin'].data['password'],
            original.data['password'],
        )

    def test_changed_rollout_identity_deletes_only_selected_pods(self) -> None:
        result = self.reconcile()
        self.api.pods = {
            'dex-1': kubernetes_client.V1Pod(metadata=kubernetes_client.V1ObjectMeta(
                name='dex-1', labels={'app': 'dex'})),
            'unrelated': kubernetes_client.V1Pod(metadata=kubernetes_client.V1ObjectMeta(
                name='unrelated', labels={'app': 'api'})),
        }

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='release',
            tracking_secret_names=(
                'release-dex-admin', 'release-dex-oauth'),
            rollout_annotation='osmo.nvidia.com/dex-rollout',
            rollout_identity=result.dex_credential_identity,
            pod_label_selector='app=dex',
        )

        self.assertEqual(self.api.deleted_pods, ['dex-1'])
        self.assertIn('unrelated', self.api.pods)
        for secret_name in ('release-dex-admin', 'release-dex-oauth'):
            self.assertEqual(
                self.api.secrets[secret_name].metadata.annotations[
                    'osmo.nvidia.com/dex-rollout'],
                result.dex_credential_identity)

    def test_equal_rollout_identity_does_not_delete_replacement_pod(self) -> None:
        result = self.reconcile()
        arguments = dict(
            namespace='osmo',
            release_name='release',
            tracking_secret_names=('release-dex-admin', 'release-dex-oauth'),
            rollout_annotation='osmo.nvidia.com/dex-rollout',
            rollout_identity=result.dex_credential_identity,
            pod_label_selector='app=dex',
        )
        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]
        self.api.pods['dex-replacement'] = kubernetes_client.V1Pod(
            metadata=kubernetes_client.V1ObjectMeta(
                name='dex-replacement', labels={'app': 'dex'}))

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]

        self.assertIn('dex-replacement', self.api.pods)
        self.assertEqual(self.api.deleted_pods, [])

    def test_cookie_rotation_preserves_dex_rollout_state(self) -> None:
        result = self.reconcile()
        arguments = dict(
            namespace='osmo',
            release_name='release',
            tracking_secret_names=('release-dex-admin', 'release-dex-oauth'),
            rollout_annotation='osmo.nvidia.com/dex-rollout',
            rollout_identity=result.dex_credential_identity,
            pod_label_selector='app=dex',
        )
        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]
        self.reconcile(cookie_generation=2)
        self.api.pods['dex'] = kubernetes_client.V1Pod(
            metadata=kubernetes_client.V1ObjectMeta(
                name='dex', labels={'app': 'dex'}))

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]

        self.assertIn('dex', self.api.pods)

    def test_password_rotation_preserves_config_rollout_state(self) -> None:
        self.reconcile()
        arguments = dict(
            namespace='osmo',
            release_name='release',
            tracking_secret_names=('release-dex-admin',),
            rollout_annotation='osmo.nvidia.com/config-rollout',
            rollout_identity='config-v1',
            pod_label_selector='app=dex',
        )
        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]
        self.reconcile(password_generation=2)
        self.api.pods['dex'] = kubernetes_client.V1Pod(
            metadata=kubernetes_client.V1ObjectMeta(
                name='dex', labels={'app': 'dex'}))

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api, **arguments)  # type: ignore[arg-type]

        self.assertIn('dex', self.api.pods)

    def test_rollout_records_identity_when_pods_do_not_exist_yet(self) -> None:
        self.reconcile()

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='release',
            tracking_secret_names=('release-dex-admin',),
            rollout_annotation='osmo.nvidia.com/config-rollout',
            rollout_identity='config-v1',
            pod_label_selector='app=dex',
        )

        self.assertEqual(
            self.api.secrets['release-dex-admin'].metadata.annotations[
                'osmo.nvidia.com/config-rollout'], 'config-v1')

    def test_rollout_failure_does_not_record_identity_before_replacement_ready(
        self,
    ) -> None:
        result = self.reconcile()
        self.api.replace_deleted_pods = False
        self.api.pods['dex'] = kubernetes_client.V1Pod(
            metadata=kubernetes_client.V1ObjectMeta(
                name='dex', uid='old-uid', labels={'app': 'dex'}),
            status=kubernetes_client.V1PodStatus(conditions=[
                kubernetes_client.V1PodCondition(type='Ready', status='True'),
            ]),
        )

        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'did not become ready',
        ):
            embedded_dex_bootstrap.restart_pods_if_needed(
                self.api,  # type: ignore[arg-type]
                namespace='osmo',
                release_name='release',
                tracking_secret_names=(
                    'release-dex-admin', 'release-dex-oauth'),
                rollout_annotation='osmo.nvidia.com/dex-rollout',
                rollout_identity=result.dex_credential_identity,
                pod_label_selector='app=dex',
                restart_timeout_seconds=0,
            )
        for secret_name in ('release-dex-admin', 'release-dex-oauth'):
            self.assertNotIn(
                'osmo.nvidia.com/dex-rollout',
                self.api.secrets[secret_name].metadata.annotations,
            )

    def test_rollout_accepts_ready_scaled_down_replacement_cohort(self) -> None:
        self.api = ScaleDownDuringRestartCoreApi()
        result = self.reconcile()
        for index in range(3):
            name = f'oauth-{index}'
            self.api.pods[name] = kubernetes_client.V1Pod(
                metadata=kubernetes_client.V1ObjectMeta(
                    name=name, uid=f'{name}-uid', labels={'app': 'oauth'}),
                status=kubernetes_client.V1PodStatus(conditions=[
                    kubernetes_client.V1PodCondition(
                        type='Ready', status='True'),
                ]),
            )

        embedded_dex_bootstrap.restart_pods_if_needed(
            self.api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='release',
            tracking_secret_names=('release-dex-oauth',),
            rollout_annotation='osmo.nvidia.com/oauth-rollout',
            rollout_identity=result.oauth_credential_identity,
            pod_label_selector='app=oauth',
            restart_timeout_seconds=0,
        )

        self.assertEqual(2, len(self.api.pods))
        self.assertEqual(
            result.oauth_credential_identity,
            self.api.secrets['release-dex-oauth'].metadata.annotations[
                'osmo.nvidia.com/oauth-rollout'],
        )

    def test_concurrent_create_is_re_read_and_preserved(self) -> None:
        self.api = ConcurrentCreateCoreApi()

        self.reconcile()

        self.assertIn('release-dex-admin', self.api.secrets)
        self.assertIn('release-dex-oauth', self.api.secrets)

    def test_same_generation_recreation_changes_only_affected_rollout_identity(
        self,
    ) -> None:
        original = self.reconcile()
        del self.api.secrets['release-dex-admin']

        recreated = self.reconcile()

        self.assertNotEqual(
            recreated.dex_credential_identity,
            original.dex_credential_identity)
        self.assertEqual(
            recreated.oauth_credential_identity,
            original.oauth_credential_identity)

    def test_concurrent_replace_is_re_read_and_converges(self) -> None:
        self.api = ConcurrentReplaceCoreApi()
        self.reconcile()

        result = self.reconcile(password_generation=2)

        self.assertTrue(self.api.conflicted)
        self.assertEqual(
            result.dex_credential_identity,
            embedded_dex_bootstrap.credential_identity(
                'dex',
                self.decode(self.api.secrets['release-dex-admin'], 'password-hash'),
                self.decode(
                    self.api.secrets['release-dex-oauth'],
                    'browser-client-secret'),
            ))

    def test_partial_rotation_failure_converges_without_rerotating_admin(
        self,
    ) -> None:
        self.api = PartialRotationFailureCoreApi()
        self.reconcile()

        with self.assertRaisesRegex(
            embedded_dex_bootstrap.BootstrapError,
            'Unable to write credential Secret release-dex-oauth',
        ):
            self.reconcile(
                password_generation=2,
                client_generation=2,
                cookie_generation=2)
        rotated_admin = copy.deepcopy(
            self.api.secrets['release-dex-admin'].data)

        self.reconcile(
            password_generation=2,
            client_generation=2,
            cookie_generation=2)

        self.assertEqual(
            self.api.secrets['release-dex-admin'].data,
            rotated_admin)
        self.assertEqual(
            self.api.secrets['release-dex-oauth'].metadata.annotations,
            {
                'osmo.nvidia.com/browser-client-secret-generation': '2',
                'osmo.nvidia.com/cookie-secret-generation': '2',
            })

    def test_argument_parser_rejects_nonpositive_generation(self) -> None:
        arguments = [
            '--namespace', 'osmo',
            '--release-name', 'release',
            '--admin-secret-name', 'release-dex-admin',
            '--oauth-secret-name', 'release-dex-oauth',
            '--password-generation', '0',
            '--client-generation', '1',
            '--cookie-generation', '1',
            '--dex-pod-selector', 'app=dex',
            '--oauth-pod-selector', 'app=oauth2-proxy',
        ]

        with (
            contextlib.redirect_stderr(io.StringIO()),
            self.assertRaises(SystemExit),
        ):
            embedded_dex_bootstrap._parse_arguments(arguments)

    def test_main_reports_api_failure_without_logging_error_body(self) -> None:
        arguments = types.SimpleNamespace(
            namespace='osmo',
            release_name='release',
            admin_secret_name='release-dex-admin',
            oauth_secret_name='release-dex-oauth',
            allow_initial_generation=True,
            password_generation=1,
            client_generation=1,
            cookie_generation=1,
            dex_pod_selector='app=dex',
            oauth_pod_selector='app=oauth2-proxy',
            restart_timeout_seconds=120,
            config_rollout_identity=None,
        )
        with (
            mock.patch.object(
                embedded_dex_bootstrap, '_parse_arguments',
                return_value=arguments),
            mock.patch.object(
                embedded_dex_bootstrap.kubernetes_config,
                'load_incluster_config'),
            mock.patch.object(
                embedded_dex_bootstrap.kubernetes_client,
                'CoreV1Api', return_value=FailingReadCoreApi()),
            self.assertLogs(level='ERROR') as logs,
            self.assertRaises(SystemExit),
        ):
            embedded_dex_bootstrap.main()

        self.assertNotIn(
            'credential-canary-must-not-be-logged', '\n'.join(logs.output))

    def test_main_shares_timeout_across_sequential_rollouts(self) -> None:
        arguments = types.SimpleNamespace(
            namespace='osmo',
            release_name='release',
            admin_secret_name='release-dex-admin',
            oauth_secret_name='release-dex-oauth',
            allow_initial_generation=True,
            password_generation=1,
            client_generation=1,
            cookie_generation=1,
            dex_pod_selector='app=dex',
            oauth_pod_selector='app=oauth2-proxy',
            restart_timeout_seconds=120,
            config_rollout_identity='config-v1',
        )
        result = types.SimpleNamespace(
            dex_credential_identity='dex-v1',
            oauth_credential_identity='oauth-v1',
        )
        observed_timeouts = []

        def observe_restart(*unused_arguments, **keyword_arguments):
            observed_timeouts.append(
                keyword_arguments['restart_timeout_seconds'])

        with (
            mock.patch.object(
                embedded_dex_bootstrap, '_parse_arguments',
                return_value=arguments),
            mock.patch.object(
                embedded_dex_bootstrap.kubernetes_config,
                'load_incluster_config'),
            mock.patch.object(
                embedded_dex_bootstrap.kubernetes_client,
                'CoreV1Api', return_value=FakeCoreApi()),
            mock.patch.object(
                embedded_dex_bootstrap, 'reconcile', return_value=result),
            mock.patch.object(
                embedded_dex_bootstrap, 'restart_pods_if_needed',
                side_effect=observe_restart),
            mock.patch.object(
                embedded_dex_bootstrap.time, 'monotonic',
                side_effect=[100, 110, 150, 210]),
        ):
            embedded_dex_bootstrap.main()

        self.assertEqual([110, 70, 10], observed_timeouts)


if __name__ == '__main__':
    unittest.main()
