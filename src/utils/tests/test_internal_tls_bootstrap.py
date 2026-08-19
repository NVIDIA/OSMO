"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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
import datetime
from types import SimpleNamespace
import unittest
from unittest import mock

from cryptography import x509
from kubernetes import client as kubernetes_client  # type: ignore
from kubernetes.client import exceptions as kubernetes_exceptions  # type: ignore

from src.utils import internal_tls_bootstrap


class FakeCoreApi:
    """Minimal in-memory CoreV1Api used by the reconciler tests."""

    def __init__(self) -> None:
        self.secrets: dict[str, kubernetes_client.V1Secret] = {}

    def add_placeholder(self, name: str, release_name: str = 'test') -> None:
        self.secrets[name] = kubernetes_client.V1Secret(
            metadata=kubernetes_client.V1ObjectMeta(
                name=name,
                labels={
                    'app.kubernetes.io/managed-by': (
                        'osmo-internal-tls-bootstrap'
                    ),
                    'app.kubernetes.io/instance': release_name,
                },
            ),
            data={},
            type='Opaque',
        )

    def read_namespaced_secret(
        self,
        name: str,
        namespace: str,
    ) -> kubernetes_client.V1Secret:
        del namespace
        return self.secrets[name]

    def patch_namespaced_secret(
        self,
        name: str,
        namespace: str,
        body: dict[str, object],
    ) -> kubernetes_client.V1Secret:
        del namespace
        secret = self.secrets[name]
        secret.data = body['data']  # type: ignore[assignment]
        secret.type = body['type']  # type: ignore[assignment]
        return secret


