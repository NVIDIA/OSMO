"""
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from src.lib.utils import priority as wf_priority
from src.utils import connectors
from src.utils.job import kb_objects


class TopologyTestBase(unittest.TestCase):
    """
    Base class for topology-aware scheduling tests.
    Provides utility methods for creating mock configurations and validating PodGroup specs.
    """

    def create_mock_backend(self, namespace: str = 'test-namespace') -> connectors.Backend:
        """
        Create a mock Backend object with KAI scheduler.

        Args:
            namespace: Kubernetes namespace for the backend

        Returns:
            Mock Backend object
        """
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

    def create_mock_pool_config(self, topology_keys: List[Dict[str, str]] | None = None) -> Dict[str, Any]:
        """
        Create a mock pool configuration with optional topology_keys.

        Args:
            topology_keys: List of topology key definitions. Each entry should have:
                - key: User-friendly name (e.g., "gpu-clique")
                - label: Kubernetes node label (e.g., "nvidia.com/gpu-clique")

        Returns:
            Dict representing a pool configuration
        """
        pool_config: Dict[str, Any] = {
            'name': 'test-pool',
            'description': 'Test pool for topology tests',
            'backend': 'test-backend',
        }
        if topology_keys is not None:
            pool_config['topology_keys'] = topology_keys
        return pool_config

    def create_mock_pod_spec(self, name: str) -> Dict[str, Any]:
        """
        Create a mock pod spec for testing.

        Args:
            name: Name for the pod

        Returns:
            Mock pod spec dictionary
        """
        return {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': name,
                'labels': {},
                'annotations': {}
            },
            'spec': {
                'containers': [{
                    'name': 'test-container',
                    'image': 'test-image'
                }]
            }
        }

    def validate_podgroup_metadata(self, podgroup: Dict, expected_name: str, expected_labels: Dict[str, str]):
        """
        Validate PodGroup metadata fields.

        Args:
            podgroup: The PodGroup spec dictionary
            expected_name: Expected name for the PodGroup
            expected_labels: Expected labels on the PodGroup
        """
        self.assertEqual(podgroup['metadata']['name'], expected_name)
        for key, value in expected_labels.items():
            self.assertIn(key, podgroup['metadata']['labels'])
            self.assertEqual(podgroup['metadata']['labels'][key], value)

    def validate_podgroup_spec_basic(self, podgroup: Dict, expected_min_member: int,
                                     expected_queue: str, expected_priority_class: str):
        """
        Validate basic PodGroup spec fields (minMember, queue, priorityClassName).

        Args:
            podgroup: The PodGroup spec dictionary
            expected_min_member: Expected minMember count
            expected_queue: Expected queue name
            expected_priority_class: Expected priority class name
        """
        self.assertEqual(podgroup['spec']['minMember'], expected_min_member)
        self.assertEqual(podgroup['spec']['queue'], expected_queue)
        self.assertEqual(podgroup['spec']['priorityClassName'], expected_priority_class)

    def validate_topology_constraint(self, topology_constraint: Dict, expected_topology: str,
                                     expected_level: str, required: bool = True):
        """
        Validate a topologyConstraint field in PodGroup or subgroup spec.

        Args:
            topology_constraint: The topologyConstraint dictionary
            expected_topology: Expected topology reference name
            expected_level: Expected topology level (node label)
            required: Whether to check for requiredTopologyLevel (True) or preferredTopologyLevel (False)
        """
        self.assertEqual(topology_constraint['topology'], expected_topology)
        level_key = 'requiredTopologyLevel' if required else 'preferredTopologyLevel'
        self.assertEqual(topology_constraint[level_key], expected_level)

    def validate_subgroup(self, subgroup: Dict, expected_name: str, expected_min_member: int,
                         expected_topology_constraint: Dict | None = None):
        """
        Validate a subgroup entry in the PodGroup spec.

        Args:
            subgroup: The subgroup dictionary
            expected_name: Expected subgroup name
            expected_min_member: Expected minMember count for this subgroup
            expected_topology_constraint: Expected topologyConstraint (if any)
        """
        self.assertEqual(subgroup['name'], expected_name)
        self.assertEqual(subgroup['minMember'], expected_min_member)
        if expected_topology_constraint is not None:
            self.assertIn('topologyConstraint', subgroup)
            self.assertEqual(subgroup['topologyConstraint'], expected_topology_constraint)

    def validate_pod_annotations(self, pod: Dict, expected_pod_group_name: str,
                                 expected_subgroup_name: str | None = None):
        """
        Validate pod annotations for topology-aware scheduling.

        Args:
            pod: The pod spec dictionary
            expected_pod_group_name: Expected pod-group-name annotation
            expected_subgroup_name: Expected kai.scheduler/subgroup-name label (if any)
        """
        self.assertIn('annotations', pod['metadata'])
        self.assertEqual(pod['metadata']['annotations']['pod-group-name'], expected_pod_group_name)

        if expected_subgroup_name is not None:
            self.assertIn('kai.scheduler/subgroup-name', pod['metadata']['labels'])
            self.assertEqual(pod['metadata']['labels']['kai.scheduler/subgroup-name'],
                           expected_subgroup_name)


class BasicTopologyTests(TopologyTestBase):
    """Test basic topology requirements functionality."""

    def test_no_topology_requirements(self):
        """
        Test 1.3: No Topology Requirements
        A simple workflow without any topology configuration should generate
        a standard PodGroup without topology constraints.
        """
        # Create factory
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        # Create mock pods
        group_uuid = 'test-group-uuid'
        pods = [
            self.create_mock_pod_spec('pod-1'),
            self.create_mock_pod_spec('pod-2'),
            self.create_mock_pod_spec('pod-3'),
            self.create_mock_pod_spec('pod-4'),
        ]
        labels = {'test-label': 'test-value'}
        pool_name = 'test-pool'
        priority = wf_priority.WorkflowPriority.NORMAL

        # Generate PodGroup and pods
        k8s_resources = factory.create_group_k8s_resources(
            group_uuid, pods, labels, pool_name, priority
        )

        # First resource should be the PodGroup
        podgroup = k8s_resources[0]
        self.assertEqual(podgroup['kind'], 'PodGroup')
        self.assertEqual(podgroup['apiVersion'], 'scheduling.run.ai/v2alpha2')

        # Validate basic PodGroup fields
        self.validate_podgroup_metadata(podgroup, group_uuid, labels)
        self.validate_podgroup_spec_basic(
            podgroup, 4, f'osmo-pool-test-namespace-{pool_name}', 'osmo-normal'
        )

        # Should NOT have topology constraints
        self.assertNotIn('topologyConstraint', podgroup['spec'])
        self.assertNotIn('subgroups', podgroup['spec'])

        # Remaining resources should be the pods
        self.assertEqual(len(k8s_resources), 5)  # 1 PodGroup + 4 pods
        for i, pod in enumerate(k8s_resources[1:], 1):
            self.assertEqual(pod['kind'], 'Pod')
            self.assertEqual(pod['metadata']['annotations']['pod-group-name'], group_uuid)

    def test_single_topology_level_required(self):
        """
        Test 1.1: Single Topology Level - Required
        A workflow with a single topology requirement (gpu-clique) should generate
        a PodGroup with a single subgroup and topology constraint.
        """
        # Create factory with pool that has topology_keys
        backend = self.create_mock_backend()
        factory = kb_objects.KaiK8sObjectFactory(backend)

        # For this test, we need to pass topology information to the PodGroup generation
        # The design doc shows that topology constraints come from the workflow spec
        # and are processed during PodGroup generation.
        #
        # Expected PodGroup structure:
        # - spec.topologyConstraint: None (only one level, so it's in the subgroup)
        # - spec.subgroups: [
        #     {
        #       name: <subgroup-name>,
        #       minMember: 4,
        #       topologyConstraint: {
        #         topology: "test-pool-topology",
        #         requiredTopologyLevel: "nvidia.com/gpu-clique"
        #       }
        #     }
        #   ]
        #
        # Since the feature is not yet implemented, this test will fail.
        # We'll add a skip for now and implement once the feature is ready.

        self.skipTest("Topology feature not yet implemented")


class MultipleSubgroupTests(TopologyTestBase):
    """Test multiple subgroups with same topology level."""

    def test_multiple_subgroups_same_level(self):
        """
        Test 2.1: Multiple Groups - Required
        A workflow with tasks grouped into multiple topology groups at the same level
        should generate a PodGroup with multiple subgroups.

        Expected behavior (from design doc Use Case 2):
        - 8 tasks total: 4 for model-1-group, 4 for model-2-group
        - PodGroup with minMember=8
        - Two subgroups, each with minMember=4
        - Each subgroup has topology constraint for gpu-clique
        - Pods labeled with their respective subgroup names

        Implementation requirements:
        - Need to pass topology information to create_group_k8s_resources
        - Need to group pods by their topology group
        - Need to generate subgroups with appropriate topology constraints
        """
        self.skipTest("Topology feature not yet implemented")


class HierarchicalTopologyTests(TopologyTestBase):
    """Test hierarchical topology requirements."""

    def test_two_level_hierarchy_required(self):
        """
        Test 3.1: Two-Level Hierarchy - Required
        A workflow with hierarchical topology requirements (gpu-clique + zone)
        should generate a PodGroup with top-level constraint and subgroups.

        Expected behavior (from design doc Use Case 3):
        - 8 tasks: 4 for model-1 (group: model-1-group), 4 for model-2 (group: model-2-group)
        - Both models require same zone (group: workflow-group)
        - PodGroup.spec.topologyConstraint for zone (coarsest level)
        - Two subgroups for gpu-clique (finest level)

        Implementation requirements:
        - Identify coarsest topology level shared by all tasks
        - Create top-level topologyConstraint
        - Create subgroups for finer-grained requirements
        """
        self.skipTest("Topology feature not yet implemented")

    def test_mixed_required_and_preferred(self):
        """
        Test 3.3: Mixed Required and Preferred
        A workflow with preferred (not required) topology requirements should use
        preferredTopologyLevel instead of requiredTopologyLevel.

        Implementation requirements:
        - Support requirementType field in TopologyRequirement
        - Use preferredTopologyLevel in PodGroup spec when requirementType=preferred
        """
        self.skipTest("Topology feature not yet implemented")


class EdgeCaseTests(TopologyTestBase):
    """Test edge cases and error conditions."""

    def test_empty_topology_list(self):
        """
        Test 4.1: Empty Topology List
        A workflow with topology=[] should behave the same as no topology.
        """
        self.skipTest("Topology feature not yet implemented")

    def test_single_task_with_topology(self):
        """
        Test 4.3: Single Task with Topology
        A single task with topology requirement should create a subgroup with minMember=1.
        """
        self.skipTest("Topology feature not yet implemented")

    def test_all_tasks_same_topology_group(self):
        """
        Test 4.4: All Tasks Same Topology Group
        When all tasks use the same topology group and key, the constraint should
        be at the top level with a single subgroup.
        """
        self.skipTest("Topology feature not yet implemented")


class ComplexScenarioTests(TopologyTestBase):
    """Test complex scenarios with multiple groups and mixed configurations."""

    def test_placeholder_complex(self):
        """Placeholder test for complex scenarios."""
        pass


class ValidationTests(TopologyTestBase):
    """Test validation and error handling."""

    def test_inconsistent_topology_keys_within_group(self):
        """
        Test 6.2: Inconsistent Topology Keys Within Group
        All tasks in a group must have the same topology keys.
        This validation should happen at workflow parse time.

        Implementation requirements:
        - Add validation in workflow spec parsing
        - Raise error if tasks in same group have different topology keys
        """
        self.skipTest("Validation not yet implemented")

    def test_mixed_topology_and_non_topology_same_group(self):
        """
        Test 6.3: Mixed Topology and Non-Topology Within Same Group
        All tasks in a group must either have topology or not have topology.
        Mixing is not allowed.

        Implementation requirements:
        - Add validation in workflow spec parsing
        - Raise error if some tasks have topology and others don't
        """
        self.skipTest("Validation not yet implemented")


if __name__ == "__main__":
    unittest.main()
