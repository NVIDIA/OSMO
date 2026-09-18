# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Safety contracts for ordinary-Job initialization and application file gates."""

import base64
import contextlib
import copy
import dataclasses
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import types
import unittest
from unittest import mock

from kubernetes import client
from kubernetes.client.exceptions import ApiException

from src.utils import bootstrap, identity_bootstrap


CONFIGURATION_PAYLOAD = {
    'namespace': 'namespace',
    'release': 'release',
    'record': 'record',
    'generation': 'generation',
    'initialization_id': '',
    'secrets': [
        {'name': 'root', 'step': 'tls', 'owner': 'owner', 'keys': ['key']},
    ],
    'consumers': ['api'],
    'steps': ['tls'],
}


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


def container_status(started: bool) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        container_id='containerd://started' if started else None,
        restart_count=0,
        state=types.SimpleNamespace(running=None, terminated=None),
    )


def replica_set(
    uid: str = 'replica-set-uid',
    owner_uid: str = 'deployment-uid',
    replicas: int = 1,
    generation: str = 'generation',
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            uid=uid,
            owner_references=[
                types.SimpleNamespace(
                    controller=True, uid=owner_uid, kind='Deployment'
                )
            ],
        ),
        spec=types.SimpleNamespace(
            replicas=replicas,
            template=types.SimpleNamespace(
                metadata=types.SimpleNamespace(
                    annotations={bootstrap.GENERATION: generation}
                )
            ),
        ),
    )


def consumer_pod(
    owner_uid: str = 'replica-set-uid',
    generation: str = 'generation',
    statuses: list | None = None,
) -> types.SimpleNamespace:
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(
            annotations={bootstrap.GENERATION: generation},
            owner_references=[
                types.SimpleNamespace(
                    controller=True, kind='ReplicaSet', uid=owner_uid
                )
            ],
        ),
        status=types.SimpleNamespace(
            container_statuses=(
                statuses if statuses is not None else [container_status(False)]
            )
        ),
    )


def consumer_deployment(generation: str = 'generation') -> types.SimpleNamespace:
    return types.SimpleNamespace(
        metadata=types.SimpleNamespace(uid='deployment-uid', generation=1),
        spec=types.SimpleNamespace(
            replicas=1,
            selector=types.SimpleNamespace(match_labels={'app': 'api'}),
            template=types.SimpleNamespace(
                metadata=types.SimpleNamespace(
                    annotations={bootstrap.GENERATION: generation}
                )
            ),
        ),
    )


class Fixture:
    """A mocked Kubernetes surface whose installation record survives save()."""

    def __init__(self, runtime_configuration: bootstrap.Configuration):
        self.core = mock.Mock()
        self.apps = mock.Mock()
        self.coordination = mock.Mock()
        self.runtime = bootstrap.Coordinator(
            runtime_configuration,
            self.core,
            self.apps,
            self.coordination,
            'pod',
            'uid',
        )
        self.core.read_namespaced_secret.return_value = secret()
        self.coordination.read_namespaced_lease.return_value = client.V1Lease(
            metadata=client.V1ObjectMeta(resource_version='1'),
            spec=client.V1LeaseSpec(holder_identity='pod/uid'),
        )
        self.state: dict = {
            'installation': 'namespace/release',
            'podUID': 'uid',
            'generation': 'generation',
            'credentialsReady': True,
            'complete': False,
            'intents': {},
            'receipts': {},
            'committed': {},
        }
        self.publish()

    def publish(self) -> None:
        self.core.read_namespaced_config_map.return_value = client.V1ConfigMap(
            metadata=client.V1ObjectMeta(resource_version='3'),
            data={'state.json': json.dumps(self.state)},
        )

        def persist(*args, **_kwargs):
            self.core.read_namespaced_config_map.return_value = copy.deepcopy(args[2])
            return copy.deepcopy(args[2])

        self.core.replace_namespaced_config_map.side_effect = persist

    def saved_state(self) -> dict:
        body = self.core.replace_namespaced_config_map.call_args.args[2]
        return json.loads(body.data['state.json'])


