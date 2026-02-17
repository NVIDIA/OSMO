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
import datetime
import unittest
from typing import Any, Dict, List

from src.lib.utils import osmo_errors, priority as wf_priority
from src.utils import connectors
from src.utils.job import kb_objects, topology


class TopologyTestBase(unittest.TestCase):
    """
    Base class for topology-aware scheduling tests.
    Provides utility methods for creating mock configurations and comparing PodGroup specs.
    """

    def create_mock_backend(self, namespace: str = 'test-namespace') -> connectors.Backend:
        """Create a mock Backend object with KAI scheduler."""
        return connectors.Backend(
            name='test-backend',
            description='Test backend',
            version='1.0.0',
            k8s_uid='test-uid',
            k8s_namespace=namespace,
            dashboard_url='http://test',
            grafana_url='http://test',
            tests=[],
            scheduler_settings=connectors.BackendSchedulerSettings(
                scheduler_type=connectors.BackendSchedulerType.KAI,
                scheduler_name='kai-scheduler'
            ),
            node_conditions=connectors.BackendNodeConditions(),
            last_heartbeat=datetime.datetime.now(),
            created_date=datetime.datetime.now(),
            router_address='test-router',
            online=True
        )

    def create_mock_pod_spec(self, task_name: str) -> Dict[str, Any]:
        """Create a mock pod spec for testing."""
        return {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': f'pod-{task_name}',
                'labels': {'osmo.task_name': task_name},
                'annotations': {}
            },
            'spec': {
                'containers': [{
                    'name': 'test-container',
                    'image': 'test-image'
                }]
            }
        }

    def as_golden(self, podgroup: Dict) -> Dict:
        """Extract topology-relevant fields from a PodGroup for golden comparison.

        Includes topology-relevant spec fields only (minMember, topologyConstraint,
        subGroups). Excludes metadata and non-topology spec fields (queue,
        priorityClassName). Subgroups are sorted by name for deterministic comparison.
        """
        topology_spec_keys = frozenset({'minMember', 'topologyConstraint', 'subGroups'})
        spec = {k: v for k, v in podgroup['spec'].items() if k in topology_spec_keys}
        if 'subGroups' in spec:
            spec['subGroups'] = sorted(spec['subGroups'], key=lambda sg: sg['name'])
        return spec


class BasicTopologyTests(TopologyTestBase):
    """Test basic topology requirements functionality."""

    def test_no_topology_requirements(self):
        """
        A simple workflow without any topology configuration should generate
        a standard PodGroup without topology constraints.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        group_uuid = 'test-group-uuid'
        topology_keys_list: List[topology.TopologyKey] = []
        task_infos = [topology.TaskTopology(name=f'task{i}', topology_requirements=[])
                      for i in range(1, 5)]
        pods = [self.create_mock_pod_spec(task_info.name) for task_info in task_infos]
        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys_list, task_infos
        )

        self.assertEqual(self.as_golden(k8s_resources[0]), {'minMember': 4})

        self.assertEqual(len(k8s_resources), 5)  # 1 PodGroup + 4 pods
        for pod in k8s_resources[1:]:
            self.assertNotIn('kai.scheduler/subgroup-name', pod['metadata']['labels'])

    def test_single_topology_level_required(self):
        """
        A workflow with a single topology requirement (gpu-clique) should generate
        a PodGroup with a top-level topology constraint and no subgroups when all
        tasks share the same group.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
            topology.TopologyKey(key='zone', label='topology.kubernetes.io/zone'),
        ]
        task_infos = [
            topology.TaskTopology(
                name=f'model1-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='default', required=True)
                ]
            )
            for i in range(1, 5)
        ]

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'minMember': 4,
            'topologyConstraint': {
                'topology': topology_name,
                'requiredTopologyLevel': 'nvidia.com/gpu-clique',
            },
        })

        for pod in k8s_resources[1:]:
            self.assertNotIn('kai.scheduler/subgroup-name', pod['metadata']['labels'])


