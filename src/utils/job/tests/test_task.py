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
from typing import Dict, List
import unittest

from src.lib.utils import common
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

def create_container(cpu: str = '1', ephemeral_storage: str = '1Gi', memory: str = '1Gi',
                     name='user', volume_mounts: List = []):
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
    def check_other_fields(self, final_pod: Dict, tolerations: Dict, labels: List):
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
        pod_override = {'spec': {'containers': [], 'volumes': []}}
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
        self.assertAlmostEqual(tokens[f'USER_STORAGE_m'], 10 * 1024 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_STORAGE_B'], 10 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_STORAGE_Ki'], 10 * 1024 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_STORAGE_Mi'], 10 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_STORAGE_Gi'], 10, places=5)
        self.assertAlmostEqual(tokens[f'USER_STORAGE_Ti'], 10.0 / 1024 , places=5)

        # Evaluate the values for memory (test that values with decimal work)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_m'], 10.5 * 1024 * 1024 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_B'], 10.5 * 1024 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_Ki'], 10.5 * 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_Mi'], 10.5 , places=5)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_Gi'], 10.5 / 1024, places=5)
        self.assertAlmostEqual(tokens[f'USER_MEMORY_Ti'], 10.5 / 1024 /1024, places=5)

    def test_token_values_with_incomplete_resource_spec(self):
        """ Test that the keys are still populated, with values None. """
        resource = connectors.ResourceSpec()
        tokens = resource.get_allocatable_tokens({})
        for resource in ['CPU', 'GPU']:
            self.assertIsNone(tokens[f'USER_{resource}'])
        for resource in ['MEMORY', 'STORAGE']:
            self.assertIsNone(tokens[f'USER_{resource}'])
            self.assertIsNone(tokens[f'USER_{resource}_VAL'])
            self.assertIsNone(tokens[f'USER_{resource}_UNIT'])
            for target_unit in common.MEASUREMENTS_SHORT:
                self.assertIsNone(tokens[f'USER_{resource}_{target_unit}'])

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


if __name__ == '__main__':
    unittest.main()
