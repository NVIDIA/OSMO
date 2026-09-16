# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Real-cluster regressions for the single ordinary bootstrap Job.

Use the explicit bootstrap-kind OETF environment and immutable, locally loaded
baseline/candidate images. Each case owns a unique namespace; failures preserve
redacted Kubernetes evidence through the shared OETF fixture.
"""

import base64
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import secrets
import urllib.error
import urllib.request
import subprocess
import time
import unittest

import yaml

from test.oetf.cluster_fixture import ClusterFixture
from test.oetf.embedded_auth import EmbeddedAuthAssertions


STEP_NAMES = [
    'internal-tls-bootstrap',
    'identity-bootstrap',
    'bootstrap-service-auth',
    'mek-lifecycle',
    'object-storage-bootstrap',
]


class BootstrapLifecycleKind(EmbeddedAuthAssertions, ClusterFixture):
    """Exercise ordered OSMO bootstrap and independent Dex hooks on disposable KIND."""

    def setUp(self) -> None:
        super().setUp()
        self.values = yaml.safe_load(
            (self.chart_path() / 'tests/bootstrap-kind-values.yaml').read_text()
        )
        self.values['bootstrap']['initializationId'] = self.namespace
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            self.port = listener.getsockname()[1]
        self.values['externalUrl'] = f'http://127.0.0.1:{self.port}'
        self.set_image(self.values, os.environ['OETF_BOOTSTRAP_IMAGE'])

    @staticmethod
    def set_image(values: dict, image: str) -> None:
        name, separator, digest = image.partition('@')
        if not separator or not digest.startswith('sha256:'):
            raise RuntimeError('Lifecycle tests require an image pinned with @sha256:.')
        registry, _, repository = name.partition('/')
        values['services']['api']['image'] = {
            'registry': registry,
            'repository': repository,
            'digest': digest,
            'tag': '',
            'pullPolicy': 'IfNotPresent',
        }

    def assert_sequence(self, expected: list[str] | None = None) -> dict:
        if expected is None:
            expected = STEP_NAMES
        job = self.bootstrap_job()
        assert job is not None
        self.assertEqual(len(self.jobs()), 1, 'Unexpected extra bootstrap or hook Job.')
        self.assertNotIn('helm.sh/hook', job['metadata'].get('annotations', {}))
        pod = job['spec']['template']['spec']
        self.assertEqual(
            [item['name'] for item in pod['initContainers']],
            ['install-supervisor', 'begin'] + expected + ['ready'],
        )
        self.assertEqual([item['name'] for item in pod['containers']], ['complete'])
        actual = self.job_pod(job)
        assert actual is not None
        expected_digest = os.environ['OETF_BOOTSTRAP_IMAGE'].split('@', 1)[1]
        installed = next(
            item
            for item in actual['status']['initContainerStatuses']
            if item['name'] == 'install-supervisor'
        )
        self.assertIn(expected_digest, installed['imageID'])
        return job

    def authenticate(self, *, login_email: str = 'admin@osmo.local') -> str:
        password = base64.b64decode(
            self.kube_json(['get', 'secret', 'osmo-embedded-dex-admin'])['data'][
                'password'
            ]
        )
        with self.port_forward('service/osmo-gateway', 80, self.port):
            return self._authenticate_embedded_admin(
                self.values['externalUrl'], password, login_email=login_email
            )

    def failed_step(self, name: str, message: str | tuple[str, ...]) -> dict:
        job = self.wait_job(False)
        pod = self.job_pod(job)
        assert pod is not None
        self.assertEqual(pod['status']['phase'], 'Failed')
        statuses = {
            item['name']: item for item in pod['status']['initContainerStatuses']
        }
        self.assertNotEqual(statuses[name]['state']['terminated']['exitCode'], 0)
        output = self.kube(['logs', pod['metadata']['name'], '-c', name]).stdout
        messages = (message,) if isinstance(message, str) else message
        self.assertTrue(
            any(item in output for item in messages),
            f'Failure was not attributed to {messages}.',
        )
        if name != 'begin':
            self.assertFalse(self.record().get('complete', False))
        return job

    def assert_application_files(self) -> None:
        pod = self.kube_json(['get', 'pods', '-l', 'app.kubernetes.io/component=api'])[
            'items'
        ][0]
        gate = next(
            item
            for item in pod['spec']['initContainers']
            if item['name'] == 'bootstrap-credentials'
        )
        mappings = json.loads(
            next(
                item['value']
                for item in gate['env']
                if item['name'] == 'OSMO_BOOTSTRAP_FILES'
            )
        )
        application = pod['spec']['containers'][0]
        expected = {}
        for mapping in mappings:
            gate_mount = next(
                item
                for item in gate['volumeMounts']
                if mapping['path'].startswith(item['mountPath'] + '/')
            )
            relative = mapping['path'][len(gate_mount['mountPath']) + 1 :]
            mount = next(
                item
                for item in application['volumeMounts']
                if item['name'] == gate_mount['name']
            )
            if mount.get('subPath'):
                self.assertEqual(mount['subPath'], relative)
                path = mount['mountPath']
            else:
                path = mount['mountPath'] + '/' + relative
            data = self.kube_json(['get', 'secret', mapping['secret']])['data']
            value = data.get(mapping['key'])
            expected[path] = (
                hashlib.sha256(base64.b64decode(value)).hexdigest() if value else None
            )
        self.assertTrue(expected)
        # Return hashes only; credential bytes never leave the running application.
        script = (
            'import hashlib,json,pathlib,sys; '
            'print(json.dumps({p:hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() '
            'if pathlib.Path(p).exists() else None for p in json.loads(sys.argv[1])}))'
        )
        actual = self.kube(
            [
                'exec',
                pod['metadata']['name'],
                '-c',
                application['name'],
                '--',
                '/opt/osmo-python/bin/python3.14',
                '-c',
                script,
                json.dumps(list(expected)),
            ]
        ).stdout
        self.assertEqual(json.loads(actual), expected)

    def test_bootstrap_fresh_install(self) -> None:
        self.assertEqual(self.kube_json(['get', 'secrets'])['items'], [])
        self.install(self.values)
        self.assert_sequence()
        self.assertTrue(self.record()['complete'])
        self.assertTrue(self.record()['credentialsReady'])
        self.assert_application_files()
        self.authenticate()

    def test_bootstrap_generation_upgrade(self) -> None:
        self.install(self.values)
        before = self.secret_identities(list(self.record()['committed']))
        old_generation = self.record()['generation']
        old_uid = self.require_bootstrap_job()['metadata']['uid']
        self.values['bootstrap']['initializationId'] = ''
        self.values['gateway']['tls']['generated'] = {
            'leafRotationNonce': 'generation-2'
        }
        self.install(self.values)
        self.assertNotEqual(self.record()['generation'], old_generation)
        self.assertNotEqual(self.require_bootstrap_job()['metadata']['uid'], old_uid)
        self.assert_identities_preserved(before)
        self.assert_sequence()
        self.authenticate()
        current = self.record()['generation']
        for deployment in self.kube_json(['get', 'deployments'])['items']:
            annotation = (
                deployment['spec']['template']['metadata']
                .get('annotations', {})
                .get('osmo.nvidia.com/bootstrap-generation')
            )
            if annotation:
                self.assertEqual(annotation, current)
                self.assertEqual(
                    deployment['status'].get('replicas'),
                    deployment['status'].get('updatedReplicas'),
                )

    def test_dex_hooks_refresh_config_independently(self) -> None:
        self.install(self.values)
        self.authenticate()
        before = self.secret_identities(list(self.record()['committed']) + [
            'osmo-embedded-dex-admin', 'osmo-embedded-dex-oauth',
        ])
        job_uid = self.require_bootstrap_job()['metadata']['uid']
        dex_before = self.kube_json(['get', 'pods', '-l', 'app.kubernetes.io/name=dex'])['items']
        self.values['authentication'] = {
            'embeddedDex': {'expiry': {'idTokens': '12h'}},
            'bootstrap': {'identities': {'admin': {'dex': {'email': 'updated-admin@osmo.local'}}}},
        }
        self.install(self.values)
        self.assertEqual(self.require_bootstrap_job()['metadata']['uid'], job_uid)
        self.assert_identities_preserved(before)
        dex_after = self.kube_json(['get', 'pods', '-l', 'app.kubernetes.io/name=dex'])['items']
        self.assertTrue(dex_before and dex_after)
        self.assertTrue({pod['metadata']['uid'] for pod in dex_before}.isdisjoint(
            {pod['metadata']['uid'] for pod in dex_after}))
        self.assertFalse(any('dex' in name for name in self.record()['committed']))
        self.authenticate(login_email='updated-admin@osmo.local')

    def test_bootstrap_missing_retained_secret(self) -> None:
        self.install(self.values)
        missing = 'osmo-admin-token'
        retained = self.secret_identities(
            [name for name in self.record()['committed'] if name != missing]
        )
        self.kube(['delete', 'secret', missing])
        self.values['bootstrap']['attempt'] = 'missing-retained'
        with self.installing(self.values) as process:
            self.failed_step('begin', 'credential')
            self.finish_failed_install(process)
        self.assertNotEqual(
            self.kube(['get', 'secret', missing], check=False).returncode, 0
        )
        self.assert_identities_preserved(retained)

    def test_bootstrap_legacy_upgrade(self) -> None:
        baseline = copy.deepcopy(self.values)
        baseline.pop('bootstrap')
        self.set_image(baseline, os.environ['OETF_BOOTSTRAP_BASELINE_IMAGE'])
        self.install(baseline, chart=Path(os.environ['OETF_BOOTSTRAP_BASELINE_CHART']))
        self.assertNotEqual(
            self.kube(
                ['get', 'configmap', 'osmo-bootstrap-state'], check=False
            ).returncode,
            0,
        )
        baseline_pod = self.kube_json(
            ['get', 'pods', '-l', 'app.kubernetes.io/component=api']
        )['items'][0]
        self.assertIn(
            os.environ['OETF_BOOTSTRAP_BASELINE_IMAGE'].split('@')[1],
            baseline_pod['status']['containerStatuses'][0]['imageID'],
        )
        names = [
            'osmo-internal-tls-ca',
            'osmo-embedded-dex-admin',
            'osmo-embedded-dex-oauth',
            'osmo-backend-token',
            'osmo-service-auth',
            'osmo-master-encryption-key',
        ]
        previous_token = secrets.token_urlsafe(32)
        self.kube(
            [
                'patch',
                'secret',
                'osmo-admin-token',
                '--type=merge',
                '-p',
                json.dumps({'stringData': {'previous-token': previous_token}}),
            ]
        )
        names.append('osmo-admin-token')
        before = self.secret_identities(names)
        self.values['bootstrap']['initializationId'] = ''
        self.install(self.values)
        self.assertEqual(self.record()['mode'], 'adopt')
        tokens = self.kube_json(['get', 'secret', 'osmo-admin-token'])['data']
        with self.port_forward('service/osmo-gateway', 80, self.port):
            for key in ('token', 'previous-token'):
                exchange = urllib.request.Request(
                    self.values['externalUrl'] + '/api/auth/jwt/access_token',
                    data=json.dumps(
                        {'token': base64.b64decode(tokens[key]).decode()}
                    ).encode(),
                    headers={'Content-Type': 'application/json'},
                )
                with urllib.request.urlopen(exchange, timeout=15) as response:
                    jwt = json.load(response)['token']
                request = urllib.request.Request(
                    self.values['externalUrl'] + '/api/profile/settings',
                    headers={'Authorization': 'Bearer ' + jwt},
                )
                with urllib.request.urlopen(request, timeout=15) as response:
                    self.assertEqual(
                        json.load(response)['profile']['username'], 'admin'
                    )
        self.assert_identities_preserved(before)
        self.assert_sequence()
        self.authenticate()

    def test_bootstrap_legacy_rotation_upgrade(self) -> None:
        # The baseline rotation hook unconditionally requires these consumers,
        # even when their services are disabled. Exercise its supported cohort.
        images = json.loads(os.environ['OETF_BOOTSTRAP_WORKFLOW_IMAGES'])
        for key in ('router', 'agent', 'logger'):
            repository, digest = images[key].split('@')
            registry, repository = repository.split('/', 1)
            self.values['services'][key] = {
                'enabled': True,
                'replicas': 1,
                'autoscaling': {'enabled': False},
                'image': {
                    'registry': registry,
                    'repository': repository,
                    'tag': '',
                    'digest': digest,
                    'pullPolicy': 'IfNotPresent',
                },
                'resources': {
                    'requests': {'cpu': '25m', 'memory': '128Mi'},
                    'limits': {'memory': '1Gi'},
                },
            }
        baseline = copy.deepcopy(self.values)
        baseline.pop('bootstrap')
        self.set_image(baseline, os.environ['OETF_BOOTSTRAP_BASELINE_IMAGE'])
        chart = Path(os.environ['OETF_BOOTSTRAP_BASELINE_CHART'])
        self.install(baseline, chart=chart)
        rotation = {'id': 'legacy-rotation', 'phase': 'prepare', 'freezeHpas': True}
        baseline['gateway']['tls']['generated'] = {'caRotation': rotation}
        self.install(baseline, chart=chart)
        protected = self.secret_identities(
            [
                'osmo-internal-tls-ca',
                'osmo-service-auth',
                'osmo-admin-token',
                'osmo-backend-token',
                'osmo-master-encryption-key',
            ]
        )
        self.values['bootstrap']['initializationId'] = ''
        self.values['gateway']['tls']['generated'] = {'caRotation': rotation}
        self.install(self.values)
        self.assert_identities_preserved(protected)
        self.assert_sequence(STEP_NAMES[1:])
        self.authenticate()
        rotation['phase'] = 'activate'
        self.install(self.values)
        receipt = json.loads(
            self.kube_json(['get', 'configmap', 'osmo-tls-state'])['data']['state.json']
        )
        self.assertEqual(receipt['phase'], 'activate')
        self.authenticate()

    def test_bootstrap_blocked_lock(self) -> None:
        # Install only PostgreSQL prerequisites before starting the bootstrap Job.
        resources = self.render(self.values)
        self.apply_owned(
            [
                item
                for item in resources
                if item['kind'] == 'Cluster'
                or (
                    item['kind'] == 'Secret'
                    and item['metadata']['name'].startswith('osmo-pg')
                )
            ]
        )
        self.kube(
            ['wait', '--for=condition=Ready', 'cluster/osmo-pg', '--timeout=300s'],
            timeout=310,
        )
        lock = 0x4F534D4F4D454B
        command = [
            'kubectl',
            '--kubeconfig',
            str(self.kubeconfig),
            '--context',
            self.context,
            '-n',
            self.namespace,
            'exec',
            'osmo-pg-1',
            '--',
            'psql',
            '-U',
            'postgres',
            '-d',
            'osmo',
            '-Atc',
            f'SELECT pg_advisory_lock({lock}); SELECT pg_sleep(240);',
        ]
        # The finally block releases the database lock before terminating its client.
        # pylint: disable-next=consider-using-with
        holder = subprocess.Popen(
            command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:

            def locked() -> bool:
                result = self.kube(
                    [
                        'exec',
                        'osmo-pg-1',
                        '--',
                        'psql',
                        '-U',
                        'postgres',
                        '-d',
                        'osmo',
                        '-Atc',
                        "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND granted;",
                    ]
                )
                return result.stdout.strip() == '1'

            self.wait_for(locked, 'independently confirmed advisory lock', timeout=30)
            self.values.setdefault('secrets', {}).setdefault(
                'masterEncryptionKey', {}
            ).setdefault('bootstrap', {})['activeDeadlineSeconds'] = 30
            started = time.monotonic()
            with self.installing(self.values) as process:

                def waiting_for_lock() -> bool:
                    result = self.kube(
                        [
                            'exec',
                            'osmo-pg-1',
                            '--',
                            'psql',
                            '-U',
                            'postgres',
                            '-d',
                            'osmo',
                            '-Atc',
                            'SELECT count(*) FROM pg_stat_activity '
                            'WHERE pid <> pg_backend_pid() '
                            "AND query LIKE 'SELECT pg_try_advisory_lock(%';",
                        ]
                    )
                    return int(result.stdout.strip()) > 0

                self.wait_for(
                    waiting_for_lock,
                    'MEK advisory-lock acquisition attempt',
                    timeout=90,
                )
                failed = self.failed_step('mek-lifecycle', 'step exceeded')
                self.finish_failed_install(process)
            self.assertLess(time.monotonic() - started, 180)
            self.assertNotIn(
                'external-master-encryption-key-secret', self.record()['intents']
            )
            before = self.secret_identities(list(self.record()['committed']))
        finally:
            self.kube(
                [
                    'exec',
                    'osmo-pg-1',
                    '--',
                    'psql',
                    '-U',
                    'postgres',
                    '-d',
                    'osmo',
                    '-Atc',
                    'SELECT pg_terminate_backend(pid) FROM pg_stat_activity '
                    "WHERE query LIKE 'SELECT pg_advisory_lock(%' "
                    'AND pid <> pg_backend_pid();',
                ]
            )
            holder.terminate()
            holder.wait(timeout=10)
        self.values['secrets']['masterEncryptionKey']['bootstrap'][
            'activeDeadlineSeconds'
        ] = 300
        self.values['bootstrap']['attempt'] = 'lock-released'
        self.install(self.values)
        self.assertNotEqual(
            self.require_bootstrap_job()['metadata']['uid'], failed['metadata']['uid']
        )
        self.assert_identities_preserved(before)
        self.assert_sequence()

    def test_bootstrap_dependency_retry(self) -> None:
        self.values['rustfs'] = {'replicaCount': 0}
        self.values['bootstrap']['storageActiveDeadlineSeconds'] = 10
        self.values['embeddedDependencies'] = {
            'objectStorage': {'bootstrap': {'backoffLimit': 0}}
        }
        with self.installing(self.values) as process:
            failed = self.failed_step(
                'object-storage-bootstrap',
                ('object storage endpoint was not ready', 'step exceeded'),
            )
            self.finish_failed_install(process)
        before = self.secret_identities(list(self.record()['committed']))
        self.values['rustfs']['replicaCount'] = 1
        self.values['bootstrap'].update(
            attempt='storage-restored', storageActiveDeadlineSeconds=120
        )
        self.install(self.values)
        self.assertNotEqual(
            self.require_bootstrap_job()['metadata']['uid'], failed['metadata']['uid']
        )
        self.assert_identities_preserved(before)
        self.assert_sequence()
        self.authenticate()

    def test_bootstrap_postgresql_retry(self) -> None:
        original = copy.deepcopy(self.values)
        self.values['embeddedDependencies'] = {'postgresql': {'enabled': False}}
        self.values['externalDependencies'] = {
            'postgresql': {
                'host': '127.0.0.1',
                'port': 5432,
                'database': 'osmo',
                'username': 'osmo',
                'tls': {'enabled': False},
            }
        }
        self.values['secrets'] = {
            'postgresql': {
                'existingSecret': 'unavailable-postgresql',
                'keys': {'password': 'password'},
            },
            'masterEncryptionKey': {'bootstrap': {'activeDeadlineSeconds': 30}},
        }
        self.apply_owned(
            [
                {
                    'apiVersion': 'v1',
                    'kind': 'Secret',
                    'metadata': {'name': 'unavailable-postgresql'},
                    'stringData': {'password': secrets.token_urlsafe(32)},
                }
            ]
        )
        with self.installing(self.values) as process:
            self.failed_step(
                'mek-lifecycle', ('MEK lifecycle operation failed', 'step exceeded')
            )
            self.finish_failed_install(process)
        self.assertNotIn('osmo-master-encryption-key', self.record()['intents'])
        before = self.secret_identities(list(self.record()['committed']))
        self.values = original
        self.values['bootstrap']['attempt'] = 'postgresql-restored'
        self.install(self.values)
        self.assert_identities_preserved(before)
        self.assert_sequence()
        self.authenticate()

    def test_bootstrap_enabled_steps(self) -> None:
        self.values['gateway']['tls']['enabled'] = False
        self.install(self.values)
        self.assert_sequence(STEP_NAMES[1:])
        self.assertNotEqual(
            self.kube(
                ['get', 'secret', 'osmo-internal-tls-ca'], check=False
            ).returncode,
            0,
        )
        self.authenticate()
        retained = self.secret_identities(list(self.record()['committed']))
        external = yaml.safe_load(
            (self.chart_path() / 'tests/control-external-values.yaml').read_text()
        )
        self.values['authentication'] = external['authentication']
        self.values['authentication']['bootstrap']['identities'][
            'backend-operator-default'
        ] = {'enabled': False}
        self.values['embeddedDependencies'] = {
            'dex': {'enabled': False},
            'objectStorage': {'enabled': False},
        }
        self.values['externalDependencies'] = {
            'objectStorage': external['externalDependencies']['objectStorage']
        }
        self.values['secrets'] = {
            'objectStorage': external['secrets']['objectStorage'],
            'serviceAuth': {'bootstrap': {'enabled': False}},
            'masterEncryptionKey': {'bootstrap': {'enabled': False}},
        }
        # This external-provider configuration deliberately has no live IdP.
        # Inspect actual reconciled resources; readiness is covered by the partial case above.
        with self.installing(self.values, wait=False) as process:
            process.wait(timeout=90)
            self.assertEqual(process.returncode, 0)
        self.assertEqual(self.jobs(), [])
        self.assert_identities_preserved(retained)

    def test_bootstrap_partial_retry(self) -> None:
        resources = [
            item
            for item in self.render(self.values)
            if 'helm.sh/hook' not in (item['metadata'].get('annotations') or {})
        ]
        job = next(item for item in resources if item['kind'] == 'Job')
        step = next(
            item
            for item in job['spec']['template']['spec']['initContainers']
            if item['name'] == 'identity-bootstrap'
        )
        step['args'][step['args'].index('--retries') + 1] = '0'
        for environment in step['env']:
            if environment['name'] == 'OSMO_BOOTSTRAP_AFTER':
                environment['value'] = json.dumps(
                    [
                        'osmo-bootstrap',
                        '--config',
                        '/bootstrap-config/config.json',
                        'injected-crash-before-receipt',
                    ]
                )
        # Apply consumers and dependencies before the faulted Job. Its real
        # reconciler creates credentials, then the post-command exits before finish.
        self.apply_owned([item for item in resources if item is not job])
        self.apply_owned([job])
        failed = self.failed_step('identity-bootstrap', 'injected-crash-before-receipt')
        record = self.record()
        self.assertEqual(record['pending']['step'], 'identity')
        self.assertNotIn('identity', record['receipts'])
        self.assertIn('osmo-admin-token', record['intents'])
        names = list(record['committed']) + [
            'osmo-admin-token',
            'osmo-backend-token',
        ]
        before = self.secret_identities(names)
        # The faulted resources were applied without a Helm release; remove only
        # the proven-terminal Job before Helm adopts their ordinary resources.
        self.kube(['delete', 'job', failed['metadata']['name'], '--wait=true'])
        self.values['bootstrap']['attempt'] = 'after-secret-create'
        self.install(self.values)
        self.assert_identities_preserved(before)
        self.assertNotEqual(
            self.assert_sequence()['metadata']['uid'], failed['metadata']['uid']
        )
        self.assertTrue(self.record()['complete'])
        self.authenticate()

    def test_bootstrap_rotation_coexistence(self) -> None:
        self.install(self.values)
        before = self.secret_identities(['osmo-internal-tls-ca'])
        stable = self.kube_json(['get', 'secret', 'osmo-internal-tls-ca'])['data'][
            'ca.crt'
        ]
        rotation = {'id': 'cluster-rotation', 'phase': 'prepare', 'freezeHpas': True}
        self.values['gateway']['tls']['generated'] = {'caRotation': rotation}
        for phase in ('prepare', 'activate', 'retire'):
            rotation['phase'] = phase
            if phase == 'activate':
                pod = self.kube_json(
                    ['get', 'pods', '-l', 'app.kubernetes.io/component=api']
                )['items'][0]
                name = pod['metadata']['name']
                self.kube(
                    [
                        'annotate',
                        'pod',
                        name,
                        'checksum/internal-tls-ca-phase=unverified-predecessor',
                        '--overwrite',
                    ]
                )
                unchanged = self.secret_identities(['osmo-internal-tls-ca'])
                with self.installing(self.values) as process:
                    def finished(current: subprocess.Popen = process) -> bool:
                        return current.poll() is not None

                    self.wait_for(
                        finished,
                        'rotation rejects invalid predecessor',
                        timeout=90,
                    )
                    self.assertNotEqual(process.returncode, 0)
                self.assert_identities_preserved(unchanged)
                self.kube(
                    [
                        'annotate',
                        'pod',
                        name,
                        'checksum/internal-tls-ca-phase=cluster-rotation:prepare',
                        '--overwrite',
                    ]
                )
            self.install(self.values)
            self.assert_sequence(STEP_NAMES[1:])
            ca = self.kube_json(['get', 'secret', 'osmo-internal-tls-ca'])
            self.assertEqual(
                ca['metadata']['uid'], before['osmo-internal-tls-ca']['uid']
            )
            self.assertEqual(
                base64.b64decode(ca['data']['rotation-phase']).decode(), phase
            )
            self.assertEqual(ca['data']['ca.crt'] == stable, phase == 'prepare')
            receipt = json.loads(
                self.kube_json(['get', 'configmap', 'osmo-tls-state'])['data'][
                    'state.json'
                ]
            )
            self.assertEqual(receipt['phase'], phase)
            self.assertNotIn('osmo-internal-tls-ca', receipt['files'])
            self.authenticate()
        rotation['phase'] = 'stable'
        rotation['freezeHpas'] = False
        self.install(self.values)
        self.assert_sequence()
        self.authenticate()

    def test_bootstrap_mek_rotation_coexistence(self) -> None:
        self.install(self.values)

        def keyring() -> dict:
            secret = self.kube_json(['get', 'secret', 'osmo-master-encryption-key'])
            return yaml.safe_load(base64.b64decode(secret['data']['mek.yaml']))

        original = keyring()
        protected = self.secret_identities(
            [
                'osmo-internal-tls-ca',
                'osmo-service-auth',
                'osmo-admin-token',
                'osmo-backend-token',
            ]
        )
        rotation = {'requestId': 'mek-cluster-rotation', 'phase': ''}
        self.values['secrets'] = {
            'masterEncryptionKey': {
                'bootstrap': {'enabled': False},
                'rotation': rotation,
            }
        }
        self.install(self.values)
        rotation['phase'] = 'prepare'
        self.install(self.values)
        ordinary = self.require_bootstrap_job()
        names = [
            item['name']
            for item in ordinary['spec']['template']['spec']['initContainers']
        ]
        self.assertNotIn('mek-lifecycle', names)
        self.assertEqual(len(self.jobs()), 2)
        prepared = keyring()
        self.assertEqual(prepared['currentMek'], original['currentMek'])
        self.assertEqual(len(prepared['meks']), len(original['meks']) + 1)
        rotation.update(phase='', rolloutRevision='mek-prepared')
        self.install(self.values)
        self.assert_sequence([name for name in STEP_NAMES if name != 'mek-lifecycle'])
        rotation['phase'] = 'activate'
        self.install(self.values)
        activated = keyring()
        self.assertNotEqual(activated['currentMek'], original['currentMek'])
        self.assertIn(original['currentMek'], activated['meks'])
        rotation.update(phase='', rolloutRevision='mek-activated')
        self.install(self.values)
        rotation['phase'] = 'rewrap'
        self.install(self.values)
        rotation['phase'] = ''
        self.install(self.values)
        self.assert_identities_preserved(protected)
        self.assert_sequence([name for name in STEP_NAMES if name != 'mek-lifecycle'])
        self.authenticate()

    def test_bootstrap_cpu_workflow(self) -> None:
        images = json.loads(os.environ['OETF_BOOTSTRAP_WORKFLOW_IMAGES'])
        self.values['externalUrl'] = (
            f'http://osmo-gateway.{self.namespace}.svc.cluster.local'
        )
        self.values['planes']['compute']['enabled'] = True
        for key in (
            'worker',
            'router',
            'agent',
            'logger',
            'delayedJobMonitor',
            'backendListener',
            'backendWorker',
        ):
            repository, digest = images[key].split('@')
            registry, repository = repository.split('/', 1)
            self.values['services'][key] = {
                'enabled': True,
                'replicas': 1,
                'autoscaling': {'enabled': False},
                'image': {
                    'registry': registry,
                    'repository': repository,
                    'tag': '',
                    'digest': digest,
                    'pullPolicy': 'IfNotPresent',
                },
                'resources': {
                    'requests': {'cpu': '25m', 'memory': '128Mi'},
                    'limits': {'memory': '1Gi'},
                },
            }
        self.values['configuration'] = {
            'workflow': {
                'backend_images': {'init': images['init'], 'client': images['client']}
            },
            'podTemplates': {
                'default_ctrl': {
                    'spec': {
                        'containers': [
                            {
                                'name': 'osmo-ctrl',
                                'resources': {
                                    'requests': {
                                        'cpu': '100m',
                                        'memory': '128Mi',
                                        'ephemeral-storage': '100Mi',
                                    },
                                    'limits': {
                                        'cpu': '1',
                                        'memory': '512Mi',
                                        'ephemeral-storage': '1Gi',
                                    },
                                },
                            }
                        ]
                    }
                },
            },
        }
        self.install(self.values)
        self.assert_sequence()
        token = base64.b64decode(
            self.kube_json(['get', 'secret', 'osmo-admin-token'])['data']['token']
        ).decode()
        with self.port_forward('service/osmo-gateway', 80, self.port):
            exchange = urllib.request.Request(
                f'http://127.0.0.1:{self.port}/api/auth/jwt/access_token',
                data=json.dumps({'token': token}).encode(),
                headers={'Content-Type': 'application/json'},
            )
            with urllib.request.urlopen(exchange, timeout=15) as response:
                token = json.load(response)['token']

            def request(path: str, payload: dict | None = None) -> dict:
                body = json.dumps(payload).encode() if payload is not None else None
                query = urllib.request.Request(
                    f'http://127.0.0.1:{self.port}/api/' + path,
                    data=body,
                    headers={
                        'Authorization': 'Bearer ' + token,
                        'Content-Type': 'application/json',
                    },
                )
                try:
                    with urllib.request.urlopen(query, timeout=30) as response:
                        return json.load(response)
                except urllib.error.HTTPError as error:
                    if error.code == 400:
                        # This request contains only the checked-in synthetic workflow.
                        self.fail('Workflow validation: ' + error.read(4096).decode())
                    raise

            self.wait_for(
                lambda: bool(request('resources?pools=default').get('resources', [])),
                'CPU backend registration',
                timeout=180,
            )
            workflow = {
                'version': 2,
                'workflow': {
                    'name': 'bootstrap-storage-proof',
                    'resources': {
                        'default': {'cpu': 1, 'memory': '256Mi', 'storage': '1Gi'}
                    },
                    'tasks': [
                        {
                            'name': 'write',
                            'image': 'python:3.14.2-bookworm',
                            'resource': 'default',
                            'command': ['sh', '-c'],
                            'args': [
                                'printf bootstrap-storage-proof > {{output}}/proof.txt'
                            ],
                        },
                        {
                            'name': 'read',
                            'image': 'python:3.14.2-bookworm',
                            'resource': 'default',
                            'command': ['sh', '-c'],
                            'inputs': [{'task': 'write'}],
                            'args': [
                                'test "$(cat {{input:0}}/proof.txt)" = bootstrap-storage-proof'
                            ],
                        },
                    ],
                    'timeout': {'exec_timeout': '5m', 'queue_timeout': '5m'},
                },
            }
            submitted = request(
                'pool/default/workflow',
                {
                    'file': yaml.safe_dump(workflow),
                    'set_variables': [],
                    'set_string_variables': [],
                    'uploaded_templated_spec': None,
                },
            )
            name = submitted['name']

            transient_reads = 0

            def finished() -> dict | None:
                nonlocal transient_reads
                try:
                    state = request('workflow/' + name)
                except urllib.error.HTTPError as error:
                    if error.code not in (502, 503, 504):
                        raise
                    error.close()
                    transient_reads += 1
                    return None
                status = state.get('status', '')
                if status == 'COMPLETED':
                    return state
                self.assertFalse(
                    status.startswith('FAILED') or status in ('CANCELED', 'CANCELLED'),
                    f'CPU workflow ended with {status}',
                )
                return None

            result = self.wait_for(
                finished,
                'CPU workflow transfers output through object storage',
                timeout=600,
            )
            self._recorder.record_attachment(
                'cpu-workflow.json',
                'application/json',
                json.dumps(
                    {
                        'name': name,
                        'status': result['status'],
                        'transientStatusReads': transient_reads,
                    }
                ).encode(),
            )

    def test_bootstrap_gitops_retry(self) -> None:
        self.kube(
            ['get', 'deployment', 'helm-controller', '-n', 'flux-system'],
            namespaced=False,
        )
        url = self.serve_helm_chart()
        self.apply_owned(
            [
                {
                    'apiVersion': 'source.toolkit.fluxcd.io/v1',
                    'kind': 'HelmRepository',
                    'metadata': {'name': 'bootstrap-test'},
                    'spec': {'interval': '1m', 'url': url},
                },
                {
                    'apiVersion': 'helm.toolkit.fluxcd.io/v2',
                    'kind': 'HelmRelease',
                    'metadata': {'name': self.release},
                    'spec': {
                        'interval': '1m',
                        'timeout': '140m',
                        'releaseName': self.release,
                        'targetNamespace': self.namespace,
                        'install': {
                            'disableWait': False,
                            'disableWaitForJobs': False,
                            'remediation': {'retries': 0},
                        },
                        'upgrade': {
                            'disableWait': False,
                            'disableWaitForJobs': False,
                            'remediation': {
                                'retries': 0,
                                'remediateLastFailure': False,
                            },
                        },
                        'chart': {
                            'spec': {
                                'chart': 'osmo',
                                'version': '0.1.0',
                                'sourceRef': {
                                    'kind': 'HelmRepository',
                                    'name': 'bootstrap-test',
                                },
                            }
                        },
                        'values': self.values,
                    },
                },
            ]
        )
        self.wait_flux_ready()
        original = self.assert_sequence()['metadata']['uid']
        self.kube(
            [
                'annotate',
                'helmrelease',
                self.release,
                'reconcile.fluxcd.io/requestedAt=unchanged-check',
                '--overwrite',
            ]
        )
        self.wait_for(
            lambda: (
                self.kube_json(['get', 'helmrelease', self.release])
                .get('status', {})
                .get('lastHandledReconcileAt')
                == 'unchanged-check'
            ),
            'unchanged Flux sync',
        )
        self.wait_flux_ready()
        self.assertEqual(self.require_bootstrap_job()['metadata']['uid'], original)
        before = self.secret_identities(list(self.record()['committed']))
        self.values['rustfs'] = {'replicaCount': 0}
        self.values['embeddedDependencies'] = {
            'objectStorage': {'bootstrap': {'backoffLimit': 0}}
        }
        self.values['bootstrap'].update(
            attempt='flux-failure', storageActiveDeadlineSeconds=10
        )
        self.kube(
            [
                'patch',
                'helmrelease',
                self.release,
                '--type=merge',
                '-p',
                json.dumps({'spec': {'values': self.values, 'timeout': '90s'}}),
            ]
        )

        def replacement_started() -> bool:
            jobs = self.jobs()
            return len(jobs) == 1 and jobs[0]['metadata']['uid'] != original

        self.wait_for(replacement_started, 'Flux failure attempt')
        failed = self.failed_step(
            'object-storage-bootstrap',
            ('object storage endpoint was not ready', 'step exceeded'),
        )

        def flux_failed() -> bool:
            release = self.kube_json(['get', 'helmrelease', self.release])
            status = release.get('status', {})
            return status.get('history', [{}])[0].get('status') == 'failed' and any(
                condition['type'] == 'Released'
                and condition['status'] == 'False'
                and condition.get('reason') == 'UpgradeFailed'
                and condition.get('observedGeneration')
                == release['metadata']['generation']
                for condition in status.get('conditions', [])
            )

        self.wait_for(flux_failed, 'Flux records the failed upgrade', timeout=180)
        self.collect_evidence()
        self.values['rustfs']['replicaCount'] = 1
        self.values['bootstrap'].update(
            attempt='flux-retry', storageActiveDeadlineSeconds=120
        )
        self.kube(
            [
                'patch',
                'helmrelease',
                self.release,
                '--type=merge',
                '-p',
                json.dumps({'spec': {'values': self.values, 'timeout': '140m'}}),
            ]
        )
        reconciled = self.wait_flux_ready()
        # Helm upgrades from its last deployed inventory, which can omit resources
        # created by the failed revision. Perform the documented operator cleanup
        # only after the failed Pod is terminal and the replacement is healthy.
        retained = self.kube_json(['get', 'job', failed['metadata']['name']])
        self.assertEqual(retained['metadata']['uid'], failed['metadata']['uid'])
        retained_pod = self.job_pod(retained)
        assert retained_pod is not None
        self.assertEqual(retained_pod['status']['phase'], 'Failed')
        self.kube(['delete', 'job', retained['metadata']['name'], '--wait=true'])
        replacement = self.assert_sequence()['metadata']['uid']
        self.assertNotEqual(replacement, failed['metadata']['uid'])
        self.assert_identities_preserved(before)
        self.assertTrue(self.record()['complete'])
        self._recorder.record_attachment(
            'flux-reconciliation.json',
            'application/json',
            json.dumps(
                {
                    'originalJobUID': original,
                    'failedJobUID': failed['metadata']['uid'],
                    'replacementJobUID': replacement,
                    'status': reconciled['status'],
                }
            ).encode(),
        )


if __name__ == '__main__':
    unittest.main()
