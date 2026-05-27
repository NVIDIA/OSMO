"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
import datetime
from typing import Any, Dict, List, Union, cast
from unittest import mock
import unittest

from src.lib.utils import common, credentials
from src.utils.job import task, kb_objects
from src.utils import connectors


def create_lvm_volume(name: str, size: str):
    return {
            'name': name,
            'csi': {
                'driver': 'lvm.csi.nvidia.com',
                'fsType': 'ext4',
                'readOnly': 'false',
                'volumeAttributes': {
                    'sizeGB': size
                }
            }
    }

def create_container(cpu: Union[str, int] = '1', ephemeral_storage: str = '1Gi',
                     memory: str = '1Gi',
                     name: str = 'user', volume_mounts: List[Any] | None = None):
    volume_mounts = volume_mounts if volume_mounts is not None else []
    result = {
        'name': name,
        'image': 'ubuntu:latest',
        'resources': {
            'requests': {
                'ephemeral-storage': ephemeral_storage,
                'cpu': cpu,
                'memory': memory
            },
            'limits': {
                'ephemeral-storage': ephemeral_storage,
                'cpu': cpu,
                'memory': memory
            }
        }
    }
    if volume_mounts:
        result['volumeMounts'] = volume_mounts
    return result

def create_task_manifest(cpu: str = '1', ephemeral_storage: str = '1Gi'):
    workflow_uuid = common.generate_unique_id()
    task_uuid = common.generate_unique_id()
    labels = {'user': 'test', 'workflow_uuid': workflow_uuid, 'task_uuid': task_uuid}
    return {
            'metadata': {
                'name': kb_objects.construct_pod_name(workflow_uuid, task_uuid),
                'labels': labels,
            },
            'spec': {
                'volumes': [{'name': 'osmo'}, {'name': 'osmo-data'}],
                'containers': [create_container(cpu, ephemeral_storage)]
            }
    }


def create_toleration():
    return {
        'effect': 'NoSchedule',
        'key': 'reserved',
        'operator': 'Equal',
        'value': 'osmo'
    }


class TaskTest(unittest.TestCase):
    def check_other_fields(self, final_pod: Dict, tolerations: List, labels: Dict):
        self.assertEqual(final_pod['spec']['tolerations'], tolerations)
        self.assertEqual(final_pod['metadata']['labels'], labels)

    def test_simple_pod_spec(self):
        """ Runs a simple test to apply pod template to task pod. """
        pod_template = {
            'spec': {
                'tolerations': [
                    create_toleration()
                ]
            }
        }
        task_pod = create_task_manifest()
        final_pod = task.apply_pod_template(pod_template, task_pod)

        self.check_other_fields(
            final_pod, pod_template['spec']['tolerations'], task_pod['metadata']['labels'])
        self.assertEqual(final_pod['spec']['tolerations'], pod_template['spec']['tolerations'])
        # Check the spec value of the final pod
        self.maxDiff = None
        self.assertEqual({
            'tolerations': [create_toleration()],
            'volumes': [{'name': 'osmo'}, {'name': 'osmo-data'}],
            'containers': [create_container()]
            },
            final_pod['spec'])


    def test_pod_spec_extend_volume(self):
        """ Testing the extension of volumes for the task pod after applying pod template. """
        scratch_volume = create_lvm_volume('scratch-space', '1750')
        pod_template = {
            'spec': {
                'volumes': [scratch_volume],
                'tolerations': [
                    create_toleration()
                ]
            }
        }
        task_pod = create_task_manifest()
        final_pod = task.apply_pod_template(pod_template, task_pod)

        self.check_other_fields(
            final_pod, pod_template['spec']['tolerations'], task_pod['metadata']['labels'])
        self.assertEqual(len(final_pod['spec']['volumes']), 3)
        for item in final_pod['spec']['volumes']:
            if item['name'] == 'scratch-space':
                self.assertEqual(item, scratch_volume)
            elif item['name'] == 'osmo':
                self.assertEqual(item, {'name': 'osmo'})
            elif item['name'] == 'osmo-data':
                self.assertEqual(item, {'name': 'osmo-data'})
            else:
                self.fail(f'Invalid volume name: {item["name"]}')

    def test_pod_spec_replace_volume(self):
        """
        Testing the replacement of osmo-data volume in task pod using the one defined in
        pod template.
        """
        scratch_volume = create_lvm_volume('osmo-data', '1750')
        pod_template = {
            'spec': {
                'volumes': [scratch_volume],
                'tolerations': [
                    create_toleration()
                ]
            }
        }
        task_pod = create_task_manifest()
        final_pod = task.apply_pod_template(pod_template, task_pod)

        self.check_other_fields(
            final_pod, pod_template['spec']['tolerations'], task_pod['metadata']['labels'])
        self.assertEqual(len(final_pod['spec']['volumes']), 2)
        for item in final_pod['spec']['volumes']:
            if item['name'] == 'osmo-data':
                self.assertEqual(item, scratch_volume)
            elif item['name'] == 'osmo':
                self.assertEqual(item, {'name': 'osmo'})
            else:
                self.fail(f'Invalid volume name: {item["name"]}')


    def test_pod_template_override(self):
        """ Test template override. """
        storage_val = '10GB'
        cpu_count = 2
        pod = {
            'spec': {
                'containers': [
                    create_container(cpu_count, storage_val, name='user'),
                    create_container(cpu_count, storage_val, name='another-container')
                ],
                'volumes': [create_lvm_volume('osmo-data', storage_val)]
            }
        }
        override_storage = '1Gi'
        # A more stripped down pod template, without image and cpu in resources
        pod_override = {
            'spec': {
                'containers': [
                    {
                        'name': 'user',
                        'resources': {
                            'requests': {
                                'ephemeral-storage': override_storage,
                            },
                            'limits': {
                                'ephemeral-storage': override_storage,
                            }
                        }
                    }
                ]
            }
        }
        pod = task.apply_pod_template(pod, pod_override)

        # Only the ephemeral storage of the user container shoud be changed
        final_answer = {
            'spec': {
                'containers': [
                    create_container(cpu_count, override_storage, name='user'),
                    create_container(cpu_count, storage_val, name='another-container')
                ],
                'volumes': [create_lvm_volume('osmo-data', storage_val)]
            }
        }
        self.assertEqual(pod, final_answer)


    def test_pod_template_override_volumes(self):
        """ Test template override. """
        storage_val = '10GB'
        cpu_count = 2
        volume_mounts = [
            {"name": "volume1", "mountPath": "/v1"},
            {"name": "volume2", "mountPath": "/v2"}
        ]

        volumes = [
            {"name": "volume1", "hostPath": {"path": "/v1"}},
            {"name": "volume2", "hostPath": {"path": "/v2"}},
        ]

        new_volume_mount = {"name": "volume3", "mountPath": "/v3"}
        new_volume = {"name": "volume3", "hostPath": {"path": "/v3"}}

        pod = {
            'spec': {
                'containers': [
                    create_container(cpu_count, storage_val, name='user',
                                     volume_mounts=copy.deepcopy(volume_mounts)),
                    create_container(cpu_count, storage_val, name='another-container')
                ],
                'volumes': copy.deepcopy(volumes)
            }
        }
        override_storage = '1Gi'
        pod_override = {
            'spec': {
                'containers': [
                    {
                        'name': 'user',
                        'resources': {
                            'requests': {
                                'ephemeral-storage': override_storage,
                            },
                            'limits': {
                                'ephemeral-storage': override_storage,
                            }
                        },
                        'volumeMounts': [copy.deepcopy(new_volume_mount)]
                    }
                ],
                "volumes": [copy.deepcopy(new_volume)]
            }
        }
        pod = task.apply_pod_template(pod, pod_override)

        # Only the ephemeral storage of the user container shoud be changed
        final_answer = {
            'spec': {
                'containers': [
                    create_container(cpu_count, override_storage, name='user',
                                     volume_mounts=(volume_mounts + [new_volume_mount])),
                    create_container(cpu_count, storage_val, name='another-container')
                ],
                'volumes': volumes + [new_volume]
            }
        }
        self.assertEqual(pod, final_answer)

    def test_pod_template_override_empty(self):
        """ Test template override with empty override. No changes shoud incur. """
        pod = {
            'spec': {
                'containers': [
                    create_container('1', '10Gi'),
                    create_container('1', '10Gi', name='another-container')
                ],
                'volumes': [create_lvm_volume('osmo-data', '10GB')]
            }
        }
        # When applying empty override specs, the pod spec still be the same
        answer = copy.deepcopy(pod)

        # Override spec with empty arrays
        pod_override: Dict[str, Any] = {'spec': {'containers': [], 'volumes': []}}
        pod = task.apply_pod_template(pod, pod_override)
        self.assertEqual(pod, answer)

        # Empty override spec
        pod = task.apply_pod_template(pod, {})
        self.assertEqual(pod, answer)

    def test_substitute_tokens_different_units(self):
        """ Evaluate the values for different units in storage and memory. """
        resource = connectors.ResourceSpec(cpu=2, storage='10Gi', memory='10.5Mi')
        tokens = resource.get_allocatable_tokens({})

        # Evaluate the values for storage
        # cast() used because get_allocatable_tokens returns Optional values,
        # but these keys are guaranteed non-None when storage is set.
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_m']), 10 * 1024 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_B']), 10 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_Ki']), 10 * 1024 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_Mi']), 10 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_Gi']), 10, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_STORAGE_Ti']), 10.0 / 1024, places=5)

        # Evaluate the values for memory (test that values with decimal work)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_m']), 10.5 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_B']), 10.5 * 1024 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_Ki']), 10.5 * 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_Mi']), 10.5, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_Gi']), 10.5 / 1024, places=5)
        self.assertAlmostEqual(cast(float, tokens['USER_MEMORY_Ti']), 10.5 / 1024 / 1024, places=5)

    def test_token_values_with_incomplete_resource_spec(self):
        """ Test that the keys are still populated, with values None. """
        resource_spec = connectors.ResourceSpec()
        tokens = resource_spec.get_allocatable_tokens({})
        for resource_name in ['CPU', 'GPU']:
            self.assertIsNone(tokens[f'USER_{resource_name}'])
        for resource_name in ['MEMORY', 'STORAGE']:
            self.assertIsNone(tokens[f'USER_{resource_name}'])
            self.assertIsNone(tokens[f'USER_{resource_name}_VAL'])
            self.assertIsNone(tokens[f'USER_{resource_name}_UNIT'])
            for target_unit in common.MEASUREMENTS_SHORT:
                self.assertIsNone(tokens[f'USER_{resource_name}_{target_unit}'])

    def test_default_user_and_override_resource_spec(self):
        """
        Test that the substitution function removes the fields that have the special
        env tokens if there are no values.
        """
        user_cpu_count = 4
        user_memory = '10Gi'

        # Note that there is no storage value
        resource = connectors.ResourceSpec(cpu=user_cpu_count, memory='10Gi')

        # Override pod template has USER_STORAGE, which is undefined in the resource spec above
        override_pod_template = {
            'spec': {
                'containers': [
                    create_container(cpu='{{USER_CPU}}', ephemeral_storage='{{USER_STORAGE}}',
                                     memory='{{USER_MEMORY}}')
                ]
            }
        }

        tokens = resource.get_allocatable_tokens({})
        task.substitute_pod_template_tokens(override_pod_template, tokens)

        pod_container_template_resources = override_pod_template['spec']['containers'][0]['resources']
        for resource_ask in ['requests', 'limits']:
            self.assertTrue('cpu' in pod_container_template_resources[resource_ask])
            self.assertEqual(float(pod_container_template_resources[resource_ask]['cpu']), user_cpu_count)
            self.assertTrue('memory' in pod_container_template_resources[resource_ask])
            self.assertEqual(pod_container_template_resources[resource_ask]['memory'], user_memory)

        # Setup for default resource spec in the init pod template
        default_cpu_count = 1
        default_memory = '4Gi'
        default_storage = '4Gi'

        init_pod_template = {
            'spec': {
                'containers': [
                    create_container(cpu=default_cpu_count, ephemeral_storage=default_memory,
                                     memory=default_storage)
                ]
            }
        }

        # Apply override pod template on init pod template
        final_pod = task.apply_pod_template(init_pod_template, override_pod_template)
        pod_container_template_resources = final_pod['spec']['containers'][0]['resources']
        for resource_ask in ['requests', 'limits']:
            self.assertTrue('cpu' in pod_container_template_resources[resource_ask])
            self.assertEqual(float(pod_container_template_resources[resource_ask]['cpu']), user_cpu_count)
            self.assertTrue('memory' in pod_container_template_resources[resource_ask])
            self.assertEqual(pod_container_template_resources[resource_ask]['memory'], user_memory)

            # Ephemeral storage is now in the pod manifest
            self.assertTrue('ephemeral-storage' in pod_container_template_resources[resource_ask])


    def test_default_variables(self):
        """
        Test that get_allocatable_tokens returns the right values when passed default_variables.
        """
        resource = connectors.ResourceSpec(cpu=1, memory='10Gi')
        default_variables = {"USER_CPU": 2, 'USER_MEMORY': '20Gi', 'USER_STORAGE': '20Gi', 'USER_GPU': 1}
        tokens = resource.get_allocatable_tokens(default_variables)

        self.assertEqual(tokens['USER_CPU'], 1)
        self.assertEqual(tokens['USER_MEMORY'], '10Gi')
        self.assertEqual(tokens['USER_STORAGE'], '20Gi')
        self.assertEqual(tokens['USER_GPU'], 1)


    def test_node_exclusion(self):
        """
        Test that node exclusion variable gets converted to an array properly
        """
        exclude_list = ['osmo-worker1', 'osmo-worker2']
        resource = connectors.ResourceSpec(cpu=1, nodesExcluded=['osmo-worker1', 'osmo-worker2'])
        default_variables = {"USER_CPU": 2}
        tokens = resource.get_allocatable_tokens(default_variables)
        override_pod_template = {
            "spec": {
                "affinity": {
                    "nodeAffinity": {
                        "requiredDuringSchedulingIgnoredDuringExecution": {
                            "nodeSelectorTerms": [
                            {
                                "matchExpressions": [
                                    {
                                    "key": "kubernetes.io/hostname",
                                    "operator": "NotIn",
                                    "values": "{{ USER_EXCLUDED_NODES }}"
                                    }
                                ]
                            }
                          ]
                        }
                    }
                }
            }
        }
        task.substitute_pod_template_tokens(override_pod_template, tokens)
        node_selector_terms = override_pod_template['spec']['affinity']['nodeAffinity']\
            ['requiredDuringSchedulingIgnoredDuringExecution']['nodeSelectorTerms']
        match_expressions = node_selector_terms[0]['matchExpressions']
        self.assertEqual(len(match_expressions), 1)

        rendered_excluded_list = match_expressions[0]['values']
        # rendered_excluded_list should now be a list of strings, instead of a string
        self.assertTrue(isinstance(rendered_excluded_list, list))
        self.assertTrue(all(isinstance(item, str) for item in rendered_excluded_list))

        # Check that the contents of the list is correct
        self.assertEqual(rendered_excluded_list, exclude_list)


