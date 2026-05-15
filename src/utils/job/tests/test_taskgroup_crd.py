# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

import pathlib
import unittest

import yaml

from src.utils.job import taskgroup_crd


class TaskGroupCRDTest(unittest.TestCase):

    def test_build_otg_payload(self):
        payload = taskgroup_crd.build_otg_payload(
            workflow_id='workflow-a',
            workflow_uuid='workflow-uuid',
            group_name='group-a',
            group_uuid='123_group_uuid',
            namespace='osmo-workloads',
            mode='shadow',
            resources=[{'apiVersion': 'v1', 'kind': 'Secret', 'metadata': {'name': 's'}}],
        )

        document = yaml.safe_load(payload.yaml_text)
        self.assertEqual(payload.name, 'otg-123-group-uuid')
        self.assertEqual(payload.namespace, 'osmo-workloads')
        self.assertEqual(document['metadata']['annotations'], {
            'workflow.osmo.nvidia.com/mode': 'shadow',
        })
        self.assertEqual(document['spec']['mode'], 'shadow')
        self.assertEqual(payload.manifest['spec']['mode'], 'shadow')
        runtime_config = document['spec']['runtimeConfig']
        self.assertEqual(runtime_config['kai']['resources'][0]['kind'], 'Secret')
        self.assertEqual(runtime_config['expectedResources'][0]['kind'], 'Secret')

    def test_synthetic_single_task_runtime_config_matches_golden(self):
        self.assert_runtime_config_matches_golden(
            'kai_single_task_runtime_config.yaml',
            single_task_resources(),
        )

    def test_synthetic_multi_feature_runtime_config_matches_golden(self):
        self.assert_runtime_config_matches_golden(
            'kai_multi_feature_runtime_config.yaml',
            multi_feature_resources(),
        )

    def test_real_group_workflow_runtime_config_matches_golden(self):
        self.assert_runtime_config_matches_golden(
            'kai_real_group_communication_runtime_config.yaml',
            real_group_workflow_resources(),
        )

    def assert_runtime_config_matches_golden(self, golden_name, resources):
        actual = yaml.safe_dump(
            taskgroup_crd.build_kai_runtime_config(resources),
            sort_keys=True,
        )
        golden_path = pathlib.Path(__file__).with_name('golden') / golden_name
        self.assertEqual(actual, golden_path.read_text(encoding='utf-8'))


def single_task_resources():
    return [
        {
            'apiVersion': 'scheduling.run.ai/v2alpha2',
            'kind': 'PodGroup',
            'metadata': {'name': 'group-single'},
            'spec': {'minMember': 1, 'queue': 'queue-a'},
        },
        {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': 'pod-single',
                'labels': {'app': 'osmo'},
                'annotations': {},
            },
            'spec': {
                'schedulerName': 'kai-scheduler',
                'priorityClassName': 'high',
                'restartPolicy': 'Never',
                'containers': [
                    {'name': 'user', 'image': 'busybox', 'command': ['sleep', '60']},
                ],
            },
        },
    ]


