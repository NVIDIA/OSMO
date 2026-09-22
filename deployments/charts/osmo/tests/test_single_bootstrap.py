# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Semantic render regressions for the unified, ordinary bootstrap Job."""

import copy
import dataclasses
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Any, cast
import unittest
from unittest import mock

from kubernetes import client as kubernetes_client
from kubernetes.client import exceptions as kubernetes_exceptions
import yaml

from src.utils import bootstrap, identity_bootstrap


CHART = Path(__file__).parents[1]
NAMES = [
    'internal-tls-bootstrap',
    'identity-bootstrap',
    'bootstrap-service-auth',
    'mek-lifecycle',
    'object-storage-bootstrap',
]
FLAGS = [
    'gateway.tls.enabled',
    'authentication.bootstrap.identities.backend-operator-default.enabled',
    'secrets.serviceAuth.bootstrap.enabled',
    'secrets.masterEncryptionKey.bootstrap.enabled',
    'embeddedDependencies.objectStorage.enabled',
]


def setUpModule() -> None:
    """Build locked dependencies in a private chart, including on a clean checkout."""
    global CHART
    temporary = tempfile.TemporaryDirectory(prefix='osmo-bootstrap-render-')
    unittest.addModuleCleanup(temporary.cleanup)
    root = Path(temporary.name)
    chart = root / 'osmo'
    # Exclude downloaded archives so local runs exercise the same setup as CI.
    shutil.copytree(CHART, chart, ignore=shutil.ignore_patterns('charts', '__pycache__'))
    environment = {
        **os.environ,
        'HELM_REPOSITORY_CONFIG': str(root / 'repositories.yaml'),
        'HELM_REPOSITORY_CACHE': str(root / 'repository-cache'),
    }
    dependencies = yaml.safe_load((chart / 'Chart.lock').read_text())['dependencies']
    for dependency in dependencies:
        if dependency['repository'].startswith('https://'):
            subprocess.run(
                ['helm', 'repo', 'add', dependency['name'], dependency['repository']],
                check=True, env=environment, timeout=60,
            )
    subprocess.run(
        ['helm', 'dependency', 'build', str(chart)],
        check=True, env=environment, timeout=180,
    )
    subprocess.run(
        ['bash', str(chart / 'tests/verify_dex_chart_archive.sh'),
         str(chart / 'charts/dex-0.24.1.tgz')],
        check=True, timeout=30,
    )
    CHART = chart


def render(mask: int, extra: list[str] | None = None) -> list[dict]:
    command = [
        'helm',
        'template',
        'bootstrap-matrix',
        str(CHART),
        '--namespace',
        'test',
        '-f',
        str(CHART / 'profiles/split-plane-control.yaml'),
        '-f',
        str(CHART / 'tests/control-external-values.yaml'),
        '--set',
        'secrets.serviceAuth.managementMode=osmo',
        '--set',
        'secrets.masterEncryptionKey.managementMode=osmo',
    ]
    for bit, flag in enumerate(FLAGS):
        command += ['--set', f'{flag}={str(bool(mask & (1 << bit))).lower()}']
    if mask & 16:
        for key in [
            'locations.workflows',
            'locations.logs',
            'locations.apps',
            's3.region',
            's3.overrideUrl',
        ]:
            command += ['--set-string', f'externalDependencies.objectStorage.{key}=']
        command += [
            '--set',
            'secrets.objectStorage.generate=true',
            '--set-string',
            'secrets.objectStorage.existingSecret=',
        ]
    result = subprocess.run(
        command + (extra or []), check=True, capture_output=True, text=True, timeout=30
    )
    return [item for item in yaml.safe_load_all(result.stdout) if item]


def bootstrap_jobs(resources: list[dict]) -> list[dict]:
    return [
        item
        for item in resources
        if item['kind'] == 'Job'
        and item['metadata'].get('labels', {}).get('app.kubernetes.io/component')
        == 'bootstrap'
    ]