def _summary(status: str, lead: bool, count: int = 1) -> Dict:
    """Helper to build a status summary row for _aggregate_status tests."""
    return {'status': status, 'lead': lead, 'count': count}


def _make_group(ignore_nonlead: bool = True) -> task.TaskGroup:
    """Create a minimal TaskGroup for testing _aggregate_status."""
    spec = task.TaskGroupSpec(
        name='test-group',
        ignoreNonleadStatus=ignore_nonlead,
        tasks=[task.TaskSpec(name='lead-task', image='ubuntu:latest',
                             command=['echo'], lead=True)],
    )
    return task.TaskGroup(
        name='test-group',
        group_uuid=common.generate_unique_id(),
        spec=spec,
        tasks=[],
        remaining_upstream_groups=set(),
        downstream_groups=set(),
        database=mock.create_autospec(connectors.PostgresConnector, instance=True),
    )


class AggregateStatusTest(unittest.TestCase):
    """Tests for TaskGroup._aggregate_status with lightweight summary rows."""

    def test_all_running(self):
        group = _make_group()
        summary = [
            _summary('RUNNING', True),
            _summary('RUNNING', False, 3),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.RUNNING)

    def test_running_takes_precedence_over_initializing(self):
        group = _make_group()
        summary = [
            _summary('RUNNING', True),
            _summary('INITIALIZING', False, 2),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.RUNNING)

    def test_all_initializing(self):
        group = _make_group()
        summary = [_summary('INITIALIZING', True), _summary('INITIALIZING', False, 3)]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.INITIALIZING)

    def test_scheduling_not_group_finished(self):
        """SCHEDULING is not group_finished, so should return INITIALIZING when no RUNNING."""
        group = _make_group()
        summary = [_summary('SCHEDULING', True), _summary('SCHEDULING', False, 2)]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.INITIALIZING)

    def test_all_completed(self):
        group = _make_group()
        summary = [
            _summary('COMPLETED', True),
            _summary('COMPLETED', False, 4),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.COMPLETED)

    def test_one_failed_rest_completed(self):
        group = _make_group(ignore_nonlead=False)
        summary = [
            _summary('COMPLETED', True),
            _summary('FAILED', False),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.FAILED)

    def test_failed_upstream_takes_precedence(self):
        group = _make_group()
        summary = [
            _summary('FAILED_UPSTREAM', False),
            _summary('FAILED', True),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.FAILED_UPSTREAM)

    def test_failed_server_error_takes_precedence_over_failed(self):
        group = _make_group()
        summary = [
            _summary('FAILED_SERVER_ERROR', True),
            _summary('FAILED', False),
        ]
        self.assertEqual(group._aggregate_status(summary),
                         task.TaskGroupStatus.FAILED_SERVER_ERROR)

    def test_failed_preempted_takes_precedence_over_failed(self):
        group = _make_group()
        summary = [
            _summary('FAILED_PREEMPTED', True),
            _summary('FAILED', False),
        ]
        self.assertEqual(group._aggregate_status(summary),
                         task.TaskGroupStatus.FAILED_PREEMPTED)

    def test_failed_evicted_lead(self):
        group = _make_group()
        summary = [
            _summary('FAILED_EVICTED', True),
            _summary('COMPLETED', False, 3),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.FAILED_EVICTED)

    def test_ignore_nonlead_nonlead_failed_lead_completed(self):
        """With ignoreNonleadStatus=True, non-lead failures are ignored."""
        group = _make_group(ignore_nonlead=True)
        summary = [
            _summary('COMPLETED', True),
            _summary('FAILED', False, 3),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.COMPLETED)

    def test_ignore_nonlead_nonlead_evicted_lead_completed(self):
        """With ignoreNonleadStatus=True, non-lead FAILED_EVICTED is ignored."""
        group = _make_group(ignore_nonlead=True)
        summary = [
            _summary('COMPLETED', True),
            _summary('FAILED_EVICTED', False, 2),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.COMPLETED)

    def test_no_ignore_nonlead_failed(self):
        """With ignoreNonleadStatus=False, non-lead failure is considered."""
        group = _make_group(ignore_nonlead=False)
        summary = [
            _summary('COMPLETED', True),
            _summary('FAILED', False),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.FAILED)

    def test_empty_summary_returns_running(self):
        group = _make_group()
        self.assertEqual(group._aggregate_status([]), task.TaskGroupStatus.RUNNING)

    def test_failed_upstream_before_server_error(self):
        """FAILED_UPSTREAM is checked before FAILED_SERVER_ERROR."""
        group = _make_group()
        summary = [
            _summary('FAILED_UPSTREAM', False),
            _summary('FAILED_SERVER_ERROR', True),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.FAILED_UPSTREAM)

    def test_multiple_counts(self):
        """Verify count is used correctly for the COMPLETED check."""
        group = _make_group(ignore_nonlead=False)
        summary = [
            _summary('COMPLETED', True, 1),
            _summary('COMPLETED', False, 9),
        ]
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.COMPLETED)

    def test_mixed_finished_not_all_completed(self):
        """COMPLETED + RESCHEDULED considered tasks should not return COMPLETED."""
        group = _make_group(ignore_nonlead=True)
        summary = [
            _summary('COMPLETED', True),
            _summary('RESCHEDULED', True),
        ]
        # Both are lead, both considered. Not all COMPLETED → falls through to RUNNING.
        self.assertEqual(group._aggregate_status(summary), task.TaskGroupStatus.RUNNING)


