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
import base64
import json
import unittest
from unittest import mock

from src.lib.utils import priority as wf_priority
from src.utils.job import backend_job_defs, kb_objects


# ---------------------------------------------------------------------------
# k8s_name
# ---------------------------------------------------------------------------
class K8sNameTest(unittest.TestCase):
    def test_lowercase(self):
        self.assertEqual(kb_objects.k8s_name('MyTask'), 'mytask')

    def test_underscores_to_hyphens(self):
        self.assertEqual(kb_objects.k8s_name('my_task_name'), 'my-task-name')

    def test_already_valid(self):
        self.assertEqual(kb_objects.k8s_name('valid-name'), 'valid-name')

    def test_mixed(self):
        self.assertEqual(kb_objects.k8s_name('My_Task_Name'), 'my-task-name')


# ---------------------------------------------------------------------------
# construct_pod_name
# ---------------------------------------------------------------------------
class ConstructPodNameTest(unittest.TestCase):
    def test_format(self):
        wf_uuid = 'abcdef1234567890extra'
        task_uuid = '0987654321fedcbaextra'
        result = kb_objects.construct_pod_name(wf_uuid, task_uuid)
        self.assertEqual(result, 'abcdef1234567890-0987654321fedcba')

    def test_truncation(self):
        result = kb_objects.construct_pod_name('a' * 40, 'b' * 40)
        parts = result.split('-')
        self.assertEqual(len(parts), 2)
        self.assertEqual(len(parts[0]), 16)
        self.assertEqual(len(parts[1]), 16)


# ---------------------------------------------------------------------------
# K8sObjectFactory
# ---------------------------------------------------------------------------
class K8sObjectFactoryTest(unittest.TestCase):
    def setUp(self):
        self.factory = kb_objects.K8sObjectFactory(scheduler_name='default-scheduler')

    def test_create_secret(self):
        secret = self.factory.create_secret(
            name='my-secret',
            labels={'app': 'osmo'},
            data={'key': 'dmFsdWU='},
            string_data={'plain': 'value'})
        self.assertEqual(secret['kind'], 'Secret')
        self.assertEqual(secret['metadata']['name'], 'my-secret')
        self.assertEqual(secret['metadata']['labels']['app'], 'osmo')
        self.assertEqual(secret['data']['key'], 'dmFsdWU=')
        self.assertEqual(secret['stringData']['plain'], 'value')
        self.assertEqual(secret['type'], 'Opaque')

    def test_create_secret_custom_type(self):
        secret = self.factory.create_secret(
            name='tls-secret', labels={}, data={}, string_data={},
            secret_type='kubernetes.io/tls')
        self.assertEqual(secret['type'], 'kubernetes.io/tls')

    def test_create_headless_service(self):
        svc = self.factory.create_headless_service(
            name='my-group', labels={'osmo.workflow': 'wf1'})
        self.assertEqual(svc['kind'], 'Service')
        self.assertEqual(svc['spec']['clusterIP'], 'None')
        self.assertEqual(svc['spec']['selector']['osmo.workflow'], 'wf1')

    def test_create_config_map(self):
        cm = self.factory.create_config_map(
            name='my-config', labels={'app': 'osmo'},
            data={'key1': 'val1', 'key2': 'val2'})
        self.assertEqual(cm['kind'], 'ConfigMap')
        self.assertEqual(cm['metadata']['name'], 'my-config')
        self.assertEqual(cm['data']['key1'], 'val1')

    def test_create_image_secret(self):
        cred = {'registry.io': {'username': 'user', 'password': 'pass'}}
        secret = self.factory.create_image_secret(
            secret_name='reg-secret', labels={'app': 'osmo'}, cred=cred)
        self.assertEqual(secret['kind'], 'Secret')
        self.assertEqual(secret['type'], 'kubernetes.io/dockerconfigjson')
        decoded = json.loads(
            base64.b64decode(secret['data']['.dockerconfigjson']).decode('utf-8'))
        self.assertEqual(decoded['auths']['registry.io']['username'], 'user')

    def test_priority_supported(self):
        self.assertFalse(self.factory.priority_supported())

    def test_topology_supported(self):
        self.assertFalse(self.factory.topology_supported())

    def test_retry_allowed(self):
        self.assertTrue(self.factory.retry_allowed())

    def test_list_scheduler_resources_spec_empty(self):
        backend = mock.MagicMock()
        self.assertEqual(self.factory.list_scheduler_resources_spec(backend), [])

    def test_list_immutable_scheduler_resources_empty(self):
        self.assertEqual(self.factory.list_immutable_scheduler_resources(), [])

    def test_get_scheduler_resources_spec_empty(self):
        backend = mock.MagicMock()
        self.assertEqual(self.factory.get_scheduler_resources_spec(backend, []), [])

    def test_get_group_cleanup_specs(self):
        labels = {'app': 'osmo'}
        specs = self.factory.get_group_cleanup_specs(labels)
        self.assertEqual(len(specs), 1)
        self.assertEqual(specs[0].resource_type, 'Pod')
        self.assertEqual(specs[0].labels, labels)

    def test_get_error_log_specs(self):
        labels = {'app': 'osmo'}
        spec = self.factory.get_error_log_specs(labels)
        self.assertEqual(spec.resource_type, 'Pod')
        self.assertEqual(spec.labels, labels)

    def test_update_pod_k8s_resource(self):
        pod: dict = {'spec': {}}
        self.factory.update_pod_k8s_resource(
            pod, 'group-uuid', 'pool1', wf_priority.WorkflowPriority.NORMAL)
        self.assertEqual(pod['spec']['schedulerName'], 'default-scheduler')

    def test_create_group_k8s_resources(self):
        pods: list = [{'spec': {}, 'metadata': {'labels': {}}}]
        result = self.factory.create_group_k8s_resources(
            group_uuid='g1', pods=pods, labels={}, pool_name='pool1',
            priority=wf_priority.WorkflowPriority.NORMAL,
            topology_keys=[], task_infos=[])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['spec']['schedulerName'], 'default-scheduler')