class FakeCoreApi:
    def __init__(self) -> None:
        self.secrets: dict[str, kubernetes_client.V1Secret] = {}
        self.config_maps: dict[str, kubernetes_client.V1ConfigMap] = {}
        self.revision = 0

    def _persist(self, resource: Any) -> Any:
        self.revision += 1
        metadata = resource.metadata
        if not metadata.uid:
            metadata.uid = f'uid-{self.revision}'
        metadata.resource_version = str(self.revision)
        return copy.deepcopy(resource)

    def read_namespaced_secret(
        self, name: str, namespace: str, **_kwargs: object
    ) -> kubernetes_client.V1Secret:
        del namespace
        try:
            return copy.deepcopy(self.secrets[name])
        except KeyError as error:
            raise kubernetes_exceptions.ApiException(status=404) from error

    def create_namespaced_secret(
        self,
        namespace: str,
        body: kubernetes_client.V1Secret,
        **_kwargs: object,
    ) -> kubernetes_client.V1Secret:
        del namespace
        name = body.metadata.name
        if name in self.secrets:
            raise kubernetes_exceptions.ApiException(status=409)
        self.secrets[name] = self._persist(body)
        return copy.deepcopy(self.secrets[name])

    def replace_namespaced_secret(
        self,
        name: str,
        namespace: str,
        body: kubernetes_client.V1Secret,
        **_kwargs: object,
    ) -> kubernetes_client.V1Secret:
        del namespace
        if name not in self.secrets:
            raise kubernetes_exceptions.ApiException(status=404)
        body.metadata.uid = self.secrets[name].metadata.uid
        self.secrets[name] = self._persist(body)
        return copy.deepcopy(self.secrets[name])

    def read_namespaced_config_map(
        self, name: str, namespace: str, **_kwargs: object
    ) -> kubernetes_client.V1ConfigMap:
        del namespace
        try:
            return copy.deepcopy(self.config_maps[name])
        except KeyError as error:
            raise kubernetes_exceptions.ApiException(status=404) from error

    def create_namespaced_config_map(
        self,
        namespace: str,
        body: kubernetes_client.V1ConfigMap,
        **_kwargs: object,
    ) -> kubernetes_client.V1ConfigMap:
        del namespace
        name = body.metadata.name
        if name in self.config_maps:
            raise kubernetes_exceptions.ApiException(status=409)
        self.config_maps[name] = self._persist(body)
        return copy.deepcopy(self.config_maps[name])

    def replace_namespaced_config_map(
        self,
        name: str,
        namespace: str,
        body: kubernetes_client.V1ConfigMap,
        **_kwargs: object,
    ) -> kubernetes_client.V1ConfigMap:
        del namespace
        if name not in self.config_maps:
            raise kubernetes_exceptions.ApiException(status=404)
        body.metadata.uid = self.config_maps[name].metadata.uid
        self.config_maps[name] = self._persist(body)
        return copy.deepcopy(self.config_maps[name])


class FakeCoordinationApi:
    def __init__(self) -> None:
        self.lease: kubernetes_client.V1Lease | None = None
        self.revision = 0

    def read_namespaced_lease(
        self, name: str, namespace: str, **_kwargs: object
    ) -> kubernetes_client.V1Lease:
        del name, namespace
        if self.lease is None:
            raise kubernetes_exceptions.ApiException(status=404)
        return copy.deepcopy(self.lease)

    def create_namespaced_lease(
        self, namespace: str, body: dict, **_kwargs: object
    ) -> kubernetes_client.V1Lease:
        del namespace
        self.revision += 1
        self.lease = kubernetes_client.V1Lease(
            metadata=kubernetes_client.V1ObjectMeta(
                name=body['metadata']['name'], resource_version=str(self.revision)
            ),
            spec=kubernetes_client.V1LeaseSpec(),
        )
        return copy.deepcopy(self.lease)

    def patch_namespaced_lease(
        self, name: str, namespace: str, body: dict, **_kwargs: object
    ) -> kubernetes_client.V1Lease:
        del name, namespace
        if self.lease is None:
            raise kubernetes_exceptions.ApiException(status=404)
        self.revision += 1
        self.lease.metadata.resource_version = str(self.revision)
        self.lease.spec.holder_identity = body['spec']['holderIdentity']
        return copy.deepcopy(self.lease)