class ConfigurationTests(unittest.TestCase):
    """Non-secret installation inputs must round-trip from the mounted ConfigMap."""

    def setUp(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.path = os.path.join(directory, 'config.json')
        Path(self.path).write_text(
            json.dumps(CONFIGURATION_PAYLOAD), encoding='utf-8'
        )

    def test_read_parses_secret_specifications(self) -> None:
        parsed = bootstrap.Configuration.read(self.path)

        self.assertEqual(
            parsed.secrets, [bootstrap.SecretSpec('root', 'tls', 'owner', ['key'])]
        )

    def test_read_exposes_namespaced_installation_identity(self) -> None:
        parsed = bootstrap.Configuration.read(self.path)

        self.assertEqual(parsed.installation, 'namespace/release')

    def test_read_defaults_tls_rotation_to_empty(self) -> None:
        parsed = bootstrap.Configuration.read(self.path)

        self.assertEqual(parsed.tls_rotation, {})


class BoundedApiClientTests(unittest.TestCase):
    """Every Kubernetes request, including legacy reconciler calls, must be bounded."""

    def test_call_api_applies_the_default_request_timeout(self) -> None:
        with mock.patch.object(bootstrap.client.ApiClient, 'call_api') as parent:
            bootstrap.BoundedApiClient().call_api('/version', 'GET')

        self.assertEqual(
            parent.call_args.kwargs['_request_timeout'], bootstrap.API_TIMEOUT
        )

    def test_call_api_preserves_an_explicit_request_timeout(self) -> None:
        with mock.patch.object(bootstrap.client.ApiClient, 'call_api') as parent:
            bootstrap.BoundedApiClient().call_api(
                '/version', 'GET', _request_timeout=(1, 2)
            )

        self.assertEqual(parent.call_args.kwargs['_request_timeout'], (1, 2))

    def test_client_disables_transport_level_retries(self) -> None:
        api_client = bootstrap.BoundedApiClient()

        self.assertEqual(api_client.configuration.retries, 0)


class SecretIdentityTests(unittest.TestCase):
    """Only well-formed, non-empty, correctly owned credentials may be fingerprinted."""

    def test_missing_declared_key_is_rejected(self) -> None:
        value = secret()
        value.data = {}

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'invalid key key'):
            bootstrap.secret_identity(value, configuration().secrets[0], 'release')

    def test_non_base64_key_is_rejected(self) -> None:
        value = secret()
        value.data = {'key': 'not-base64-$$$'}

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'invalid key key'):
            bootstrap.secret_identity(value, configuration().secrets[0], 'release')

    def test_empty_key_is_rejected(self) -> None:
        value = secret()
        value.data = {'key': ''}

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'empty key key'):
            bootstrap.secret_identity(value, configuration().secrets[0], 'release')

    def test_foreign_release_ownership_is_rejected(self) -> None:
        value = secret()
        value.metadata.labels['app.kubernetes.io/instance'] = 'other-release'

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'unexpected ownership'):
            bootstrap.secret_identity(value, configuration().secrets[0], 'release')


class InventoryTests(unittest.TestCase):
    """Reading credential identities must fail loudly on anything but a clean 404."""

    def setUp(self) -> None:
        self.fixture = Fixture(configuration())

    def test_non_404_read_error_is_not_treated_as_absence(self) -> None:
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=500)

        with self.assertRaises(ApiException):
            self.fixture.runtime.optional_secret('root')

    def test_empty_unprotected_derived_secret_is_not_inventoried(self) -> None:
        self.fixture.runtime.configuration = dataclasses.replace(
            configuration(),
            secrets=[
                bootstrap.SecretSpec(
                    'leaf', 'internal-tls', 'owner', ['tls.crt'], protected=False
                )
            ],
        )
        derived = secret()
        derived.data = None
        self.fixture.core.read_namespaced_secret.return_value = derived

        self.assertEqual(self.fixture.runtime.inventory(), {})

    def test_absent_secret_is_omitted_from_inventory(self) -> None:
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=404)

        self.assertEqual(self.fixture.runtime.inventory(), {})


