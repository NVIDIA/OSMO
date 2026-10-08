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
import copy
import unittest
from unittest import mock

from kubernetes.client import (
    V1Pod, V1ObjectMeta, V1PodSpec, V1Container, V1PodStatus, V1ContainerStatus,
    V1ContainerState, V1ContainerStateRunning, V1ContainerStateTerminated,
    V1Node, V1NodeStatus, V1NodeCondition, V1NodeSpec,
    V1ListMeta, V1PodList, V1ResourceRequirements)  # type: ignore
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


class StopPodWatch(BaseException):
    """End a finite test stream without entering the listener's error/retry handlers."""


class TestPodWatchResourceUsage(unittest.TestCase):
    """Exercise namespace routing with the real Pod cache and resource calculator."""

    def setUp(self):
        self.config = backend_listener.objects.BackendListenerConfig(
            backend='own-backend', namespace='own', include_namespace_usage=['included'])
        self.node_send_queue = mock.Mock()
        self.pod_send_queue = mock.Mock()
        self.event_send_queue = mock.Mock()
        self.watcher = mock.Mock()
        self.patch(backend_listener.objects.BackendListenerConfig, 'load',
                   return_value=self.config)
        self.patch(backend_listener, 'get_thread_local_api', return_value=mock.Mock())
        self.patch(backend_listener.kubernetes.watch, 'Watch', return_value=self.watcher)
        self.patch(backend_listener.helpers, 'send_log_through_queue')
        for name in ('send_backend_message_count', 'send_histogram_for_processing_times',
                     'send_stream_event_count'):
            self.patch(backend_listener, name)
        self.calculate_status = self.patch(
            backend_listener, 'calculate_pod_status',
            return_value=(task.TaskGroupStatus.RUNNING, '', None))
        self.send_status = self.patch(backend_listener, 'send_pod_status')
        self.send_monitor = self.patch(backend_listener, 'send_pod_monitor')
        # An unexpected exception should fail this test, not signal the entire test runner.
        self.patch(backend_listener.os, 'kill',
                   side_effect=AssertionError('Unexpected exception in pod watch'))

    def patch(self, target, name, **kwargs):
        patcher = mock.patch.object(target, name, **kwargs)
        patched = patcher.start()
        self.addCleanup(patcher.stop)
        return patched

    @staticmethod
    def create_pod(namespace, *, phase='Running', labelled=False, node_name='worker-1'):
        labels = {'osmo.workflow_uuid': f'{namespace}-workflow',
                  'osmo.task_uuid': f'{namespace}-task'} if labelled else None
        return V1Pod(
            metadata=V1ObjectMeta(name=f'{namespace}-pod', namespace=namespace,
                                  resource_version='2', labels=labels),
            spec=V1PodSpec(
                node_name=node_name,
                containers=[V1Container(name='user', resources=V1ResourceRequirements(
                    requests={'cpu': '1', 'memory': '1Gi', 'ephemeral-storage': '1Gi',
                              'nvidia.com/gpu': '1'}))]),
            status=V1PodStatus(phase=phase))

    def run_watch(self, events, initial_pods=None):
        for callback in (self.node_send_queue, self.pod_send_queue, self.calculate_status,
                         self.send_status, self.send_monitor):
            callback.reset_mock()
        self.all_pods = backend_listener.PodList()
        for pod in initial_pods or []:
            self.all_pods.update_pod(pod)

        def stream(*_args, **_kwargs):
            for event_type, pod in events:
                yield {'type': event_type, 'object': pod}
            raise StopPodWatch()

        self.watcher.stream.side_effect = stream
        listing = V1PodList(metadata=V1ListMeta(resource_version='1'),
                            items=initial_pods or [])
        with self.assertRaises(StopPodWatch):
            backend_listener.watch_pod_events(
                mock.Mock(), self.pod_send_queue, self.node_send_queue, self.event_send_queue,
                self.config, listing, mock.Mock(), self.all_pods, mock.Mock())

        messages = [call.args[0] for call in self.node_send_queue.call_args_list]
        for message in messages:
            self.assertEqual(message.type,
                             backend_listener.backend_messages.MessageType.RESOURCE_USAGE)
            self.assertIsInstance(message.body, dict)
            self.assertEqual(message.body['hostname'], 'worker-1')
        return [message.body for message in messages]

    def assert_usage(self, messages, total_gpu, non_workflow_gpu):
        self.assertEqual([message['usage_fields']['nvidia.com/gpu'] for message in messages],
                         [str(value) for value in total_gpu])
        self.assertEqual(
            [message['non_workflow_usage_fields']['nvidia.com/gpu'] for message in messages],
            [str(value) for value in non_workflow_gpu])

    def assert_no_task_handling(self):
        self.calculate_status.assert_not_called()
        self.send_status.assert_not_called()
        self.send_monitor.assert_not_called()
        self.pod_send_queue.assert_not_called()

    def test_included_namespace_add_and_delete_publish_usage_only(self):
        for labelled in (False, True):
            for phase in ('Running', 'Pending'):
                with self.subTest(labelled=labelled, phase=phase):
                    pod = self.create_pod('included', phase=phase, labelled=labelled)
                    messages = self.run_watch([('ADDED', pod), ('DELETED', pod)])
                    self.assert_usage(messages, [1, 0], [0, 0])
                    self.assertEqual(list(self.all_pods.get_pods_by_node('worker-1')), [])
                    self.assert_no_task_handling()

    def test_included_terminal_pod_releases_usage(self):
        for phase in ('Succeeded', 'Failed'):
            with self.subTest(phase=phase):
                running = self.create_pod('included', labelled=True)
                terminal = copy.deepcopy(running)
                terminal.status.phase = phase
                terminal.metadata.resource_version = '3'
                messages = self.run_watch([('ADDED', running), ('MODIFIED', terminal)])
                self.assert_usage(messages, [1, 0], [0, 0])
                self.assert_no_task_handling()

    def test_own_workflow_retains_status_and_monitor_handling(self):
        for phase in ('Running', 'Pending'):
            with self.subTest(phase=phase):
                pod = self.create_pod('own', phase=phase, labelled=True)
                messages = self.run_watch([('ADDED', pod)])
                self.assert_usage(messages, [1], [0])
                self.calculate_status.assert_called_once_with(pod)
                self.send_status.assert_called_once()
                self.assertIs(self.send_status.call_args.args[2], pod)
                self.assertEqual(self.send_status.call_args.args[-1], 'own-backend')
                if phase == 'Pending':
                    self.send_monitor.assert_called_once_with(
                        self.pod_send_queue, self.event_send_queue, pod, '')
                else:
                    self.send_monitor.assert_not_called()

    def test_own_pod_without_workflow_labels_still_publishes_usage(self):
        for labels in (None, {}, {'osmo.workflow_uuid': 'workflow'},
                       {'osmo.task_uuid': 'task'}):
            with self.subTest(labels=labels):
                pod = self.create_pod('own')
                pod.metadata.labels = labels
                messages = self.run_watch([('ADDED', pod)])
                self.assert_usage(messages, [1], [0])
                self.assert_no_task_handling()

    def test_excluded_events_update_cache_and_remain_non_workflow_usage(self):
        excluded = self.create_pod('excluded', labelled=True)
        included = self.create_pod('included')
        messages = self.run_watch([
            ('ADDED', excluded), ('ADDED', included),
            ('DELETED', excluded), ('MODIFIED', included)])
        self.assert_usage(messages, [2, 1], [1, 0])
        self.assertEqual(list(self.all_pods.get_pods_by_node('worker-1')), [included])
        self.assert_no_task_handling()

    def test_unassigned_included_pod_does_not_publish_node_usage(self):
        pod = self.create_pod('included', phase='Pending', labelled=True, node_name=None)
        messages = self.run_watch([('ADDED', pod), ('DELETED', pod)])
        self.assertEqual(messages, [])
        self.assertEqual(list(self.all_pods.get_pods_by_node('worker-1')), [])
        self.assert_no_task_handling()

    def test_initial_replay_includes_configured_namespace_without_task_handling(self):
        for labelled in (False, True):
            with self.subTest(labelled=labelled):
                included = self.create_pod('included', labelled=labelled)
                excluded = self.create_pod('excluded')
                messages = self.run_watch([], initial_pods=[included, excluded])
                self.assert_usage(messages, [2], [1])
                self.assert_no_task_handling()

    def test_included_pod_without_resource_requests_publishes_zero_usage(self):
        for resources in (None, V1ResourceRequirements()):
            with self.subTest(resources=resources):
                pod = self.create_pod('included')
                pod.spec.containers[0].resources = resources
                messages = self.run_watch([('ADDED', pod), ('DELETED', pod)])
                self.assert_usage(messages, [0, 0], [0, 0])
                self.assert_no_task_handling()


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