class RenderedIdentityLifecycle:
    def __init__(self) -> None:
        self.core = FakeCoreApi()
        self.coordination = FakeCoordinationApi()
        self.attempt = 0
        self.generations: list[str] = []

    def run(
        self, resources: list[dict]
    ) -> dict[str, tuple[str, dict[str, str]]]:
        job = bootstrap_jobs(resources)[0]
        configuration_json = next(
            item['data']['config.json']
            for item in resources
            if item['kind'] == 'ConfigMap'
            and item['metadata']['name'] == job['metadata']['name'] + '-config'
        )
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'config.json'
            path.write_text(configuration_json, encoding='utf-8')
            configuration = bootstrap.Configuration.read(str(path))
        configuration = dataclasses.replace(configuration, consumers=[])
        self.generations.append(configuration.generation)

        identity_container = next(
            item
            for item in job['spec']['template']['spec']['initContainers']
            if item['name'] == 'identity-bootstrap'
        )
        arguments = identity_container['args']
        token_specs = []
        for index, argument in enumerate(arguments):
            if argument != '--token':
                continue
            identity, secret_name = arguments[index + 1].split('=', 1)
            identity_id, token_name = identity.split('/', 1)
            token_specs.append(
                identity_bootstrap.TokenSpec(identity_id, token_name, secret_name)
            )

        self.attempt += 1
        coordinator = bootstrap.Coordinator(
            configuration,
            self.core,
            None,
            self.coordination,
            f'pod-{self.attempt}',
            f'pod-uid-{self.attempt}',
        )
        coordinator.begin()
        coordinator.prepare('identity')
        with mock.patch.object(
            identity_bootstrap,
            'record_issuance_if_configured',
            side_effect=coordinator.record_issuance,
        ):
            identity_bootstrap.reconcile_identities(
                cast(kubernetes_client.CoreV1Api, self.core),
                namespace=configuration.namespace,
                release_name=configuration.release,
                password_specs=(),
                token_specs=tuple(token_specs),
                oauth_secret_name=None,
                dex_hash_secret_name=None,
            )
        coordinator.finish('identity')
        coordinator.ready()
        coordinator.complete()
        return {
            specification.name: (
                self.core.secrets[specification.name].metadata.uid,
                copy.deepcopy(self.core.secrets[specification.name].data),
            )
            for specification in configuration.secrets
            if specification.step == 'identity'
        }

    def delete(self, name: str) -> None:
        del self.core.secrets[name]

    def secret(self, name: str) -> kubernetes_client.V1Secret:
        return copy.deepcopy(self.core.secrets[name])