class LeaseTests(unittest.TestCase):
    """Execution ownership transfers only with proof the previous attempt stopped."""

    def setUp(self) -> None:
        self.fixture = Fixture(configuration())

    def test_release_refuses_to_clear_a_foreign_holder(self) -> None:
        lease = self.fixture.coordination.read_namespaced_lease.return_value
        lease.spec.holder_identity = 'other/other-uid'

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'another attempt'):
            self.fixture.runtime.release()

        self.fixture.coordination.patch_namespaced_lease.assert_not_called()

    def test_acquire_requires_downward_api_pod_identity(self) -> None:
        anonymous = bootstrap.Coordinator(
            configuration(),
            self.fixture.core,
            self.fixture.apps,
            self.fixture.coordination,
            '',
            '',
        )

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'downward-API'):
            anonymous.acquire()

    def test_acquire_creates_the_lease_when_it_does_not_exist(self) -> None:
        self.fixture.coordination.read_namespaced_lease.side_effect = ApiException(
            status=404
        )
        self.fixture.coordination.create_namespaced_lease.return_value = client.V1Lease(
            metadata=client.V1ObjectMeta(resource_version='7'),
            spec=client.V1LeaseSpec(holder_identity=None),
        )

        self.fixture.runtime.acquire()

        body = self.fixture.coordination.patch_namespaced_lease.call_args.args[2]
        self.assertEqual(body['metadata']['resourceVersion'], '7')

    def test_acquire_propagates_a_non_404_lease_read_failure(self) -> None:
        self.fixture.coordination.read_namespaced_lease.side_effect = ApiException(
            status=500
        )

        with self.assertRaises(ApiException):
            self.fixture.runtime.acquire()

    def test_acquire_propagates_a_non_404_previous_pod_read_failure(self) -> None:
        lease = self.fixture.coordination.read_namespaced_lease.return_value
        lease.spec.holder_identity = 'old/old-uid'
        self.fixture.core.read_namespaced_pod.side_effect = ApiException(status=500)

        with self.assertRaises(ApiException):
            self.fixture.runtime.acquire()

    def test_acquire_rejects_a_recycled_previous_pod_name(self) -> None:
        lease = self.fixture.coordination.read_namespaced_lease.return_value
        lease.spec.holder_identity = 'old/old-uid'
        self.fixture.core.read_namespaced_pod.return_value = client.V1Pod(
            metadata=client.V1ObjectMeta(uid='recycled-uid'),
            status=client.V1PodStatus(phase='Succeeded'),
        )

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'cannot be verified'):
            self.fixture.runtime.acquire()

        self.fixture.coordination.patch_namespaced_lease.assert_not_called()

    def test_load_rejects_a_record_from_another_installation(self) -> None:
        self.fixture.state['installation'] = 'namespace/other-release'
        self.fixture.publish()

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'different release'):
            self.fixture.runtime.load()


