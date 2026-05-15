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

import unittest
from unittest import mock

import kubernetes.client.exceptions as kb_exceptions  # type: ignore

from src.utils.job import backend_job_defs, backend_jobs


class FakeResourceApi:
    def __init__(self):
        self.created = []
        self.deleted = []
        self.create_error = None
        self.delete_error = None

    def create(self, namespace, body):
        if self.create_error:
            raise self.create_error
        self.created.append((namespace, body))

    def delete(self, name, namespace):
        if self.delete_error:
            raise self.delete_error
        self.deleted.append((namespace, name))


class FakeDynamicClient:
    def __init__(self, resource_api):
        self.resource_api = resource_api
        self.resources = self
        self.get_calls = []

    def get(self, api_version, kind):
        self.get_calls.append((api_version, kind))
        return self.resource_api


class RoutingDynamicClient:
    def __init__(self, resources):
        self._resources = resources
        self.resources = self

    def get(self, api_version, kind):
        return self._resources[kind]


class FakeApiClient:
    def __init__(self):
        self.configuration = mock.Mock()


class FakeBackendContext(backend_jobs.BackendJobExecutionContext):
    def __init__(self):
        self.api_client = FakeApiClient()

    def get_kb_client(self):
        return self.api_client

    def get_kb_namespace(self):
        return 'osmo-vpan'

    def get_test_runner_namespace(self):
        return None

    def get_test_runner_cronjob_spec_file(self):
        return None

    def send_message(self, message):
        pass


def api_error(status, reason):
    error = kb_exceptions.ApiException(status=status)
    error.body = f'{{"code": {status}, "reason": "{reason}"}}'
    return error


class OSMOTaskGroupBackendJobTest(unittest.TestCase):
    def test_create_otg_creates_namespaced_resource(self):
        resource_api = FakeResourceApi()
        dyn_client = FakeDynamicClient(resource_api)

        result = backend_jobs.create_otg(
            dyn_client,
            backend_job_defs.BackendOTGSpec(
                namespace='osmo-vpan',
                name='otg-a',
                yaml_text='apiVersion: workflow.osmo.nvidia.com/v1alpha1\n'
                          'kind: OSMOTaskGroup\n'
                          'metadata:\n'
                          '  name: stale\n',
                mode='active',
            ),
        )

        self.assertEqual(result.status, backend_jobs.JobStatus.SUCCESS)
        self.assertEqual(dyn_client.get_calls, [
            ('workflow.osmo.nvidia.com/v1alpha1', 'OSMOTaskGroup'),
        ])
        namespace, body = resource_api.created[0]
        self.assertEqual(namespace, 'osmo-vpan')
        self.assertEqual(body['metadata']['namespace'], 'osmo-vpan')
        self.assertEqual(body['metadata']['name'], 'otg-a')

    def test_create_otg_already_exists_is_success(self):
        resource_api = FakeResourceApi()
        resource_api.create_error = api_error(409, 'AlreadyExists')

        result = backend_jobs.create_otg(
            FakeDynamicClient(resource_api),
            backend_job_defs.BackendOTGSpec(
                namespace='osmo-vpan',
                name='otg-a',
                yaml_text='kind: OSMOTaskGroup\nmetadata: {}\n',
                mode='active',
            ),
        )

        self.assertEqual(result.status, backend_jobs.JobStatus.SUCCESS)
        self.assertEqual(result.message, 'AlreadyExists')

    def test_create_otg_server_error_retries(self):
        resource_api = FakeResourceApi()
        resource_api.create_error = api_error(500, 'InternalError')

        result = backend_jobs.create_otg(
            FakeDynamicClient(resource_api),
            backend_job_defs.BackendOTGSpec(
                namespace='osmo-vpan',
                name='otg-a',
                yaml_text='kind: OSMOTaskGroup\nmetadata: {}\n',
                mode='active',
            ),
        )

        self.assertEqual(result.status, backend_jobs.JobStatus.FAILED_RETRY)

    def test_delete_otg_deletes_namespaced_resource(self):
        resource_api = FakeResourceApi()

        backend_jobs.delete_otg(
            FakeDynamicClient(resource_api),
            backend_job_defs.BackendOTGSpec(namespace='osmo-vpan', name='otg-a'),
            workflow_uuid='workflow-uuid',
        )

        self.assertEqual(resource_api.deleted, [('osmo-vpan', 'otg-a')])

    def test_shadow_otg_failure_continues_legacy_resource_creation(self):
        otg_api = FakeResourceApi()
        otg_api.create_error = api_error(400, 'BadRequest')
        pod_api = FakeResourceApi()
        dyn_client = RoutingDynamicClient({
            'OSMOTaskGroup': otg_api,
            'Pod': pod_api,
        })
        job = backend_jobs.BackendCreateGroup(
            backend='backend-a',
            job_id='workflow-uuid-group-a-submit',
            workflow_uuid='workflow-uuid',
            group_name='group-a',
            k8s_resources=[{
                'apiVersion': 'v1',
                'kind': 'Pod',
                'metadata': {'name': 'pod-a'},
            }],
            otg_create=backend_job_defs.BackendOTGSpec(
                namespace='osmo-vpan',
                name='otg-a',
                yaml_text='kind: OSMOTaskGroup\nmetadata: {}\n',
                mode='shadow',
            ),
        )

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient', return_value=dyn_client):
            result = job.execute(FakeBackendContext(), mock.Mock())

        self.assertEqual(result.status, backend_jobs.JobStatus.SUCCESS)
        self.assertEqual(pod_api.created[0][0], 'osmo-vpan')

    def test_active_otg_failure_fails_without_legacy_resource_creation(self):
        otg_api = FakeResourceApi()
        otg_api.create_error = api_error(400, 'BadRequest')
        pod_api = FakeResourceApi()
        dyn_client = RoutingDynamicClient({
            'OSMOTaskGroup': otg_api,
            'Pod': pod_api,
        })
        job = backend_jobs.BackendCreateGroup(
            backend='backend-a',
            job_id='workflow-uuid-group-a-submit',
            workflow_uuid='workflow-uuid',
            group_name='group-a',
            k8s_resources=[{
                'apiVersion': 'v1',
                'kind': 'Pod',
                'metadata': {'name': 'pod-a'},
            }],
            otg_create=backend_job_defs.BackendOTGSpec(
                namespace='osmo-vpan',
                name='otg-a',
                yaml_text='kind: OSMOTaskGroup\nmetadata: {}\n',
                mode='active',
            ),
        )

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient', return_value=dyn_client):
            result = job.execute(FakeBackendContext(), mock.Mock())

        self.assertEqual(result.status, backend_jobs.JobStatus.FAILED_NO_RETRY)
        self.assertEqual(pod_api.created, [])