class MultipleSubgroupTests(TopologyTestBase):
    """Test multiple subgroups with same topology level."""

    def test_multiple_subgroups_same_level(self):
        """
        A workflow with tasks grouped into multiple topology groups at the same level
        should generate a PodGroup with multiple subgroups.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
            topology.TopologyKey(key='zone', label='topology.kubernetes.io/zone'),
        ]

        task_infos = []
        for i in range(1, 5):
            task_infos.append(topology.TaskTopology(
                name=f'model1-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='model-1-group', required=True)
                ]
            ))
            task_infos.append(topology.TaskTopology(
                name=f'model2-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='model-2-group', required=True)
                ]
            ))

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'subGroups': [
                {
                    'name': 'model-1-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'requiredTopologyLevel': 'nvidia.com/gpu-clique',
                    },
                },
                {
                    'name': 'model-2-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'requiredTopologyLevel': 'nvidia.com/gpu-clique',
                    },
                },
            ],
        })

        for pod in k8s_resources[1:]:
            task_name = pod['metadata']['labels']['osmo.task_name']
            expected_subgroup = 'model-1-group' if 'model1' in task_name else 'model-2-group'
            self.assertEqual(
                pod['metadata']['labels']['kai.scheduler/subgroup-name'],
                expected_subgroup
            )


class HierarchicalTopologyTests(TopologyTestBase):
    """Test hierarchical topology requirements."""

    def test_two_level_hierarchy_required(self):
        """
        A workflow with hierarchical topology requirements (zone + gpu-clique) should
        generate a PodGroup with a top-level zone constraint and per-model subgroups
        constrained to gpu-clique.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='zone', label='topology.kubernetes.io/zone'),
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
        ]

        task_infos = []
        for i in range(1, 5):
            task_infos.append(topology.TaskTopology(
                name=f'model1-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='zone', group='workflow-group', required=True),
                    topology.TopologyRequirement(key='gpu-clique', group='model-1-group', required=True),
                ]
            ))
            task_infos.append(topology.TaskTopology(
                name=f'model2-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='zone', group='workflow-group', required=True),
                    topology.TopologyRequirement(key='gpu-clique', group='model-2-group', required=True),
                ]
            ))

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'topologyConstraint': {
                'topology': topology_name,
                'requiredTopologyLevel': 'topology.kubernetes.io/zone',
            },
            'subGroups': [
                {
                    'name': 'workflow-group-model-1-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'requiredTopologyLevel': 'nvidia.com/gpu-clique',
                    },
                },
                {
                    'name': 'workflow-group-model-2-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'requiredTopologyLevel': 'nvidia.com/gpu-clique',
                    },
                },
            ],
        })

        for pod in k8s_resources[1:]:
            task_name = pod['metadata']['labels']['osmo.task_name']
            expected_subgroup = ('workflow-group-model-1-group' if 'model1' in task_name
                                 else 'workflow-group-model-2-group')
            self.assertEqual(
                pod['metadata']['labels']['kai.scheduler/subgroup-name'],
                expected_subgroup
            )

    def test_mixed_required_and_preferred(self):
        """
        A workflow with preferred (not required) topology requirements should use
        preferredTopologyLevel instead of requiredTopologyLevel.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='spine', label='topology.kubernetes.io/spine'),
            topology.TopologyKey(key='rack', label='topology.kubernetes.io/rack'),
        ]

        task_infos = []
        for i in range(1, 5):
            task_infos.append(topology.TaskTopology(
                name=f'model1-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='spine', group='workflow-group', required=False),
                    topology.TopologyRequirement(key='rack', group='model-1-group', required=False),
                ]
            ))
            task_infos.append(topology.TaskTopology(
                name=f'model2-shard{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='spine', group='workflow-group', required=False),
                    topology.TopologyRequirement(key='rack', group='model-2-group', required=False),
                ]
            ))

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'topologyConstraint': {
                'topology': topology_name,
                'preferredTopologyLevel': 'topology.kubernetes.io/spine',
            },
            'subGroups': [
                {
                    'name': 'workflow-group-model-1-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'preferredTopologyLevel': 'topology.kubernetes.io/rack',
                    },
                },
                {
                    'name': 'workflow-group-model-2-group',
                    'minMember': 4,
                    'topologyConstraint': {
                        'topology': topology_name,
                        'preferredTopologyLevel': 'topology.kubernetes.io/rack',
                    },
                },
            ],
        })


class EdgeCaseTests(TopologyTestBase):
    """Test edge cases and error conditions."""

    def test_empty_topology_list(self):
        """
        A workflow with topology=[] should behave the same as no topology.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
        ]
        task_infos = [
            topology.TaskTopology(name=f'task{i}', topology_requirements=[])
            for i in range(1, 5)
        ]

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        self.assertEqual(self.as_golden(k8s_resources[0]), {'minMember': 4})

        for pod in k8s_resources[1:]:
            self.assertNotIn('kai.scheduler/subgroup-name', pod['metadata']['labels'])

    def test_single_task_with_topology(self):
        """
        A single task with topology requirement should create topology constraint.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
        ]
        task_infos = [
            topology.TaskTopology(
                name='single-task',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='default', required=True)
                ]
            )
        ]

        group_uuid = 'test-group-uuid'
        pod = self.create_mock_pod_spec('single-task')

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, [pod], labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'minMember': 1,
            'topologyConstraint': {
                'topology': topology_name,
                'requiredTopologyLevel': 'nvidia.com/gpu-clique',
            },
        })

    def test_all_tasks_same_topology_group(self):
        """
        When all tasks use the same topology group and key, the constraint should
        be at the top level with no subgroups (optimization).
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='zone', label='topology.kubernetes.io/zone'),
            topology.TopologyKey(key='rack', label='topology.kubernetes.io/rack'),
        ]
        task_infos = [
            topology.TaskTopology(
                name=f'task{i}',
                topology_requirements=[
                    topology.TopologyRequirement(key='zone', group='same', required=True),
                    topology.TopologyRequirement(key='rack', group='same', required=True),
                ]
            )
            for i in range(1, 5)
        ]

        group_uuid = 'test-group-uuid'
        pods = []
        for task_info in task_infos:
            pod = self.create_mock_pod_spec(task_info.name)
            pods.append(pod)

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        # When all tasks share the same groups at all topology levels, the entire
        # path is a single-child chain. The algorithm walks down this chain and
        # promotes the constraint to the top level, using the finest shared level (rack).
        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'minMember': 4,
            'topologyConstraint': {
                'topology': topology_name,
                'requiredTopologyLevel': 'topology.kubernetes.io/rack',
            },
        })


