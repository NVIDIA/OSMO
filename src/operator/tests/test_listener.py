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
import unittest

from kubernetes.client import (
    V1Pod, V1ObjectMeta, V1PodSpec, V1Container, V1PodStatus, V1ContainerStatus,
    V1ContainerState, V1ContainerStateRunning, V1ContainerStateTerminated,
    V1Node, V1NodeStatus, V1NodeCondition, V1NodeSpec)  # type: ignore
from src.operator import backend_listener
from src.utils.job import task

class TestBackendListener(unittest.TestCase):
    def create_spec(self):
        # Define the containers (without specific runtime commands, as this is for mock)
        control_container = V1Container(
            name='osmo-ctrl',
            image='osmo-ctrl-image'
        )

        user_container = V1Container(
            name='user',
            image='nginx'
        )

        # Define the Pod spec (normally used for actual Pod creation)
        return V1PodSpec(
            containers=[control_container, user_container]
        )

    def create_bad_ctrl_good_user_pod(self):
        """
        Create a pod event object where osmo-ctrl errors out, but user container is still running.
        The pod's phase field is also Running.
        """
        # Artificially construct the container statuses to reflect the desired states
        control_container_status = V1ContainerStatus(
            name='osmo-ctrl',
            image='osmo-ctrl-image',
            image_id='osmo-ctrl-imageid',
            state=V1ContainerState(
                terminated=V1ContainerStateTerminated(reason='Error', exit_code=2)),
            ready=False,
            restart_count=0
        )

        user_container_status = V1ContainerStatus(
            name='user',
            image='nginx',
            image_id='nginx_id',
            state=V1ContainerState(
                running=V1ContainerStateRunning(started_at='2024-02-27T12:34:56Z')),
            ready=True,
            restart_count=0
        )

        # Define the Pod status to include these container statuses
        status = V1PodStatus(
            phase='Running',
            container_statuses=[control_container_status, user_container_status]
        )

        # Instantiate the Pod with the specified metadata, spec, and status
        pod = V1Pod(
            api_version='v1',
            kind='Pod',
            metadata=V1ObjectMeta(name='my-mock-pod'),
            spec=self.create_spec(),
            status=status
        )
        return pod

    def create_good_ctrl_starterror_user_pod(self):
        """
        Create a pod event object where osmo-ctrl is running, but user container entered a
        StartError state. The pod's phase field is also Running.
        """
        # Artificially construct the container statuses to reflect the desired states
        control_container_status = V1ContainerStatus(
            name='osmo-ctrl',
            image='osmo-ctrl-image',
            image_id='osmo-ctrl-imageid',
            state=V1ContainerState(
                running=V1ContainerStateRunning(started_at='2024-02-27T12:34:56Z')),
            ready=True,
            restart_count=0
        )

        user_container_status = V1ContainerStatus(
            name='user',
            image='nginx',
            image_id='nginx_id',
            state=V1ContainerState(
                terminated=V1ContainerStateTerminated(reason='StartError', exit_code=128)),
            ready=False,
            restart_count=0
        )

        status = V1PodStatus(
            phase='Running',
            container_statuses=[control_container_status, user_container_status]
        )

        # Instantiate the Pod with the specified metadata, spec, and status
        pod = V1Pod(
            api_version='v1',
            kind='Pod',
            metadata=V1ObjectMeta(name='my-mock-pod'),
            spec=self.create_spec(),
            status=status
        )
        return pod

    def create_good_ctrl_error_user_pod(self):
        """
        Create a pod event object where osmo-ctrl is running, but user container entered error state.
        The pod's phase field is also Running.
        """
        # Artificially construct the container statuses to reflect the desired states
        control_container_status = V1ContainerStatus(
            name='osmo-ctrl',
            image='osmo-ctrl-image',
            image_id='osmo-ctrl-imageid',
            state=V1ContainerState(running=V1ContainerStateRunning(started_at='2024-02-27T12:34:56Z')),
            ready=True,
            restart_count=0
        )

        user_container_status = V1ContainerStatus(
            name='user',
            image='nginx',
            image_id='nginx_id',
            state=V1ContainerState(terminated=V1ContainerStateTerminated(reason='Error', exit_code=2)),
            ready=False,
            restart_count=0
        )

        status = V1PodStatus(
            phase='Running',
            container_statuses=[control_container_status, user_container_status]
        )

        # Instantiate the Pod with the specified metadata, spec, and status
        pod = V1Pod(
            api_version='v1',
            kind='Pod',
            metadata=V1ObjectMeta(name='my-mock-pod'),
            spec=self.create_spec(),
            status=status
        )
        return pod

    def test_osmo_ctrl_error_only(self):
        """ Test raising failure status if only osmo-ctrl errors out. """
        pod_event = self.create_bad_ctrl_good_user_pod()
        status, err_msg, exit_code = backend_listener.calculate_pod_status(pod_event)
        self.assertEqual(status, task.TaskGroupStatus.FAILED)
        self.assertTrue('OSMO Control' in err_msg)
        self.assertNotEqual(exit_code, 0)

    def test_user_start_error_only(self):
        """ Test raising failure status if user container has StartError. """
        pod_event = self.create_good_ctrl_starterror_user_pod()
        status, _, exit_code = backend_listener.calculate_pod_status(pod_event)
        self.assertEqual(status, task.TaskGroupStatus.FAILED)
        self.assertNotEqual(exit_code, 0)

    def test_user_error_but_ctrl_running_results_in_running(self):
        """
        Test raising Running status when osmo-ctrl is running but user container enters error
        state. This is because osmo-ctrl still needs to upload data before cleaning up.
        """
        pod_event = self.create_good_ctrl_error_user_pod()
        status, _, _ = backend_listener.calculate_pod_status(pod_event)
        self.assertEqual(status, task.TaskGroupStatus.RUNNING)