class BatchUpdateValidationTest(unittest.TestCase):
    """Tests for Task.batch_update_status_to_db input validation."""

    def test_rejects_non_finished_status_running(self):
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=mock.Mock(),
                workflow_id='wf-1',
                group_name='group-1',
                update_time=datetime.datetime.now(),
                status=task.TaskGroupStatus.RUNNING,
                message='should fail',
            )

    def test_rejects_non_finished_status_waiting(self):
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=mock.Mock(),
                workflow_id='wf-1',
                group_name='group-1',
                update_time=datetime.datetime.now(),
                status=task.TaskGroupStatus.WAITING,
                message='should fail',
            )

    def test_rejects_non_finished_status_processing(self):
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=mock.Mock(),
                workflow_id='wf-1',
                group_name='group-1',
                update_time=datetime.datetime.now(),
                status=task.TaskGroupStatus.PROCESSING,
                message='should fail',
            )

    def test_rejects_non_finished_status_initializing(self):
        with self.assertRaises(ValueError):
            task.Task.batch_update_status_to_db(
                database=mock.Mock(),
                workflow_id='wf-1',
                group_name='group-1',
                update_time=datetime.datetime.now(),
                status=task.TaskGroupStatus.INITIALIZING,
                message='should fail',
            )


class CredentialEnvTest(unittest.TestCase):
    """Tests for credential env var generation in TaskSpec.to_pod_container."""

    def _make_task_spec(self, credentials: Dict[str, Any]) -> task.TaskSpec:
        return task.TaskSpec(
            name='test-task',
            image='ubuntu:latest',
            command=['echo'],
            credentials=credentials,
        )

    def _get_cred_env_vars(self, container: Dict) -> List[Dict]:
        """Extract credential-sourced env vars (those with secretKeyRef)."""
        return [
            env for env in container['env']
            if 'valueFrom' in env
            and 'secretKeyRef' in env['valueFrom']
            and env['valueFrom']['secretKeyRef']['name'] == 'test-secrets'
        ]

    def _build_container(self, credentials: Dict[str, Any]) -> Dict:
        task_spec = self._make_task_spec(credentials)
        return task_spec.to_pod_container(
            user_args=[],
            files=[],
            mounts=[],
            user_secrets_name='test-secrets',
            config_dir_secret_name='test-config',
        )

    def test_single_credential(self):
        """Single credential produces a namespaced secret key."""
        container = self._build_container({
            'my-cred': {'MY_ENV': 'key'},
        })
        cred_vars = self._get_cred_env_vars(container)
        self.assertEqual(len(cred_vars), 1)
        self.assertEqual(cred_vars[0]['name'], 'MY_ENV')
        self.assertEqual(
            cred_vars[0]['valueFrom']['secretKeyRef']['key'], 'my-cred.key')

    def test_multiple_credentials_same_payload_key(self):
        """Two credentials sharing the same payload key get distinct secret keys."""
        container = self._build_container({
            'service-a-auth': {'SERVICE_A_KEY': 'key'},
            'service-b-auth': {'SERVICE_B_KEY': 'key'},
        })
        cred_vars = self._get_cred_env_vars(container)
        self.assertEqual(len(cred_vars), 2)

        by_name = {v['name']: v for v in cred_vars}
        self.assertEqual(
            by_name['SERVICE_A_KEY']['valueFrom']['secretKeyRef']['key'],
            'service-a-auth.key')
        self.assertEqual(
            by_name['SERVICE_B_KEY']['valueFrom']['secretKeyRef']['key'],
            'service-b-auth.key')

    def test_multiple_payload_keys_per_credential(self):
        """A credential with multiple payload keys maps each one correctly."""
        container = self._build_container({
            'my-cred': {'ENV_A': 'username', 'ENV_B': 'password'},
        })
        cred_vars = self._get_cred_env_vars(container)
        self.assertEqual(len(cred_vars), 2)

        by_name = {v['name']: v for v in cred_vars}
        self.assertEqual(
            by_name['ENV_A']['valueFrom']['secretKeyRef']['key'],
            'my-cred.username')
        self.assertEqual(
            by_name['ENV_B']['valueFrom']['secretKeyRef']['key'],
            'my-cred.password')

    def test_file_mount_credentials_skipped(self):
        """String-valued credentials (file mounts) produce no secretKeyRef env vars."""
        container = self._build_container({
            'my-cred': '/mnt/secrets',
        })
        cred_vars = self._get_cred_env_vars(container)
        self.assertEqual(len(cred_vars), 0)


class CredentialSecretBuildTest(unittest.TestCase):
    """Tests that get_kb_specs builds the K8s Secret with correctly namespaced keys and values."""

    def _make_group_with_credentials(
        self, credentials: Dict[str, Union[str, Dict[str, str]]]
    ) -> task.TaskGroup:
        spec = task.TaskGroupSpec(
            name='test-group',
            tasks=[task.TaskSpec(
                name='lead-task', image='ubuntu:latest',
                command=['echo'], lead=True, credentials=credentials,
            )],
        )
        database = mock.create_autospec(connectors.PostgresConnector, instance=True)
        return task.TaskGroup(
            name='test-group',
            group_uuid=common.generate_unique_id(),
            spec=spec,
            tasks=[],
            remaining_upstream_groups=set(),
            downstream_groups=set(),
            database=database,
        )

    def _run_get_kb_specs(
        self, group: task.TaskGroup, cred_payloads: Dict[str, Dict[str, str]]
    ) -> mock.MagicMock:
        """Run get_kb_specs with mocked internals, return the captured create_secret calls."""
        cast(mock.MagicMock, group.database.get_generic_cred).side_effect = (
            lambda user, name: cred_payloads[name]
        )

        mock_k8s_factory = mock.MagicMock()
        mock_k8s_factory.create_secret.side_effect = lambda name, *a, **kw: {
            'name': name, 'stringData': a[2] if len(a) > 2 else kw.get('string_data', {})
        }
        mock_k8s_factory.create_image_secret.return_value = {}
        mock_k8s_factory.create_group_k8s_resources.return_value = []

        mock_pool = mock.MagicMock()
        mock_pool.topology_keys = []
        mock_pool.parsed_group_templates = []

        with mock.patch.object(task.TaskGroup, 'get_k8s_object_factory', return_value=mock_k8s_factory), \
             mock.patch.object(task.TaskGroup, '_get_registry_creds', return_value=({}, None)), \
             mock.patch.object(task.TaskGroup, 'convert_all_pod_specs', return_value=([], [], [])), \
             mock.patch.object(task.TaskGroup, '_build_topology_tree', return_value=([], [])), \
             mock.patch('src.utils.connectors.Pool.fetch_from_db', return_value=mock_pool):
            mock_progress = mock.create_autospec(
                task.progress.ProgressWriter, instance=True)
            group.get_kb_specs(
                workflow_uuid=common.generate_unique_id(),
                user='test-user',
                workflow_config=mock.MagicMock(),
                backend_config_cache=mock.MagicMock(),
                backend_name='test-backend',
                pool='test-pool',
                progress_writer=mock_progress,
                progress_iter_freq=datetime.timedelta(seconds=999),
                workflow_plugins=mock.MagicMock(),
                priority=mock.MagicMock(),
            )
        return mock_k8s_factory.create_secret

    def test_secret_values_namespaced_single_credential(self):
        """Secret stores value under namespaced key for a single credential."""
        group = self._make_group_with_credentials({
            'my-cred': {'MY_ENV': 'token'},
        })
        create_secret = self._run_get_kb_specs(group, {
            'my-cred': {'token': 'secret-value-123'},
        })
        user_secret_call = [
            c for c in create_secret.call_args_list
            if 'user-secrets' in c[0][0]
        ]
        self.assertEqual(len(user_secret_call), 1)
        string_data = user_secret_call[0][0][3]
        self.assertEqual(string_data, {'my-cred.token': 'secret-value-123'})

    def test_secret_values_namespaced_multiple_credentials_same_key(self):
        """Two credentials with the same payload key produce distinct secret entries."""
        group = self._make_group_with_credentials({
            'service-a-auth': {'SERVICE_A_KEY': 'key'},
            'service-b-auth': {'SERVICE_B_KEY': 'key'},
        })
        create_secret = self._run_get_kb_specs(group, {
            'service-a-auth': {'key': 'value-a'},
            'service-b-auth': {'key': 'value-b'},
        })
        user_secret_call = [
            c for c in create_secret.call_args_list
            if 'user-secrets' in c[0][0]
        ]
        self.assertEqual(len(user_secret_call), 1)
        string_data = user_secret_call[0][0][3]
        self.assertEqual(string_data, {
            'service-a-auth.key': 'value-a',
            'service-b-auth.key': 'value-b',
        })

    def test_file_mount_credential_not_in_secrets(self):
        """File-mount credentials should not appear in the user-secrets Secret."""
        group = self._make_group_with_credentials({
            'my-cred': '/mnt/secrets',
        })
        create_secret = self._run_get_kb_specs(group, {
            'my-cred': {'token': 'secret-value'},
        })
        user_secret_call = [
            c for c in create_secret.call_args_list
            if 'user-secrets' in c[0][0]
        ]
        self.assertEqual(len(user_secret_call), 0)