class QuiescenceTests(unittest.TestCase):
    """Initialization is only safe while no consumer has run application code."""

    def setUp(self) -> None:
        self.fixture = Fixture(configuration())
        self.deployment = consumer_deployment()
        self.fixture.apps.read_namespaced_deployment.return_value = self.deployment
        self.replica_sets = [replica_set()]
        self.fixture.apps.list_namespaced_replica_set.return_value = (
            types.SimpleNamespace(items=self.replica_sets)
        )
        self.pods = [consumer_pod()]
        self.fixture.core.list_namespaced_pod.return_value = types.SimpleNamespace(
            items=self.pods
        )

    def test_fully_gated_consumer_is_quiescent(self) -> None:
        self.fixture.runtime.verify_quiescence()

        self.assertEqual(
            self.fixture.apps.list_namespaced_replica_set.call_args.kwargs[
                'label_selector'
            ],
            'app=api',
        )

    def test_non_404_deployment_read_failure_is_propagated(self) -> None:
        self.fixture.apps.read_namespaced_deployment.side_effect = ApiException(
            status=500
        )

        with self.assertRaises(ApiException):
            self.fixture.runtime.verify_quiescence()

    def test_ungated_deployment_template_waits_for_the_startup_gate(self) -> None:
        self.deployment.spec.template.metadata.annotations = {}

        with self.assertRaisesRegex(bootstrap.WaitingForConsumers, 'startup gate'):
            self.fixture.runtime.verify_quiescence()

    def test_scaled_up_ungated_replica_set_waits(self) -> None:
        self.replica_sets[0] = replica_set(replicas=2, generation='previous')

        with self.assertRaisesRegex(
            bootstrap.WaitingForConsumers, 'ungated ReplicaSet'
        ):
            self.fixture.runtime.verify_quiescence()

    def test_scaled_down_ungated_replica_set_is_tolerated(self) -> None:
        self.replica_sets[0] = replica_set(replicas=0, generation='previous')

        self.fixture.runtime.verify_quiescence()

        self.fixture.core.list_namespaced_pod.assert_called_once()

    def test_pod_owned_by_a_foreign_replica_set_is_rejected(self) -> None:
        self.replica_sets[0] = replica_set(owner_uid='other-deployment-uid')

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'unowned or ungated'):
            self.fixture.runtime.verify_quiescence()

    def test_ungated_pod_is_rejected(self) -> None:
        self.pods[0] = consumer_pod(generation='previous')

        with self.assertRaisesRegex(bootstrap.BootstrapError, 'unowned or ungated'):
            self.fixture.runtime.verify_quiescence()

    def test_pod_with_a_created_container_has_already_started(self) -> None:
        self.pods[0] = consumer_pod(statuses=[container_status(True)])

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'already started application code'
        ):
            self.fixture.runtime.verify_quiescence()

    def test_pod_with_a_restarted_container_has_already_started(self) -> None:
        status = container_status(False)
        status.restart_count = 1
        self.pods[0] = consumer_pod(statuses=[status])

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'already started application code'
        ):
            self.fixture.runtime.verify_quiescence()

    def test_pod_with_a_terminated_container_has_already_started(self) -> None:
        status = container_status(False)
        status.state.terminated = types.SimpleNamespace(exit_code=0)
        self.pods[0] = consumer_pod(statuses=[status])

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'already started application code'
        ):
            self.fixture.runtime.verify_quiescence()

    def test_pod_without_container_statuses_is_quiescent(self) -> None:
        self.pods[0] = consumer_pod(statuses=[])

        self.fixture.runtime.verify_quiescence()

        self.fixture.core.list_namespaced_pod.assert_called_once()

    def test_initialization_requires_quiescent_consumers(self) -> None:
        self.fixture.runtime.configuration = configuration('new-install')
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=404)
        self.fixture.core.read_namespaced_config_map.side_effect = ApiException(
            status=404
        )
        self.fixture.apps.read_namespaced_deployment.side_effect = ApiException(
            status=404
        )

        with self.assertRaises(bootstrap.WaitingForConsumers):
            self.fixture.runtime.begin()

        self.fixture.core.create_namespaced_config_map.assert_not_called()

    def test_begin_propagates_a_non_404_record_read_failure(self) -> None:
        self.fixture.core.read_namespaced_config_map.side_effect = ApiException(
            status=500
        )

        with self.assertRaises(ApiException):
            self.fixture.runtime.begin()


