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

Golden-file fixtures for src/utils/job/rendering.py.

These fixtures are the Phase 0 contract for the OSMOTaskGroup CRD project
(`projects/PROJ-taskgroup-crd/PROJ-taskgroup-crd.md`). Two scopes:

  - **Dual-write contract** (Phase 1, what the Go KAI reconciler MUST
    reproduce byte-identically right now): `single_task_no_topology.json`.
    Any divergence is a Phase 1 blocker.
  - **Porting targets** (Python-only reference for later phases — *not* in
    the Phase 1 diff): `multi_task_with_topology.json` (KAI topology
    algorithm; ported once `PodGroupTopologyBuilder` exists in Go) and
    `pool_scheduler_resources.json` (Queue / Topology CRDs applied at
    backend-init time; Go side will reuse this fixture once the same logic
    lands controller-side).

Regenerating fixtures:
    Run with REGENERATE_GOLDEN=1 in the environment. Review the diff carefully
    — a fixture change here means the on-cluster object shape has changed and
    the Go reconciler must catch up for any fixture in the dual-write scope.
"""
import copy
import json
import os
import pathlib
import unittest
from typing import Any, Dict, List

from src.lib.utils import priority as wf_priority
from src.utils.job import rendering, topology


GOLDEN_DIR = pathlib.Path(__file__).parent / 'testdata' / 'rendering'
REGENERATE = os.environ.get('REGENERATE_GOLDEN') == '1'


def _base_pod(name: str, task_name: str) -> Dict[str, Any]:
    """Minimal pod skeleton matching the shape task.py emits before kb_objects mutates it."""
    return {
        'apiVersion': 'v1',
        'kind': 'Pod',
        'metadata': {
            'name': name,
            'labels': {
                'osmo.workflow_id': 'wf-abc',
                'osmo.group_uuid': 'group-xyz',
                'osmo.task_name': task_name,
            },
        },
        'spec': {
            'containers': [{
                'name': 'user',
                'image': 'nvcr.io/example/user:1.0',
                'resources': {
                    'requests': {'cpu': '4', 'memory': '16Gi', 'nvidia.com/gpu': '1'},
                    'limits': {'cpu': '4', 'memory': '16Gi', 'nvidia.com/gpu': '1'},
                },
            }],
            'restartPolicy': 'Never',
        },
    }


def _topology_keys() -> List[topology.TopologyKey]:
    return [
        topology.TopologyKey(key='z', label='topology.kubernetes.io/zone'),
        topology.TopologyKey(key='r', label='topology.kubernetes.io/rack'),
    ]


class GoldenFileTest(unittest.TestCase):
    """Run each case and diff render output against its golden file."""

    maxDiff = None

    def _assert_matches(self, case_name: str, actual: Dict[str, Any]) -> None:
        path = GOLDEN_DIR / f'{case_name}.json'
        if REGENERATE:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(actual, indent=2, sort_keys=True) + '\n')
            return
        if not path.exists():
            self.fail(
                f'Golden file missing: {path}. Run with REGENERATE_GOLDEN=1 '
                f'after reviewing the rendered output.'
            )
        expected = json.loads(path.read_text())
        self.assertEqual(
            expected, actual,
            f'Rendered output diverged from golden {path}. '
            f'If intentional, regenerate with REGENERATE_GOLDEN=1.'
        )

    def test_single_task_no_topology(self) -> None:
        spec = rendering.RenderInput(
            group_uuid='group-xyz',
            pool_name='default',
            pool_namespace='osmo-test',
            priority=wf_priority.WorkflowPriority.NORMAL,
            labels={'osmo.workflow_id': 'wf-abc', 'osmo.group_uuid': 'group-xyz'},
            pods=[_base_pod('wf-abc-task-1', 'worker_0')],
        )
        out = rendering.render_kai_task_group(spec)
        self._assert_matches('single_task_no_topology', _serialize(out))

    def test_multi_task_with_topology(self) -> None:
        keys = _topology_keys()
        task_infos = [
            topology.TaskTopology(
                name='worker_0',
                topology_requirements=[
                    topology.TopologyRequirement(key='z', group='z1', required=True),
                    topology.TopologyRequirement(key='r', group='r1', required=True),
                ],
            ),
            topology.TaskTopology(
                name='worker_1',
                topology_requirements=[
                    topology.TopologyRequirement(key='z', group='z1', required=True),
                    topology.TopologyRequirement(key='r', group='r1', required=True),
                ],
            ),
            topology.TaskTopology(
                name='worker_2',
                topology_requirements=[
                    topology.TopologyRequirement(key='z', group='z1', required=True),
                    topology.TopologyRequirement(key='r', group='r2', required=True),
                ],
            ),
        ]
        spec = rendering.RenderInput(
            group_uuid='group-xyz',
            pool_name='gpus',
            pool_namespace='osmo-test',
            priority=wf_priority.WorkflowPriority.HIGH,
            labels={'osmo.workflow_id': 'wf-abc', 'osmo.group_uuid': 'group-xyz'},
            pods=[
                _base_pod('wf-abc-task-0', 'worker_0'),
                _base_pod('wf-abc-task-1', 'worker_1'),
                _base_pod('wf-abc-task-2', 'worker_2'),
            ],
            topology_keys=keys,
            task_infos=task_infos,
        )
        out = rendering.render_kai_task_group(spec)
        self._assert_matches('multi_task_with_topology', _serialize(out))

    def test_queue_and_topology_resources(self) -> None:
        pools = [
            rendering.PoolInput(
                name='default',
                quota=rendering.PoolQuota(),
            ),
            rendering.PoolInput(
                name='gpus',
                quota=rendering.PoolQuota(gpu_guarantee=8, gpu_maximum=16, gpu_weight=2),
                topology_keys=_topology_keys(),
            ),
        ]
        resources = rendering.render_pool_scheduler_resources(
            namespace='osmo-test',
            pools=pools,
        )
        self._assert_matches('pool_scheduler_resources', {'resources': resources})

    def test_render_is_deterministic(self) -> None:
        """Same input → identical output. Phase 1 dual-write relies on this."""
        spec = rendering.RenderInput(
            group_uuid='group-xyz',
            pool_name='default',
            pool_namespace='osmo-test',
            priority=wf_priority.WorkflowPriority.NORMAL,
            labels={'osmo.workflow_id': 'wf-abc'},
            pods=[_base_pod('wf-abc-task-1', 'worker_0')],
        )
        first = _serialize(rendering.render_kai_task_group(copy.deepcopy(spec)))
        second = _serialize(rendering.render_kai_task_group(copy.deepcopy(spec)))
        self.assertEqual(first, second)


def _serialize(out: rendering.RenderOutput) -> Dict[str, Any]:
    """Stable JSON-friendly form for golden diffing."""
    return {
        'pod_group': out.pod_group,
        'pods': out.pods,
    }


if __name__ == '__main__':
    unittest.main()
