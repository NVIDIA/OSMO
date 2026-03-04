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
"""
import unittest
from typing import Dict, List

from src.lib.utils import priority as wf_priority
from src.service.core.workflow import objects
from src.service.core.workflow.workflow_service import calculate_pool_quotas
from src.utils import connectors
from src.utils.job import workflow


def make_pool_config(
    name: str,
    backend: str,
    gpu_guarantee: int = -1,
) -> connectors.PoolMinimal:
    resources = connectors.PoolResources(
        gpu=connectors.PoolResourceCountable(guarantee=gpu_guarantee)
    )
    return connectors.PoolMinimal(
        name=name, backend=backend, resources=resources)


def make_resource(
    hostname: str,
    backend: str,
    pool_platforms: List[str],
    gpu_allocatable: int = 0,
    gpu_usage: int = 0,
    gpu_non_workflow_usage: int = 0,
) -> workflow.ResourcesEntry:
    return workflow.ResourcesEntry.construct(
        hostname=hostname,
        backend=backend,
        allocatable_fields={'gpu': str(gpu_allocatable)},
        usage_fields={'gpu': str(gpu_usage)},
        non_workflow_usage_fields={'nvidia.com/gpu': str(gpu_non_workflow_usage)},
        exposed_fields={'pool/platform': pool_platforms},
        taints=[],
        conditions=None,
        platform_allocatable_fields=None,
        platform_available_fields=None,
        platform_workflow_allocatable_fields=None,
        config_fields=None,
        label_fields=None,
        pool_platform_labels={},
        resource_type=connectors.BackendResourceType.SHARED,
    )


def make_task_summary(
    pool: str,
    gpu: int,
    priority: str = wf_priority.WorkflowPriority.NORMAL.value,
) -> objects.ListTaskSummaryEntry:
    return objects.ListTaskSummaryEntry(
        user='test-user',
        pool=pool,
        storage=0,
        cpu=0,
        memory=0,
        gpu=gpu,
        priority=priority,
    )


def get_pool_usage(
    response: objects.PoolResponse,
    pool_name: str,
) -> objects.ResourceUsage:
    for node_set in response.node_sets:
        for pool in node_set.pools:
            if pool.name == pool_name:
                return pool.resource_usage
    raise ValueError(f'Pool {pool_name} not found in response')


class TestCalculatePoolQuotas(unittest.TestCase):

    # ------------------------------------------------------------------
    # Single pool, single node
    # ------------------------------------------------------------------
    def test_single_pool_single_node_no_tasks(self):
        """One pool with one 8-GPU node, no running tasks."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')
        self.assertEqual(usage.total_free, '8')
        self.assertEqual(usage.quota_limit, '8')
        self.assertEqual(usage.quota_used, '0')
        self.assertEqual(usage.quota_free, '8')
        self.assertEqual(usage.total_usage, '0')

        self.assertEqual(response.resource_sum.total_capacity, '8')
        self.assertEqual(response.resource_sum.total_free, '8')

    def test_single_pool_single_node_with_tasks(self):
        """One pool, one 8-GPU node, 3 GPUs used by non-preemptible tasks."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8, gpu_usage=3),
        ]
        task_summaries = [
            make_task_summary('pool-a', gpu=2),
            make_task_summary('pool-a', gpu=1),
        ]

        response = calculate_pool_quotas(pool_configs, task_summaries, resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')
        self.assertEqual(usage.total_free, '5')
        self.assertEqual(usage.quota_used, '3')
        self.assertEqual(usage.total_usage, '3')

    def test_single_pool_with_gpu_guarantee(self):
        """Pool with an explicit GPU guarantee (not -1)."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1', gpu_guarantee=4),
        }
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.quota_limit, '4')
        self.assertEqual(usage.quota_free, '4')
        self.assertEqual(usage.total_capacity, '8')

    # ------------------------------------------------------------------
    # Single pool, multiple nodes
    # ------------------------------------------------------------------
    def test_single_pool_multiple_nodes(self):
        """One pool spanning two 8-GPU nodes = 16 total GPUs."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8, gpu_usage=2),
            make_resource('node-2', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8, gpu_usage=0),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '16')
        self.assertEqual(usage.total_free, '14')
        self.assertEqual(response.resource_sum.total_capacity, '16')
        self.assertEqual(response.resource_sum.total_free, '14')

    # ------------------------------------------------------------------
    # Multiple disjoint pools (separate nodesets)
    # ------------------------------------------------------------------
    def test_disjoint_pools_separate_nodesets(self):
        """Two pools on different backends, no shared nodes."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1'),
            'pool-b': make_pool_config('pool-b', 'k8s-2'),
        }
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
            make_resource('node-2', 'k8s-2', ['pool-b/platform-1'],
                          gpu_allocatable=4, gpu_usage=1),
        ]
        task_summaries = [
            make_task_summary('pool-b', gpu=1),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        self.assertEqual(len(response.node_sets), 2)

        usage_a = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage_a.total_capacity, '8')
        self.assertEqual(usage_a.total_free, '8')
        self.assertEqual(usage_a.quota_used, '0')

        usage_b = get_pool_usage(response, 'pool-b')
        self.assertEqual(usage_b.total_capacity, '4')
        self.assertEqual(usage_b.total_free, '3')
        self.assertEqual(usage_b.quota_used, '1')
        self.assertEqual(usage_b.total_usage, '1')

        self.assertEqual(response.resource_sum.total_capacity, '12')
        self.assertEqual(response.resource_sum.total_free, '11')

    # ------------------------------------------------------------------
    # Overlapping pools (shared nodes -> merged nodeset)
    # ------------------------------------------------------------------
    def test_overlapping_pools_shared_node(self):
        """Two pools share the same node. They should be merged into one nodeset
        with the shared capacity reported for both pools."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1'),
            'pool-b': make_pool_config('pool-b', 'k8s-1'),
        }
        resources = [
            make_resource('node-1', 'k8s-1',
                          ['pool-a/platform-1', 'pool-b/platform-1'],
                          gpu_allocatable=8, gpu_usage=2),
        ]
        task_summaries = [
            make_task_summary('pool-a', gpu=1),
            make_task_summary('pool-b', gpu=1),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        # Both pools share the same nodeset
        self.assertEqual(len(response.node_sets), 1)
        self.assertEqual(len(response.node_sets[0].pools), 2)

        # Both pools see the same total capacity (the shared node)
        usage_a = get_pool_usage(response, 'pool-a')
        usage_b = get_pool_usage(response, 'pool-b')
        self.assertEqual(usage_a.total_capacity, '8')
        self.assertEqual(usage_b.total_capacity, '8')
        self.assertEqual(usage_a.total_free, '6')
        self.assertEqual(usage_b.total_free, '6')

        # But per-pool quota usage is tracked separately
        self.assertEqual(usage_a.quota_used, '1')
        self.assertEqual(usage_a.total_usage, '1')
        self.assertEqual(usage_b.quota_used, '1')
        self.assertEqual(usage_b.total_usage, '1')

        # Sum should reflect the shared capacity once, not doubled
        self.assertEqual(response.resource_sum.total_capacity, '8')
        self.assertEqual(response.resource_sum.total_free, '6')

    def test_overlapping_pools_transitive_merge(self):
        """Three pools where pool-a and pool-c don't directly share a node,
        but both share nodes with pool-b. The BFS should merge all three
        into a single nodeset."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1'),
            'pool-b': make_pool_config('pool-b', 'k8s-1'),
            'pool-c': make_pool_config('pool-c', 'k8s-1'),
        }
        resources = [
            # node-1: shared by pool-a and pool-b
            make_resource('node-1', 'k8s-1',
                          ['pool-a/platform-1', 'pool-b/platform-1'],
                          gpu_allocatable=8),
            # node-2: shared by pool-b and pool-c
            make_resource('node-2', 'k8s-1',
                          ['pool-b/platform-1', 'pool-c/platform-1'],
                          gpu_allocatable=4),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        # All three pools should be merged into one nodeset
        self.assertEqual(len(response.node_sets), 1)
        self.assertEqual(len(response.node_sets[0].pools), 3)

        # All pools see the combined capacity of node-1 + node-2
        for pool_name in ('pool-a', 'pool-b', 'pool-c'):
            usage = get_pool_usage(response, pool_name)
            self.assertEqual(usage.total_capacity, '12')
            self.assertEqual(usage.total_free, '12')

        self.assertEqual(response.resource_sum.total_capacity, '12')

    def test_mixed_overlapping_and_disjoint_pools(self):
        """Pool-a and pool-b share a node; pool-c is on a separate backend.
        This should produce two nodesets."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1'),
            'pool-b': make_pool_config('pool-b', 'k8s-1'),
            'pool-c': make_pool_config('pool-c', 'k8s-2'),
        }
        resources = [
            make_resource('node-1', 'k8s-1',
                          ['pool-a/platform-1', 'pool-b/platform-1'],
                          gpu_allocatable=8),
            make_resource('node-2', 'k8s-2', ['pool-c/platform-1'],
                          gpu_allocatable=4),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        self.assertEqual(len(response.node_sets), 2)
        self.assertEqual(response.resource_sum.total_capacity, '12')

        usage_a = get_pool_usage(response, 'pool-a')
        usage_c = get_pool_usage(response, 'pool-c')
        self.assertEqual(usage_a.total_capacity, '8')
        self.assertEqual(usage_c.total_capacity, '4')

    # ------------------------------------------------------------------
    # Duplicate resource entries for the same node
    # ------------------------------------------------------------------
    def test_duplicate_resource_entries_not_double_counted(self):
        """If the same node appears multiple times in the resource list
        (e.g. from multiple pool/platform labels), the GPU capacity must
        not be double-counted."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
            make_resource('node-1', 'k8s-1', ['pool-a/platform-2'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')
        self.assertEqual(response.resource_sum.total_capacity, '8')

    # ------------------------------------------------------------------
    # Non-workflow GPU usage
    # ------------------------------------------------------------------
    def test_non_workflow_usage_subtracted(self):
        """Non-workflow GPU usage (e.g. system pods) should reduce free GPUs."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8, gpu_usage=2,
                          gpu_non_workflow_usage=1),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')
        # total_free = allocatable - (usage + non_workflow_usage) = 8 - (2+1) = 5
        self.assertEqual(usage.total_free, '5')

    # ------------------------------------------------------------------
    # Preemptible vs non-preemptible tasks
    # ------------------------------------------------------------------
    def test_preemptible_tasks_do_not_count_toward_quota(self):
        """LOW priority tasks are preemptible and should not count toward
        quota_used, but should still count toward total_usage."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1', gpu_guarantee=8),
        }
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8, gpu_usage=6),
        ]
        task_summaries = [
            make_task_summary('pool-a', gpu=4,
                              priority=wf_priority.WorkflowPriority.NORMAL.value),
            make_task_summary('pool-a', gpu=2,
                              priority=wf_priority.WorkflowPriority.LOW.value),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        usage = get_pool_usage(response, 'pool-a')
        # Only NORMAL tasks count toward quota_used
        self.assertEqual(usage.quota_used, '4')
        # Both tasks count toward total_usage
        self.assertEqual(usage.total_usage, '6')
        self.assertEqual(usage.quota_limit, '8')
        self.assertEqual(usage.quota_free, '4')

    # ------------------------------------------------------------------
    # Tasks in unknown pools
    # ------------------------------------------------------------------
    def test_tasks_in_unknown_pool_ignored(self):
        """Tasks referencing a pool not in pool_configs should be ignored."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]
        task_summaries = [
            make_task_summary('pool-a', gpu=2),
            make_task_summary('pool-unknown', gpu=4),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.quota_used, '2')
        self.assertEqual(usage.total_usage, '2')

    def test_task_with_no_pool_ignored(self):
        """Tasks with pool=None should be ignored."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]
        task_summaries = [
            objects.ListTaskSummaryEntry(
                user='test-user', pool=None,
                storage=0, cpu=0, memory=0, gpu=4, priority='NORMAL'),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.quota_used, '0')
        self.assertEqual(usage.total_usage, '0')

    # ------------------------------------------------------------------
    # Empty inputs
    # ------------------------------------------------------------------
    def test_no_pools(self):
        """Empty pool_configs should return an empty response."""
        response = calculate_pool_quotas({}, [], [])

        self.assertEqual(len(response.node_sets), 0)
        self.assertEqual(response.resource_sum.total_capacity, '0')
        self.assertEqual(response.resource_sum.total_free, '0')

    def test_pools_with_no_resources(self):
        """Pools exist but have no resource entries (no nodes registered)."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}

        response = calculate_pool_quotas(pool_configs, [], [])

        self.assertEqual(len(response.node_sets), 1)
        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '0')
        self.assertEqual(usage.total_free, '0')
        self.assertEqual(usage.quota_limit, '0')

    def test_no_tasks(self):
        """No running tasks should show zero usage."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.quota_used, '0')
        self.assertEqual(usage.total_usage, '0')

    # ------------------------------------------------------------------
    # Pool with no GPU resource config
    # ------------------------------------------------------------------
    def test_pool_with_no_resource_config(self):
        """Pool created without any GPU resource limits.
        The function should default to PoolResourceCountable."""
        pool_config = connectors.PoolMinimal(
            name='pool-a', backend='k8s-1',
            resources=connectors.PoolResources(gpu=None))
        pool_configs = {'pool-a': pool_config}
        resources = [
            make_resource('node-1', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        # Default guarantee is -1, which resolves to total allocatable
        self.assertEqual(usage.quota_limit, '8')
        self.assertEqual(usage.total_capacity, '8')

    # ------------------------------------------------------------------
    # Resource sum consistency
    # ------------------------------------------------------------------
    def test_resource_sum_equals_nodeset_totals(self):
        """The resource_sum totals must exactly equal the sum of all
        nodeset-level capacities, regardless of pool overlap."""
        pool_configs = {
            'pool-a': make_pool_config('pool-a', 'k8s-1', gpu_guarantee=4),
            'pool-b': make_pool_config('pool-b', 'k8s-1', gpu_guarantee=4),
            'pool-c': make_pool_config('pool-c', 'k8s-2', gpu_guarantee=2),
        }
        resources = [
            # Shared by pool-a and pool-b
            make_resource('node-1', 'k8s-1',
                          ['pool-a/platform-1', 'pool-b/platform-1'],
                          gpu_allocatable=8, gpu_usage=3),
            # Only pool-c
            make_resource('node-2', 'k8s-2', ['pool-c/platform-1'],
                          gpu_allocatable=4, gpu_usage=1),
        ]
        task_summaries = [
            make_task_summary('pool-a', gpu=2),
            make_task_summary('pool-b', gpu=1),
            make_task_summary('pool-c', gpu=1),
        ]

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        # Compute expected sum from individual nodesets
        expected_capacity = 0
        expected_free = 0
        for node_set in response.node_sets:
            # All pools in a nodeset share the same capacity, so just take the first
            pool_usage = node_set.pools[0].resource_usage
            expected_capacity += int(pool_usage.total_capacity)
            expected_free += int(pool_usage.total_free)

        self.assertEqual(response.resource_sum.total_capacity,
                         str(expected_capacity))
        self.assertEqual(response.resource_sum.total_free,
                         str(expected_free))

    # ------------------------------------------------------------------
    # Nodes with zero GPUs
    # ------------------------------------------------------------------
    def test_nodes_with_zero_gpus(self):
        """Nodes without GPUs (e.g., CPU-only nodes) should contribute 0."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('gpu-node', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=8),
            make_resource('cpu-node', 'k8s-1', ['pool-a/platform-1'],
                          gpu_allocatable=0),
        ]

        response = calculate_pool_quotas(pool_configs, [], resources)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')
        self.assertEqual(usage.total_free, '8')

    # ------------------------------------------------------------------
    # Resource from unknown pool in exposed_fields (all_pools=True)
    # ------------------------------------------------------------------
    def test_resource_with_unknown_pool_skipped(self):
        """If a resource's pool/platform references a pool not in pool_configs,
        that assignment is skipped but the node still contributes to known pools."""
        pool_configs = {'pool-a': make_pool_config('pool-a', 'k8s-1')}
        resources = [
            make_resource('node-1', 'k8s-1',
                          ['pool-a/platform-1', 'pool-unknown/platform-1'],
                          gpu_allocatable=8),
        ]

        response = calculate_pool_quotas(
            pool_configs, [], resources, all_pools=True)

        usage = get_pool_usage(response, 'pool-a')
        self.assertEqual(usage.total_capacity, '8')

    # ------------------------------------------------------------------
    # Large-scale scenario
    # ------------------------------------------------------------------
    def test_many_pools_many_nodes(self):
        """Stress test: 10 pools, each with 4 dedicated 8-GPU nodes."""
        pool_configs: Dict[str, connectors.PoolMinimal] = {}
        resources: List[workflow.ResourcesEntry] = []
        task_summaries: List[objects.ListTaskSummaryEntry] = []

        for i in range(10):
            pool_name = f'pool-{i}'
            backend = f'k8s-{i}'
            pool_configs[pool_name] = make_pool_config(
                pool_name, backend, gpu_guarantee=16)
            for j in range(4):
                resources.append(
                    make_resource(f'node-{i}-{j}', backend,
                                  [f'{pool_name}/platform-1'],
                                  gpu_allocatable=8, gpu_usage=j))
            task_summaries.append(make_task_summary(pool_name, gpu=2))

        response = calculate_pool_quotas(
            pool_configs, task_summaries, resources)

        self.assertEqual(len(response.node_sets), 10)

        for i in range(10):
            usage = get_pool_usage(response, f'pool-{i}')
            # 4 nodes * 8 GPU = 32 total
            self.assertEqual(usage.total_capacity, '32')
            # Usage per backend: 0+1+2+3 = 6
            self.assertEqual(usage.total_free, '26')
            self.assertEqual(usage.quota_used, '2')
            self.assertEqual(usage.total_usage, '2')

        # Overall: 10 * 32 = 320 total, 10 * 26 = 260 free
        self.assertEqual(response.resource_sum.total_capacity, '320')
        self.assertEqual(response.resource_sum.total_free, '260')


if __name__ == '__main__':
    unittest.main()