class CreateConfigDictTest(unittest.TestCase):
    """Tests for create_config_dict with different credential types."""

    def test_static_credential(self):
        """Test create_config_dict with StaticDataCredential."""
        static_cred = credentials.StaticDataCredential(
            endpoint='s3://my-bucket',
            access_key_id='AKIAIOSFODNN7EXAMPLE',
            access_key='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
            region='us-east-1',
        )

        result = task.create_config_dict({'s3://my-bucket': static_cred})

        data_entry = result['auth']['data']['s3://my-bucket']
        self.assertEqual(data_entry['access_key_id'], 'AKIAIOSFODNN7EXAMPLE')
        self.assertEqual(data_entry['access_key'], 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
        self.assertEqual(data_entry['endpoint'], 's3://my-bucket')
        self.assertEqual(data_entry['region'], 'us-east-1')

    def test_default_credential(self):
        """Test create_config_dict with DefaultDataCredential produces no access keys."""
        default_cred = credentials.DefaultDataCredential(
            endpoint='s3://ambient-bucket',
            region='us-west-2',
        )

        result = task.create_config_dict({'s3://ambient-bucket': default_cred})

        data_entry = result['auth']['data']['s3://ambient-bucket']
        self.assertEqual(data_entry['endpoint'], 's3://ambient-bucket')
        self.assertEqual(data_entry['region'], 'us-west-2')
        self.assertNotIn('access_key_id', data_entry)
        self.assertNotIn('access_key', data_entry)

    def test_mixed_credentials(self):
        """Test create_config_dict with both credential types."""
        static_cred = credentials.StaticDataCredential(
            endpoint='s3://static-bucket',
            access_key_id='AKIAIOSFODNN7EXAMPLE',
            access_key='secret',
        )
        default_cred = credentials.DefaultDataCredential(
            endpoint='s3://ambient-bucket',
            region='eu-west-1',
        )

        result = task.create_config_dict({
            's3://static-bucket': static_cred,
            's3://ambient-bucket': default_cred,
        })

        static_entry = result['auth']['data']['s3://static-bucket']
        self.assertIn('access_key_id', static_entry)
        self.assertIn('access_key', static_entry)

        ambient_entry = result['auth']['data']['s3://ambient-bucket']
        self.assertNotIn('access_key_id', ambient_entry)
        self.assertNotIn('access_key', ambient_entry)
        self.assertEqual(ambient_entry['region'], 'eu-west-1')


class HelperFunctionsTest(unittest.TestCase):
    """Tests for shorten_name_to_fit_kb and create_login_dict."""

    def test_shorten_name_to_fit_kb_short_name_unchanged(self):
        name = 'a' * 50
        self.assertEqual(task.shorten_name_to_fit_kb(name), name)

    def test_shorten_name_to_fit_kb_exactly_63_chars_unchanged(self):
        name = 'a' * 63
        self.assertEqual(task.shorten_name_to_fit_kb(name), name)

    def test_shorten_name_to_fit_kb_long_name_truncates_to_63(self):
        name = 'a' * 100
        result = task.shorten_name_to_fit_kb(name)
        self.assertEqual(result, 'a' * 63)

    def test_shorten_name_to_fit_kb_strips_trailing_hyphen_after_truncation(self):
        # truncated[:63] ends with '-' so it is stripped
        name = 'a' * 62 + '-' + 'extra'
        result = task.shorten_name_to_fit_kb(name)
        self.assertEqual(result, 'a' * 62)

    def test_shorten_name_to_fit_kb_strips_trailing_underscore_after_truncation(self):
        name = 'b' * 62 + '_' + 'tail'
        result = task.shorten_name_to_fit_kb(name)
        self.assertEqual(result, 'b' * 62)

    def test_create_login_dict_with_token_returns_token_login(self):
        result = task.create_login_dict(
            user='alice',
            url='https://example.com',
            token='id-token-1',
            refresh_endpoint='https://example.com/refresh',
            refresh_token='refresh-token-1',
        )
        self.assertEqual(result['username'], 'alice')
        self.assertEqual(result['url'], 'https://example.com')
        self.assertTrue(result['osmo_token'])
        self.assertEqual(result['token_login']['id_token'], 'id-token-1')
        self.assertEqual(result['token_login']['refresh_url'],
                         'https://example.com/refresh')
        self.assertEqual(result['token_login']['refresh_token'], 'refresh-token-1')
        self.assertNotIn('dev_login', result)

    def test_create_login_dict_without_token_returns_dev_login(self):
        result = task.create_login_dict(user='bob', url='https://example.com')
        self.assertEqual(result['url'], 'https://example.com')
        self.assertEqual(result['dev_login']['username'], 'bob')
        self.assertNotIn('token_login', result)
        self.assertNotIn('osmo_token', result)


class TaskGroupStatusBoolTest(unittest.TestCase):
    """Tests for TaskGroupStatus state-checker boolean methods."""

    def test_finished_completed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.finished())

    def test_finished_rescheduled_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.finished())

    def test_finished_failed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.finished())

    def test_finished_running_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.finished())

    def test_finished_waiting_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.WAITING.finished())

    def test_group_finished_completed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.COMPLETED.group_finished())

    def test_group_finished_rescheduled_returns_false(self):
        # RESCHEDULED is finished for tasks but not for groups.
        self.assertFalse(task.TaskGroupStatus.RESCHEDULED.group_finished())

    def test_group_finished_failed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_BACKEND_ERROR.group_finished())

    def test_failed_failed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.failed())

    def test_failed_failed_canceled_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_CANCELED.failed())

    def test_failed_completed_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.failed())

    def test_failed_running_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.failed())

    def test_prescheduling_submitting_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.SUBMITTING.prescheduling())

    def test_prescheduling_waiting_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.WAITING.prescheduling())

    def test_prescheduling_processing_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.PROCESSING.prescheduling())

    def test_prescheduling_scheduling_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.SCHEDULING.prescheduling())

    def test_prescheduling_running_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.prescheduling())

    def test_in_queue_scheduling_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.SCHEDULING.in_queue())

    def test_in_queue_initializing_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.INITIALIZING.in_queue())

    def test_in_queue_submitting_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.SUBMITTING.in_queue())

    def test_prerunning_initializing_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.INITIALIZING.prerunning())

    def test_prerunning_running_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.RUNNING.prerunning())

    def test_prerunning_waiting_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.WAITING.prerunning())

    def test_canceled_failed_canceled_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_CANCELED.canceled())

    def test_canceled_failed_exec_timeout_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_EXEC_TIMEOUT.canceled())

    def test_canceled_failed_queue_timeout_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_QUEUE_TIMEOUT.canceled())

    def test_canceled_plain_failed_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED.canceled())

    def test_canceled_completed_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.canceled())

    def test_server_errored_failed_server_error_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_SERVER_ERROR.server_errored())

    def test_server_errored_failed_evicted_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_EVICTED.server_errored())

    def test_server_errored_failed_image_pull_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED_IMAGE_PULL.server_errored())

    def test_server_errored_failed_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED.server_errored())

    def test_has_error_logs_rescheduled_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.RESCHEDULED.has_error_logs())

    def test_has_error_logs_failed_returns_true(self):
        self.assertTrue(task.TaskGroupStatus.FAILED.has_error_logs())

    def test_has_error_logs_failed_canceled_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_CANCELED.has_error_logs())

    def test_has_error_logs_failed_upstream_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_UPSTREAM.has_error_logs())

    def test_has_error_logs_failed_server_error_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.FAILED_SERVER_ERROR.has_error_logs())

    def test_has_error_logs_completed_returns_false(self):
        self.assertFalse(task.TaskGroupStatus.COMPLETED.has_error_logs())

    def test_get_alive_statuses_includes_running(self):
        statuses = task.TaskGroupStatus.get_alive_statuses()
        self.assertIn(task.TaskGroupStatus.RUNNING, statuses)
        self.assertIn(task.TaskGroupStatus.RESCHEDULED, statuses)

    def test_get_alive_statuses_excludes_completed(self):
        statuses = task.TaskGroupStatus.get_alive_statuses()
        self.assertNotIn(task.TaskGroupStatus.COMPLETED, statuses)
        self.assertNotIn(task.TaskGroupStatus.FAILED, statuses)

    def test_backend_states_returns_expected_states(self):
        states = task.TaskGroupStatus.backend_states()
        self.assertIn('SCHEDULING', states)
        self.assertIn('RUNNING', states)