class StepFencingTests(unittest.TestCase):
    """Each step must prove it owns the attempt before touching credentials."""

    def setUp(self) -> None:
        self.fixture = Fixture(configuration())

    def test_prepare_rejects_a_pod_that_does_not_own_the_attempt(self) -> None:
        self.fixture.state['podUID'] = 'other-uid'
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'does not own the current attempt'
        ):
            self.fixture.runtime.prepare('tls')

    def test_prepare_rejects_a_disabled_step(self) -> None:
        with self.assertRaisesRegex(bootstrap.BootstrapError, 'Step identity is disabled'):
            self.fixture.runtime.prepare('identity')

    def test_record_issuance_ignores_unmanaged_credentials(self) -> None:
        self.fixture.runtime.record_issuance('unknown')

        self.fixture.core.read_namespaced_config_map.assert_not_called()

    def test_record_issuance_requires_a_matching_prepared_step(self) -> None:
        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'does not belong to the prepared step'
        ):
            self.fixture.runtime.record_issuance('root')

    def test_record_issuance_refuses_to_recreate_a_committed_credential(self) -> None:
        self.fixture.state['pending'] = {
            'step': 'tls',
            'podUID': 'uid',
            'existing': {},
        }
        self.fixture.state['committed'] = {'root': {'uid': 'secret-uid', 'keys': {}}}
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Refusing to recreate retained credential root'
        ):
            self.fixture.runtime.record_issuance('root')

    def test_record_issuance_refuses_to_recreate_an_adopted_credential(self) -> None:
        self.fixture.state['pending'] = {
            'step': 'tls',
            'podUID': 'uid',
            'existing': {},
        }
        self.fixture.state['adopted'] = {'root': 'secret-uid'}
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Refusing to recreate retained credential root'
        ):
            self.fixture.runtime.record_issuance('root')

    def test_record_issuance_rejects_a_second_unresolved_intent(self) -> None:
        self.fixture.state['pending'] = {
            'step': 'tls',
            'podUID': 'uid',
            'existing': {},
        }
        self.fixture.state['intents'] = {'root': 'uid'}
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'unresolved issuance intent'
        ):
            self.fixture.runtime.record_issuance('root')

    def test_finish_rejects_a_step_that_was_never_prepared(self) -> None:
        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'does not match the prepared attempt'
        ):
            self.fixture.runtime.finish('tls')

    def test_finish_rejects_a_step_that_did_not_issue_its_credential(self) -> None:
        self.fixture.state['pending'] = {
            'step': 'tls',
            'podUID': 'uid',
            'existing': {},
        }
        self.fixture.publish()
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=404)

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Step tls did not issue root'
        ):
            self.fixture.runtime.finish('tls')

    def test_internal_tls_step_allows_the_initial_generation(self) -> None:
        self.fixture.runtime.configuration = dataclasses.replace(
            configuration(),
            steps=['internal-tls'],
            secrets=[bootstrap.SecretSpec('root', 'internal-tls', 'owner', ['key'])],
        )

        with mock.patch.object(bootstrap.subprocess, 'run') as reconcile:
            self.fixture.runtime.step('internal-tls', ['validator'])

        self.assertEqual(
            reconcile.call_args.args[0], ['validator', '--allow-initial-generation']
        )

    def test_service_auth_step_projects_the_verified_token_to_disk(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        path = os.path.join(directory, 'service-auth-token')
        self.fixture.runtime.configuration = dataclasses.replace(
            configuration(),
            steps=['service-auth'],
            secrets=[bootstrap.SecretSpec('root', 'service-auth', 'owner', ['key'])],
        )
        self.fixture.state['pending'] = {
            'step': 'service-auth',
            'podUID': 'uid',
            'existing': {},
        }
        self.fixture.publish()
        mapping = json.dumps({'secret': 'root', 'key': 'key', 'path': path})

        with mock.patch.dict(
            os.environ, {'OSMO_BOOTSTRAP_SERVICE_AUTH': mapping}
        ):
            self.fixture.runtime.finish('service-auth')

        self.assertEqual(Path(path).read_bytes(), b'credential')


class ReadinessTests(unittest.TestCase):
    """Readiness must require every enabled output and a receipt from this attempt."""

    def setUp(self) -> None:
        self.fixture = Fixture(configuration())

    def test_ready_rejects_a_missing_enabled_output(self) -> None:
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=404)

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Missing enabled output root'
        ):
            self.fixture.runtime.ready()

    def test_ready_rejects_a_step_without_a_receipt_for_this_attempt(self) -> None:
        self.fixture.state['receipts'] = {'tls': {'podUID': 'other-uid'}}
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Step tls has no receipt'
        ):
            self.fixture.runtime.ready()

    def test_ready_publishes_verified_identities_when_receipts_match(self) -> None:
        self.fixture.state['receipts'] = {'tls': {'podUID': 'uid'}}
        self.fixture.state['credentialsReady'] = False
        self.fixture.publish()

        self.fixture.runtime.ready()

        saved = self.fixture.saved_state()
        self.assertTrue(saved['credentialsReady'])
        self.assertEqual(saved['files']['root']['uid'], 'secret-uid')

    def test_ready_synthesizes_the_object_storage_receipt(self) -> None:
        self.fixture.runtime.configuration = dataclasses.replace(
            configuration(), steps=['object-storage']
        )

        self.fixture.runtime.ready()

        saved = self.fixture.saved_state()
        self.assertEqual(saved['receipts']['object-storage']['podUID'], 'uid')

    def test_complete_rejects_an_attempt_without_ready_credentials(self) -> None:
        self.fixture.state['credentialsReady'] = False
        self.fixture.publish()

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Credentials are not ready'
        ):
            self.fixture.runtime.complete()

    def test_snapshot_waits_for_an_absent_required_credential(self) -> None:
        self.fixture.core.read_namespaced_secret.side_effect = ApiException(status=404)

        with self.assertRaisesRegex(
            bootstrap.BootstrapError, 'Waiting for a required credential'
        ):
            self.fixture.runtime.snapshot(
                [{'secret': 'root', 'key': 'key', 'path': '/unused'}]
            )


