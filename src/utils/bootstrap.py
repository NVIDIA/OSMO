# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Retained installation receipts and startup snapshots for the unified bootstrap Job.

The ConfigMap contains identities, never credential bytes. Kubernetes resourceVersion
is the compare-and-swap fence; a live previous Pod always prevents lease takeover.
Every invocation is also bounded by bootstrap-step's process watchdog.
"""

import argparse
import base64
import dataclasses
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from typing import Any

from kubernetes import client, config
from kubernetes.client.exceptions import ApiException
import yaml


GENERATION = 'osmo.nvidia.com/bootstrap-generation'
API_TIMEOUT = (5, 10)


class BoundedApiClient(client.ApiClient):
    """Bound each Kubernetes request, including calls inside legacy reconcilers."""

    def __init__(self) -> None:
        configuration = client.Configuration.get_default_copy()
        configuration.retries = 0
        super().__init__(configuration=configuration)

    def call_api(self, *args: Any, **kwargs: Any) -> Any:
        kwargs.setdefault('_request_timeout', API_TIMEOUT)
        return super().call_api(*args, **kwargs)


class BootstrapError(RuntimeError):
    """An installation cannot safely proceed without operator intervention."""


class WaitingForConsumers(BootstrapError):
    """The release controller has not applied the gated consumer cohort yet."""


@dataclasses.dataclass(frozen=True)
class SecretSpec:
    name: str
    step: str
    owner: str
    keys: list[str]
    protected: bool = True
    rotation_id: str = ''
    optional_keys: list[str] = dataclasses.field(default_factory=list)


@dataclasses.dataclass(frozen=True)
class Configuration:
    namespace: str
    release: str
    record: str
    generation: str
    initialization_id: str
    secrets: list[SecretSpec]
    consumers: list[str]
    steps: list[str]
    tls_rotation: dict[str, str] = dataclasses.field(default_factory=dict)

    @classmethod
    def read(cls, path: str) -> 'Configuration':
        values = json.loads(Path(path).read_text(encoding='utf-8'))
        values['secrets'] = [SecretSpec(**item) for item in values['secrets']]
        return cls(**values)

    @property
    def installation(self) -> str:
        return f'{self.namespace}/{self.release}'


def secret_identity(
    secret: Any, specification: SecretSpec, release: str
) -> dict[str, Any]:
    """Check ownership and encode only key fingerprints in the installation record."""
    labels = secret.metadata.labels or {}
    if (
        labels.get('app.kubernetes.io/instance') != release
        or labels.get('app.kubernetes.io/managed-by') != specification.owner
    ):
        raise BootstrapError(f'Secret {specification.name} has unexpected ownership.')
    values = secret.data or {}
    fingerprints = {}
    for key in specification.keys + [
        key for key in specification.optional_keys if key in values
    ]:
        try:
            value = base64.b64decode(values[key], validate=True)
        except (KeyError, ValueError, TypeError) as error:
            raise BootstrapError(
                f'Secret {specification.name} has invalid key {key}.'
            ) from error
        if not value:
            raise BootstrapError(f'Secret {specification.name} has empty key {key}.')
        fingerprints[key] = hashlib.sha256(value).hexdigest()
    return {'uid': secret.metadata.uid, 'keys': fingerprints}


def initialization_mode(configuration: Configuration, inventory: dict[str, Any]) -> str:
    """Absence of Kubernetes objects never independently authorizes initialization."""
    missing = [
        item.name
        for item in configuration.secrets
        if item.protected and item.name not in inventory
    ]
    if not missing:
        return 'adopt'
    if not configuration.initialization_id:
        raise BootstrapError(
            'No installation record and protected credentials are missing: '
            + ', '.join(missing)
            + '. Restore retained credentials to adopt this release unchanged. For an intentionally '
            'new installation, set bootstrap.initializationId to a unique non-secret ID; '
            'remove it after initialization. Adopt before changing credential declarations.'
        )
    return 'initialize'


def verify_committed(committed: dict[str, Any], inventory: dict[str, Any]) -> None:
    for name, identity in committed.items():
        if inventory.get(name) != identity:
            raise BootstrapError(
                f'Committed credential {name} is missing or replaced; restore it before retrying.'
            )


class Coordinator:
    """One Pod owns the sequence; each init container resumes its durable receipts."""

    def __init__(
        self,
        configuration: Configuration,
        core: Any,
        apps: Any,
        coordination: Any,
        pod_name: str,
        pod_uid: str,
    ):
        self.configuration = configuration
        self.core = core
        self.apps = apps
        self.coordination = coordination
        self.pod_name = pod_name
        self.pod_uid = pod_uid
        self.state: dict[str, Any] = {}
        self.record: Any = None

    def optional_secret(self, name: str) -> Any:
        try:
            return self.core.read_namespaced_secret(
                name, self.configuration.namespace, _request_timeout=API_TIMEOUT
            )
        except ApiException as error:
            if error.status != 404:
                raise
            return None

    def inventory(self) -> dict[str, Any]:
        result = {}
        for specification in self.configuration.secrets:
            secret = self.optional_secret(specification.name)
            if secret is not None:
                labels = secret.metadata.labels or {}
                if (
                    not specification.protected
                    and not secret.data
                    and labels.get('app.kubernetes.io/instance')
                    == self.configuration.release
                    and labels.get('app.kubernetes.io/managed-by')
                    == specification.owner
                ):
                    # TLS may allocate an empty derived leaf/trust Secret before
                    # filling it. Its protected CA is issued atomically.
                    continue
                result[specification.name] = secret_identity(
                    secret, specification, self.configuration.release
                )
        return result

    def verify_enabled_committed(self, inventory: dict[str, Any]) -> None:
        for specification in self.configuration.secrets:
            adopted_uid = self.state.get('adopted', {}).get(specification.name)
            if (
                adopted_uid
                and inventory.get(specification.name, {}).get('uid') != adopted_uid
            ):
                raise BootstrapError(
                    f'Adopted credential {specification.name} is missing or replaced.'
                )
            previous = self.state['committed'].get(specification.name)
            if not specification.protected or previous is None:
                continue
            current = inventory.get(specification.name)
            if (
                specification.rotation_id
                and specification.rotation_id
                != self.state.get('rotations', {}).get(specification.name, '')
            ):
                # The explicit lifecycle operation owns key transitions. Its
                # validator must still accept the retained Secret in step().
                # Rotation never authorizes recreating a lost Secret.
                if current is None or current['uid'] != previous['uid']:
                    raise BootstrapError(
                        f'Rotated credential {specification.name} was replaced.'
                    )
            else:
                verify_committed({specification.name: previous}, inventory)

    def release(self) -> None:
        lease = self.coordination.read_namespaced_lease(
            self.configuration.record,
            self.configuration.namespace,
            _request_timeout=API_TIMEOUT,
        )
        if lease.spec.holder_identity != f'{self.pod_name}/{self.pod_uid}':
            raise BootstrapError("Cannot release another attempt's lease.")
        self.coordination.patch_namespaced_lease(
            self.configuration.record,
            self.configuration.namespace,
            {
                'metadata': {'resourceVersion': lease.metadata.resource_version},
                'spec': {'holderIdentity': None},
            },
            _request_timeout=API_TIMEOUT,
        )

    def acquire(self) -> None:
        if not self.pod_name or not self.pod_uid:
            raise BootstrapError(
                'Bootstrap requires its downward-API Pod name and UID.'
            )
        namespace = self.configuration.namespace
        name = self.configuration.record
        try:
            lease = self.coordination.read_namespaced_lease(
                name, namespace, _request_timeout=API_TIMEOUT
            )
        except ApiException as error:
            if error.status != 404:
                raise
            lease = self.coordination.create_namespaced_lease(
                namespace,
                {
                    'metadata': {'name': name},
                    'spec': {},
                },
                _request_timeout=API_TIMEOUT,
            )
        holder = lease.spec.holder_identity
        desired = f'{self.pod_name}/{self.pod_uid}'
        if holder and holder != desired:
            previous_name, previous_uid = holder.split('/', 1)
            try:
                previous = self.core.read_namespaced_pod(
                    previous_name, namespace, _request_timeout=API_TIMEOUT
                )
            except ApiException as error:
                if error.status != 404:
                    raise
                # A deleted Pod can remain alive on an unreachable node. API
                # disappearance never authorizes clearing a still-held Lease.
                raise BootstrapError(
                    'Previous bootstrap Pod disappeared without terminal proof. Confirm its '
                    'processes stopped before explicitly clearing the bootstrap Lease.'
                ) from error
            if previous.metadata.uid == previous_uid and previous.status.phase not in (
                'Succeeded',
                'Failed',
            ):
                raise BootstrapError(
                    'Previous bootstrap Pod is still live; refusing lease takeover.'
                )
            if previous.metadata.uid != previous_uid:
                raise BootstrapError(
                    'Previous bootstrap Pod UID cannot be verified; refusing takeover.'
                )
            # Failed can be synthesized after node loss, and even a terminal
            # container status can mean ContainerStatusUnknown. Normal exits
            # release only after the supervisor proves child-process cleanup.
            # A still-held foreign lease always needs explicit recovery.
            raise BootstrapError(
                'Previous bootstrap attempt left a held Lease. Confirm its processes '
                'stopped before explicitly clearing the bootstrap Lease; Pod phase alone '
                'does not prove termination.'
            )
        self.coordination.patch_namespaced_lease(
            name,
            namespace,
            {
                'metadata': {'resourceVersion': lease.metadata.resource_version},
                'spec': {'holderIdentity': desired},
            },
            _request_timeout=API_TIMEOUT,
        )

    def load(self) -> None:
        self.record = self.core.read_namespaced_config_map(
            self.configuration.record,
            self.configuration.namespace,
            _request_timeout=API_TIMEOUT,
        )
        self.state = json.loads(self.record.data['state.json'])
        if self.state['installation'] != self.configuration.installation:
            raise BootstrapError('Installation record belongs to a different release.')

    def save(self) -> None:
        lease = self.coordination.read_namespaced_lease(
            self.configuration.record,
            self.configuration.namespace,
            _request_timeout=API_TIMEOUT,
        )
        if lease.spec.holder_identity != f'{self.pod_name}/{self.pod_uid}':
            raise BootstrapError('Bootstrap lease ownership changed.')
        self.record.data = {'state.json': json.dumps(self.state, sort_keys=True)}
        self.record = self.core.replace_namespaced_config_map(
            self.configuration.record,
            self.configuration.namespace,
            self.record,
            _request_timeout=API_TIMEOUT,
        )

    def verify_quiescence(self) -> None:
        for name in self.configuration.consumers:
            try:
                deployment = self.apps.read_namespaced_deployment(
                    name, self.configuration.namespace, _request_timeout=API_TIMEOUT
                )
            except ApiException as error:
                if error.status != 404:
                    raise
                raise WaitingForConsumers(
                    f'Waiting for consumer Deployment {name}.'
                ) from error
            annotations = deployment.spec.template.metadata.annotations or {}
            if annotations.get(GENERATION) != self.configuration.generation:
                raise WaitingForConsumers(
                    f'Consumer {name} has not reached the startup gate.'
                )
            selector = ','.join(
                f'{key}={value}'
                for key, value in deployment.spec.selector.match_labels.items()
            )
            replica_sets = self.apps.list_namespaced_replica_set(
                self.configuration.namespace,
                label_selector=selector,
                _request_timeout=API_TIMEOUT,
            ).items
            owners = set()
            for replica_set in replica_sets:
                references = replica_set.metadata.owner_references or []
                if any(
                    reference.controller
                    and reference.uid == deployment.metadata.uid
                    and reference.kind == 'Deployment'
                    for reference in references
                ):
                    if (replica_set.spec.replicas or 0) > 0 and (
                        replica_set.spec.template.metadata.annotations or {}
                    ).get(GENERATION) != self.configuration.generation:
                        raise WaitingForConsumers(
                            f'Consumer {name} still has an ungated ReplicaSet.'
                        )
                    owners.add(replica_set.metadata.uid)
            pods = self.core.list_namespaced_pod(
                self.configuration.namespace,
                label_selector=selector,
                _request_timeout=API_TIMEOUT,
            ).items
            for pod in pods:
                references = pod.metadata.owner_references or []
                if (
                    not any(
                        reference.controller
                        and reference.kind == 'ReplicaSet'
                        and reference.uid in owners
                        for reference in references
                    )
                    or (pod.metadata.annotations or {}).get(GENERATION)
                    != self.configuration.generation
                ):
                    raise BootstrapError(
                        f'Consumer {name} has an unowned or ungated Pod.'
                    )
                for status in pod.status.container_statuses or []:
                    if (
                        status.container_id
                        or status.restart_count
                        or status.state.running
                        or status.state.terminated
                    ):
                        raise BootstrapError(
                            f'Consumer {name} has already started application code.'
                        )

    def begin(self) -> None:
        self.acquire()
        inventory = self.inventory()
        try:
            self.load()
        except ApiException as error:
            if error.status != 404:
                raise
            mode = initialization_mode(self.configuration, inventory)
            if mode == 'initialize':
                self.verify_quiescence()
            self.state = {
                'installation': self.configuration.installation,
                'initializationId': self.configuration.initialization_id,
                'mode': mode,
                'committed': {},
                'intents': {},
                'receipts': {},
                'adopted': {
                    item.name: inventory[item.name]['uid']
                    for item in self.configuration.secrets
                    if item.protected and item.name in inventory
                },
            }
            # Commit only after the authoritative reconciler validates the bytes.
            # A malformed legacy credential can then be restored before adoption.
            self.record = self.core.create_namespaced_config_map(
                self.configuration.namespace,
                client.V1ConfigMap(
                    metadata=client.V1ObjectMeta(
                        name=self.configuration.record,
                        labels={
                            'app.kubernetes.io/instance': self.configuration.release,
                            'app.kubernetes.io/managed-by': 'osmo-bootstrap',
                        },
                        annotations={'helm.sh/resource-policy': 'keep'},
                    ),
                    data={'state.json': json.dumps(self.state, sort_keys=True)},
                ),
                _request_timeout=API_TIMEOUT,
            )
        self.verify_enabled_committed(inventory)
        self.state.update(
            generation=self.configuration.generation,
            podUID=self.pod_uid,
            credentialsReady=False,
            complete=False,
        )
        self.save()

    def prepare(self, name: str) -> None:
        self.load()
        if self.state['podUID'] != self.pod_uid:
            raise BootstrapError('This Pod does not own the current attempt.')
        if name not in self.configuration.steps:
            raise BootstrapError(f'Step {name} is disabled.')
        inventory = self.inventory()
        self.verify_enabled_committed(inventory)
        existing_protected = {
            item.name: inventory[item.name]
            for item in self.configuration.secrets
            if item.step == name and item.protected and item.name in inventory
        }
        for specification in self.configuration.secrets:
            if specification.step == name:
                if (
                    specification.protected
                    and specification.name not in inventory
                    and specification.name in self.state['intents']
                ):
                    raise BootstrapError(
                        f'Credential {specification.name} is absent after a prior issuance intent; '
                        'restore it or resolve the incomplete initialization intent explicitly.'
                    )
        self.state['pending'] = {
            'step': name,
            'podUID': self.pod_uid,
            'existing': existing_protected,
        }
        self.save()

    def record_issuance(self, name: str) -> None:
        """Fence a credential create at its write boundary, after dependency waits."""
        specification = next(
            (
                item
                for item in self.configuration.secrets
                if item.name == name and item.protected
            ),
            None,
        )
        if specification is None:
            return
        self.load()
        pending = self.state.get('pending', {})
        if (
            self.state['podUID'] != self.pod_uid
            or pending.get('podUID') != self.pod_uid
            or pending.get('step') != specification.step
        ):
            raise BootstrapError(
                'Credential issuance does not belong to the prepared step.'
            )
        if name in self.state.get('adopted', {}) or name in self.state['committed']:
            raise BootstrapError(f'Refusing to recreate retained credential {name}.')
        if name in self.state['intents']:
            raise BootstrapError(
                f'Credential {name} has an unresolved issuance intent.'
            )
        self.state['intents'][name] = self.pod_uid
        self.save()

    def finish(self, name: str) -> None:
        self.load()
        pending = self.state.get('pending', {})
        if pending.get('step') != name or pending.get('podUID') != self.pod_uid:
            raise BootstrapError('Step completion does not match the prepared attempt.')
        inventory = self.inventory()
        self.verify_enabled_committed(inventory)
        verify_committed(pending['existing'], inventory)
        for specification in self.configuration.secrets:
            if specification.step == name:
                if specification.name not in inventory:
                    raise BootstrapError(
                        f'Step {name} did not issue {specification.name}.'
                    )
                if specification.protected:
                    self.state['committed'][specification.name] = inventory[
                        specification.name
                    ]
                    self.state.setdefault('rotations', {})[specification.name] = (
                        specification.rotation_id
                    )
        self.state['receipts'][name] = {
            'generation': self.configuration.generation,
            'podUID': self.pod_uid,
        }
        self.save()
        if name == 'service-auth' and os.environ.get('OSMO_BOOTSTRAP_SERVICE_AUTH'):
            mapping = json.loads(os.environ['OSMO_BOOTSTRAP_SERVICE_AUTH'])
            secret = self.optional_secret(mapping['secret'])
            raw = base64.b64decode(secret.data[mapping['key']], validate=True)
            descriptor = os.open(
                mapping['path'], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o440
            )
            with os.fdopen(descriptor, 'wb') as output:
                output.write(raw)

    def step(self, name: str, command: list[str]) -> None:
        """Convenience entrypoint; containers use separate prepare/finish processes."""
        self.prepare(name)
        if name == 'internal-tls':
            command = command + ['--allow-initial-generation']
        subprocess.run(command, check=True)
        self.finish(name)

    def ready(self) -> None:
        self.load()
        inventory = self.inventory()
        self.verify_enabled_committed(inventory)
        for specification in self.configuration.secrets:
            if specification.name not in inventory:
                raise BootstrapError(f'Missing enabled output {specification.name}.')
        for step in self.configuration.steps:
            if step == 'object-storage':
                # Kubernetes starts this container only after the bounded bucket
                # init container exits successfully in this exact Pod.
                self.state['receipts'][step] = {
                    'generation': self.configuration.generation,
                    'podUID': self.pod_uid,
                }
            elif self.state['receipts'].get(step, {}).get('podUID') != self.pod_uid:
                raise BootstrapError(f'Step {step} has no receipt for this attempt.')
        self.state.update(files=inventory, credentialsReady=True)
        self.save()

    def complete(self) -> None:
        self.load()
        if not self.state['credentialsReady']:
            raise BootstrapError('Credentials are not ready.')
        self.verify_enabled_committed(self.inventory())
        for name in self.configuration.consumers:
            deployment = self.apps.read_namespaced_deployment(
                name, self.configuration.namespace, _request_timeout=API_TIMEOUT
            )
            desired = (
                deployment.spec.replicas if deployment.spec.replicas is not None else 1
            )
            if desired == 0:
                continue
            if (
                (deployment.spec.template.metadata.annotations or {}).get(GENERATION)
                != self.configuration.generation
                or (deployment.status.observed_generation or 0)
                < deployment.metadata.generation
                or (deployment.status.replicas or 0) != desired
                or (deployment.status.updated_replicas or 0) < desired
                or (deployment.status.ready_replicas or 0) < desired
                or (deployment.status.available_replicas or 0) < desired
            ):
                raise BootstrapError(
                    f'Consumer {name} has not completed the requested rollout.'
                )
        self.state['complete'] = True
        self.save()
        self.release()

    def snapshot(self, mappings: list[dict[str, Any]]) -> None:
        """Copy verified API bytes to the same emptyDir files applications consume."""
        files = {}
        if self.configuration.steps:
            self.load()
            if (
                not self.state.get('credentialsReady')
                or self.state.get('generation') != self.configuration.generation
            ):
                raise BootstrapError('Waiting for the requested credential generation.')
            files.update(self.state.get('files', {}))
        rotation = self.configuration.tls_rotation
        if rotation:
            receipt = self.core.read_namespaced_config_map(
                rotation['record'],
                self.configuration.namespace,
                _request_timeout=API_TIMEOUT,
            )
            labels = receipt.metadata.labels or {}
            state = json.loads(receipt.data['state.json'])
            if (
                labels.get('app.kubernetes.io/instance') != self.configuration.release
                or labels.get('app.kubernetes.io/managed-by')
                != 'osmo-internal-tls-bootstrap'
                or state.get('id') != rotation['id']
                or state.get('phase') != rotation['phase']
            ):
                raise BootstrapError('Waiting for the verified TLS rotation snapshot.')
            files.update(state['files'])
        snapshots = []
        absent = []
        for mapping in mappings:
            secret = self.optional_secret(mapping['secret'])
            if secret is None:
                raise BootstrapError('Waiting for a required credential.')
            identity = files.get(mapping['secret'], {})
            if mapping.get('optional') and mapping['key'] not in (secret.data or {}):
                if identity.get('uid') != secret.metadata.uid or mapping[
                    'key'
                ] in identity.get('keys', {}):
                    raise BootstrapError(
                        'Waiting for the verified optional credential snapshot.'
                    )
                absent.append(Path(mapping['path']))
                continue
            raw = base64.b64decode((secret.data or {})[mapping['key']], validate=True)
            if (
                identity.get('uid') != secret.metadata.uid
                or identity.get('keys', {}).get(mapping['key'])
                != hashlib.sha256(raw).hexdigest()
            ):
                raise BootstrapError('Waiting for the verified credential snapshot.')
            snapshots.append((Path(mapping['path']), raw))
        for path in absent:
            path.unlink(missing_ok=True)
        for path, raw in snapshots:
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o440)
            with os.fdopen(descriptor, 'wb') as output:
                output.write(raw)
        if os.environ.get('OSMO_BOOTSTRAP_DEX_CONFIG'):
            dex = yaml.safe_load(os.environ['OSMO_BOOTSTRAP_DEX_CONFIG'])
            for password in dex.get('staticPasswords') or []:
                environment_name = password.pop('hashFromEnv')
                password['hash'] = Path(
                    '/bootstrap-dex-env', environment_name
                ).read_text(encoding='utf-8')
            for oauth_client in dex.get('staticClients') or []:
                if oauth_client.pop('secretEnv', None):
                    oauth_client['secret'] = Path(
                        '/bootstrap-dex-env/browser-client-secret'
                    ).read_text(encoding='utf-8')
            descriptor = os.open(
                '/bootstrap-snapshot/config/config.yaml',
                os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
                0o440,
            )
            with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
                yaml.safe_dump(dex, output)


def _run() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--wait-seconds', type=int, default=300)
    parser.add_argument(
        'action',
        choices=['begin', 'step', 'prepare', 'finish', 'ready', 'complete', 'gate'],
    )
    parser.add_argument('arguments', nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    configuration = Configuration.read(arguments.config)
    config.load_incluster_config()
    api_client = BoundedApiClient()
    coordinator = Coordinator(
        configuration,
        client.CoreV1Api(api_client),
        client.AppsV1Api(api_client),
        client.CoordinationV1Api(api_client),
        os.environ.get('OSMO_POD_NAME', ''),
        os.environ.get('OSMO_POD_UID', ''),
    )
    deadline = time.monotonic() + arguments.wait_seconds
    while True:
        try:
            if arguments.action == 'step':
                coordinator.step(arguments.arguments[0], arguments.arguments[1:])
            elif arguments.action in ('prepare', 'finish'):
                getattr(coordinator, arguments.action)(arguments.arguments[0])
            elif arguments.action == 'gate':
                coordinator.snapshot(
                    json.loads(os.environ.get('OSMO_BOOTSTRAP_FILES', '[]'))
                )
            else:
                getattr(coordinator, arguments.action)()
            return
        except WaitingForConsumers:
            if arguments.action != 'begin' or time.monotonic() >= deadline:
                raise
            time.sleep(1)
        except BootstrapError, ApiException:
            if (
                arguments.action not in ('complete', 'gate')
                or time.monotonic() >= deadline
            ):
                raise
            time.sleep(1)


def record_issuance_if_configured(name: str) -> None:
    """Existing reconcilers participate only when invoked by the unified Job."""
    path = os.environ.get('OSMO_BOOTSTRAP_CONFIG')
    if not path:
        return
    configuration = Configuration.read(path)
    api_client = BoundedApiClient()
    coordinator = Coordinator(
        configuration,
        client.CoreV1Api(api_client),
        client.AppsV1Api(api_client),
        client.CoordinationV1Api(api_client),
        os.environ.get('OSMO_POD_NAME', ''),
        os.environ.get('OSMO_POD_UID', ''),
    )
    coordinator.record_issuance(name)


def main() -> None:
    try:
        _run()
    except BootstrapError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from None
    except ApiException as error:
        print(
            f'Bootstrap Kubernetes request failed (HTTP {error.status}).',
            file=sys.stderr,
        )
        raise SystemExit(1) from None
    except Exception as error:  # pylint: disable=broad-except
        # API errors and decoder exceptions may embed credential material.
        print(
            f'Bootstrap failed ({type(error).__name__}); inspect step status.',
            file=sys.stderr,
        )
        raise SystemExit(1) from None


if __name__ == '__main__':
    main()