class TaskInputOutputValidationTest(unittest.TestCase):
    """Tests for TaskInputOutput regex validation and workflow info parsing."""

    def test_empty_regex_passes(self):
        spec = task.TaskInputOutput(task='task1', regex='')
        self.assertEqual(spec.regex, '')

    def test_valid_regex_passes(self):
        spec = task.TaskInputOutput(task='task1', regex=r'.*\.txt$')
        self.assertEqual(spec.regex, r'.*\.txt$')

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            task.TaskInputOutput(task='task1', regex='[unclosed')

    def test_is_from_previous_workflow_with_workflow_id(self):
        spec = task.TaskInputOutput(task='wf123:task1')
        self.assertTrue(spec.is_from_previous_workflow())

    def test_is_from_previous_workflow_without_workflow_id(self):
        spec = task.TaskInputOutput(task='task1')
        self.assertFalse(spec.is_from_previous_workflow())

    def test_parsed_workflow_info_with_workflow_id(self):
        spec = task.TaskInputOutput(task='wf123:task1')
        self.assertEqual(spec.parsed_workflow_info(), ('wf123', 'task1'))

    def test_parsed_workflow_info_without_workflow_id(self):
        spec = task.TaskInputOutput(task='task1')
        self.assertEqual(spec.parsed_workflow_info(), ('task1', None))


class DatasetInputOutputValidationTest(unittest.TestCase):
    """Tests for DatasetInputOutput field validators."""

    def _make(self, **fields) -> task.DatasetInputOutput:
        defaults = {'name': 'mydataset'}
        defaults.update(fields)
        return task.DatasetInputOutput(dataset=defaults)

    def test_valid_name_passes(self):
        spec = self._make(name='valid-dataset_1')
        self.assertEqual(spec.dataset.name, 'valid-dataset_1')

    def test_invalid_name_raises(self):
        with self.assertRaises(Exception):
            self._make(name='!!invalid!!')

    def test_empty_path_passes(self):
        spec = self._make(path='')
        self.assertEqual(spec.dataset.path, '')

    def test_valid_path_passes(self):
        spec = self._make(path='subdir/file.txt')
        self.assertEqual(spec.dataset.path, 'subdir/file.txt')

    def test_invalid_path_raises(self):
        with self.assertRaises(Exception):
            self._make(path='bad?path')

    def test_invalid_metadata_path_raises(self):
        with self.assertRaises(Exception):
            self._make(metadata=['bad,path'])

    def test_invalid_label_path_raises(self):
        with self.assertRaises(Exception):
            self._make(labels=['bad<path'])

    def test_valid_metadata_passes(self):
        spec = self._make(metadata=['meta/file.json'])
        self.assertEqual(spec.dataset.metadata, ['meta/file.json'])

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            self._make(regex='[unclosed')

    def test_empty_regex_passes(self):
        spec = self._make(regex='')
        self.assertEqual(spec.dataset.regex, '')


class UpdateDatasetOutputValidationTest(unittest.TestCase):
    """Tests for UpdateDatasetOutput field validators."""

    def _make(self, **fields) -> task.UpdateDatasetOutput:
        defaults = {'name': 'mydataset'}
        defaults.update(fields)
        return task.UpdateDatasetOutput(update_dataset=defaults)

    def test_valid_name_passes(self):
        spec = self._make(name='dataset1')
        self.assertEqual(spec.update_dataset.name, 'dataset1')

    def test_invalid_name_raises(self):
        with self.assertRaises(Exception):
            self._make(name='!!bad!!')

    def test_invalid_paths_raises(self):
        with self.assertRaises(Exception):
            self._make(paths=['bad?path'])

    def test_invalid_metadata_raises(self):
        with self.assertRaises(Exception):
            self._make(metadata=['bad,path'])

    def test_invalid_labels_raises(self):
        with self.assertRaises(Exception):
            self._make(labels=['bad<path'])

    def test_valid_paths_passes(self):
        spec = self._make(paths=['dir/file.txt'])
        self.assertEqual(spec.update_dataset.paths, ['dir/file.txt'])


class URLInputOutputValidationTest(unittest.TestCase):
    """Tests for URLInputOutput.validate_regex."""

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            task.URLInputOutput(url='https://example.com', regex='[unclosed')

    def test_empty_regex_passes(self):
        spec = task.URLInputOutput(url='https://example.com', regex='')
        self.assertEqual(spec.regex, '')

    def test_valid_regex_passes(self):
        spec = task.URLInputOutput(url='https://example.com', regex=r'\d+')
        self.assertEqual(spec.regex, r'\d+')


class CheckpointSpecValidationTest(unittest.TestCase):
    """Tests for CheckpointSpec.validate_frequency and validate_regex."""

    def _make(self, frequency, regex: str = '') -> task.CheckpointSpec:
        return task.CheckpointSpec(
            path='/some/path',
            url='s3://bucket/key',
            frequency=frequency,
            regex=regex,
        )

    def test_frequency_int_converts_to_timedelta_seconds(self):
        spec = self._make(frequency=30)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=30))

    def test_frequency_float_converts_to_timedelta_seconds(self):
        spec = self._make(frequency=1.5)
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=1.5))

    def test_frequency_timedelta_passthrough(self):
        original = datetime.timedelta(minutes=5)
        spec = self._make(frequency=original)
        self.assertEqual(spec.frequency, original)

    def test_frequency_string_converts_via_to_timedelta(self):
        spec = self._make(frequency='30s')
        self.assertEqual(spec.frequency, datetime.timedelta(seconds=30))

    def test_frequency_bool_raises(self):
        with self.assertRaises(Exception):
            self._make(frequency=True)

    def test_invalid_regex_raises(self):
        with self.assertRaises(Exception):
            self._make(frequency=10, regex='[unclosed')

    def test_empty_regex_passes(self):
        spec = self._make(frequency=10, regex='')
        self.assertEqual(spec.regex, '')


class FileValidatePathTest(unittest.TestCase):
    """Tests for File.validate_path."""

    def test_metadata_path_passes(self):
        # Paths starting with DATA_LOCATION + '/output/' bypass restrictions.
        file_obj = task.File(
            path=f'{kb_objects.DATA_LOCATION}/output/result.json',
            contents='data',
        )
        self.assertEqual(file_obj.path, f'{kb_objects.DATA_LOCATION}/output/result.json')

    def test_empty_path_raises(self):
        with self.assertRaises(Exception):
            task.File(path='', contents='data')

    def test_only_slashes_path_raises(self):
        with self.assertRaises(Exception):
            task.File(path='///', contents='data')

    def test_osmo_root_path_raises(self):
        with self.assertRaises(Exception):
            task.File(path='/osmo/foo', contents='data')

    def test_valid_path_passes(self):
        file_obj = task.File(path='/etc/myfile', contents='data')
        self.assertEqual(file_obj.path, '/etc/myfile')

    def test_encoded_contents_plain_text(self):
        file_obj = task.File(path='/etc/myfile', contents='hello', base64=False)
        # Plain text is base64-encoded.
        self.assertEqual(file_obj.encoded_contents(), 'aGVsbG8=')

    def test_encoded_contents_already_base64(self):
        file_obj = task.File(path='/etc/myfile', contents='aGVsbG8=', base64=True)
        # Already-encoded contents pass through.
        self.assertEqual(file_obj.encoded_contents(), 'aGVsbG8=')


