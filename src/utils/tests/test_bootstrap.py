# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Safety contracts for ordinary-Job initialization and application file gates."""

import base64
import copy
import dataclasses
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

from kubernetes import client
from kubernetes.client.exceptions import ApiException

from src.utils import bootstrap, identity_bootstrap


def configuration(initialization_id: str = '') -> bootstrap.Configuration:
    return bootstrap.Configuration(
        'namespace',
        'release',
        'record',
        'generation',
        initialization_id,
        [bootstrap.SecretSpec('root', 'tls', 'owner', ['key'])],
        ['api'],
        ['tls'],
    )


def secret(value: bytes = b'credential', uid: str = 'secret-uid') -> client.V1Secret:
    return client.V1Secret(
        metadata=client.V1ObjectMeta(
            uid=uid,
            labels={
                'app.kubernetes.io/instance': 'release',
                'app.kubernetes.io/managed-by': 'owner',
            },
        ),
        data={'key': base64.b64encode(value).decode()},
    )


class CoordinatorTests(unittest.TestCase):
    """Prove retained credentials and execution ownership survive retries safely."""

    def setUp(self) -> None:
        self.core = mock.Mock()
        self.apps = mock.Mock()
        self.coordination = mock.Mock()
        self.runtime = bootstrap.Coordinator(
            configuration(), self.core, self.apps, self.coordination, 'pod', 'uid'
        )
        self.core.read_namespaced_secret.return_value = secret()
        self.coordination.read_namespaced_lease.return_value = client.V1Lease(
            metadata=client.V1ObjectMeta(resource_version='1'),
            spec=client.V1LeaseSpec(holder_identity='pod/uid'),
        )
        self.state = {
            'installation': 'namespace/release',
            'podUID': 'uid',
            'generation': 'generation',
            'credentialsReady': True,
            'complete': False,
            'intents': {},
            'receipts': {},
            'committed': {},
        }
        self.set_state()

    def set_state(self) -> None:
        self.core.read_namespaced_config_map.return_value = client.V1ConfigMap(
            metadata=client.V1ObjectMeta(resource_version='3'),
            data={'state.json': json.dumps(self.state)},
        )

        def persist(*args, **_kwargs):
            self.core.read_namespaced_config_map.return_value = copy.deepcopy(args[2])
            return copy.deepcopy(args[2])

        self.core.replace_namespaced_config_map.side_effect = persist

    def test_absence_is_not_initialization_authorization(self) -> None:
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'initializationId'):
            bootstrap.initialization_mode(configuration(), {})
        self.assertEqual(
            bootstrap.initialization_mode(configuration('new-install'), {}),
            'initialize',
        )

    def test_complete_inventory_adopts_without_initialization_authorization(
        self,
    ) -> None:
        self.assertEqual(
            bootstrap.initialization_mode(configuration(), {'root': {}}), 'adopt'
        )

    def test_legacy_tokens_require_migration_before_strict_adoption(self) -> None:
        for manager in ('osmo-backend-token-bootstrap', 'osmo-embedded-dex-bootstrap'):
            with self.subTest(manager=manager):
                retained = secret(b't' * 43)
                retained.metadata.name = 'root'
                retained.metadata.resource_version = '1'
                retained.metadata.labels['app.kubernetes.io/managed-by'] = manager
                retained.type = 'Opaque'
                retained.data = {'token': retained.data['key']}
                before = copy.deepcopy(retained.data)
                self.runtime.configuration = dataclasses.replace(
                    configuration(),
                    steps=['identity'],
                    secrets=[
                        bootstrap.SecretSpec(
                            'root', 'identity', 'osmo-identity-bootstrap', ['token']
                        )
                    ],
                )
                self.core.read_namespaced_secret.return_value = retained
                self.core.read_namespaced_config_map.side_effect = ApiException(
                    status=404
                )
                with self.assertRaisesRegex(
                    bootstrap.BootstrapError, 'unexpected ownership'
                ):
                    self.runtime.begin()

                def patch(name, namespace, body, retained=retained):
                    del name, namespace
                    self.assertEqual(body[0]['value'], retained.metadata.uid)
                    retained.metadata.labels['app.kubernetes.io/managed-by'] = body[2][
                        'value'
                    ]
                    retained.metadata.resource_version = '2'

                self.core.patch_namespaced_secret.side_effect = patch
                identity_bootstrap.migrate_tokens(
                    self.core,
                    namespace='namespace',
                    release_name='release',
                    token_specs=(
                        identity_bootstrap.TokenSpec('identity', 'primary', 'root'),
                    ),
                )
                self.core.create_namespaced_config_map.side_effect = (
                    lambda *args, **_kw: args[1]
                )
                self.runtime.begin()
                self.assertEqual(self.runtime.state['mode'], 'adopt')
                self.assertEqual(
                    self.runtime.state['adopted'], {'root': retained.metadata.uid}
                )
                self.assertEqual(retained.data, before)

    def test_adoption_plus_new_identity_is_rejected(self) -> None:
        changed = dataclasses.replace(
            configuration(),
            secrets=configuration().secrets
            + [bootstrap.SecretSpec('new-identity', 'identity', 'owner', ['token'])],
        )
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'Adopt before changing'):
            bootstrap.initialization_mode(changed, {'root': {}})

    def test_committed_loss_rejects_even_with_initialization_authorization(
        self,
    ) -> None:
        self.runtime.configuration = configuration('still-configured')
        self.state['committed'] = {'root': {'uid': 'secret-uid', 'keys': {}}}
        self.set_state()
        self.core.read_namespaced_secret.side_effect = ApiException(status=404)
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'Committed credential'):
            self.runtime.begin()
        self.core.create_namespaced_config_map.assert_not_called()

    def test_replaced_secret_uid_is_not_an_exact_retry(self) -> None:
        original = bootstrap.secret_identity(
            secret(), configuration().secrets[0], 'release'
        )
        replacement = bootstrap.secret_identity(
            secret(uid='new'), configuration().secrets[0], 'release'
        )
        with self.assertRaises(bootstrap.BootstrapError):
            bootstrap.verify_committed({'root': original}, {'root': replacement})

    def test_crash_after_issuance_preserves_existing_bytes(self) -> None:
        # An issuance intent survives; the Secret exists but there is no step receipt.
        self.state['intents'] = {'root': 'previous-pod'}
        self.set_state()
        before = copy.deepcopy(self.core.read_namespaced_secret.return_value.data)
        with mock.patch.object(bootstrap.subprocess, 'run') as reconcile:
            self.runtime.step('tls', ['validator'])
        reconcile.assert_called_once_with(['validator'], check=True)
        self.assertEqual(before, self.core.read_namespaced_secret.return_value.data)
        saved = json.loads(
            self.core.replace_namespaced_config_map.call_args.args[2].data['state.json']
        )
        self.assertEqual(saved['committed']['root']['uid'], 'secret-uid')
        self.assertEqual(saved['receipts']['tls']['podUID'], 'uid')

    def test_live_lease_owner_is_not_stolen(self) -> None:
        self.coordination.read_namespaced_lease.return_value.spec.holder_identity = (
            'old/old-uid'
        )
        self.core.read_namespaced_pod.return_value = client.V1Pod(
            metadata=client.V1ObjectMeta(uid='old-uid'),
            status=client.V1PodStatus(phase='Running'),
        )
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'still live'):
            self.runtime.acquire()
        self.coordination.patch_namespaced_lease.assert_not_called()

    def test_stranded_terminal_lease_requires_explicit_recovery(self) -> None:
        self.coordination.read_namespaced_lease.return_value.spec.holder_identity = (
            'old/old-uid'
        )
        for phase, reason in [
            ('Failed', None),
            ('Failed', 'NodeLost'),
            ('Failed', 'ContainerStatusUnknown'),
            ('Failed', 'OOMKilled'),
            ('Failed', 'Error'),
            ('Succeeded', 'Completed'),
        ]:
            with self.subTest(phase=phase, reason=reason):
                self.core.read_namespaced_pod.return_value = client.V1Pod(
                    metadata=client.V1ObjectMeta(uid='old-uid'),
                    status=client.V1PodStatus(phase=phase, reason=reason),
                )
                with self.assertRaisesRegex(bootstrap.BootstrapError, 'held Lease'):
                    self.runtime.acquire()
        self.coordination.patch_namespaced_lease.assert_not_called()

    def test_unheld_or_same_pod_lease_is_acquired_with_cas(self) -> None:
        for holder in (None, 'pod/uid'):
            with self.subTest(holder=holder):
                self.coordination.read_namespaced_lease.return_value.spec.holder_identity = holder
                self.runtime.acquire()
                body = self.coordination.patch_namespaced_lease.call_args.args[2]
                self.assertEqual(body['metadata']['resourceVersion'], '1')
                self.assertEqual(body['spec']['holderIdentity'], 'pod/uid')
        self.core.read_namespaced_pod.assert_not_called()

    def test_disappeared_pod_is_not_proof_of_termination(self) -> None:
        self.coordination.read_namespaced_lease.return_value.spec.holder_identity = (
            'old/old-uid'
        )
        self.core.read_namespaced_pod.side_effect = ApiException(status=404)
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'terminal proof'):
            self.runtime.acquire()

    def test_optional_previous_token_is_verified_and_copied_when_present(self) -> None:
        specification = bootstrap.SecretSpec(
            'root', 'tls', 'owner', ['key'], optional_keys=['previous-token']
        )
        value = secret()
        for present in (False, True):
            with (
                self.subTest(present=present),
                tempfile.TemporaryDirectory() as directory,
            ):
                if present:
                    value.data['previous-token'] = base64.b64encode(
                        b'previous'
                    ).decode()
                self.core.read_namespaced_secret.return_value = value
                self.state['files'] = {
                    'root': bootstrap.secret_identity(value, specification, 'release')
                }
                self.set_state()
                path = Path(directory, 'previous-token')
                mappings = [
                    {
                        'secret': 'root',
                        'key': 'previous-token',
                        'optional': True,
                        'path': str(path),
                    }
                ]
                self.runtime.snapshot(mappings)
                self.assertEqual(path.exists(), present)
                if present:
                    self.assertEqual(path.read_bytes(), b'previous')
                value.data['previous-token'] = base64.b64encode(b'unverified').decode()
                with self.assertRaises(bootstrap.BootstrapError):
                    self.runtime.snapshot(mappings)
                value.data.pop('previous-token')
                if present:
                    with self.assertRaises(bootstrap.BootstrapError):
                        self.runtime.snapshot(mappings)

    def test_snapshot_copies_only_verified_bytes(self) -> None:
        self.state['files'] = self.runtime.inventory()
        self.set_state()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential'
            self.runtime.snapshot([{'secret': 'root', 'key': 'key', 'path': str(path)}])
            self.assertEqual(path.read_bytes(), b'credential')
            self.core.read_namespaced_secret.return_value = secret(b'other-generation')
            with self.assertRaisesRegex(
                bootstrap.BootstrapError, 'verified credential'
            ):
                self.runtime.snapshot(
                    [{'secret': 'root', 'key': 'key', 'path': str(path)}]
                )
            self.assertEqual(path.read_bytes(), b'credential')

    def test_gate_does_not_wait_for_job_completion(self) -> None:
        self.runtime.snapshot([])
        self.assertFalse(self.state['complete'])

    def test_wrong_generation_blocks_gate(self) -> None:
        self.state['generation'] = 'previous'
        self.set_state()
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'generation'):
            self.runtime.snapshot([])

    def test_empty_rollout_is_not_success_when_replicas_desired(self) -> None:
        deployment = types.SimpleNamespace(
            metadata=types.SimpleNamespace(generation=2),
            spec=types.SimpleNamespace(
                replicas=1,
                template=types.SimpleNamespace(
                    metadata=types.SimpleNamespace(
                        annotations={bootstrap.GENERATION: 'generation'}
                    )
                ),
            ),
            status=types.SimpleNamespace(
                observed_generation=2,
                replicas=0,
                updated_replicas=0,
                ready_replicas=0,
                available_replicas=0,
            ),
        )
        self.apps.read_namespaced_deployment.return_value = deployment
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'rollout'):
            self.runtime.complete()
        deployment.spec.replicas = 0
        self.runtime.complete()
        self.assertTrue(self.runtime.state['complete'])

    def test_lost_lease_cannot_publish_readiness(self) -> None:
        self.runtime.load()
        self.coordination.read_namespaced_lease.return_value.spec.holder_identity = (
            'new/new-uid'
        )
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'ownership changed'):
            self.runtime.save()
        self.core.replace_namespaced_config_map.assert_not_called()

    def test_disabling_step_does_not_read_or_execute_it(self) -> None:
        self.state['committed'] = {'disabled': {'uid': 'retained', 'keys': {}}}
        self.set_state()
        self.runtime.begin()
        self.assertEqual(self.core.read_namespaced_secret.call_args.args[0], 'root')
        self.assertIn('disabled', self.runtime.state['committed'])

    def test_partial_crash_reconciler_cannot_replace_issued_secret(self) -> None:
        self.state['intents'] = {'root': 'previous-pod'}
        self.set_state()

        def replace(*_args, **_kwargs):
            self.core.read_namespaced_secret.return_value = secret(b'regenerated')

        with mock.patch.object(bootstrap.subprocess, 'run', side_effect=replace):
            with self.assertRaisesRegex(
                bootstrap.BootstrapError, 'Committed credential'
            ):
                self.runtime.step('tls', ['bad-reconciler'])
        self.assertEqual(self.runtime.state['committed'], {})

    def test_missing_partial_credential_is_ambiguous_and_fails_closed(self) -> None:
        self.state['intents'] = {'root': 'previous-pod'}
        self.set_state()
        self.core.read_namespaced_secret.side_effect = ApiException(status=404)
        with mock.patch.object(bootstrap.subprocess, 'run') as reconcile:
            with self.assertRaisesRegex(
                bootstrap.BootstrapError, 'prior issuance intent'
            ):
                self.runtime.step('tls', ['validator'])
        reconcile.assert_not_called()

    def test_success_releases_lease_before_completed_job_is_pruned(self) -> None:
        self.runtime.configuration = dataclasses.replace(configuration(), consumers=[])
        self.runtime.complete()
        body = self.coordination.patch_namespaced_lease.call_args.args[2]
        self.assertIsNone(body['spec']['holderIdentity'])
        self.assertTrue(self.runtime.state['complete'])

    def test_job_before_deployment_waits_without_committing_credentials(self) -> None:
        self.apps.read_namespaced_deployment.side_effect = ApiException(status=404)
        with self.assertRaises(bootstrap.WaitingForConsumers):
            self.runtime.verify_quiescence()
        self.core.create_namespaced_config_map.assert_not_called()

    def test_explicit_rotation_accepts_validated_in_place_transition(self) -> None:
        self.state['committed'] = self.runtime.inventory()
        self.set_state()
        self.runtime.configuration = dataclasses.replace(
            configuration(),
            secrets=[
                dataclasses.replace(
                    configuration().secrets[0], rotation_id='rotation-1'
                )
            ],
        )
        self.core.read_namespaced_secret.return_value = secret(b'rotated')
        with mock.patch.object(bootstrap.subprocess, 'run'):
            self.runtime.step('tls', ['validator'])
        self.assertEqual(self.runtime.state['committed'], self.runtime.inventory())
        self.assertEqual(self.runtime.state['rotations']['root'], 'rotation-1')

    def test_rotation_cannot_authorize_missing_or_replaced_secret(self) -> None:
        self.state['committed'] = self.runtime.inventory()
        self.set_state()
        self.runtime.configuration = dataclasses.replace(
            configuration(),
            secrets=[
                dataclasses.replace(
                    configuration().secrets[0], rotation_id='rotation-1'
                )
            ],
        )
        self.core.read_namespaced_secret.return_value = secret(uid='replacement')
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'was replaced'):
            self.runtime.begin()

    def test_dependency_wait_before_create_can_retry(self) -> None:
        self.core.read_namespaced_secret.side_effect = ApiException(status=404)
        self.runtime.prepare('tls')
        self.assertEqual(self.runtime.state['intents'], {})
        self.runtime.prepare('tls')
        self.runtime.record_issuance('root')
        self.assertEqual(self.runtime.state['intents'], {'root': 'uid'})
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'prior issuance intent'):
            self.runtime.prepare('tls')

    def test_adoption_cannot_regenerate_before_first_step_receipt(self) -> None:
        self.state['adopted'] = {'root': 'secret-uid'}
        self.set_state()
        self.core.read_namespaced_secret.side_effect = ApiException(status=404)
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'Adopted credential'):
            self.runtime.prepare('tls')
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'Adopted credential'):
            self.runtime.begin()

    def test_old_ready_replica_cannot_complete_new_unready_rollout(self) -> None:
        deployment = types.SimpleNamespace(
            metadata=types.SimpleNamespace(generation=2),
            spec=types.SimpleNamespace(
                replicas=1,
                template=types.SimpleNamespace(
                    metadata=types.SimpleNamespace(
                        annotations={bootstrap.GENERATION: 'generation'}
                    )
                ),
            ),
            status=types.SimpleNamespace(
                observed_generation=2,
                replicas=2,
                updated_replicas=1,
                ready_replicas=1,
                available_replicas=1,
            ),
        )
        self.apps.read_namespaced_deployment.return_value = deployment
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'rollout'):
            self.runtime.complete()
        deployment.status.replicas = 1
        self.runtime.complete()

    def test_rotation_gate_rejects_stale_phase_and_stale_files(self) -> None:
        self.runtime.configuration = dataclasses.replace(
            configuration(),
            steps=[],
            tls_rotation={
                'record': 'tls-record',
                'id': 'rotation-1',
                'phase': 'prepare',
            },
        )
        receipt = client.V1ConfigMap(
            metadata=client.V1ObjectMeta(
                labels={
                    'app.kubernetes.io/instance': 'release',
                    'app.kubernetes.io/managed-by': 'osmo-internal-tls-bootstrap',
                }
            ),
            data={
                'state.json': json.dumps(
                    {
                        'id': 'rotation-1',
                        'phase': 'stable',
                        'files': self.runtime.inventory(),
                    }
                )
            },
        )
        self.core.read_namespaced_config_map.return_value = receipt
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'trust'
            mappings = [{'secret': 'root', 'key': 'key', 'path': str(path)}]
            with self.assertRaisesRegex(
                bootstrap.BootstrapError, 'TLS rotation snapshot'
            ):
                self.runtime.snapshot(mappings)
            state = json.loads(receipt.data['state.json'])
            state['phase'] = 'prepare'
            receipt.data['state.json'] = json.dumps(state)
            self.core.read_namespaced_secret.return_value = secret(b'stale-projection')
            with self.assertRaisesRegex(
                bootstrap.BootstrapError, 'verified credential'
            ):
                self.runtime.snapshot(mappings)
            self.assertFalse(path.exists())
            self.core.read_namespaced_secret.return_value = secret()
            self.runtime.snapshot(mappings)
            self.assertEqual(path.read_bytes(), b'credential')


if __name__ == '__main__':
    unittest.main()
