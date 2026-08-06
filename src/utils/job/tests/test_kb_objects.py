"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from src.lib.utils import priority as wf_priority
from src.utils import connectors
from src.utils.job import kb_objects, topology


class KbObjectTest(unittest.TestCase):
    def test_simple_host_mounts(self):
        """
        Test if the generated outputs from a host mount with a single path are correct.
        """
        test_path = '/opt/data'
        host_mount = kb_objects.HostMount(name='my-mount', path=test_path)
        self.assertEqual(host_mount.src_path, test_path)
        self.assertEqual(host_mount.dest_path, test_path)

        self.assertEqual(host_mount.volume()['hostPath']['path'], test_path)
        self.assertEqual(host_mount.volume_mount()['mountPath'], test_path)

    def test_src_dest_host_mounts(self):
        """
        Test if the generated outputs from a host mount with source and destination paths are correct.
        """
        src_test_path = '/opt/data'
        dest_test_path = '/home/data'
        host_mount = kb_objects.HostMount(name='my-mount', path=f'{src_test_path}:{dest_test_path}')
        self.assertEqual(host_mount.src_path, src_test_path)
        self.assertEqual(host_mount.dest_path, dest_test_path)
        self.assertEqual(host_mount.volume()['hostPath']['path'], src_test_path)
        self.assertEqual(host_mount.volume_mount()['mountPath'], dest_test_path)


def _make_backend(scheduler_type: connectors.BackendSchedulerType,
                  scheduler_name: str = '') -> connectors.Backend:
    return connectors.Backend(
        name='test-backend',
        description='Test backend',
        version='1.0.0',
        k8s_uid='test-uid',
        k8s_namespace='test-namespace',
        dashboard_url='http://test',
        grafana_url='http://test',
        tests=[],
        scheduler_settings=connectors.BackendSchedulerSettings(
            scheduler_type=scheduler_type,
            scheduler_name=scheduler_name,
        ),
        node_conditions=connectors.BackendNodeConditions(),
        last_heartbeat=datetime.datetime.now(),
        created_date=datetime.datetime.now(),
        router_address='test-router',
        online=True,
    )


def _make_pod(task_name: str) -> dict:
    return {
        'apiVersion': 'v1',
        'kind': 'Pod',
        'metadata': {
            'name': f'pod-{task_name}',
            'labels': {'osmo.task_name': task_name},
            'annotations': {},
        },
        'spec': {
            'containers': [{'name': 'test', 'image': 'test:latest'}],
        },
    }


class NoneSchedulerSettingsTest(unittest.TestCase):
    """Validate that BackendSchedulerType.NONE is accepted by the Pydantic model."""

    def test_enum_value_is_none(self):
        self.assertEqual(connectors.BackendSchedulerType.NONE.value, 'none')

    def test_settings_parses_none_from_string(self):
        settings = connectors.BackendSchedulerSettings(scheduler_type='none')
        self.assertEqual(settings.scheduler_type, connectors.BackendSchedulerType.NONE)

    def test_settings_parses_none_from_dict(self):
        settings = connectors.BackendSchedulerSettings.model_validate({
            'scheduler_type': 'none',
        })
        self.assertEqual(settings.scheduler_type, connectors.BackendSchedulerType.NONE)