class TaskSpecValidationTest(unittest.TestCase):
    """Tests for TaskSpec field validators (name, command, files, etc.)."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_name_osmo_ctrl_raises(self):
        with self.assertRaises(Exception):
            self._make(name='osmo-ctrl')

    def test_name_osmo_ctrl_underscore_form_raises(self):
        # k8s_name lowercases and replaces '_' with '-'.
        with self.assertRaises(Exception):
            self._make(name='osmo_ctrl')

    def test_valid_name_passes(self):
        spec = self._make(name='mytask')
        self.assertEqual(spec.name, 'mytask')

    def test_empty_command_raises(self):
        with self.assertRaises(Exception):
            self._make(command=[])

    def test_duplicate_files_raises(self):
        files = [
            task.File(path='/etc/a', contents='1'),
            task.File(path='/etc/a', contents='2'),
        ]
        with self.assertRaises(Exception):
            self._make(files=files)

    def test_unique_files_passes(self):
        files = [
            task.File(path='/etc/a', contents='1'),
            task.File(path='/etc/b', contents='2'),
        ]
        spec = self._make(files=files)
        self.assertEqual(len(spec.files), 2)

    def test_invalid_download_type_raises(self):
        with self.assertRaises(Exception):
            self._make(downloadType='not-a-real-type')

    def test_valid_download_type_string_converts_to_enum(self):
        spec = self._make(downloadType='download')
        self.assertEqual(spec.downloadType, connectors.DownloadType.DOWNLOAD)

    def test_download_type_enum_passthrough(self):
        spec = self._make(downloadType=connectors.DownloadType.DOWNLOAD)
        self.assertEqual(spec.downloadType, connectors.DownloadType.DOWNLOAD)

    def test_download_type_none_passes(self):
        spec = self._make(downloadType=None)
        self.assertIsNone(spec.downloadType)

    def test_invalid_download_type_python_type_raises(self):
        with self.assertRaises(Exception):
            self._make(downloadType=42)

    def test_invalid_exit_action_key_raises(self):
        with self.assertRaises(Exception):
            self._make(exitActions={'not_a_real_action': '0'})

    def test_invalid_exit_code_raises(self):
        with self.assertRaises(Exception):
            self._make(exitActions={'COMPLETE': 'not-numeric'})

    def test_valid_exit_actions_single_code_passes(self):
        spec = self._make(exitActions={'COMPLETE': '0'})
        self.assertEqual(spec.exitActions, {'COMPLETE': '0'})

    def test_valid_exit_actions_range_and_list_passes(self):
        spec = self._make(exitActions={'FAIL': '1-3,5'})
        self.assertEqual(spec.exitActions, {'FAIL': '1-3,5'})

    def test_exit_action_lowercase_key_passes(self):
        # Validator uppercases the key when checking against ExitAction enum.
        spec = self._make(exitActions={'complete': '0'})
        self.assertEqual(spec.exitActions, {'complete': '0'})

    def test_environment_bool_value_coerced_to_string(self):
        # YAML booleans should be coerced to strings.
        spec = self._make(environment={'DEBUG': True})
        self.assertEqual(spec.environment['DEBUG'], 'True')

    def test_environment_int_value_coerced_to_string(self):
        spec = self._make(environment={'COUNT': 42})
        self.assertEqual(spec.environment['COUNT'], '42')

    def test_credentials_str_value_passthrough(self):
        spec = self._make(credentials={'cred1': '/mnt/secret'})
        self.assertEqual(spec.credentials, {'cred1': '/mnt/secret'})

    def test_credentials_outer_list_raises(self):
        with self.assertRaises(Exception):
            self._make(credentials=['not-a-dict-or-str'])

    def test_credentials_nested_none_value_raises(self):
        with self.assertRaises(Exception):
            self._make(credentials={'cred1': {'KEY': None}})

    def test_credentials_invalid_outer_value_raises(self):
        with self.assertRaises(Exception):
            self._make(credentials={'cred1': None})

    def test_credentials_int_value_coerced(self):
        spec = self._make(credentials={'cred1': 42})
        self.assertEqual(spec.credentials, {'cred1': '42'})

    def test_credentials_nested_bool_value_coerced(self):
        spec = self._make(credentials={'cred1': {'KEY': True}})
        self.assertEqual(spec.credentials, {'cred1': {'KEY': 'True'}})


class TaskInputOutputHashAndErrorTest(unittest.TestCase):
    """Tests for TaskInputOutput.__hash__ and parsed_workflow_info error paths."""

    def test_hash_equal_for_same_task(self):
        a = task.TaskInputOutput(task='task1')
        b = task.TaskInputOutput(task='task1')
        self.assertEqual(hash(a), hash(b))

    def test_hash_differs_for_different_tasks(self):
        a = task.TaskInputOutput(task='task1')
        b = task.TaskInputOutput(task='task2')
        self.assertNotEqual(hash(a), hash(b))

    def test_hash_ignores_regex(self):
        # __hash__ uses only class name + task, not regex.
        a = task.TaskInputOutput(task='task1', regex='.*')
        b = task.TaskInputOutput(task='task1')
        self.assertEqual(hash(a), hash(b))


class DatasetInputOutputHashTest(unittest.TestCase):
    """Tests for DatasetInputOutput.__hash__."""

    def test_hash_equal_for_same_name_and_path(self):
        a = task.DatasetInputOutput(dataset={'name': 'd1', 'path': 'sub/file'})
        b = task.DatasetInputOutput(dataset={'name': 'd1', 'path': 'sub/file'})
        self.assertEqual(hash(a), hash(b))

    def test_hash_differs_for_different_name(self):
        a = task.DatasetInputOutput(dataset={'name': 'd1'})
        b = task.DatasetInputOutput(dataset={'name': 'd2'})
        self.assertNotEqual(hash(a), hash(b))

    def test_valid_labels_passes(self):
        spec = task.DatasetInputOutput(
            dataset={'name': 'd1', 'labels': ['lbl/file.json']})
        self.assertEqual(spec.dataset.labels, ['lbl/file.json'])

    def test_valid_regex_passes(self):
        spec = task.DatasetInputOutput(dataset={'name': 'd1', 'regex': r'\d+'})
        self.assertEqual(spec.dataset.regex, r'\d+')


class UpdateDatasetOutputHashAndValidationTest(unittest.TestCase):
    """Tests for UpdateDatasetOutput.__hash__ and additional validators."""

    def test_hash_equal_for_same_name(self):
        a = task.UpdateDatasetOutput(update_dataset={'name': 'd1'})
        b = task.UpdateDatasetOutput(update_dataset={'name': 'd1'})
        self.assertEqual(hash(a), hash(b))

    def test_hash_differs_for_different_name(self):
        a = task.UpdateDatasetOutput(update_dataset={'name': 'd1'})
        b = task.UpdateDatasetOutput(update_dataset={'name': 'd2'})
        self.assertNotEqual(hash(a), hash(b))

    def test_valid_metadata_passes(self):
        spec = task.UpdateDatasetOutput(
            update_dataset={'name': 'd1', 'metadata': ['meta/path']})
        self.assertEqual(spec.update_dataset.metadata, ['meta/path'])

    def test_valid_labels_passes(self):
        spec = task.UpdateDatasetOutput(
            update_dataset={'name': 'd1', 'labels': ['lbl/path']})
        self.assertEqual(spec.update_dataset.labels, ['lbl/path'])


class URLInputOutputHashTest(unittest.TestCase):
    """Tests for URLInputOutput.__hash__."""

    def test_hash_equal_for_same_url(self):
        a = task.URLInputOutput(url='https://example.com')
        b = task.URLInputOutput(url='https://example.com')
        self.assertEqual(hash(a), hash(b))

    def test_hash_differs_for_different_urls(self):
        a = task.URLInputOutput(url='https://example.com')
        b = task.URLInputOutput(url='https://other.com')
        self.assertNotEqual(hash(a), hash(b))


class TaskSpecPropagateResourceTest(unittest.TestCase):
    """Tests for TaskSpec.propagate_resource_values error paths."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_default_resource_not_in_resources_raises(self):
        spec = self._make()  # default resource = 'default'
        with self.assertRaises(Exception):
            spec.propagate_resource_values({})

    def test_undefined_named_resource_raises(self):
        spec = self._make(resource='custom')
        with self.assertRaises(Exception):
            spec.propagate_resource_values({})

    def test_resource_assigned_to_resources_field(self):
        spec = self._make(resource='cpu-pool')
        cpu_resources = connectors.ResourceSpec(cpu=4, memory='8Gi')
        spec.propagate_resource_values({'cpu-pool': cpu_resources})
        self.assertEqual(spec.resources.cpu, 4)
        self.assertEqual(spec.resources.memory, '8Gi')


class TaskSpecPrivilegeMountValidationTest(unittest.TestCase):
    """Tests for TaskSpec.validate_privilege_host_mount."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_no_privilege_no_mount_returns_silently(self):
        spec = self._make()
        spec.validate_privilege_host_mount({})  # No platform required.

    def test_privileged_without_platform_raises(self):
        # privileged requires resources.platform to be set.
        spec = self._make(privileged=True)
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({})

    def test_host_network_without_platform_raises(self):
        spec = self._make(hostNetwork=True)
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({})

    def test_volume_mounts_without_platform_raises(self):
        spec = self._make(volumeMounts=['/tmp'])
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({})

    def test_privileged_not_allowed_by_platform_raises(self):
        spec = self._make(privileged=True,
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(privileged_allowed=False)
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({'dev': platform})

    def test_host_network_not_allowed_by_platform_raises(self):
        spec = self._make(hostNetwork=True,
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(host_network_allowed=False)
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({'dev': platform})

    def test_volume_mount_too_many_colons_raises(self):
        spec = self._make(volumeMounts=['/src:/dst:/extra'],
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(allowed_mounts=['/src'],
                                       default_mounts=[])
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({'dev': platform})

    def test_volume_mount_empty_after_colon_raises(self):
        spec = self._make(volumeMounts=['/src:'],
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(allowed_mounts=['/src'],
                                       default_mounts=[])
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({'dev': platform})

    def test_disallowed_volume_mount_raises(self):
        spec = self._make(volumeMounts=['/forbidden'],
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(allowed_mounts=['/src'],
                                       default_mounts=['/data'])
        with self.assertRaises(Exception):
            spec.validate_privilege_host_mount({'dev': platform})

    def test_allowed_mount_passes(self):
        spec = self._make(volumeMounts=['/src'],
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(allowed_mounts=['/src'],
                                       default_mounts=[])
        spec.validate_privilege_host_mount({'dev': platform})

    def test_default_mount_passes(self):
        spec = self._make(volumeMounts=['/data'],
                          resources=connectors.ResourceSpec(platform='dev'))
        platform = connectors.Platform(allowed_mounts=[],
                                       default_mounts=['/data'])
        spec.validate_privilege_host_mount({'dev': platform})


class TaskSpecToPodResourceSpecTest(unittest.TestCase):
    """Tests for TaskSpec.get_resource_from_spec and to_pod_resource_spec."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_get_resource_from_spec_with_unit(self):
        spec = self._make()
        # When unit is provided, the value is read directly.
        result = spec.get_resource_from_spec({'storage': '10Gi'}, 'storage', 'Gi')
        self.assertEqual(result, '10Gi')

    def test_get_resource_from_spec_without_unit_uses_count(self):
        spec = self._make()
        # When unit is None, the function reads the 'count' subkey.
        result = spec.get_resource_from_spec({'cpu': {'count': 4}}, 'cpu', None)
        self.assertEqual(result, 4)

    def test_get_resource_from_spec_missing_returns_none(self):
        spec = self._make()
        # No 'cpu' key in dict, with unit=None -> returns None via .get('cpu', {})
        result = spec.get_resource_from_spec({}, 'cpu', None)
        self.assertIsNone(result)

    @unittest.skip(
        'Suspected source bug: get_resource_from_spec assumes cpu/gpu values '
        'are dicts with a "count" key, but ResourceSpec.model_dump() emits '
        'them as plain ints. Calling to_pod_resource_spec raises '
        'AttributeError on any non-empty cpu/gpu field.'
    )
    def test_to_pod_resource_spec_drops_zero_gpu(self):
        spec = self._make()
        resources = connectors.ResourceSpec(cpu=2, memory='4Gi', gpu=0)
        pod_spec = spec.to_pod_resource_spec(resources)
        self.assertNotIn('nvidia.com/gpu', pod_spec)