def multi_feature_resources():
    return [
        {
            'apiVersion': 'v1',
            'kind': 'Secret',
            'metadata': {'name': 'registry-secret'},
            'type': 'kubernetes.io/dockerconfigjson',
            'data': {'.dockerconfigjson': 'redacted'},
        },
        {
            'apiVersion': 'v1',
            'kind': 'Service',
            'metadata': {
                'name': 'headless-service',
                'labels': {'osmo.group_uuid': 'group-uuid'},
            },
            'spec': {
                'clusterIP': 'None',
                'selector': {'osmo.group_uuid': 'group-uuid'},
                'ports': [{'name': 'control', 'port': 9000, 'targetPort': 9000}],
            },
        },
        {
            'apiVersion': 'scheduling.k8s.io/v1',
            'kind': 'PriorityClass',
            'metadata': {'name': 'osmo-high'},
            'value': 1000,
            'globalDefault': False,
            'description': 'synthetic priority',
        },
        {
            'apiVersion': 'scheduling.run.ai/v2alpha2',
            'kind': 'PodGroup',
            'metadata': {
                'name': 'group-uuid',
                'labels': {
                    'kai.scheduler/queue': 'queue-a',
                    'runai/queue': 'queue-a',
                },
            },
            'spec': {
                'queue': 'queue-a',
                'minMember': 2,
                'priorityClassName': 'osmo-high',
                'subGroups': [
                    {'name': 'worker', 'minMember': 1},
                    {'name': 'server', 'minMember': 1},
                ],
            },
        },
        {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': 'worker-0',
                'labels': {'kai.scheduler/pod-group-sub-group': 'worker'},
                'annotations': {'osmo/template': 'worker'},
            },
            'spec': {
                'schedulerName': 'kai-scheduler',
                'priorityClassName': 'osmo-high',
                'restartPolicy': 'Never',
                'imagePullSecrets': [{'name': 'registry-secret'}],
                'containers': [
                    {'name': 'user', 'image': 'nvcr.io/synthetic/worker:latest'},
                ],
                'topologySpreadConstraints': [
                    {
                        'maxSkew': 1,
                        'topologyKey': 'kubernetes.io/hostname',
                        'whenUnsatisfiable': 'DoNotSchedule',
                        'labelSelector': {
                            'matchLabels': {'kai.scheduler/pod-group-sub-group': 'worker'},
                        },
                    },
                ],
            },
        },
        {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': 'server-0',
                'labels': {'kai.scheduler/pod-group-sub-group': 'server'},
                'annotations': {'osmo/template': 'server'},
            },
            'spec': {
                'schedulerName': 'kai-scheduler',
                'priorityClassName': 'osmo-high',
                'restartPolicy': 'Never',
                'containers': [
                    {'name': 'user', 'image': 'nvcr.io/synthetic/server:latest'},
                ],
            },
        },
    ]


def real_group_workflow_resources():
    fixture_path = pathlib.Path(__file__).with_name('fixtures') / 'group_tasks_communication.yaml'
    spec_dict = yaml.safe_load(fixture_path.read_text(encoding='utf-8'))
    group_spec = spec_dict['workflow']['groups'][0]
    tasks = group_spec['tasks']
    group_uuid = 'parallel-processing-group'
    resources = [
        {
            'apiVersion': 'scheduling.run.ai/v2alpha2',
            'kind': 'PodGroup',
            'metadata': {
                'name': group_uuid,
                'labels': {
                    'kai.scheduler/queue': 'default',
                'runai/queue': 'default',
                },
            },
            'spec': {
                'queue': 'default',
                'minMember': len(tasks),
            },
        },
        {
            'apiVersion': 'v1',
            'kind': 'Service',
            'metadata': {
                'name': group_uuid,
                'labels': {'osmo.group_name': group_spec['name']},
            },
            'spec': {
                'clusterIP': 'None',
                'selector': {'osmo.group_name': group_spec['name']},
                'ports': [{'name': 'task-link', 'port': 24831, 'targetPort': 24831}],
            },
        },
    ]
    for task_spec in tasks:
        labels = {
            'osmo.group_name': group_spec['name'],
            'osmo.task_name': task_spec['name'],
            'osmo.task_uuid': f'{task_spec["name"]}-uuid',
            'osmo.retry_id': '0',
        }
        if task_spec.get('lead', False):
            labels['osmo.lead_container'] = 'true'
        resources.append({
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {
                'name': f'{task_spec["name"]}-pod',
                'labels': labels,
                'annotations': {},
            },
            'spec': {
                'schedulerName': 'kai-scheduler',
                'restartPolicy': 'Never',
                'containers': [
                    {
                        'name': 'user',
                        'image': task_spec['image'],
                        'command': task_spec['command'],
                        'args': task_spec['args'],
                    },
                ],
            },
        })
    return resources


if __name__ == '__main__':
    unittest.main()