class InternalTlsBootstrapTest(unittest.TestCase):
    def setUp(self) -> None:
        self.api = FakeCoreApi()
        for name in ('ca', 'trust', 'leaf'):
            self.api.add_placeholder(name)
        self.now = datetime.datetime(2026, 8, 18, tzinfo=datetime.UTC)

    def reconcile(
        self,
        phase: str = 'stable',
        rotation_id: str = '',
        fail_if_missing: bool = False,
    ) -> None:
        internal_tls_bootstrap.reconcile(
            self.api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='test',
            ca_secret_name='ca',
            trust_secret_name='trust',
            leaf_specs=[internal_tls_bootstrap.LeafSpec('leaf', 'osmo-api')],
            leaf_rotation_nonce='leaf-v1',
            ca_rotation_id=rotation_id,
            ca_rotation_phase=phase,
            fail_if_missing=fail_if_missing,
            now=self.now,
            rollout_verified=phase != 'stable',
        )

    def secret_value(self, secret_name: str, key: str) -> bytes:
        secret = self.api.secrets[secret_name]
        self.assertIsNotNone(secret.data)
        encoded = secret.data[key]  # type: ignore[index]
        return base64.b64decode(encoded)

    def test_write_failure_reports_sanitized_api_status(self) -> None:
        with mock.patch.object(
            self.api,
            'patch_namespaced_secret',
            side_effect=kubernetes_exceptions.ApiException(
                status=403,
                reason='Forbidden',
            ),
        ), self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            r'ca: Kubernetes API 403 Forbidden',
        ):
            self.reconcile()

    def test_initial_bootstrap_generates_stable_ca_trust_and_leaf(self) -> None:
        self.reconcile()
        initial_ca = self.secret_value('ca', 'ca.crt')
        initial_leaf = self.secret_value('leaf', 'tls.crt')

        self.reconcile()

        self.assertEqual(self.secret_value('ca', 'ca.crt'), initial_ca)
        self.assertEqual(self.secret_value('trust', 'ca.crt'), initial_ca)
        self.assertEqual(self.secret_value('leaf', 'tls.crt'), initial_leaf)
        certificate = x509.load_pem_x509_certificate(initial_leaf)
        alternative_names = certificate.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value.get_values_for_type(x509.DNSName)
        self.assertEqual(
            alternative_names,
            ['osmo-api', 'osmo-api.osmo', 'osmo-api.osmo.svc'],
        )
        self.assertEqual(getattr(self.api.secrets['leaf'], 'type'), 'kubernetes.io/tls')

    def test_ca_rotation_preserves_dual_trust_across_prepare_activate(self) -> None:
        self.reconcile()
        original_ca = self.secret_value('ca', 'ca.crt')
        original_leaf = self.secret_value('leaf', 'tls.crt')

        self.reconcile('prepare', 'ca-2026-09')
        self.reconcile('prepare', 'ca-2026-09')
        prepared_bundle = x509.load_pem_x509_certificates(
            self.secret_value('trust', 'ca.crt')
        )
        self.assertEqual(len(prepared_bundle), 2)
        self.assertEqual(self.secret_value('leaf', 'tls.crt'), original_leaf)

        self.reconcile('activate', 'ca-2026-09')
        self.reconcile('activate', 'ca-2026-09')
        activated_bundle = x509.load_pem_x509_certificates(
            self.secret_value('trust', 'ca.crt')
        )
        self.assertEqual(len(activated_bundle), 2)
        self.assertNotEqual(self.secret_value('ca', 'ca.crt'), original_ca)
        self.assertNotEqual(self.secret_value('leaf', 'tls.crt'), original_leaf)

        self.reconcile('retire', 'ca-2026-09')
        retired_bundle = x509.load_pem_x509_certificates(
            self.secret_value('trust', 'ca.crt')
        )
        self.assertEqual(len(retired_bundle), 1)
        self.assertNotIn('previous-ca.crt', getattr(self.api.secrets['ca'], 'data'))

        # The retained Helm value remains safe on later upgrades.
        self.reconcile('retire', 'ca-2026-09')

    def test_ca_rotation_cannot_retire_a_prepared_ca(self) -> None:
        self.reconcile()
        self.reconcile('prepare', 'ca-2026-09')

        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'activated first',
        ):
            self.reconcile('retire', 'ca-2026-09')

    def test_ca_rotation_cannot_retire_with_an_old_leaf(self) -> None:
        self.reconcile()
        old_leaf_data = dict(getattr(self.api.secrets['leaf'], 'data'))
        self.reconcile('prepare', 'ca-2026-09')
        self.reconcile('activate', 'ca-2026-09')
        setattr(self.api.secrets['leaf'], 'data', old_leaf_data)

        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'every leaf Secret to use the active CA',
        ):
            self.reconcile('retire', 'ca-2026-09')

        trust_bundle = x509.load_pem_x509_certificates(
            self.secret_value('trust', 'ca.crt')
        )
        self.assertEqual(len(trust_bundle), 2)

    def test_upgrade_never_regenerates_a_missing_ca(self) -> None:
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'incomplete; restore it',
        ):
            self.reconcile(fail_if_missing=True)

    def test_replaces_leaf_that_is_not_signed_by_the_retained_ca(self) -> None:
        self.reconcile()
        rogue_ca = internal_tls_bootstrap._generate_ca(self.now)  # pylint: disable=protected-access
        rogue_leaf = internal_tls_bootstrap._generate_leaf(  # pylint: disable=protected-access
            rogue_ca,
            'osmo-api',
            'osmo',
            self.now,
        )
        leaf_secret = self.api.secrets['leaf']
        setattr(
            leaf_secret,
            'data',
            internal_tls_bootstrap._encode_secret_data(  # pylint: disable=protected-access
                {
                    'tls.crt': rogue_leaf.certificate,
                    'tls.key': rogue_leaf.private_key,
                    'rotation-nonce': b'leaf-v1',
                }
            ),
        )

        self.reconcile(fail_if_missing=True)

        self.assertNotEqual(self.secret_value('leaf', 'tls.crt'), rogue_leaf.certificate)

    def test_replaces_leaf_with_the_wrong_dns_identity(self) -> None:
        self.reconcile()
        ca = internal_tls_bootstrap.KeyPair(
            self.secret_value('ca', 'ca.crt'),
            self.secret_value('ca', 'ca.key'),
        )
        wrong_leaf = internal_tls_bootstrap._generate_leaf(  # pylint: disable=protected-access
            ca,
            'wrong-service',
            'osmo',
            self.now,
        )
        leaf_secret = self.api.secrets['leaf']
        setattr(
            leaf_secret,
            'data',
            internal_tls_bootstrap._encode_secret_data(  # pylint: disable=protected-access
                {
                    'tls.crt': wrong_leaf.certificate,
                    'tls.key': wrong_leaf.private_key,
                    'rotation-nonce': b'leaf-v1',
                }
            ),
        )

        self.reconcile(fail_if_missing=True)

        self.assertNotEqual(self.secret_value('leaf', 'tls.crt'), wrong_leaf.certificate)

    def test_refuses_secret_owned_by_another_release(self) -> None:
        self.api.add_placeholder('ca', release_name='other')
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'not owned by release test',
        ):
            self.reconcile()

    def test_rotation_requires_durable_rollout_proof(self) -> None:
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'requires verified consumer rollout state',
        ):
            internal_tls_bootstrap.reconcile(
                self.api,  # type: ignore[arg-type]
                namespace='osmo',
                release_name='test',
                ca_secret_name='ca',
                trust_secret_name='trust',
                leaf_specs=[internal_tls_bootstrap.LeafSpec('leaf', 'osmo-api')],
                leaf_rotation_nonce='leaf-v1',
                ca_rotation_id='ca-2026-09',
                ca_rotation_phase='prepare',
                fail_if_missing=False,
                now=self.now,
            )


class RolloutVerificationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.annotation = 'ca-2026-09:prepare'
        self.deployment = SimpleNamespace(
            metadata=SimpleNamespace(generation=3),
            spec=SimpleNamespace(
                replicas=2,
                selector=SimpleNamespace(match_labels={'app': 'api'}),
            ),
            status=SimpleNamespace(
                observed_generation=3,
                replicas=2,
                updated_replicas=2,
                ready_replicas=2,
                available_replicas=2,
                unavailable_replicas=0,
            ),
        )
        self.pods = [
            SimpleNamespace(
                metadata=SimpleNamespace(
                    annotations={
                        'checksum/internal-tls-ca-phase': self.annotation
                    },
                    deletion_timestamp=None,
                ),
                status=SimpleNamespace(phase='Running'),
            )
            for _ in range(2)
        ]

    def verify(self, *, hpas: list[object] | None = None) -> None:
        core_api = SimpleNamespace(
            list_namespaced_pod=lambda **_kwargs: SimpleNamespace(items=self.pods)
        )
        apps_api = SimpleNamespace(
            read_namespaced_deployment=lambda **_kwargs: self.deployment
        )
        autoscaling_api = SimpleNamespace(
            list_namespaced_horizontal_pod_autoscaler=lambda **_kwargs: (
                SimpleNamespace(items=hpas or [])
            )
        )
        internal_tls_bootstrap.verify_rollout(
            core_api,  # type: ignore[arg-type]
            apps_api,  # type: ignore[arg-type]
            autoscaling_api,  # type: ignore[arg-type]
            namespace='osmo',
            deployment_names=['osmo-api'],
            allowed_annotations={self.annotation},
        )

    def test_accepts_one_complete_frozen_generation(self) -> None:
        self.verify()

    def test_rejects_a_partial_rollout(self) -> None:
        self.deployment.status.updated_replicas = 1
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'complete consumer rollout',
        ):
            self.verify()

    def test_rejects_an_unfrozen_hpa(self) -> None:
        hpa = SimpleNamespace(
            spec=SimpleNamespace(
                scale_target_ref=SimpleNamespace(kind='Deployment', name='osmo-api'),
                min_replicas=1,
                max_replicas=3,
            )
        )
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'HPA to be frozen',
        ):
            self.verify(hpas=[hpa])

    def test_rejects_a_pod_from_the_wrong_phase(self) -> None:
        self.pods[0].metadata.annotations[
            'checksum/internal-tls-ca-phase'
        ] = 'ca-2026-09:stable'
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'wrong phase',
        ):
            self.verify()

    def verify_transition(
        self,
        *,
        stored_phase: str,
        pod_annotations: list[str],
        requested_phase: str = 'activate',
    ) -> None:
        encoded = internal_tls_bootstrap._encode_secret_data(  # pylint: disable=protected-access
            {
                'rotation-id': b'ca-2026-09',
                'rotation-phase': stored_phase.encode('utf-8'),
            }
        )
        secret = SimpleNamespace(
            metadata=SimpleNamespace(
                name='ca',
                labels={
                    'app.kubernetes.io/managed-by': (
                        'osmo-internal-tls-bootstrap'
                    ),
                    'app.kubernetes.io/instance': 'test',
                },
            ),
            data=encoded,
        )
        pods = [
            SimpleNamespace(
                metadata=SimpleNamespace(
                    annotations={'checksum/internal-tls-ca-phase': annotation},
                    deletion_timestamp=None,
                ),
                status=SimpleNamespace(phase='Running'),
            )
            for annotation in pod_annotations
        ]
        core_api = SimpleNamespace(
            read_namespaced_secret=lambda **_kwargs: secret,
            list_namespaced_pod=lambda **_kwargs: SimpleNamespace(items=pods),
        )
        apps_api = SimpleNamespace(
            read_namespaced_deployment=lambda **_kwargs: self.deployment
        )
        autoscaling_api = SimpleNamespace(
            list_namespaced_horizontal_pod_autoscaler=lambda **_kwargs: (
                SimpleNamespace(items=[])
            )
        )
        internal_tls_bootstrap.verify_transition_rollout(
            core_api,  # type: ignore[arg-type]
            apps_api,  # type: ignore[arg-type]
            autoscaling_api,  # type: ignore[arg-type]
            namespace='osmo',
            release_name='test',
            ca_secret_name='ca',
            deployment_names=['osmo-api'],
            requested_rotation_id='ca-2026-09',
            requested_phase=requested_phase,
        )

    def test_transition_accepts_complete_predecessor_generation(self) -> None:
        self.verify_transition(
            stored_phase='prepare',
            pod_annotations=['ca-2026-09:prepare'] * 2,
        )

    def test_transition_retry_accepts_only_predecessor_and_target_pods(self) -> None:
        self.deployment.status.updated_replicas = 1
        self.deployment.status.ready_replicas = 1
        self.deployment.status.available_replicas = 1
        self.deployment.status.unavailable_replicas = 1
        self.verify_transition(
            stored_phase='activate',
            pod_annotations=[
                'ca-2026-09:prepare',
                'ca-2026-09:activate',
            ],
        )

    def test_transition_retry_accepts_completed_target_generation(self) -> None:
        self.verify_transition(
            stored_phase='activate',
            pod_annotations=['ca-2026-09:activate'] * 2,
        )

    def test_retire_retry_accepts_partial_target_generation(self) -> None:
        self.deployment.status.updated_replicas = 1
        self.deployment.status.ready_replicas = 1
        self.deployment.status.available_replicas = 1
        self.deployment.status.unavailable_replicas = 1
        self.verify_transition(
            stored_phase='retire',
            requested_phase='retire',
            pod_annotations=[
                'ca-2026-09:activate',
                'ca-2026-09:retire',
            ],
        )

    def test_transition_retry_rejects_unrelated_mixed_generation(self) -> None:
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'wrong phase',
        ):
            self.verify_transition(
                stored_phase='activate',
                pod_annotations=[
                    'ca-2026-09:prepare',
                    'other:retire',
                ],
            )

    def test_transition_rejects_skipped_durable_phase(self) -> None:
        with self.assertRaisesRegex(
            internal_tls_bootstrap.BootstrapError,
            'requires the durable prepare phase',
        ):
            self.verify_transition(
                stored_phase='stable',
                pod_annotations=['ca-2026-09:stable'] * 2,
            )


if __name__ == '__main__':
    unittest.main()