class SingleBootstrapTests(unittest.TestCase):
    def test_rendered_coordinator_preserves_then_recreates_managed_secret(
        self,
    ) -> None:
        lifecycle = RenderedIdentityLifecycle()
        first = lifecycle.run(render(2))
        second = lifecycle.run(render(2, [
            '--set-string', 'gateway.tls.generated.leafRotationNonce=second',
        ]))
        self.assertNotEqual(lifecycle.generations[0], lifecycle.generations[1])
        self.assertEqual(second, first)

        missing = 'osmo-backend-token'
        lifecycle.delete(missing)
        third = lifecycle.run(render(2, [
            '--set-string', 'gateway.tls.generated.leafRotationNonce=third',
        ]))
        self.assertNotEqual(third[missing][0], first[missing][0])
        self.assertNotEqual(third[missing][1], first[missing][1])
        secret = lifecycle.secret(missing)
        self.assertEqual(
            secret.metadata.labels,
            {
                'app.kubernetes.io/managed-by': 'osmo-identity-bootstrap',
                'app.kubernetes.io/instance': 'bootstrap-matrix',
            },
        )
    def test_all_32_enable_combinations(self) -> None:
        for mask in range(32):
            with self.subTest(mask=mask):
                resources = render(mask)
                jobs = bootstrap_jobs(resources)
                self.assertEqual(
                    len([item for item in resources if item['kind'] == 'Job']),
                    int(mask != 0) + int(bool(mask & 2)),
                    'Unexpected bootstrap or migration Job',
                )
                self.assertEqual(len(jobs), int(mask != 0))
                if not jobs:
                    continue
                job = jobs[0]
                configuration = json.loads(next(
                    item['data']['config.json']
                    for item in resources
                    if item['kind'] == 'ConfigMap'
                    and item['metadata']['name']
                    == job['metadata']['name'] + '-config'
                ))
                self.assertNotIn('initialization_id', configuration)
                specification = job['spec']
                pod = specification['template']['spec']
                self.assertEqual(specification['backoffLimit'], 0)
                self.assertGreater(specification['activeDeadlineSeconds'], 0)
                self.assertNotIn('ttlSecondsAfterFinished', specification)
                self.assertNotIn('helm.sh/hook', job['metadata'].get('annotations', {}))
                expected = (
                    ['install-supervisor', 'begin']
                    + [name for bit, name in enumerate(NAMES) if mask & (1 << bit)]
                    + ['ready']
                )
                self.assertEqual(
                    [item['name'] for item in pod['initContainers']], expected
                )
                self.assertEqual(
                    [item['name'] for item in pod['containers']], ['complete']
                )
                for container in pod['initContainers'][2:-1]:
                    self.assertEqual(
                        container['command'], ['/bootstrap-tools/bootstrap-step']
                    )
                    self.assertIn('--timeout', container['args'])
                    if container['name'] == 'object-storage-bootstrap':
                        self.assertNotIn(
                            'service-auth',
                            [mount['name'] for mount in container['volumeMounts']],
                        )
                volumes = {volume['name']: volume for volume in pod['volumes']}
                if mask & 4:
                    self.assertIn('emptyDir', volumes['service-auth'])
                    self.assertEqual(
                        volumes['service-auth']['emptyDir']['medium'], 'Memory'
                    )
                roles = [
                    item
                    for item in resources
                    if item['kind'] == 'Role'
                    and item['metadata']['name'] == job['metadata']['name']
                ]
                self.assertEqual(len(roles), 1)
                rules = json.dumps(roles[0]['rules'])
                for bit, secret in [
                    (0, 'internal-tls-ca'),
                    (1, 'osmo-backend-token'),
                    (2, 'osmo-service-auth'),
                    (3, 'external-master-encryption-key-secret'),
                ]:
                    self.assertEqual(secret in rules, bool(mask & (1 << bit)))

    def test_attempt_changes_only_job_generation(self) -> None:
        before = render(31)
        after = render(31, ['--set-string', 'bootstrap.attempt=retry-1'])
        self.assertNotEqual(
            bootstrap_jobs(before)[0]['metadata']['name'],
            bootstrap_jobs(after)[0]['metadata']['name'],
        )
        deployments = lambda items: [
            item for item in items if item['kind'] == 'Deployment'
        ]
        self.assertEqual(deployments(before), deployments(after))
        self.assertEqual(bootstrap_jobs(before), bootstrap_jobs(render(31)))

    def test_disabled_attempt_does_not_recreate_job(self) -> None:
        before = bootstrap_jobs(render(1))
        after = bootstrap_jobs(
            render(
                1,
                [
                    '--set-string',
                    'secrets.serviceAuth.bootstrap.attempt=disabled-retry',
                    '--set-string',
                    'secrets.masterEncryptionKey.bootstrap.attempt=disabled-retry',
                ],
            )
        )
        self.assertEqual(before, after)

    def test_effective_immutable_inputs_change_job_name(self) -> None:
        baseline = bootstrap_jobs(render(31))[0]['metadata']['name']
        changes = [
            ['--set-string', 'imagePullSecrets[0].name=private-registry'],
            ['--set-string', 'commonLabels.test-label=changed'],
            ['--set-string', 'bootstrap.nodeSelector.test-pool=bootstrap'],
            ['--set-string', 'services.api.image.tag=candidate'],
            [
                '--set-string',
                'embeddedDependencies.objectStorage.bootstrap.resources.requests.cpu=75m',
            ],
            ['--set-string', 'secrets.serviceAuth.bootstrap.attempt=retry'],
            ['--set-string', 'secrets.masterEncryptionKey.bootstrap.attempt=retry'],
        ]
        for change in changes:
            with self.subTest(change=change):
                self.assertNotEqual(
                    bootstrap_jobs(render(31, change))[0]['metadata']['name'], baseline
                )

    def test_step_resources_and_retries_are_individual(self) -> None:
        resources = render(
            31,
            [
                '--set-string',
                'secrets.serviceAuth.bootstrap.resources.requests.cpu=123m',
                '--set-string',
                'embeddedDependencies.objectStorage.bootstrap.resources.requests.cpu=77m',
                '--set',
                'embeddedDependencies.objectStorage.bootstrap.backoffLimit=2',
                '--set',
                'secrets.serviceAuth.bootstrap.activeDeadlineSeconds=45',
            ],
        )
        pod = bootstrap_jobs(resources)[0]['spec']['template']['spec']
        containers = {item['name']: item for item in pod['initContainers']}
        auth = containers['bootstrap-service-auth']
        storage = containers['object-storage-bootstrap']
        self.assertEqual(auth['resources']['requests']['cpu'], '123m')
        self.assertEqual(storage['resources']['requests']['cpu'], '77m')
        self.assertEqual(auth['args'][:4], ['--timeout', '45s', '--retries', '0'])
        self.assertEqual(storage['args'][2:4], ['--retries', '2'])
        self.assertFalse(any('POSTGRES' in item['name'] for item in auth['env']))
        roles = [
            item
            for item in resources
            if item['kind'] == 'Role'
            and item['metadata']['name']
            == bootstrap_jobs(resources)[0]['metadata']['name']
        ]
        # Service-auth reads are name-scoped. Kubernetes RBAC cannot name-scope
        # create; that permission applies to the release namespace.
        secret_rules = [
            rule for rule in roles[0]['rules'] if 'secrets' in rule['resources']
        ]
        service_auth_rules = [
            rule
            for rule in secret_rules
            if 'osmo-service-auth' in rule.get('resourceNames', [])
        ]
        self.assertEqual(service_auth_rules[0]['verbs'], ['get'])

    def test_conflicting_legacy_scheduling_is_actionable(self) -> None:
        with self.assertRaises(subprocess.CalledProcessError) as error:
            render(
                4,
                [
                    '--set-string',
                    'services.api.pod.nodeSelector.pool=api',
                    '--set-string',
                    'secrets.serviceAuth.bootstrap.nodeSelector.pool=auth',
                ],
            )
        self.assertIn('set bootstrap.nodeSelector explicitly', error.exception.stderr)
        resources = render(
            4,
            [
                '--set-string',
                'secrets.serviceAuth.bootstrap.nodeSelector.pool=auth',
                '--set-string',
                'bootstrap.nodeSelector.pool=shared',
            ],
        )
        self.assertEqual(
            bootstrap_jobs(resources)[0]['spec']['template']['spec']['nodeSelector'],
            {'pool': 'shared'},
        )

    def test_tls_configuration_changes_consumer_generation(self) -> None:
        before = render(1)
        after = render(
            1, ['--set-string', 'gateway.tls.generated.leafRotationNonce=refresh']
        )

        def generations(items):
            return [
                (item['spec']['template']['metadata'].get('annotations') or {}).get(
                    'osmo.nvidia.com/bootstrap-generation'
                )
                for item in items
                if item['kind'] == 'Deployment'
            ]

        self.assertNotEqual(generations(before), generations(after))

    def test_same_rotation_phase_hostname_change_rolls_consumers(self) -> None:
        rotation = [
            '--set-string',
            'gateway.tls.generated.caRotation.id=rotation-1',
            '--set-string',
            'gateway.tls.generated.caRotation.phase=prepare',
            '--set',
            'gateway.tls.generated.caRotation.freezeHpas=true',
        ]

        def api_generation(resources):
            api = next(
                item
                for item in resources
                if item['kind'] == 'Deployment'
                and item['metadata']
                .get('labels', {})
                .get('app.kubernetes.io/component')
                == 'api'
            )
            return api['spec']['template']['metadata']['annotations'][
                'osmo.nvidia.com/bootstrap-generation'
            ]

        before = render(1, rotation)
        after = render(
            1, rotation + ['--set-string', 'gateway.upstreams.api.host=alternate-api']
        )
        self.assertNotEqual(api_generation(before), api_generation(after))
        self.assertFalse(bootstrap_jobs(before))

    def test_long_names_preserve_ca_and_separate_retained_records(self) -> None:
        configurations = []
        for suffix in ('a', 'b'):
            fullname = 'x' * 46 + suffix
            resources = render(1, ['--set-string', 'fullnameOverride=' + fullname])
            configuration = next(
                json.loads(item['data']['config.json'])
                for item in resources
                if item['kind'] == 'ConfigMap' and 'config.json' in item.get('data', {})
            )
            specifications = configuration['secrets']
            ca = next(item for item in specifications if 'ca.key' in item['keys'])
            self.assertEqual(
                ca['name'], (fullname + '-internal-tls-ca')[:63].rstrip('-')
            )
            names = [item['name'] for item in specifications]
            self.assertEqual(len(names), len(set(names)))
            self.assertTrue(all(len(name) <= 63 for name in names))
            configurations.append(configuration)
        self.assertNotEqual(configurations[0]['record'], configurations[1]['record'])

    def test_long_consumer_names_have_unique_resources_and_permissions(self) -> None:
        for length in (40, 47):
            resources = render(1, ['--set-string', 'fullnameOverride=' + 'x' * length])
            identities = [(item['kind'], item['metadata'].get('namespace', ''),
                           item['metadata']['name']) for item in resources]
            self.assertEqual(len(identities), len(set(identities)))
            by_name = {(item['kind'], item['metadata']['name']): item for item in resources}
            gates = []
            for resource in resources:
                if resource['kind'] != 'Deployment':
                    continue
                pod = resource['spec']['template']['spec']
                gate = next((item for item in pod.get('initContainers', [])
                             if item['name'] == 'bootstrap-credentials'), None)
                if not gate:
                    continue
                name = next(volume['configMap']['name'] for volume in pod['volumes']
                            if volume['name'] == 'bootstrap-gate-config')
                gates.append(name)
                self.assertLessEqual(len(name), 63)
                self.assertIn(('ConfigMap', name), by_name)
                binding = by_name['RoleBinding', name]
                self.assertEqual(binding['roleRef']['name'], name)
                self.assertEqual(binding['subjects'][0]['name'], pod['serviceAccountName'])
                mappings = json.loads(next(item['value'] for item in gate['env']
                                           if item['name'] == 'OSMO_BOOTSTRAP_FILES'))
                allowed = {secret for rule in by_name['Role', name]['rules']
                           if rule['resources'] == ['secrets']
                           for secret in rule['resourceNames']}
                self.assertEqual(allowed, {item['secret'] for item in mappings})
            self.assertGreater(len(gates), 1)
            self.assertEqual(len(gates), len(set(gates)))

    def test_gate_populates_the_actual_application_volume(self) -> None:
        resources = render(31)
        for resource in resources:
            if resource['kind'] != 'Deployment':
                continue
            pod = resource['spec']['template']['spec']
            gates = [
                item
                for item in pod.get('initContainers', [])
                if item['name'] == 'bootstrap-credentials'
            ]
            if (
                resource['metadata']
                .get('labels', {})
                .get('app.kubernetes.io/component')
                == 'api'
            ):
                self.assertEqual(
                    len(gates), 1, 'API must load verified credential files.'
                )
            if not gates:
                continue
            gate = gates[0]
            mappings = json.loads(
                next(
                    item['value']
                    for item in gate['env']
                    if item['name'] == 'OSMO_BOOTSTRAP_FILES'
                )
            )
            if (
                resource['metadata']
                .get('labels', {})
                .get('app.kubernetes.io/component')
                == 'api'
            ):
                previous = [
                    item
                    for item in mappings
                    if item['secret'] == 'osmo-backend-token'
                    and item['key'] == 'previous-token'
                ]
                self.assertEqual(len(previous), 1)
                self.assertTrue(previous[0]['optional'])
            volumes = {volume['name']: volume for volume in pod['volumes']}
            for mapping in mappings:
                mount = next(
                    item
                    for item in gate['volumeMounts']
                    if mapping['path'].startswith(item['mountPath'] + '/')
                )
                self.assertIn('emptyDir', volumes[mount['name']])
                self.assertTrue(
                    any(
                        mount['name'] == application_mount['name']
                        for container in pod['containers']
                        for application_mount in container.get('volumeMounts', [])
                    )
                )