class EntrypointTests(unittest.TestCase):
    """The container entrypoint must dispatch actions and retry only where it is safe."""

    def setUp(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.config_path = os.path.join(directory, 'config.json')
        Path(self.config_path).write_text(
            json.dumps(CONFIGURATION_PAYLOAD), encoding='utf-8'
        )
        self.coordinator = mock.Mock()
        for patcher in (
            mock.patch.object(bootstrap.config, 'load_incluster_config'),
            mock.patch.object(bootstrap, 'BoundedApiClient'),
            mock.patch.object(
                bootstrap, 'Coordinator', return_value=self.coordinator
            ),
            mock.patch.object(bootstrap.time, 'sleep'),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def invoke(self, arguments: list[str]) -> str:
        stderr = io.StringIO()
        argv = ['bootstrap', '--config', self.config_path] + arguments
        with mock.patch.object(bootstrap.sys, 'argv', argv):
            with contextlib.redirect_stderr(stderr):
                bootstrap.main()
        return stderr.getvalue()

    def test_step_action_forwards_the_step_name_and_command(self) -> None:
        self.invoke(['step', 'tls', 'validator', '--allow'])

        self.coordinator.step.assert_called_once_with('tls', ['validator', '--allow'])

    def test_prepare_action_dispatches_the_named_step(self) -> None:
        self.invoke(['prepare', 'tls'])

        self.coordinator.prepare.assert_called_once_with('tls')

    def test_finish_action_dispatches_the_named_step(self) -> None:
        self.invoke(['finish', 'tls'])

        self.coordinator.finish.assert_called_once_with('tls')

    def test_gate_action_passes_the_configured_file_mappings(self) -> None:
        mappings = [{'secret': 'root', 'key': 'key', 'path': '/files/key'}]

        with mock.patch.dict(
            os.environ, {'OSMO_BOOTSTRAP_FILES': json.dumps(mappings)}
        ):
            self.invoke(['gate'])

        self.coordinator.snapshot.assert_called_once_with(mappings)

    def test_begin_action_dispatches_without_arguments(self) -> None:
        self.invoke(['begin'])

        self.coordinator.begin.assert_called_once_with()

    def test_begin_retries_while_consumers_are_not_gated(self) -> None:
        self.coordinator.begin.side_effect = [
            bootstrap.WaitingForConsumers('waiting'),
            None,
        ]

        self.invoke(['begin'])

        self.assertEqual(self.coordinator.begin.call_count, 2)

    def test_begin_stops_waiting_for_consumers_at_the_deadline(self) -> None:
        self.coordinator.begin.side_effect = bootstrap.WaitingForConsumers('waiting')

        with self.assertRaises(SystemExit):
            self.invoke(['--wait-seconds', '0', 'begin'])

        self.assertEqual(self.coordinator.begin.call_count, 1)

    def test_ready_does_not_wait_for_consumers(self) -> None:
        self.coordinator.ready.side_effect = bootstrap.WaitingForConsumers('waiting')

        with self.assertRaises(SystemExit):
            self.invoke(['ready'])

        self.assertEqual(self.coordinator.ready.call_count, 1)

    def test_complete_retries_a_transient_bootstrap_error(self) -> None:
        self.coordinator.complete.side_effect = [
            bootstrap.BootstrapError('rollout in progress'),
            None,
        ]

        self.invoke(['complete'])

        self.assertEqual(self.coordinator.complete.call_count, 2)

    def test_gate_retries_a_transient_api_failure(self) -> None:
        self.coordinator.snapshot.side_effect = [ApiException(status=500), None]

        self.invoke(['gate'])

        self.assertEqual(self.coordinator.snapshot.call_count, 2)

    def test_complete_stops_retrying_at_the_deadline(self) -> None:
        self.coordinator.complete.side_effect = bootstrap.BootstrapError('stalled')

        with self.assertRaises(SystemExit):
            self.invoke(['--wait-seconds', '0', 'complete'])

        self.assertEqual(self.coordinator.complete.call_count, 1)

    def test_begin_does_not_retry_a_bootstrap_error(self) -> None:
        self.coordinator.begin.side_effect = bootstrap.BootstrapError('stalled')

        with self.assertRaises(SystemExit):
            self.invoke(['begin'])

        self.assertEqual(self.coordinator.begin.call_count, 1)

    def test_bootstrap_error_guidance_reaches_the_operator(self) -> None:
        self.coordinator.begin.side_effect = bootstrap.BootstrapError(
            'restore retained credentials'
        )
        stderr = io.StringIO()
        argv = ['bootstrap', '--config', self.config_path, 'begin']

        with mock.patch.object(bootstrap.sys, 'argv', argv):
            with contextlib.redirect_stderr(stderr):
                with self.assertRaises(SystemExit):
                    bootstrap.main()

        self.assertIn('restore retained credentials', stderr.getvalue())

    def test_api_failure_reports_only_the_status_code(self) -> None:
        self.coordinator.begin.side_effect = ApiException(
            status=403, reason='token=super-secret'
        )
        stderr = io.StringIO()
        argv = ['bootstrap', '--config', self.config_path, 'begin']

        with mock.patch.object(bootstrap.sys, 'argv', argv):
            with contextlib.redirect_stderr(stderr):
                with self.assertRaises(SystemExit):
                    bootstrap.main()

        self.assertIn('HTTP 403', stderr.getvalue())
        self.assertNotIn('super-secret', stderr.getvalue())

    def test_unexpected_failure_reports_only_the_exception_type(self) -> None:
        self.coordinator.begin.side_effect = ValueError('token=super-secret')
        stderr = io.StringIO()
        argv = ['bootstrap', '--config', self.config_path, 'begin']

        with mock.patch.object(bootstrap.sys, 'argv', argv):
            with contextlib.redirect_stderr(stderr):
                with self.assertRaises(SystemExit):
                    bootstrap.main()

        self.assertIn('ValueError', stderr.getvalue())
        self.assertNotIn('super-secret', stderr.getvalue())


class RecordIssuanceHookTests(unittest.TestCase):
    """Legacy reconcilers participate in fencing only under the unified Job."""

    def setUp(self) -> None:
        directory = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, directory, True)
        self.config_path = os.path.join(directory, 'config.json')
        Path(self.config_path).write_text(
            json.dumps(CONFIGURATION_PAYLOAD), encoding='utf-8'
        )

    def test_unconfigured_hook_does_not_contact_kubernetes(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=True):
            with mock.patch.object(bootstrap, 'BoundedApiClient') as api_client:
                bootstrap.record_issuance_if_configured('root')

        api_client.assert_not_called()

    def test_configured_hook_fences_the_named_credential(self) -> None:
        environment = {
            'OSMO_BOOTSTRAP_CONFIG': self.config_path,
            'OSMO_POD_NAME': 'pod',
            'OSMO_POD_UID': 'uid',
        }

        with mock.patch.dict(os.environ, environment, clear=True):
            with mock.patch.object(bootstrap, 'BoundedApiClient'):
                with mock.patch.object(
                    bootstrap.Coordinator, 'record_issuance'
                ) as fence:
                    bootstrap.record_issuance_if_configured('root')

        fence.assert_called_once_with('root')


if __name__ == '__main__':
    unittest.main()
