# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Semantic render regressions for the unified, ordinary bootstrap Job."""

import json
from pathlib import Path
import subprocess
import unittest

import yaml


CHART = Path(__file__).resolve().parents[1]
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


class SingleBootstrapTests(unittest.TestCase):
    def test_all_32_enable_combinations(self) -> None:
        for mask in range(32):
            with self.subTest(mask=mask):
                resources = render(mask)
                jobs = bootstrap_jobs(resources)
                self.assertEqual(
                    len([item for item in resources if item['kind'] == 'Job']),
                    int(mask != 0),
                    'Unexpected legacy bootstrap Job or hook',
                )
                self.assertEqual(len(jobs), int(mask != 0))
                if not jobs:
                    continue
                job = jobs[0]
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
    def test_node_selector_requires_string_values(self):
        for value in ('1', 'true', 'null'):
            with self.subTest(value=value), self.assertRaises(subprocess.CalledProcessError) as error:
                render(4, ['--set-json', f'bootstrap.nodeSelector={{"pool":{value}}}'])
            self.assertIn('bootstrap.nodeSelector.pool', error.exception.stderr.replace('/', '.'))
        for selector in ('null', '{}', '{"pool":"control"}'):
            render(4, ['--set-json', f'bootstrap.nodeSelector={selector}'])

    def test_dex_existing_secret_requires_a_name(self):
        chart = CHART.parent / 'dex-bootstrap'
        result = subprocess.run(
            ['helm', 'template', 'dex', str(chart), '--set', 'configSecret.create=false'],
            capture_output=True, text=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('configSecret.name is required', result.stderr)
        output = subprocess.check_output(
            ['helm', 'template', 'dex', str(chart), '--set', 'configSecret.create=false',
             '--set', 'configSecret.name=existing-config'], text=True,
        )
        deployment = next(item for item in yaml.safe_load_all(output)
                          if item and item['kind'] == 'Deployment')
        self.assertTrue(any(volume.get('secret', {}).get('secretName') == 'existing-config'
                            for volume in deployment['spec']['template']['spec']['volumes']))

    def test_dex_disruption_budget_requires_one_field_and_preserves_zero(self):
        command = ['helm', 'template', 'dex', str(CHART.parent / 'dex-bootstrap'),
                   '--set', 'podDisruptionBudget.enabled=true']
        for field in ('minAvailable', 'maxUnavailable'):
            output = subprocess.check_output(
                command + ['--set', f'podDisruptionBudget.{field}=0'], text=True,
            )
            budget = next(item for item in yaml.safe_load_all(output)
                          if item and item['kind'] == 'PodDisruptionBudget')
            self.assertEqual(budget['spec'][field], 0)
            other = 'minAvailable' if field == 'maxUnavailable' else 'maxUnavailable'
            self.assertNotIn(other, budget['spec'])
        for extra in ([], ['--set', 'podDisruptionBudget.minAvailable=0',
                           '--set', 'podDisruptionBudget.maxUnavailable=1']):
            result = subprocess.run(command + extra, capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('requires exactly one', result.stderr)


if __name__ == '__main__':
    unittest.main()