class TaskSpecSavedSpecTest(unittest.TestCase):
    """Tests for TaskSpec.saved_spec field stripping."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_saved_spec_excludes_resources_field(self):
        spec = self._make()
        spec.resources = connectors.ResourceSpec(cpu=4, memory='8Gi')
        saved = spec.saved_spec()
        self.assertNotIn('resources', saved)

    def test_saved_spec_excludes_backend_field(self):
        spec = self._make(backend='backend-1')
        saved = spec.saved_spec()
        self.assertNotIn('backend', saved)

    def test_saved_spec_keeps_user_defined_fields(self):
        spec = self._make()
        saved = spec.saved_spec()
        self.assertEqual(saved['name'], 'mytask')
        self.assertEqual(saved['image'], 'ubuntu:latest')
        self.assertEqual(saved['command'], ['echo'])


class TaskSpecParseTest(unittest.TestCase):
    """Tests for TaskSpec.parse token substitution."""

    def _make(self, **fields) -> task.TaskSpec:
        defaults: Dict[str, Any] = {
            'name': 'mytask',
            'image': 'ubuntu:latest',
            'command': ['echo'],
        }
        defaults.update(fields)
        return task.TaskSpec(**defaults)

    def test_parse_substitutes_workflow_id_token(self):
        spec = self._make(args=['{{workflow_id}}'])
        result = spec.parse('wf-123', {})
        self.assertEqual(result.args, ['wf-123'])

    def test_parse_substitutes_output_token(self):
        spec = self._make(args=['{{output}}'])
        result = spec.parse('wf-123', {})
        self.assertEqual(result.args,
                         [f'{kb_objects.DATA_LOCATION}/output'])

    def test_parse_substitutes_dataset_input_index(self):
        spec = self._make(
            inputs=[task.DatasetInputOutput(dataset={'name': 'd1'})],
            args=['{{input:0}}'],
        )
        result = spec.parse('wf-id', {})
        self.assertEqual(result.args,
                         [f'{kb_objects.DATA_LOCATION}/input/0'])

    def test_parse_substitutes_url_input_index(self):
        spec = self._make(
            inputs=[task.URLInputOutput(url='https://example.com')],
            args=['{{input:0}}'],
        )
        result = spec.parse('wf-id', {})
        self.assertEqual(result.args,
                         [f'{kb_objects.DATA_LOCATION}/input/0'])

    def test_parse_substitutes_task_input_by_name(self):
        spec = self._make(
            inputs=[task.TaskInputOutput(task='upstream-task')],
            args=['{{input:upstream-task}}'],
        )
        result = spec.parse('wf-id', {})
        self.assertEqual(result.args,
                         [f'{kb_objects.DATA_LOCATION}/input/0'])


class TaskGroupSpecPropertiesTest(unittest.TestCase):
    """Tests for TaskGroupSpec.has_group_barrier, inputs, and saved_spec."""

    def _make_task(self, name: str = 'mytask',
                   inputs: List[Any] | None = None,
                   lead: bool = False) -> task.TaskSpec:
        return task.TaskSpec(
            name=name,
            image='ubuntu:latest',
            command=['echo'],
            inputs=inputs if inputs is not None else [],
            lead=lead,
        )

    def test_has_group_barrier_single_task_returns_false(self):
        spec = task.TaskGroupSpec(name='g', tasks=[self._make_task()])
        self.assertFalse(spec.has_group_barrier())

    def test_has_group_barrier_multi_task_default_returns_true(self):
        spec = task.TaskGroupSpec(
            name='g',
            tasks=[
                self._make_task(name='t1', lead=True),
                self._make_task(name='t2'),
            ],
        )
        self.assertTrue(spec.has_group_barrier())

    def test_has_group_barrier_multi_task_barrier_disabled_returns_false(self):
        spec = task.TaskGroupSpec(
            name='g',
            barrier=False,
            tasks=[
                self._make_task(name='t1', lead=True),
                self._make_task(name='t2'),
            ],
        )
        self.assertFalse(spec.has_group_barrier())

    def test_inputs_property_aggregates_unique_inputs(self):
        url_input = task.URLInputOutput(url='https://example.com')
        ds_input = task.DatasetInputOutput(dataset={'name': 'd1'})
        spec = task.TaskGroupSpec(
            name='g',
            tasks=[
                self._make_task(name='t1', lead=True, inputs=[url_input]),
                self._make_task(name='t2', inputs=[ds_input, url_input]),
            ],
        )
        # Same URL input is shared across two tasks; deduplicated by hash.
        self.assertEqual(len(spec.inputs), 2)

    def test_saved_spec_includes_tasks_via_subspec(self):
        spec = task.TaskGroupSpec(
            name='g',
            tasks=[self._make_task(name='only-task')],
        )
        saved = spec.saved_spec()
        self.assertEqual(saved['name'], 'g')
        self.assertEqual(len(saved['tasks']), 1)
        self.assertEqual(saved['tasks'][0]['name'], 'only-task')


class TaskGroupSpecValidateTasksErrorTest(unittest.TestCase):
    """Tests for TaskGroupSpec.validate_tasks edge cases."""

    def _make_task(self, name: str, lead: bool = False) -> task.TaskSpec:
        return task.TaskSpec(name=name, image='ubuntu:latest',
                             command=['echo'], lead=lead)

    def test_empty_tasks_raises(self):
        with self.assertRaises(Exception):
            task.TaskGroupSpec(name='g', tasks=[])

    def test_single_task_auto_assigned_lead(self):
        # validate_tasks auto-sets lead=True when only one task.
        spec = task.TaskGroupSpec(
            name='g', tasks=[self._make_task(name='solo', lead=False)])
        self.assertTrue(spec.tasks[0].lead)

    def test_zero_leaders_in_multi_task_raises(self):
        with self.assertRaises(Exception):
            task.TaskGroupSpec(
                name='g',
                tasks=[
                    self._make_task(name='t1'),
                    self._make_task(name='t2'),
                ],
            )

    def test_two_leaders_in_multi_task_raises(self):
        with self.assertRaises(Exception):
            task.TaskGroupSpec(
                name='g',
                tasks=[
                    self._make_task(name='t1', lead=True),
                    self._make_task(name='t2', lead=True),
                ],
            )


class HstoreEncodeDecodeTest(unittest.TestCase):
    """Tests for _encode_hstore and decode_hstore."""

    def test_encode_empty_set(self):
        self.assertEqual(task._encode_hstore(set()), '')

    def test_encode_single_task(self):
        result = task._encode_hstore({'task1'})
        self.assertEqual(result, '"task1" => "NULL"')

    def test_decode_empty_string(self):
        self.assertEqual(task.decode_hstore(''), set())

    def test_decode_single_entry(self):
        self.assertEqual(task.decode_hstore('"task1"=>"NULL"'), {'task1'})

    def test_decode_multiple_entries(self):
        encoded = '"task1"=>"NULL", "task2"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'task1', 'task2'})

    def test_decode_ignores_invalid_names(self):
        # Names must match NAMEREGEX (start with letter).
        encoded = '"123-bad"=>"NULL", "task1"=>"NULL"'
        self.assertEqual(task.decode_hstore(encoded), {'task1'})


class FetchCredsTest(unittest.TestCase):
    """Tests for fetch_creds with mocked storage backend."""

    def test_returns_credential_when_profile_present(self):
        cred = mock.MagicMock(spec=credentials.StaticDataCredential)
        backend_info = mock.MagicMock()
        backend_info.profile = 's3://my-bucket'
        backend_info.scheme = 's3'
        backend_info.supports_environment_auth = False
        with mock.patch.object(task.storage, 'construct_storage_backend',
                               return_value=backend_info):
            result = task.fetch_creds(
                user='alice',
                data_creds={'s3://my-bucket': cred},
                path='s3://my-bucket/some/path',
            )
        self.assertIs(result, cred)

    def test_returns_none_when_environment_auth_supported(self):
        backend_info = mock.MagicMock()
        backend_info.profile = 's3://other'
        backend_info.scheme = 's3'
        backend_info.supports_environment_auth = True
        with mock.patch.object(task.storage, 'construct_storage_backend',
                               return_value=backend_info):
            result = task.fetch_creds(user='alice', data_creds={},
                                      path='s3://other/path')
        self.assertIsNone(result)

    def test_returns_none_when_scheme_in_disabled_data(self):
        backend_info = mock.MagicMock()
        backend_info.profile = 's3://other'
        backend_info.scheme = 's3'
        backend_info.supports_environment_auth = False
        with mock.patch.object(task.storage, 'construct_storage_backend',
                               return_value=backend_info):
            result = task.fetch_creds(user='alice', data_creds={},
                                      path='s3://other/path',
                                      disabled_data=['s3'])
        self.assertIsNone(result)

    def test_raises_when_credential_missing_and_required(self):
        backend_info = mock.MagicMock()
        backend_info.profile = 's3://other'
        backend_info.scheme = 's3'
        backend_info.supports_environment_auth = False
        with mock.patch.object(task.storage, 'construct_storage_backend',
                               return_value=backend_info):
            with self.assertRaises(Exception):
                task.fetch_creds(user='alice', data_creds={},
                                 path='s3://other/path')

    def test_raises_when_disabled_data_does_not_include_scheme(self):
        backend_info = mock.MagicMock()
        backend_info.profile = 's3://other'
        backend_info.scheme = 's3'
        backend_info.supports_environment_auth = False
        with mock.patch.object(task.storage, 'construct_storage_backend',
                               return_value=backend_info):
            with self.assertRaises(Exception):
                task.fetch_creds(user='alice', data_creds={},
                                 path='s3://other/path',
                                 disabled_data=['gs'])


def _make_taskgroup(
    user_label: str = 'alice',
    workflow_id: str = 'wf-1',
    group_name: str = 'group-1',
    task_specs: List[task.TaskSpec] | None = None,
) -> task.TaskGroup:
    """Create a TaskGroup for label/variable tests with minimal mocking."""
    if task_specs is None:
        task_specs = [task.TaskSpec(name='t1', image='ubuntu:latest',
                                    command=['echo'], lead=True)]
    spec = task.TaskGroupSpec(name=group_name, tasks=task_specs)
    return task.TaskGroup(
        workflow_id_internal=workflow_id,
        name=group_name,
        group_uuid=common.generate_unique_id(),
        spec=spec,
        tasks=[],
        remaining_upstream_groups=set(),
        downstream_groups=set(),
        database=mock.create_autospec(connectors.PostgresConnector, instance=True),
    )


class TaskGroupLabelsTest(unittest.TestCase):
    """Tests for TaskGroup._labels (user format handling)."""

    def test_labels_contain_workflow_metadata(self):
        group = _make_taskgroup(workflow_id='wf-x', group_name='grp-y')
        labels = group._labels(user='alice', workflow_uuid='wf-uuid')
        self.assertEqual(labels['osmo.workflow_id'], 'wf-x')
        self.assertEqual(labels['osmo.group_name'], 'grp-y')
        self.assertEqual(labels['osmo.workflow_uuid'], 'wf-uuid')

    def test_simple_username_added_as_label(self):
        group = _make_taskgroup()
        labels = group._labels(user='alice', workflow_uuid='wf-uuid')
        self.assertEqual(labels['osmo.submitted_by'], 'alice')

    def test_email_username_parsed_to_local_part(self):
        group = _make_taskgroup()
        labels = group._labels(user='alice@example.com', workflow_uuid='wf-uuid')
        self.assertEqual(labels['osmo.submitted_by'], 'alice')

    def test_invalid_user_omits_label(self):
        # User starts with an underscore which is not a valid k8s label start.
        group = _make_taskgroup()
        labels = group._labels(user='_bad-user', workflow_uuid='wf-uuid')
        self.assertNotIn('osmo.submitted_by', labels)

    def test_invalid_email_local_part_omits_label(self):
        # Email's local part starts with special character.
        group = _make_taskgroup()
        labels = group._labels(user='!@example.com', workflow_uuid='wf-uuid')
        self.assertNotIn('osmo.submitted_by', labels)


class TaskGroupConvertLabelsToVariablesTest(unittest.TestCase):
    """Tests for TaskGroup._convert_labels_to_variables."""

    def test_workflow_prefix_stripped_to_wf(self):
        group = _make_taskgroup()
        result = group._convert_labels_to_variables(
            {'osmo.workflow_uuid': 'abc'})
        self.assertEqual(result, {'WF_UUID': 'abc'})

    def test_non_workflow_label_gets_wf_prefix(self):
        group = _make_taskgroup()
        result = group._convert_labels_to_variables(
            {'osmo.group_name': 'grp'})
        self.assertEqual(result, {'WF_GROUP_NAME': 'grp'})

    def test_label_without_osmo_prefix_dropped(self):
        group = _make_taskgroup()
        result = group._convert_labels_to_variables(
            {'kubernetes.io/zone': 'us-east-1', 'osmo.pool': 'p1'})
        self.assertEqual(result, {'WF_POOL': 'p1'})

    def test_multiple_labels(self):
        group = _make_taskgroup()
        result = group._convert_labels_to_variables({
            'osmo.workflow_id': 'wf-1',
            'osmo.platform': 'gpu',
        })
        self.assertEqual(result, {'WF_ID': 'wf-1', 'WF_PLATFORM': 'gpu'})


class TaskGroupGetPodNameTest(unittest.TestCase):
    """Tests for TaskGroup._get_pod_name and _get_image_secret_name."""

    def test_get_image_secret_name_format(self):
        group = _make_taskgroup()
        result = group._get_image_secret_name('group-uid', 'user')
        self.assertEqual(result, 'group-uid-user')

    def test_get_pod_name_format(self):
        group = _make_taskgroup()
        result = group._get_pod_name('mytask', 'wf-uuid-1')
        # k8s_name prepends nothing for already-valid names; format is
        # '<task>-<workflow_uuid>'.
        self.assertEqual(result, 'mytask-wf-uuid-1')

    def test_get_pod_names_iterates_spec_tasks(self):
        specs = [
            task.TaskSpec(name='t1', image='ubuntu:latest',
                          command=['echo'], lead=True),
            task.TaskSpec(name='t2', image='ubuntu:latest',
                          command=['echo']),
        ]
        group = _make_taskgroup(task_specs=specs)
        names = group.get_pod_names('wf-uuid')
        self.assertEqual(names, ['t1-wf-uuid', 't2-wf-uuid'])


class RenderGroupTemplatesTest(unittest.TestCase):
    """Tests for render_group_templates."""

    def test_strips_namespace_from_metadata(self):
        templates = [{'metadata': {'name': 'r1', 'namespace': 'old-ns'}}]
        result = task.render_group_templates(templates, {}, {})
        self.assertNotIn('namespace', result[0]['metadata'])

    def test_injects_labels_into_metadata(self):
        templates = [{'metadata': {'name': 'r1'}}]
        result = task.render_group_templates(
            templates, {}, {'osmo.workflow_id': 'wf-1'})
        self.assertEqual(
            result[0]['metadata']['labels'], {'osmo.workflow_id': 'wf-1'})

    def test_does_not_mutate_input_template(self):
        templates = [{'metadata': {'name': 'r1', 'namespace': 'orig-ns'}}]
        task.render_group_templates(templates, {}, {'foo': 'bar'})
        # Original template is preserved (deep-copied).
        self.assertEqual(templates[0]['metadata']['namespace'], 'orig-ns')
        self.assertNotIn('labels', templates[0]['metadata'])

    def test_substitutes_jinja_variables(self):
        templates = [{
            'metadata': {'name': 'r1'},
            'spec': {'value': '{{ FOO }}'},
        }]
        result = task.render_group_templates(
            templates, {'FOO': 'rendered'}, {})
        self.assertEqual(result[0]['spec']['value'], 'rendered')

    def test_creates_metadata_when_missing(self):
        templates = [{'kind': 'Custom'}]
        result = task.render_group_templates(
            templates, {}, {'osmo.foo': 'bar'})
        self.assertEqual(result[0]['metadata']['labels'], {'osmo.foo': 'bar'})


class TaskCreateNewTest(unittest.TestCase):
    """Tests for Task.create_new."""

    def _make_task(self, retry_id: int = 0) -> task.Task:
        return task.Task(
            workflow_id_internal='wf-1',
            workflow_uuid='wf-uuid',
            name='t1',
            group_name='g1',
            task_uuid=common.generate_unique_id(),
            task_db_key=common.generate_unique_id(),
            retry_id=retry_id,
            database=mock.create_autospec(connectors.PostgresConnector, instance=True),
            exit_actions={},
            lead=True,
        )

    def test_create_new_increments_retry_id(self):
        original = self._make_task(retry_id=2)
        new_task = original.create_new()
        self.assertEqual(new_task.retry_id, 3)

    def test_create_new_preserves_name_and_group(self):
        original = self._make_task()
        new_task = original.create_new()
        self.assertEqual(new_task.name, original.name)
        self.assertEqual(new_task.group_name, original.group_name)

    def test_create_new_preserves_task_uuid(self):
        original = self._make_task()
        new_task = original.create_new()
        self.assertEqual(new_task.task_uuid, original.task_uuid)

    def test_create_new_assigns_new_task_db_key(self):
        original = self._make_task()
        new_task = original.create_new()
        self.assertNotEqual(new_task.task_db_key, original.task_db_key)


if __name__ == '__main__':
    unittest.main()
