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
# Unit tests for calculate_pod_status function
# Reads from test_calculate_pod_status_cases.json for test specifications
# bazel test //src/operator/tests:test_pod_status_calculator

import datetime
import json
import os
import unittest
from typing import Any, Dict

from kubernetes.client import (
    V1Pod, V1ObjectMeta, V1PodSpec, V1Container, V1PodStatus, V1ContainerStatus,
    V1ContainerState, V1ContainerStateRunning, V1ContainerStateTerminated,
    V1ContainerStateWaiting, V1PodCondition)  # type: ignore
from src.operator.backend_listener import calculate_pod_status
from src.utils.job import task


def parse_time_string(time_str: str) -> datetime.datetime:
    """Parse time strings like 'now', 'now-5m', 'now-15m' into datetime objects"""
    if time_str == 'now':
        return datetime.datetime.now()
    elif time_str.startswith('now-'):
        parts = time_str[4:]
        if parts.endswith('m'):
            minutes = int(parts[:-1])
            return datetime.datetime.now() - datetime.timedelta(minutes=minutes)
        elif parts.endswith('h'):
            hours = int(parts[:-1])
            return datetime.datetime.now() - datetime.timedelta(hours=hours)
    return datetime.datetime.now()


def create_pod_from_json(test_input: Dict) -> V1Pod:
    """Helper function to create a real Kubernetes V1Pod object from JSON test case input"""
    phase = test_input.get('phase', 'Running')
    pod_name = test_input.get('pod_name', 'test-pod')
    reason = test_input.get('reason')
    message = test_input.get('message')
    container_statuses = test_input.get('container_statuses')
    init_container_statuses = test_input.get('init_container_statuses')
    conditions = test_input.get('conditions')
    node_name = test_input.get('node_name', 'test-node')

    # Convert container statuses
    container_status_objects = []
    if container_statuses:
        for cs in container_statuses:
            state = cs.get('state', {})
            v1_state = V1ContainerState()

            if 'waiting' in state:
                v1_state.waiting = V1ContainerStateWaiting(
                    reason=state['waiting'].get('reason'),
                    message=state['waiting'].get('message')
                )
            if 'terminated' in state:
                v1_state.terminated = V1ContainerStateTerminated(
                    reason=state['terminated'].get('reason'),
                    exit_code=state['terminated'].get('exit_code'),
                    message=state['terminated'].get('message')
                )
            if 'running' in state:
                v1_state.running = V1ContainerStateRunning()

            container_status_objects.append(V1ContainerStatus(
                name=cs.get('name', 'test-container'),
                image='test-image',
                image_id='test-image-id',
                state=v1_state,
                ready=False,
                restart_count=0
            ))

    # Convert init container statuses
    init_container_status_objects = []
    if init_container_statuses:
        for ics in init_container_statuses:
            state = ics.get('state', {})
            v1_state = V1ContainerState()

            if 'waiting' in state:
                v1_state.waiting = V1ContainerStateWaiting(
                    reason=state['waiting'].get('reason'),
                    message=state['waiting'].get('message')
                )
            if 'terminated' in state:
                v1_state.terminated = V1ContainerStateTerminated(
                    reason=state['terminated'].get('reason'),
                    exit_code=state['terminated'].get('exit_code'),
                    message=state['terminated'].get('message')
                )

            init_container_status_objects.append(V1ContainerStatus(
                name=ics.get('name', 'init-container'),
                image='init-image',
                image_id='init-image-id',
                state=v1_state,
                ready=False,
                restart_count=0
            ))

    # Convert conditions
    condition_objects = []
    if conditions:
        for cond in conditions:
            last_trans_time = None
            if 'last_transition_time' in cond:
                last_trans_time = parse_time_string(cond['last_transition_time'])

            condition_objects.append(V1PodCondition(
                type=cond.get('type'),
                status=cond.get('status'),
                reason=cond.get('reason'),
                message=cond.get('message'),
                last_transition_time=last_trans_time
            ))

    # Create Pod spec
    spec = V1PodSpec(
        containers=[V1Container(name='test-container', image='test-image')],
        node_name=node_name
    )

    # Create Pod status
    status_obj = V1PodStatus(
        phase=phase,
        reason=reason,
        message=message,
        container_statuses=container_status_objects if container_status_objects else None,
        init_container_statuses=init_container_status_objects if init_container_status_objects else None,
        conditions=condition_objects if condition_objects else None,
        pod_ip='10.0.0.1'
    )

    # Create Pod
    pod = V1Pod(
        api_version='v1',
        kind='Pod',
        metadata=V1ObjectMeta(
            name=pod_name,
            labels={'osmo.task_uuid': 'test-task', 'osmo.workflow_uuid': 'test-workflow'}
        ),
        spec=spec,
        status=status_obj
    )

    return pod


