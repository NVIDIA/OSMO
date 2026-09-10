"""Opt-in live Kubernetes projection test; only creates uniquely named probe objects.

No production Secrets are read or changed. Requires kubectl access to the specified
namespace and a built agent image. Run with --help for mandatory explicit targets.

SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
"""

import argparse
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import uuid


class ProjectionProbe:
    """Exercise a disposable pod using synthetic credentials and fixed object names."""

    def __init__(self, args):
        self.args = args
        self.name = 'secret-refresh-probe-' + uuid.uuid4().hex[:10]
        self.objects = []

    def kubectl(self, *arguments, payload=None):
        result = subprocess.run(
            ['kubectl', '--context', self.args.context, '--namespace', self.args.namespace,
             *arguments], input=json.dumps(payload) if payload is not None else None,
            text=True, capture_output=True, timeout=45, check=False)
        if result.returncode:
            # Do not dump objects or command output: this is also safe for failed API responses.
            raise RuntimeError(f'kubectl {arguments[0]} failed with exit {result.returncode}')
        return result.stdout

    def create(self, kind, **fields):
        self.kubectl('create', '-f', '-', payload={
            'apiVersion': 'v1', 'kind': kind, 'metadata': {'name': self.name}, **fields})
        self.objects.append(kind.lower())

    def rotate(self, revision):
        payload = {} if revision == 'invalid' else {
            'endpoint': 's3://test-bucket', 'access_key_id': f'fake-id-{revision}',
            'access_key': f'fake-key-{revision}', 'region': 'us-west-2'}
        return {'cred.yaml': json.dumps(payload)}

    def status(self):
        return json.loads(self.kubectl(
            'exec', self.name, '--', '/usr/bin/python3', '-c',
            "print(open('/tmp/status.json').read())"))

    def wait(self, predicate, description, timeout=180):
        deadline = time.monotonic() + timeout
        latest = None
        while time.monotonic() < deadline:
            try:
                latest = self.status()
                if predicate(latest):
                    print(json.dumps({'checkpoint': description, 'status': latest}), flush=True)
                    return latest
            except (RuntimeError, ValueError):
                pass  # Pod scheduling/image pull/status-file creation can be pending.
            threading.Event().wait(5)
        raise AssertionError(f'{description} timed out; last safe probe status: {latest}')

    def identity(self):
        pod = json.loads(self.kubectl('get', 'pod', self.name, '-o', 'json'))
        config = json.loads(self.kubectl('get', 'configmap', self.name, '-o', 'json'))
        return (pod['metadata']['uid'], config['metadata']['resourceVersion'],
                [entry['restartCount'] for entry in pod['status']['containerStatuses']])

    def run(self):
        code = Path(__file__).with_name('secret_refresh_probe.py').read_text(encoding='utf-8')
        config = {'workflow': {name: {'credential': {
            'secretName': 'probe-storage', 'secretKey': 'cred.yaml'}}
            for name in ('workflow_data', 'workflow_log', 'workflow_app')}}
        config.update({name: {} for name in (
            'service', 'backends', 'backend_tests', 'pools', 'pod_templates',
            'group_templates', 'resource_validations', 'roles')})
        config['service'] = {'max_pod_restart_limit': '30m'}
        config['roles'] = {'osmo-default': {
            'description': 'Synthetic probe role', 'external_roles': [],
            'policies': [{'effect': 'Allow', 'actions': ['system:Health'], 'resources': ['*']}]}}
        bootstrap = (
            'import glob,runpy,sys; '
            "roots=glob.glob('/src/service/*/*.runfiles'); "
            "sys.path[:0]=[r+'/_main' for r in roots]+"
            "[p for r in roots for p in glob.glob(r+'/rules_python++pip+*/site-packages')]; "
            "runpy.run_path('/probe/secret_refresh_probe.py',run_name='__main__')")
        try:
            self.create('Secret', stringData=self.rotate('A'))
            self.create('ConfigMap', data={'config.yaml': json.dumps(config),
                                           'secret_refresh_probe.py': code})
            self.create('Pod', spec={
                'restartPolicy': 'Never', 'activeDeadlineSeconds': 900,
                'automountServiceAccountToken': False,
                'nodeSelector': {'kubernetes.io/arch': 'amd64',
                                 **dict(self.args.node_selector)},
                'tolerations': [{'key': 'dedicated', 'operator': 'Equal',
                                 'value': 'osmo-service', 'effect': 'NoSchedule'}],
                'imagePullSecrets': [{'name': self.args.image_pull_secret}],
                'containers': [{
                    'name': 'probe', 'image': self.args.image,
                    'command': ['/usr/bin/python3', '-c', bootstrap],
                    'env': [{'name': 'DISABLE_DEPENDENCY_POLLING',
                             'value': '1' if self.args.negative_control else '0'}],
                    'resources': {'requests': {'cpu': '100m', 'memory': '256Mi'},
                                  'limits': {'cpu': '1', 'memory': '768Mi'}},
                    'volumeMounts': [{'name': 'probe', 'mountPath': '/probe', 'readOnly': True},
                                     {'name': 'storage', 'readOnly': True,
                                      'mountPath': '/etc/osmo/secrets/probe-storage'}],
                }],
                'volumes': [{'name': 'probe', 'configMap': {'name': self.name}},
                            {'name': 'storage', 'secret': {'secretName': self.name}}],
            })
            initial = self.wait(lambda s: s['resolved'] == ['A'] * 3, 'initial A')
            if initial['loader_hash'] != self.args.loader_sha256:
                raise AssertionError('Packaged loader does not match the reviewed source hash')
            identity = self.identity()
            previous_failures = initial['refresh']['failures']
            for revision in ('B', 'invalid', 'C'):
                self.kubectl('patch', 'secret', self.name, '--type=merge',
                             '--patch-file=/dev/stdin',
                             payload={'stringData': self.rotate(revision)})
                self.wait(lambda s, revision=revision: s['projected'] == revision,
                          f'kubelet projected {revision}')
                if revision == 'invalid':
                    current = self.wait(lambda s: s['refresh']['failures'] > previous_failures
                                        and s['refresh']['stale'],
                                        'invalid replacement rejected', timeout=75)
                    if current['resolved'] != ['B'] * 3 or current['refresh']['sequence'] != 2:
                        raise AssertionError('Invalid Secret replaced the last-good snapshot')
                else:
                    current = self.wait(
                        lambda s, revision=revision: s['resolved'] == [revision] * 3
                        and not s['refresh']['stale'],
                        f'Secret-only rotation refreshed three references to {revision}',
                        timeout=75)
                    expected_sequence = 2 if revision == 'B' else 3
                    if current['refresh']['sequence'] != expected_sequence:
                        raise AssertionError('Unexpected publication without a dependency change')
                if (self.identity() != identity or current['config_hash'] != initial['config_hash']
                        or current['pid'] != initial['pid']):
                    raise AssertionError('Pod restarted or ConfigMap changed during rotation')
                previous_failures = current['refresh']['failures']
            config['service']['max_pod_restart_limit'] = '45m'
            for settings in config['workflow'].values():
                settings['credential']['secretName'] = 'ignored-configmap-replacement'
            self.kubectl('patch', 'configmap', self.name, '--type=merge',
                         '--patch-file=/dev/stdin',
                         payload={'data': {'config.yaml': json.dumps(config)}})
            self.wait(lambda s: s['config_hash'] != initial['config_hash'],
                      'kubelet projected new startup-only ConfigMap')
            self.kubectl('patch', 'secret', self.name, '--type=merge',
                         '--patch-file=/dev/stdin', payload={'stringData': self.rotate('A')})
            self.wait(lambda s: s['projected'] == 'A', 'original Secret projected A again')
            final = self.wait(lambda s: s['resolved'] == ['A'] * 3 and not s['refresh']['stale'],
                              'original references refresh after ConfigMap replacement', timeout=75)
            final_identity = self.identity()
            if (final['startup_setting'] != '30m' or final['refresh']['sequence'] != 4
                    or final['pid'] != initial['pid'] or final_identity[0] != identity[0]
                    or final_identity[2] != identity[2]):
                raise AssertionError('ConfigMap replacement changed startup state or restarted pod')
            print('PASS: live projection, refresh, last-good recovery, immutable startup config',
                  flush=True)
        finally:
            # Delete only the exact names this invocation successfully created.
            active_exception = sys.exc_info()[0] is not None
            cleanup_failures = []
            for kind in reversed(self.objects):
                try:
                    self.kubectl('delete', kind, self.name, '--wait=false', '--ignore-not-found')
                except (RuntimeError, subprocess.TimeoutExpired):
                    cleanup_failures.append(kind)
            if cleanup_failures:
                message = f'Cleanup incomplete for {self.name}: {cleanup_failures}'
                print(message, file=sys.stderr, flush=True)
                if not active_exception:
                    raise RuntimeError(message)
            else:
                print(f'Deleted synthetic probe objects: {self.name}', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('context', 'namespace', 'image', 'image-pull-secret', 'loader-sha256'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--node-selector', action='append', type=lambda s: s.split('=', 1),
                        default=[])
    parser.add_argument('--negative-control', action='store_true',
                        help='Disable polling only in the disposable probe; test MUST fail')
    ProjectionProbe(parser.parse_args()).run()


if __name__ == '__main__':
    main()
