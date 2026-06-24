"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

End-to-end verification of issue #936 'none' scheduler type on a real kind cluster.

Generates pod specs using NoneK8sObjectFactory and KaiK8sObjectFactory directly,
applies them to a kind cluster that has NO kai-scheduler installed, and verifies:

* Kai-style resources fail to apply (PodGroup CRD missing) — proves the cluster
  really lacks kai-scheduler, so the test can fail.
* None-style resources apply cleanly and the pod reaches Running, scheduled by
  the cluster's default kube-scheduler — proves Option C removes the kai
  dependency.

Usage:
    KIND_CONTEXT=kind-issue-936-none python test_scheduler_none_kind.py
"""

import datetime
import json
import os
import subprocess
import sys
import time

# Make sibling source tree importable when invoked directly.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

from src.lib.utils import priority as wf_priority  # noqa: E402
from src.utils import connectors  # noqa: E402
from src.utils.job import kb_objects  # noqa: E402

KIND_CONTEXT = os.environ.get('KIND_CONTEXT', 'kind-issue-936-none')
NAMESPACE = os.environ.get('TEST_NAMESPACE', 'issue-936-test')
POOL_NAME = 'pool-a'
GROUP_UUID = 'issue-936-grp-1234567890ab'


def kubectl(args: list, *, input_data: str | None = None, check: bool = True) \
        -> subprocess.CompletedProcess:
    cmd = ['kubectl', '--context', KIND_CONTEXT, '-n', NAMESPACE] + args
    return subprocess.run(
        cmd, input=input_data, text=True, capture_output=True, check=check)


def make_backend(scheduler_type: connectors.BackendSchedulerType) -> connectors.Backend:
    return connectors.Backend(
        name='backend-test',
        description='kind test backend',
        version='1.0.0',
        k8s_uid='kind-uid',
        k8s_namespace=NAMESPACE,
        dashboard_url='http://test',
        grafana_url='http://test',
        tests=[],
        scheduler_settings=connectors.BackendSchedulerSettings(
            scheduler_type=scheduler_type,
            scheduler_name=('kai-scheduler'
                            if scheduler_type == connectors.BackendSchedulerType.KAI
                            else ''),
        ),
        node_conditions=connectors.BackendNodeConditions(),
        last_heartbeat=datetime.datetime.now(),
        created_date=datetime.datetime.now(),
        router_address='router',
        online=True,
    )


def make_pod(name: str) -> dict:
    return {
        'apiVersion': 'v1',
        'kind': 'Pod',
        'metadata': {
            'name': name,
            'labels': {
                'osmo.task_name': name,
                'osmo.group_uid': GROUP_UUID,
            },
            'annotations': {},
        },
        'spec': {
            'restartPolicy': 'Never',
            'containers': [{
                'name': 'sleeper',
                'image': 'busybox:1.36',
                'command': ['sh', '-c', 'echo ok && sleep 5'],
            }],
        },
    }


def assert_kind_context_has_no_kai() -> None:
    print(f'[setup] verifying {KIND_CONTEXT} has no kai-scheduler installed...')
    result = subprocess.run(
        ['kubectl', '--context', KIND_CONTEXT, 'get', 'crd', '-o', 'name'],
        capture_output=True, text=True, check=True)
    bad = [line for line in result.stdout.splitlines()
           if 'scheduling.run.ai' in line or 'kai.scheduler' in line]
    if bad:
        print(f'  FAIL: cluster has kai/run.ai CRDs: {bad}', file=sys.stderr)
        sys.exit(2)
    print('  OK: no kai-scheduler CRDs')


def reset_namespace() -> None:
    subprocess.run(
        ['kubectl', '--context', KIND_CONTEXT, 'delete', 'ns', NAMESPACE,
         '--ignore-not-found', '--wait=true', '--timeout=60s'],
        check=True)
    subprocess.run(
        ['kubectl', '--context', KIND_CONTEXT, 'create', 'ns', NAMESPACE], check=True)


def red_phase_kai_fails() -> None:
    print('\n[RED] Kai-style spec must FAIL to apply (proves cluster has no kai)')
    backend = make_backend(connectors.BackendSchedulerType.KAI)
    factory = kb_objects.get_k8s_object_factory(backend)
    assert isinstance(factory, kb_objects.KaiK8sObjectFactory)
    pods = [make_pod('kai-task-1')]
    resources = factory.create_group_k8s_resources(
        GROUP_UUID, pods, {'osmo.label': 'v'}, POOL_NAME,
        wf_priority.WorkflowPriority.NORMAL, [], [])
    kinds = sorted({r['kind'] for r in resources})
    print(f'  factory produced kinds={kinds}')
    if 'PodGroup' not in kinds:
        print('  FAIL: KaiK8sObjectFactory should have produced a PodGroup', file=sys.stderr)
        sys.exit(2)

    yaml_doc = '\n---\n'.join(json.dumps(r) for r in resources)
    result = kubectl(['apply', '-f', '-'], input_data=yaml_doc, check=False)
    if result.returncode == 0:
        print('  FAIL: kai PodGroup unexpectedly applied — cluster has kai installed?',
              file=sys.stderr)
        sys.exit(2)
    if 'PodGroup' not in result.stderr and 'no matches' not in result.stderr:
        print(f'  FAIL: unexpected error: {result.stderr}', file=sys.stderr)
        sys.exit(2)
    print(f'  OK: apply rejected as expected: {result.stderr.strip().splitlines()[-1]}')


def green_phase_none_succeeds() -> None:
    print('\n[GREEN] None-style spec must apply and pod must reach Running')
    backend = make_backend(connectors.BackendSchedulerType.NONE)
    factory = kb_objects.get_k8s_object_factory(backend)
    assert isinstance(factory, kb_objects.NoneK8sObjectFactory)

    pods = [make_pod('none-task-1')]
    resources = factory.create_group_k8s_resources(
        GROUP_UUID, pods, {'osmo.label': 'v'}, POOL_NAME,
        wf_priority.WorkflowPriority.NORMAL, [], [])

    kinds = sorted({r['kind'] for r in resources})
    print(f'  factory produced kinds={kinds}')
    if kinds != ['Pod']:
        print(f'  FAIL: expected [Pod] only, got {kinds}', file=sys.stderr)
        sys.exit(2)

    pod = resources[0]
    if 'schedulerName' in pod['spec']:
        print(f'  FAIL: pod has schedulerName={pod["spec"]["schedulerName"]}',
              file=sys.stderr)
        sys.exit(2)
    bad_label_keys = [k for k in pod['metadata']['labels']
                      if k.startswith('kai.scheduler/') or k.startswith('runai/')]
    if bad_label_keys:
        print(f'  FAIL: pod has kai labels: {bad_label_keys}', file=sys.stderr)
        sys.exit(2)
    print('  pod has no schedulerName, no kai labels ✓')

    yaml_doc = '\n---\n'.join(json.dumps(r) for r in resources)
    result = kubectl(['apply', '-f', '-'], input_data=yaml_doc)
    print(f'  apply: {result.stdout.strip()}')

    print('  waiting for pod to reach Running (or Succeeded)...')
    deadline = time.time() + 120
    pod_name = pods[0]['metadata']['name']
    last_phase = ''
    while time.time() < deadline:
        result = kubectl(
            ['get', 'pod', pod_name, '-o', 'jsonpath={.status.phase}'], check=False)
        last_phase = result.stdout.strip()
        if last_phase in ('Running', 'Succeeded'):
            break
        time.sleep(2)
    if last_phase not in ('Running', 'Succeeded'):
        kubectl(['describe', 'pod', pod_name], check=False)
        print(f'  FAIL: pod stuck in phase={last_phase}', file=sys.stderr)
        sys.exit(2)
    print(f'  OK: pod phase={last_phase}')

    result = kubectl(
        ['get', 'pod', pod_name, '-o',
         'jsonpath={.spec.schedulerName}|{.spec.nodeName}'])
    scheduler_name, _, node_name = result.stdout.partition('|')
    print(f'  scheduled by={scheduler_name!r} on node={node_name!r}')
    # K8s defaults to "default-scheduler" when schedulerName is unset.
    if scheduler_name not in ('default-scheduler', ''):
        print(f'  FAIL: unexpected scheduler {scheduler_name}', file=sys.stderr)
        sys.exit(2)
    if not node_name:
        print('  FAIL: pod was not scheduled to a node', file=sys.stderr)
        sys.exit(2)


def main() -> None:
    assert_kind_context_has_no_kai()
    reset_namespace()
    try:
        red_phase_kai_fails()
        reset_namespace()
        green_phase_none_succeeds()
    finally:
        subprocess.run(
            ['kubectl', '--context', KIND_CONTEXT, 'delete', 'ns', NAMESPACE,
             '--ignore-not-found', '--wait=false'],
            check=False)
    print('\n✅ issue #936 e2e verification PASSED')


if __name__ == '__main__':
    main()