class BootstrapInputValidationTest(unittest.TestCase):
    def test_upstream_dex_keeps_its_independent_bootstrap_hooks(self) -> None:
        options = [
            '--set', 'authentication.provider=embeddedDex',
            '--set', 'embeddedDependencies.dex.enabled=true',
            '--set', 'authentication.bootstrap.identities.admin.enabled=true',
        ]
        for mask in (0, 31):
            with self.subTest(mask=mask):
                extra = [] if mask else ['--set', 'authentication.bootstrap.identities.admin.tokens.primary=null']
                resources = render(mask, options + extra)
                jobs = bootstrap_jobs(resources)
                self.assertEqual(len(jobs), int(bool(mask)))
                hooks = [item for item in resources if item['kind'] == 'Job'
                         and 'helm.sh/hook' in item['metadata'].get('annotations', {})
                         and item['metadata']['labels'].get('app.kubernetes.io/component')
                         == 'identity-bootstrap']
                self.assertEqual(len(hooks), 2)
                self.assertEqual(
                    {hook['metadata']['annotations']['helm.sh/hook'] for hook in hooks},
                    {'pre-install,pre-upgrade', 'post-install,post-upgrade'},
                )
                for hook in hooks:
                    arguments = hook['spec']['template']['spec']['containers'][0]['args']
                    self.assertIn('--password', arguments)
                    self.assertIn('--dex-hash-secret-name', arguments)
                    self.assertIn('--oauth-secret-name', arguments)
                    self.assertNotIn('--token', arguments)
                    self.assertEqual('--config-rollout-identity' in arguments,
                                     hook['metadata']['name'].endswith('-post'))
                dex = next(item for item in resources if item['kind'] == 'Deployment'
                           and item['metadata']['name'] == 'osmo-dex')
                pod = dex['spec']['template']['spec']
                self.assertNotIn('bootstrap-credentials', [item['name'] for item in pod.get('initContainers', [])])
                config = next(volume for volume in pod['volumes'] if volume['name'] == 'config')
                self.assertEqual(config['secret']['secretName'], 'osmo-dex-config')
                container = next(item for item in pod['containers'] if item['name'] == 'dex')
                self.assertIn({'secretRef': {'name': 'osmo-embedded-dex-password-hashes'}}, container['envFrom'])
                self.assertIn({'name': 'config', 'mountPath': '/etc/dex', 'readOnly': True}, container['volumeMounts'])
                if jobs:
                    job = jobs[0]
                    step = next(item for item in job['spec']['template']['spec']['initContainers']
                                if item['name'] == 'identity-bootstrap')
                    self.assertIn('--token', step['args'])
                    for argument in ('--password', '--oauth-secret-name', '--dex-hash-secret-name'):
                        self.assertNotIn(argument, step['args'])
                    config_map = next(item for item in resources if item['kind'] == 'ConfigMap'
                                      and item['metadata']['name'] == job['metadata']['name'] + '-config')
                    configuration = json.loads(config_map['data']['config.json'])
                    self.assertFalse(any('dex' in secret['name'] for secret in configuration['secrets']))
                    self.assertFalse(any('dex' in name or 'oauth2-proxy' in name
                                         for name in configuration['consumers']))

    def test_token_migration_has_separate_hooks_and_exact_permissions(self) -> None:
        for mask in range(32):
            resources = render(mask)
            migrations = [item for item in resources if item['kind'] == 'Job'
                          and item['metadata'].get('labels', {}).get(
                              'app.kubernetes.io/component') == 'identity-token-migration']
            self.assertEqual(len(migrations), int(bool(mask & 2)))
            if not migrations:
                continue
            job = migrations[0]
            annotations = job['metadata']['annotations']
            self.assertEqual(annotations['helm.sh/hook'], 'pre-install,pre-upgrade')
            self.assertEqual(annotations['helm.sh/hook-weight'], '-30')
            self.assertNotIn('hook-failed', annotations['helm.sh/hook-delete-policy'])
            self.assertEqual(job['spec']['backoffLimit'], 0)
            self.assertGreater(job['spec']['activeDeadlineSeconds'], 0)
            pod = job['spec']['template']['spec']
            self.assertNotIn('initContainers', pod)
            self.assertFalse(pod['automountServiceAccountToken'])
            self.assertEqual([volume['name'] for volume in pod['volumes']], ['kubernetes-api'])
            arguments = pod['containers'][0]['args']
            self.assertIn('--migrate-tokens-only', arguments)
            self.assertIn('backend-operator-default/primary=osmo-backend-token', arguments)
            self.assertNotIn('--password', arguments)
            role = next(item for item in resources if item['kind'] == 'Role'
                        and item['metadata']['name'] == job['metadata']['name'])
            self.assertEqual(role['rules'], [{'apiGroups': [''], 'resources': ['secrets'],
                                            'resourceNames': ['osmo-backend-token'],
                                            'verbs': ['get', 'patch']}])
        for options in (
            ['--set', 'authentication.bootstrap.tokenMigration.enabled=false'],
        ):
            resources = render(31, options)
            self.assertFalse(any(item['metadata'].get('labels', {}).get(
                'app.kubernetes.io/component') == 'identity-token-migration'
                for item in resources))
        enabled = bootstrap_jobs(render(31))[0]
        disabled = bootstrap_jobs(render(31, [
            '--set', 'authentication.bootstrap.tokenMigration.enabled=false']))[0]
        self.assertEqual(enabled, disabled)

    def test_node_selector_requires_string_values(self) -> None:
        for value in ('1', 'true', 'null'):
            with self.subTest(value=value), self.assertRaises(subprocess.CalledProcessError) as error:
                render(4, ['--set-json', f'bootstrap.nodeSelector={{"pool":{value}}}'])
            self.assertIn('bootstrap.nodeSelector.pool', error.exception.stderr.replace('/', '.'))
        for selector in ('null', '{}', '{"pool":"control"}'):
            render(4, ['--set-json', f'bootstrap.nodeSelector={selector}'])


if __name__ == '__main__':
    unittest.main()
