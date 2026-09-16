# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""Isolated Helm lifecycle fixtures, independent of service authentication/readiness."""

import base64
import contextlib
import hashlib
import json
import os
from pathlib import Path
import socket
import shutil
import signal
import subprocess
import tempfile
import time
from typing import Any, Callable, Iterator
import unittest
import uuid

import yaml

from test.oetf.fixture_base import OetfFixture


class ClusterFixture(OetfFixture):
    """Mutations are restricted to a newly created namespace on a named KIND cluster."""

    def setUp(self) -> None:
        # Deliberately omit OetfFixture's ServiceClient: this suite breaks the
        # release under test and must remain usable while its API is unavailable.
        unittest.TestCase.setUp(self)
        if os.environ.get('OETF_ENV') != 'bootstrap-kind':
            raise RuntimeError('Lifecycle tests require --env bootstrap-kind.')
        self.context = 'kind-osmo-bootstrap'
        self.helm_binary = os.environ.get('OETF_BOOTSTRAP_HELM', 'helm')
        self.kubeconfig = Path(os.environ['KUBECONFIG']).resolve(strict=True)
        self.namespace = f'bootstrap-test-{uuid.uuid4().hex[:10]}'
        self.release = 'bootstrap'
        # Keep the directory alive through tearDown and registered evidence cleanup.
        # pylint: disable-next=consider-using-with
        self.directory = tempfile.TemporaryDirectory(prefix='osmo-bootstrap-test-')
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        source_chart = self.chart_path()
        self.frozen_chart = self.root / 'chart'
        shutil.copytree(source_chart, self.frozen_chart)
        nodes = self.kube_json(['get', 'nodes'], namespaced=False)['items']
        if not nodes or any(
            node['metadata']['labels'].get('kubernetes.io/hostname')
            != 'osmo-bootstrap-control-plane'
            for node in nodes
        ):
            raise RuntimeError(
                'Expected the disposable single-node osmo-bootstrap KIND cluster.'
            )
        self.kube(['create', 'namespace', self.namespace], namespaced=False)
        self.kube(
            ['label', 'namespace', self.namespace, 'osmo.nvidia.com/test=bootstrap'],
            namespaced=False,
        )
        if os.environ.get('OETF_BOOTSTRAP_CLEANUP', 'true') == 'true':
            self.addCleanup(self.cleanup_namespace)
        self.addCleanup(self.collect_evidence)

    @staticmethod
    def run_command(
        command: list[str],
        *,
        timeout: int = 60,
        input_text: str | None = None,
        check: bool = True,
    ) -> subprocess.CompletedProcess:
        result = subprocess.run(
            command,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
        if check and result.returncode:
            # Commands and output may contain Secret payloads. Keep failures safe
            # even when unittest stores the exception in its result attachments.
            raise RuntimeError(
                f'{Path(command[0]).name} failed with exit {result.returncode}.'
            )
        return result

    def kube(
        self,
        arguments: list[str],
        *,
        namespaced: bool = True,
        input_text: str | None = None,
        check: bool = True,
        timeout: int = 60,
    ) -> subprocess.CompletedProcess:
        command = [
            'kubectl',
            '--kubeconfig',
            str(self.kubeconfig),
            '--context',
            self.context,
        ]
        if namespaced:
            command += ['--namespace', self.namespace]
        return self.run_command(
            command + arguments, input_text=input_text, check=check, timeout=timeout
        )

    def kube_json(self, arguments: list[str], **kwargs: Any) -> Any:
        return json.loads(self.kube(arguments + ['-o', 'json'], **kwargs).stdout)

    @staticmethod
    def wait_for(
        predicate: Callable[[], Any], description: str, timeout: int = 600
    ) -> Any:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = predicate()
            if value:
                return value
            time.sleep(1)
        raise AssertionError(f'Timed out waiting for {description}.')

    def chart_path(self) -> Path:
        if hasattr(self, 'frozen_chart'):
            return self.frozen_chart
        configured = os.environ.get('OETF_HELM_CHART_PATH')
        if configured:
            return Path(configured).resolve(strict=True)
        return Path(
            os.environ['TEST_SRCDIR'],
            os.environ['TEST_WORKSPACE'],
            'deployments/charts/osmo',
        )

    def helm_command(
        self, values: dict[str, Any], *, chart: Path | None = None, wait: bool = True
    ) -> list[str]:
        path = self.root / f'values-{uuid.uuid4().hex[:8]}.yaml'
        path.write_text(yaml.safe_dump(values), encoding='utf-8')
        command = [
            self.helm_binary,
            'upgrade',
            '--install',
            self.release,
            str(chart or self.chart_path()),
            '--kubeconfig',
            str(self.kubeconfig),
            '--kube-context',
            self.context,
            '--namespace',
            self.namespace,
            '-f',
            str(path),
            '--timeout',
            '140m',
        ]
        if wait:
            command += ['--wait', '--wait-for-jobs']
        return command

    def render(self, values: dict[str, Any]) -> list[dict[str, Any]]:
        path = self.root / 'render-values.yaml'
        path.write_text(yaml.safe_dump(values), encoding='utf-8')
        result = self.run_command(
            [
                self.helm_binary,
                'template',
                self.release,
                str(self.chart_path()),
                '--namespace',
                self.namespace,
                '-f',
                str(path),
                '--api-versions',
                'postgresql.cnpg.io/v1',
            ]
        )
        return [item for item in yaml.safe_load_all(result.stdout) if item]

    def apply_owned(self, resources: list[dict[str, Any]]) -> None:
        for resource in resources:
            metadata = resource['metadata']
            metadata['namespace'] = self.namespace
            metadata.setdefault('labels', {})['app.kubernetes.io/managed-by'] = 'Helm'
            metadata.setdefault('annotations', {}).update(
                {
                    'meta.helm.sh/release-name': self.release,
                    'meta.helm.sh/release-namespace': self.namespace,
                }
            )
        self.kube(
            ['apply', '--server-side', '--field-manager=helm', '-f', '-'],
            input_text=yaml.safe_dump_all(resources),
        )

    @contextlib.contextmanager
    def installing(
        self, values: dict[str, Any], *, chart: Path | None = None, wait: bool = True
    ) -> Iterator[subprocess.Popen]:
        with (self.root / f'helm-{uuid.uuid4().hex[:8]}.log').open('w') as log:
            process = subprocess.Popen(
                self.helm_command(values, chart=chart, wait=wait),
                stdout=log,
                stderr=subprocess.STDOUT,
            )
            try:
                yield process
            finally:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=10)

    def finish_failed_install(self, process: subprocess.Popen) -> None:
        """Cancel Helm only after independently proving the Job/Pod terminated.

        Helm checks Deployments before Jobs and can wait on their startup gates
        after bootstrap failure. SIGINT cancels its install/upgrade context and
        records a failed release, allowing the next deliberate attempt.
        """
        job = self.wait_job(False)
        pod = self.job_pod(job)
        self.assertIsNotNone(pod)
        self.assertEqual((pod or {})['status']['phase'], 'Failed')
        if process.poll() is None:
            process.send_signal(signal.SIGINT)
        process.wait(timeout=30)
        self.assertNotEqual(process.returncode, 0)
        status = json.loads(
            self.run_command(
                [
                    self.helm_binary,
                    'status',
                    self.release,
                    '--kubeconfig',
                    str(self.kubeconfig),
                    '--kube-context',
                    self.context,
                    '--namespace',
                    self.namespace,
                    '-o',
                    'json',
                ]
            ).stdout
        )
        self.assertEqual(status['info']['status'], 'failed')

    def install(self, values: dict[str, Any], *, chart: Path | None = None) -> None:
        prior_failed_uids = {
            job['metadata']['uid']
            for job in self.jobs()
            if any(
                condition['type'] == 'Failed' and condition['status'] == 'True'
                for condition in job.get('status', {}).get('conditions', [])
            )
        }
        with self.installing(values, chart=chart) as process:

            def finished() -> bool:
                if process.poll() is not None:
                    return True
                failed = any(
                    condition['type'] == 'Failed' and condition['status'] == 'True'
                    for job in self.jobs()
                    if job['metadata']['uid'] not in prior_failed_uids
                    for condition in job.get('status', {}).get('conditions', [])
                )
                if failed:
                    process.send_signal(signal.SIGINT)
                    process.wait(timeout=30)
                    return True
                return False

            self.wait_for(finished, 'Helm completion', timeout=900)
            self.assertEqual(
                process.returncode, 0, 'Helm --wait --wait-for-jobs failed.'
            )

    def jobs(self) -> list[dict[str, Any]]:
        return self.kube_json(['get', 'jobs'])['items']

    def bootstrap_job(self) -> dict[str, Any] | None:
        jobs = [
            job
            for job in self.jobs()
            if job['metadata'].get('labels', {}).get('app.kubernetes.io/component')
            == 'bootstrap'
        ]
        if len(jobs) > 1:
            raise AssertionError('More than one ordinary bootstrap Job exists.')
        return jobs[0] if jobs else None

    def require_bootstrap_job(self) -> dict[str, Any]:
        job = self.bootstrap_job()
        if job is None:
            raise AssertionError('Expected one ordinary bootstrap Job.')
        return job

    def job_pod(self, job: dict[str, Any]) -> dict[str, Any] | None:
        """Select the latest terminal Pod only after every owned Pod is terminal."""
        job_name = job['metadata']['name']
        pods = self.kube_json(
            [
                'get',
                'pods',
                '-l',
                f'batch.kubernetes.io/job-name={job_name}',
            ]
        )['items']
        for pod in pods:
            owners = [
                owner for owner in pod['metadata'].get('ownerReferences', [])
                if owner.get('controller')
            ]
            self.assertEqual(len(owners), 1, 'Ambiguous bootstrap Pod ownership.')
            self.assertEqual(owners[0].get('kind'), 'Job')
            self.assertEqual(owners[0].get('uid'), job['metadata']['uid'])
        if not pods or any(
            pod.get('status', {}).get('phase') not in ('Succeeded', 'Failed')
            for pod in pods
        ):
            return None
        return max(pods, key=lambda pod: (
            pod['metadata']['creationTimestamp'], pod['metadata']['name'],
        ))

    def wait_job(self, successful: bool) -> dict[str, Any]:
        expected = 'Complete' if successful else 'Failed'

        def completed() -> Any:
            job = self.bootstrap_job()
            if job and any(
                condition['type'] == expected and condition['status'] == 'True'
                for condition in job.get('status', {}).get('conditions', [])
            ):
                return job
            return None

        return self.wait_for(completed, f'bootstrap Job {expected}', timeout=900)

    def record(self) -> dict[str, Any]:
        item = self.kube_json(['get', 'configmap', 'osmo-bootstrap-state'])
        return json.loads(item['data']['state.json'])

    def secret_identities(self, names: list[str]) -> dict[str, Any]:
        identities = {}
        for name in names:
            secret = self.kube_json(['get', 'secret', name])
            identities[name] = {
                'uid': secret['metadata']['uid'],
                'keys': {
                    key: hashlib.sha256(
                        base64.b64decode(value, validate=True)
                    ).hexdigest()
                    for key, value in secret['data'].items()
                },
            }
        return identities

    def assert_identities_preserved(self, before: dict[str, Any]) -> None:
        # Never let unittest include credential values or fingerprints in a diff.
        self.assertTrue(
            before == self.secret_identities(list(before)),
            'Retained credential identities changed.',
        )

    @contextlib.contextmanager
    def port_forward(
        self, resource: str, remote_port: int, local_port: int = 0
    ) -> Iterator[int]:
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', local_port))
            port = listener.getsockname()[1]
        command = [
            'kubectl',
            '--kubeconfig',
            str(self.kubeconfig),
            '--context',
            self.context,
            '--namespace',
            self.namespace,
            'port-forward',
            resource,
            f'{port}:{remote_port}',
        ]
        process = subprocess.Popen(
            command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
        try:

            def listening() -> bool:
                if process.poll() is not None:
                    raise RuntimeError('Port-forward stopped before listening.')
                try:
                    with socket.create_connection(('127.0.0.1', port), timeout=1):
                        return True
                except OSError:
                    return False

            self.wait_for(listening, 'port-forward listener', timeout=30)
            yield port
        finally:
            process.terminate()
            process.wait(timeout=10)

    def serve_helm_chart(self) -> str:
        """Serve a test-owned chart to a real source-controller without publishing it."""
        package_directory = self.root / 'repository'
        package_directory.mkdir()
        self.run_command(
            [
                self.helm_binary,
                'package',
                str(self.chart_path()),
                '--destination',
                str(package_directory),
            ]
        )
        self.run_command([self.helm_binary, 'repo', 'index', str(package_directory)])
        archive = next(package_directory.glob('osmo-*.tgz'))
        name = 'bootstrap-chart-repository'
        resources = [
            {
                'apiVersion': 'v1',
                'kind': 'ConfigMap',
                'metadata': {'name': name},
                'data': {'index.yaml': (package_directory / 'index.yaml').read_text()},
                'binaryData': {
                    archive.name: base64.b64encode(archive.read_bytes()).decode()
                },
            },
            {
                'apiVersion': 'v1',
                'kind': 'Pod',
                'metadata': {'name': name, 'labels': {'test-server': name}},
                'spec': {
                    'automountServiceAccountToken': False,
                    'securityContext': {'runAsUser': 10001, 'runAsGroup': 10001},
                    'containers': [
                        {
                            'name': 'http',
                            'image': 'python:3.14.2-bookworm',
                            'command': [
                                'python3',
                                '-m',
                                'http.server',
                                '8080',
                                '--directory',
                                '/charts',
                            ],
                            'securityContext': {
                                'allowPrivilegeEscalation': False,
                                'readOnlyRootFilesystem': True,
                            },
                            'resources': {'requests': {'cpu': '10m', 'memory': '32Mi'}},
                            'ports': [{'containerPort': 8080}],
                            'volumeMounts': [
                                {
                                    'name': 'charts',
                                    'mountPath': '/charts',
                                    'readOnly': True,
                                }
                            ],
                        }
                    ],
                    'volumes': [{'name': 'charts', 'configMap': {'name': name}}],
                },
            },
            {
                'apiVersion': 'v1',
                'kind': 'Service',
                'metadata': {'name': name},
                'spec': {
                    'selector': {'test-server': name},
                    'ports': [{'port': 8080, 'targetPort': 8080}],
                },
            },
        ]
        self.apply_owned(resources)
        self.kube(
            ['wait', '--for=condition=Ready', f'pod/{name}', '--timeout=180s'],
            timeout=190,
        )
        return f'http://{name}.{self.namespace}.svc:8080'

    def wait_flux_ready(self) -> dict[str, Any]:
        def ready() -> Any:
            release = self.kube_json(['get', 'helmrelease', self.release])
            return (
                release
                if release.get('status', {}).get('observedGeneration')
                == release['metadata']['generation']
                and release.get('status', {}).get('history', [{}])[0].get('status')
                == 'deployed'
                and not any(
                    condition['type'] in ('Reconciling', 'Stalled')
                    and condition['status'] == 'True'
                    for condition in release.get('status', {}).get('conditions', [])
                )
                and any(
                    condition['type'] == 'Ready'
                    and condition['status'] == 'True'
                    and condition.get('observedGeneration')
                    == release['metadata']['generation']
                    for condition in release.get('status', {}).get('conditions', [])
                )
                else None
            )

        return self.wait_for(ready, 'Flux HelmRelease readiness', timeout=900)

    def collect_evidence(self) -> None:
        evidence = {
            'namespace': self.namespace,
            'context': self.context,
            'jobs': self.jobs(),
            'pods': self.kube_json(['get', 'pods'])['items'],
            'deployments': self.kube_json(['get', 'deployments'])['items'],
        }
        # Runtime logs and Secret objects are intentionally excluded. Pod specs
        # contain Secret references only in this fixture's checked-in values.
        self._recorder.record_attachment(
            'bootstrap-cluster.json',
            'application/json',
            json.dumps(evidence, indent=2).encode(),
        )
        print(f'Lifecycle evidence: context={self.context} namespace={self.namespace}')

    def cleanup_namespace(self) -> None:
        namespace = self.kube_json(
            ['get', 'namespace', self.namespace], namespaced=False
        )
        if namespace['metadata']['labels'].get('osmo.nvidia.com/test') != 'bootstrap':
            raise RuntimeError(
                'Refusing to delete a namespace without the test ownership label.'
            )
        # Namespace deletion alone leaves compute-plane ClusterRoles/Bindings.
        # Remove the test release inventory first; kept credentials are then
        # removed with this explicitly owned disposable namespace.
        self.run_command(
            [
                self.helm_binary,
                'uninstall',
                self.release,
                '--kubeconfig',
                str(self.kubeconfig),
                '--kube-context',
                self.context,
                '--namespace',
                self.namespace,
                '--ignore-not-found',
                '--timeout',
                '90s',
            ],
            timeout=100,
        )
        self.kube(
            ['delete', 'namespace', self.namespace, '--wait=false'], namespaced=False
        )