class TestNodeAvailability(unittest.TestCase):
    def setUp(self):
        # Reset singleton before each test
        backend_listener.ConditionsController._instance = None

    def tearDown(self):
        backend_listener.ConditionsController._instance = None

    def create_node(self, conditions, unschedulable=False):
        node_conditions = [V1NodeCondition(type=ctype, status=cstatus) for ctype, cstatus in conditions]
        node_status = V1NodeStatus(conditions=node_conditions)
        node_spec = V1NodeSpec(unschedulable=unschedulable)
        return V1Node(status=node_status, spec=node_spec)

    def test_default_ready_true(self):
        controller = backend_listener.ConditionsController({})
        node = self.create_node([('Ready', 'True')])
        self.assertTrue(backend_listener.is_node_available(node, controller))

    def test_default_ready_false(self):
        controller = backend_listener.ConditionsController({})
        node = self.create_node([('Ready', 'False')])
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_allow_memorypressure_true(self):
        controller = backend_listener.ConditionsController({'^MemoryPressure$': 'True|False'})
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True')])
        self.assertTrue(backend_listener.is_node_available(node, controller))

    def test_restrict_diskpressure_false(self):
        controller = backend_listener.ConditionsController({'^DiskPressure$': 'False'})
        node = self.create_node([('Ready', 'True'), ('DiskPressure', 'True')])
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_unmatched_condition_ignored(self):
        controller = backend_listener.ConditionsController({})
        node = self.create_node([('Ready', 'True'), ('CoolCondition', 'True')])
        self.assertTrue(backend_listener.is_node_available(node, controller))

    def test_override_ready_raises_error(self):
        with self.assertRaises(Exception):
            backend_listener.ConditionsController({'^Ready$': 'False|Unknown'})

    def test_unschedulable_node(self):
        controller = backend_listener.ConditionsController({})
        node = self.create_node([('Ready', 'True')], unschedulable=True)
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_rule_mismatch_results_in_unavailable(self):
        controller = backend_listener.ConditionsController({'^MemoryPressure$': 'False'})
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True')])
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_two_rules_one_fails_other_passes(self):
        controller = backend_listener.ConditionsController({
            '^MemoryPressure$': 'False',
            '^PIDPressure$': 'True'
        })
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True'), ('PIDPressure', 'True')])
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_two_rules_other_fails_one_passes(self):
        controller = backend_listener.ConditionsController({
            '^MemoryPressure$': 'True',
            '^PIDPressure$': 'False'
        })
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True'), ('PIDPressure', 'True')])
        self.assertFalse(backend_listener.is_node_available(node, controller))

    def test_two_matching_rules_first_fails_second_passes_allows(self):
        # Conflicting rules for the same condition; any allowing rule should permit
        controller = backend_listener.ConditionsController({
            '^Memory.*': 'False',
            '^MemoryPressure$': 'True'
        })
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True')])
        self.assertTrue(backend_listener.is_node_available(node, controller))

    def test_two_matching_rules_first_passes_second_fails_allows(self):
        # Conflicting rules for the same condition; first allows, later disallows
        controller = backend_listener.ConditionsController({
            '^MemoryPressure$': 'True',
            '^Memory.*': 'False'
        })
        node = self.create_node([('Ready', 'True'), ('MemoryPressure', 'True')])
        self.assertTrue(backend_listener.is_node_available(node, controller))


if __name__ == '__main__':
    unittest.main()
