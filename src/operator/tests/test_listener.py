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
    V1ContainerState, V1ContainerStateRunning, V1ContainerStateTerminated)  # type: ignored
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
        status, err_msg, exit_code = backend_listener.calculate_pod_status(None, pod_event, None)
        self.assertEqual(status, task.TaskGroupStatus.FAILED)
        self.assertTrue('OSMO Control' in err_msg)
        self.assertNotEqual(exit_code, 0)

    def test_user_start_error_only(self):
        """ Test raising failure status if user container has StartError. """
        pod_event = self.create_good_ctrl_starterror_user_pod()
        status, _, exit_code = backend_listener.calculate_pod_status(None, pod_event, None)
        self.assertEqual(status, task.TaskGroupStatus.FAILED)
        self.assertNotEqual(exit_code, 0)

    def test_user_start_error_only(self):
        """
        Test raising Running status when osmo-ctrl is running but user container enters error
        state. This is because osmo-ctrl still needs to upload data before cleaning up.
        """
        pod_event = self.create_good_ctrl_error_user_pod()
        status, _, _ = backend_listener.calculate_pod_status(None, pod_event, None)
        self.assertEqual(status, task.TaskGroupStatus.RUNNING)

if __name__ == '__main__':
    unittest.main()