class NoneK8sObjectFactoryTest(unittest.TestCase):
    """Verify the 'none' scheduler factory bypasses PodGroup creation entirely."""

    def setUp(self):
        self.backend = _make_backend(connectors.BackendSchedulerType.NONE)
        self.factory = kb_objects.get_k8s_object_factory(self.backend)

    def test_factory_dispatch(self):
        self.assertIsInstance(self.factory, kb_objects.NoneK8sObjectFactory)

    def test_create_group_returns_pods_only(self):
        pods = [_make_pod(f'task{i}') for i in range(3)]
        resources = self.factory.create_group_k8s_resources(
            'group-uuid', pods, {'osmo.label': 'value'}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, [], [],
        )
        self.assertEqual(len(resources), 3)
        for resource in resources:
            self.assertEqual(resource['kind'], 'Pod')

    def test_no_podgroup_in_output(self):
        pods = [_make_pod('task1')]
        resources = self.factory.create_group_k8s_resources(
            'group-uuid', pods, {}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, [], [],
        )
        kinds = {r['kind'] for r in resources}
        self.assertNotIn('PodGroup', kinds)

    def test_pod_has_no_custom_scheduler_name(self):
        pods = [_make_pod('task1')]
        resources = self.factory.create_group_k8s_resources(
            'group-uuid', pods, {}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, [], [],
        )
        pod = resources[0]
        self.assertNotIn('schedulerName', pod['spec'])

    def test_pod_has_no_kai_or_runai_labels(self):
        pods = [_make_pod('task1')]
        resources = self.factory.create_group_k8s_resources(
            'group-uuid', pods, {'osmo.label': 'value'}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, [], [],
        )
        pod = resources[0]
        self.assertNotIn('kai.scheduler/queue', pod['metadata']['labels'])
        self.assertNotIn('runai/queue', pod['metadata']['labels'])
        self.assertNotIn('kai.scheduler/subgroup-name', pod['metadata']['labels'])

    def test_pod_has_no_pod_group_annotation(self):
        pods = [_make_pod('task1')]
        resources = self.factory.create_group_k8s_resources(
            'group-uuid', pods, {}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, [], [],
        )
        annotations = resources[0]['metadata'].get('annotations', {})
        self.assertNotIn('pod-group-name', annotations)

    def test_update_pod_does_not_set_scheduler_name(self):
        pod = _make_pod('task1')
        self.factory.update_pod_k8s_resource(
            pod, 'group-uuid', 'pool-a', wf_priority.WorkflowPriority.NORMAL,
        )
        self.assertNotIn('schedulerName', pod['spec'])
        self.assertNotIn('kai.scheduler/queue', pod['metadata']['labels'])

    def test_cleanup_specs_does_not_include_podgroup(self):
        specs = self.factory.get_group_cleanup_specs({'osmo.group_uid': 'g'})
        for spec in specs:
            api = getattr(spec, 'generic_api', None)
            kind = api.kind if api else spec.resource_type
            self.assertNotEqual(kind, 'PodGroup')

    def test_scheduler_resources_spec_is_empty(self):
        self.assertEqual(self.factory.get_scheduler_resources_spec(self.backend, []), [])
        self.assertEqual(self.factory.list_scheduler_resources_spec(self.backend), [])
        self.assertEqual(self.factory.list_immutable_scheduler_resources(), [])

    def test_priority_and_topology_unsupported(self):
        self.assertFalse(self.factory.priority_supported())
        self.assertFalse(self.factory.topology_supported())


class NoneFactoryWithTopologyKeysTest(unittest.TestCase):
    """Topology keys must not produce PodGroup constraints in 'none' mode."""

    def test_topology_keys_ignored(self):
        backend = _make_backend(connectors.BackendSchedulerType.NONE)
        factory = kb_objects.get_k8s_object_factory(backend)
        topology_keys = [
            topology.TopologyKey(key='gpu-clique', label='nvidia.com/gpu-clique'),
        ]
        task_infos = [
            topology.TaskTopology(
                name='task1',
                topology_requirements=[
                    topology.TopologyRequirement(
                        key='gpu-clique', group='default', required=True),
                ],
            ),
        ]
        pods = [_make_pod('task1')]
        resources = factory.create_group_k8s_resources(
            'group-uuid', pods, {}, 'pool-a',
            wf_priority.WorkflowPriority.NORMAL, topology_keys, task_infos,
        )
        kinds = {r['kind'] for r in resources}
        self.assertEqual(kinds, {'Pod'})


if __name__ == "__main__":
    unittest.main()