# ---------------------------------------------------------------------------
# FileMount
# ---------------------------------------------------------------------------
class FileMountTest(unittest.TestCase):
    def setUp(self):
        self.factory = kb_objects.K8sObjectFactory(scheduler_name='default')

    def test_creation_and_digest(self):
        fm = kb_objects.FileMount(
            group_uid='group-uuid-1234567890',
            path='/home/user/config.yaml',
            content='key: value',
            k8s_factory=self.factory)
        self.assertNotEqual(fm.digest, '')
        self.assertTrue(fm.name.startswith('osmo-'))

    def test_digest_cannot_be_set(self):
        with self.assertRaises(Exception):
            kb_objects.FileMount(
                group_uid='group-uuid',
                path='/home/test.txt',
                content='data',
                digest='custom-digest',
                k8s_factory=self.factory)

    def test_custom_digest(self):
        fm = kb_objects.FileMount(
            group_uid='group-uuid-1234567890',
            path='/test/file.txt',
            content='data',
            k8s_factory=self.factory)
        original_digest = fm.digest
        fm.custom_digest('my-hash-string')
        self.assertNotEqual(fm.digest, original_digest)

    def test_name_uses_truncated_group_uid(self):
        fm = kb_objects.FileMount(
            group_uid='abcdefghijklmnopqrstuvwxyz',
            path='/test.txt', content='data',
            k8s_factory=self.factory)
        self.assertIn('abcdefghijklmnop', fm.name)

    def test_volume(self):
        fm = kb_objects.FileMount(
            group_uid='group-uuid-1234567890',
            path='/test/file.txt', content='data',
            k8s_factory=self.factory)
        vol = fm.volume()
        self.assertEqual(vol['name'], fm.name)
        self.assertEqual(vol['secret']['secretName'], fm.name)

    def test_volume_mount(self):
        fm = kb_objects.FileMount(
            group_uid='group-uuid-1234567890',
            path='/test/file.txt', content='data',
            k8s_factory=self.factory)
        vm = fm.volume_mount()
        self.assertEqual(vm['mountPath'], '/test/file.txt')
        self.assertEqual(vm['subPath'], 'file.txt')
        self.assertEqual(vm['name'], fm.name)

    def test_secret(self):
        fm = kb_objects.FileMount(
            group_uid='group-uuid-1234567890',
            path='/test/file.txt', content='data',
            k8s_factory=self.factory)
        labels = {'app': 'osmo'}
        secret = fm.secret(labels)
        self.assertEqual(secret['kind'], 'Secret')
        self.assertIn('file.txt', secret['data'])

    def test_different_content_different_digest(self):
        fm1 = kb_objects.FileMount(
            group_uid='group', path='/test.txt', content='data1',
            k8s_factory=self.factory)
        fm2 = kb_objects.FileMount(
            group_uid='group', path='/test.txt', content='data2',
            k8s_factory=self.factory)
        self.assertNotEqual(fm1.digest, fm2.digest)


# ---------------------------------------------------------------------------
# get_k8s_object_factory
# ---------------------------------------------------------------------------
class GetK8sObjectFactoryTest(unittest.TestCase):
    def test_unsupported_scheduler_raises(self):
        backend = mock.MagicMock()
        backend.scheduler_settings.scheduler_type = 'UNSUPPORTED'
        with self.assertRaises(Exception):
            kb_objects.get_k8s_object_factory(backend)


# ---------------------------------------------------------------------------
# kb_methods (CustomObject stubs)
# ---------------------------------------------------------------------------
class KbMethodsStubTest(unittest.TestCase):
    def test_custom_object_metadata_stub(self):
        from src.utils.job.kb_methods import CustomObjectMetadataStub
        stub = CustomObjectMetadataStub(name='test-pod')
        self.assertEqual(stub.name, 'test-pod')

    def test_custom_object_stub(self):
        from src.utils.job.kb_methods import CustomObjectStub, CustomObjectMetadataStub
        meta = CustomObjectMetadataStub(name='pod-1')
        stub = CustomObjectStub(metadata=meta)
        self.assertEqual(stub.metadata.name, 'pod-1')

    def test_custom_object_list_stub(self):
        from src.utils.job.kb_methods import (
            CustomObjectListStub, CustomObjectStub, CustomObjectMetadataStub)
        items = [
            CustomObjectStub(metadata=CustomObjectMetadataStub(name='a')),
            CustomObjectStub(metadata=CustomObjectMetadataStub(name='b')),
        ]
        stub = CustomObjectListStub(items=items)
        self.assertEqual(len(stub.items), 2)
        self.assertEqual(stub.items[0].metadata.name, 'a')

    def test_kb_methods_factory_raises_for_none_kind(self):
        from unittest import mock
        from src.utils.job import kb_methods
        spec = backend_job_defs.BackendCleanupSpec(labels={'app': 'test'})
        with self.assertRaises(ValueError):
            kb_methods.kb_methods_factory(mock.MagicMock(), spec)


if __name__ == '__main__':
    unittest.main()