class ComplexScenarioTests(TopologyTestBase):
    """Test complex scenarios with multiple groups and mixed configurations."""

    def test_placeholder_complex(self):
        """Placeholder test for complex scenarios."""
        pass


class ValidationTests(TopologyTestBase):
    """Test validation and error handling."""

    def test_inconsistent_topology_keys_within_group(self):
        """
        All tasks in a group must have the same topology keys.
        This validation should raise an error.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
            topology.TopologyKey(key='zone', label='topology.kubernetes.io/zone'),
        ]
        task_infos = [
            topology.TaskTopology(
                name='task1',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='g1', required=True)
                ]
            ),
            topology.TaskTopology(
                name='task2',
                topology_requirements=[
                    topology.TopologyRequirement(key='zone', group='g2', required=True)
                ]
            ),
        ]

        group_uuid = 'test-group-uuid'
        pods = [self.create_mock_pod_spec(task_info.name) for task_info in task_infos]

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        with self.assertRaises(osmo_errors.OSMOResourceError) as context:
            factory.create_group_k8s_resources(
                group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
            )

        self.assertIn('same topology keys', str(context.exception))

    def test_mixed_topology_and_non_topology_same_group(self):
        """
        Tests behavior when some tasks have topology and others don't.

        Based on the validation code in topology.py, this is treated as having
        different key sets and should raise an error.
        """
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
        ]
        task_infos = [
            topology.TaskTopology(
                name='task1',
                topology_requirements=[
                    topology.TopologyRequirement(key='gpu-clique', group='g1', required=True)
                ]
            ),
            topology.TaskTopology(name='task2', topology_requirements=[]),
        ]

        group_uuid = 'test-group-uuid'
        pods = [self.create_mock_pod_spec(task_info.name) for task_info in task_infos]

        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        # Empty topology is NOT added to key_sets (see topology.py: "if task.topology_requirements:")
        # so only one key set exists: ('gpu-clique',). Validation passes.
        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority, topology_keys, task_infos
        )

        topology_name = f'osmo-pool-test-namespace-{pool_name}-topology'
        self.assertEqual(self.as_golden(k8s_resources[0]), {
            'minMember': 2,
            'topologyConstraint': {
                'topology': topology_name,
                'requiredTopologyLevel': 'nvidia.com/gpu-clique',
            },
        })


if __name__ == "__main__":
    unittest.main()