class TestCalculatePodStatus(unittest.TestCase):
    """Comprehensive test suite for calculate_pod_status function - driven by JSON test cases"""

    test_data: Dict[str, Any] = {}  # type: ignore

    @classmethod
    def setUpClass(cls):
        """Load test cases from JSON file"""
        # Find the JSON file - it should be in the runfiles
        test_cases_file = 'src/operator/tests/test_calculate_pod_status_cases.json'

        # Try different paths for the JSON file
        possible_paths = [
            test_cases_file,
            os.path.join(os.path.dirname(__file__), 'test_calculate_pod_status_cases.json'),
            'test_calculate_pod_status_cases.json',
        ]

        cls.test_data = {}
        for path in possible_paths:
            if os.path.exists(path):
                with open(path, 'r') as f:
                    cls.test_data = json.load(f)
                break

        if not cls.test_data:
            raise FileNotFoundError(
                f"Could not find test_calculate_pod_status_cases.json in any of: {possible_paths}"
            )

    def run_test_case(self, test_case: Dict):
        """Generic method to run a test case from JSON"""
        test_name = test_case['name']
        test_input = test_case['input']
        expected = test_case['expected']

        # Create pod from test input
        pod = create_pod_from_json(test_input)

        # Call calculate_pod_status
        status, message, exit_code = calculate_pod_status(pod)

        # Validate status
        expected_status = getattr(task.TaskGroupStatus, expected['status'])
        self.assertEqual(
            status, expected_status,
            f"{test_name}: Expected status {expected['status']}, got {status}"
        )

        # Validate exit code
        expected_exit_code = expected.get('exit_code')
        if expected_exit_code is None:
            self.assertIsNone(
                exit_code,
                f"{test_name}: Expected None exit code, got {exit_code}"
            )
        else:
            self.assertIsNotNone(
                exit_code,
                f"{test_name}: Expected exit code {expected_exit_code}, got None"
            )
            self.assertEqual(
                exit_code, expected_exit_code,
                f"{test_name}: Expected exit code {expected_exit_code}, got {exit_code}"
            )

        # Validate message contains expected strings
        if 'message_contains' in expected:
            for expected_str in expected['message_contains']:
                self.assertIn(
                    expected_str, message,
                    f"{test_name}: Expected message to contain '{expected_str}', got: {message}"
                )


def generate_test_methods():
    """Dynamically generate test methods from JSON test cases"""
    # This will be called after the class is created
    pass


# After class definition, generate test methods
def load_tests(loader, tests, pattern):
    """Load tests from JSON and generate test methods"""
    suite = unittest.TestSuite()

    # Load test data
    test_cases_file = 'src/operator/tests/test_calculate_pod_status_cases.json'
    possible_paths = [
        test_cases_file,
        os.path.join(os.path.dirname(__file__), 'test_calculate_pod_status_cases.json'),
        'test_calculate_pod_status_cases.json',
    ]

    test_data = None
    for path in possible_paths:
        if os.path.exists(path):
            with open(path, 'r') as f:
                test_data = json.load(f)
            break

    if test_data is None:
        return suite

    # Generate test methods dynamically
    for test_case in test_data['test_cases']:
        test_name = test_case['name']

        def make_test(tc):
            def test_method(self):
                self.run_test_case(tc)
            return test_method

        test_method = make_test(test_case)
        test_method.__name__ = test_name
        test_method.__doc__ = test_case['description']

        # Add test to suite
        setattr(TestCalculatePodStatus, test_name, test_method)
        suite.addTest(TestCalculatePodStatus(test_name))

    return suite


if __name__ == '__main__':
    unittest.main(verbosity=2)