class ImmutableTargetAlreadyCurrentTest(unittest.TestCase):
    """Pure unit tests for backend_jobs._immutable_target_already_current.

    Regression guard for the KAI Topology churn fix: BackendSynchronizeQueues
    must skip the delete+recreate when an immutable CRD's spec is unchanged.
    """

    def _topology(self, *, levels=None, labels=None,
                  api_version='kai.scheduler/v1alpha1', kind='Topology'):
        """Build a minimal Topology-shaped dict for comparison tests."""
        return {
            'apiVersion': api_version,
            'kind': kind,
            'metadata': {
                'name': 'osmo-pool-osmo-workflows-default-topology',
                'labels': labels or {'osmo.namespace': 'osmo-workflows'},
            },
            'spec': {'topologyKeys': levels or ['zone', 'rack', 'hostname']},
        }

    def test_identical_specs_match(self):
        target = self._topology()
        existing = self._topology()
        self.assertTrue(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_existing_with_extra_server_metadata_still_matches(self):
        """existing carries server-set fields that target doesn't — should match."""
        target = self._topology()
        existing = self._topology()
        existing['metadata'].update({
            'resourceVersion': '12345',
            'uid': 'abc-def',
            'creationTimestamp': '2026-05-01T00:00:00Z',
            'generation': 1,
            'managedFields': [{'manager': 'kai'}],
            'selfLink': '/apis/...',
        })
        existing['status'] = {'phase': 'Ready'}
        self.assertTrue(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_differing_spec_does_not_match(self):
        target = self._topology(levels=['zone', 'rack'])
        existing = self._topology(levels=['zone', 'rack', 'hostname'])
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_differing_topology_key_order_does_not_match(self):
        """Topology level order is semantically meaningful (coarse -> fine)."""
        target = self._topology(levels=['zone', 'rack', 'hostname'])
        existing = self._topology(levels=['hostname', 'rack', 'zone'])
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_target_label_subset_of_existing_matches(self):
        """Existing may carry extra labels (operator-added); target subset is fine."""
        target = self._topology(labels={'osmo.namespace': 'osmo-workflows'})
        existing = self._topology(
            labels={'osmo.namespace': 'osmo-workflows',
                    'kai.scheduler/managed': 'true'})
        self.assertTrue(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_target_label_missing_in_existing_does_not_match(self):
        target = self._topology(
            labels={'osmo.namespace': 'osmo-workflows', 'env': 'prod'})
        existing = self._topology(labels={'osmo.namespace': 'osmo-workflows'})
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_target_label_value_differs_does_not_match(self):
        target = self._topology(labels={'osmo.namespace': 'osmo-workflows'})
        existing = self._topology(labels={'osmo.namespace': 'osmo-other'})
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_api_version_bump_does_not_match(self):
        """Hedge against scheduling.run.ai/v2 -> v3 mid-deploy: must recreate."""
        target = self._topology(api_version='kai.scheduler/v1beta1')
        existing = self._topology(api_version='kai.scheduler/v1alpha1')
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_kind_mismatch_does_not_match(self):
        target = self._topology(kind='Topology')
        existing = self._topology(kind='Queue')
        self.assertFalse(
            backend_jobs._immutable_target_already_current(target, existing))

    def test_missing_metadata_labels_treated_as_empty(self):
        """A target with no labels declared matches any existing."""
        target = self._topology()
        target['metadata'].pop('labels')
        existing = self._topology()
        self.assertTrue(
            backend_jobs._immutable_target_already_current(target, existing))


class SyncObjectsForSpecImmutableShortCircuitTest(unittest.TestCase):
    """Regression guard for BackendSynchronizeQueues._sync_objects_for_spec.

    The two scenarios that matter for the KAI Topology churn fix:
      - existing object's spec matches target -> do NOT delete+recreate
      - existing object's spec differs        -> DO delete+recreate
    """

    def _make_job(self, k8s_resources):
        """Construct a BackendSynchronizeQueues without going through pydantic
        full validation — fields exercised by _sync_objects_for_spec only."""
        job = backend_jobs.BackendSynchronizeQueues.model_construct(
            backend='default',
            type='BackendSynchronizeQueues',
            super_type='backend',
            k8s_resources=k8s_resources,
            cleanup_specs=[],
            immutable_kinds=['Topology'],
        )
        return job

    def _topology(self, levels):
        return {
            'apiVersion': 'kai.scheduler/v1alpha1',
            'kind': 'Topology',
            'metadata': {
                'name': 'osmo-pool-osmo-workflows-default-topology',
                'labels': {'osmo.namespace': 'osmo-workflows'},
            },
            'spec': {'topologyKeys': levels},
        }

    def _cleanup_spec(self):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='kai.scheduler/v1alpha1', kind='Topology'),
            labels={'osmo.namespace': 'osmo-workflows'})

    def test_unchanged_immutable_target_is_not_deleted(self):
        target = self._topology(levels=['zone', 'rack', 'hostname'])
        existing = self._topology(levels=['zone', 'rack', 'hostname'])
        # existing carries server-managed fields that the helper must ignore
        existing['metadata']['resourceVersion'] = '99'

        job = self._make_job([target])
        with mock.patch.object(job, '_get_objects', return_value=[existing]), \
             mock.patch.object(job, '_delete_object') as mock_delete, \
             mock.patch.object(job, '_apply_object') as mock_apply:
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec())

        mock_delete.assert_not_called()
        mock_apply.assert_not_called()

    def test_changed_immutable_target_triggers_recreate(self):
        target = self._topology(levels=['zone', 'rack', 'hostname'])
        existing = self._topology(levels=['hostname'])  # stale shape

        job = self._make_job([target])
        with mock.patch.object(job, '_get_objects', return_value=[existing]), \
             mock.patch.object(job, '_delete_object') as mock_delete, \
             mock.patch.object(job, '_apply_object') as mock_apply:
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec())

        mock_delete.assert_called_once()
        mock_apply.assert_called_once()


if __name__ == '__main__':
    unittest.main()
