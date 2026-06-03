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

import json
import unittest
from unittest import mock

import kubernetes.client.exceptions as kb_exceptions  # type: ignore
import urllib3  # type: ignore

from src.utils.job import backend_job_defs, backend_jobs
from src.utils.job.jobs_base import JobStatus


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


class BackendJobExecutionContextAbstractMethodsTest(unittest.TestCase):
    """Cover the no-op `pass` bodies of BackendJobExecutionContext.

    The class is decorated with @abc.abstractmethod but does NOT inherit
    from abc.ABC, so it can be instantiated directly. This is intentional
    — backend worker subclasses provide the real implementations, but the
    bare class is used in places that pass through to a stubbed context.
    """

    def test_each_abstract_method_is_a_passthrough_returning_none(self):
        ctx = backend_jobs.BackendJobExecutionContext()  # type: ignore[abstract]
        self.assertIsNone(ctx.get_kb_client())
        self.assertIsNone(ctx.get_kb_namespace())
        self.assertIsNone(ctx.get_test_runner_namespace())
        self.assertIsNone(ctx.get_test_runner_cronjob_spec_file())
        self.assertIsNone(ctx.send_message(mock.Mock()))


class BackendJobBaseClassMethodsTest(unittest.TestCase):
    """Cover BackendJob.execute and handle_failure no-op bodies."""

    def _label_node(self):
        return backend_jobs.LabelNode.model_construct(
            backend='backend',
            workflow_uuid='wf-1',
            node_name='node-a',
            labels={'foo': 'bar'},
            type='LabelNode', super_type='backend',
            job_id='label-1',
        )

    def test_base_execute_pass_body_returns_none(self):
        # The concrete subclass overrides execute, so we invoke the
        # BackendJob method unbound to exercise the abstract pass body.
        result = backend_jobs.BackendJob.execute(
            self._label_node(), mock.Mock(), mock.Mock())
        self.assertIsNone(result)

    def test_handle_failure_is_a_noop(self):
        # handle_failure has a `pass` body on BackendJob and is not
        # overridden by LabelNode/BackendCreateGroup/etc.
        self.assertIsNone(self._label_node().handle_failure(
            mock.Mock(), 'some-error'))


class BackendWorkflowJobLogLabelsTest(unittest.TestCase):
    """Cover BackendWorkflowJob.log_labels for all three branch states."""

    def _job(self, *, user='', job_id=None):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='backend',
            workflow_uuid='wf-1',
            user=user,
            group_name='g',
            k8s_resources=[],
            backend_k8s_timeout=60,
            type='CreateGroup', super_type='backend',
            job_id=job_id,
        )

    def test_log_labels_workflow_uuid_only(self):
        labels = self._job().log_labels()
        self.assertEqual({'workflow_uuid': 'wf-1'}, labels)

    def test_log_labels_includes_user_when_set(self):
        labels = self._job(user='alice').log_labels()
        self.assertEqual('alice', labels['user_id'])

    def test_log_labels_includes_job_id_when_set(self):
        labels = self._job(user='alice', job_id='j-7').log_labels()
        self.assertEqual('alice', labels['user_id'])
        self.assertEqual('j-7', labels['job_id'])
        self.assertEqual('wf-1', labels['workflow_uuid'])


def _make_api_exception(reason: str, message: str = '') -> kb_exceptions.ApiException:
    """Build an ApiException with a JSON body matching what the K8s API returns."""
    exc = kb_exceptions.ApiException(status=409, reason=reason)
    exc.body = json.dumps({'reason': reason, 'message': message, 'code': 409})
    return exc


class BackendCreateGroupExecuteTest(unittest.TestCase):
    """Coverage for BackendCreateGroup.execute and its error-branch handling.

    The branches that must be exercised:
      - happy path (resource_api.create succeeds)
      - AlreadyExists (idempotent reschedule must NOT raise)
      - Other ApiException (must propagate — wrong reason)
      - urllib3 ProtocolError (transient — return FAILED_RETRY)
    """

    def _resource(self):
        return {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {'name': 'pod-a', 'namespace': ''},
        }

    def _job(self, resources=None):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='backend',
            workflow_uuid='wf-1',
            user='',
            group_name='g',
            k8s_resources=resources if resources is not None else [self._resource()],
            backend_k8s_timeout=42,
            type='CreateGroup', super_type='backend',
            job_id='create-1',
        )

    def _context(self):
        ctx = mock.Mock()
        api = mock.Mock()
        # api.configuration.timeout = ... is assigned on the mock; harmless.
        ctx.get_kb_client.return_value = api
        ctx.get_kb_namespace.return_value = 'osmo-ns'
        return ctx, api

    def test_get_allowed_job_type_returns_create_group(self):
        self.assertEqual(['CreateGroup'],
                         backend_jobs.BackendCreateGroup._get_allowed_job_type())

    def test_execute_creates_each_resource_and_propagates_namespace(self):
        job = self._job()
        ctx, api = self._context()

        resource_api = mock.Mock()
        dyn_client = mock.Mock()
        dyn_client.resources.get.return_value = resource_api

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client) as dyn_cls:
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(JobStatus.SUCCESS, result.status)
        self.assertIsNone(result.message)
        # Timeout pushed onto the API client (line 134).
        self.assertEqual(42, api.configuration.timeout)
        # DynamicClient constructed with the configured api client.
        dyn_cls.assert_called_once_with(api)
        # Namespace mutated onto the resource and passed to create.
        resource_api.create.assert_called_once()
        kwargs = resource_api.create.call_args.kwargs
        self.assertEqual('osmo-ns', kwargs['namespace'])
        self.assertEqual('osmo-ns', kwargs['body']['metadata']['namespace'])

    def test_execute_swallows_already_exists(self):
        """Idempotent reschedule must report success with the AlreadyExists message."""
        job = self._job()
        ctx, _ = self._context()

        resource_api = mock.Mock()
        resource_api.create.side_effect = _make_api_exception('AlreadyExists')
        dyn_client = mock.Mock()
        dyn_client.resources.get.return_value = resource_api

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client):
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(JobStatus.SUCCESS, result.status)
        self.assertEqual('AlreadyExists', result.message)

    def test_execute_propagates_unexpected_api_exception(self):
        """Non-AlreadyExists ApiException must NOT be swallowed."""
        job = self._job()
        ctx, _ = self._context()

        resource_api = mock.Mock()
        resource_api.create.side_effect = _make_api_exception('Forbidden')
        dyn_client = mock.Mock()
        dyn_client.resources.get.return_value = resource_api

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client):
            with self.assertRaises(kb_exceptions.ApiException):
                job.execute(ctx, mock.Mock())

    def test_execute_returns_failed_retry_on_protocol_error(self):
        """Transient connection errors should signal a retry instead of raising."""
        job = self._job()
        ctx, _ = self._context()

        resource_api = mock.Mock()
        resource_api.create.side_effect = urllib3.exceptions.ProtocolError(
            'Connection broken')
        dyn_client = mock.Mock()
        dyn_client.resources.get.return_value = resource_api

        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client):
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(JobStatus.FAILED_RETRY, result.status)
        self.assertIn('Connection error', result.message)
        self.assertIn('pod-a', result.message)


class BackendCleanupGroupGetPodLogsTest(unittest.TestCase):
    """Coverage for BackendCleanupGroup.get_pod_logs.

    Exercises:
      - filtering by failed pods (init-container terminated with non-zero exit)
      - yielding header + decoded log lines + end delimiter
      - ApiException during read_namespaced_pod_log produces a warning yield
      - non-decodable bytes are replaced (errors='replace')
      - None line in the stream terminates the iteration
    """

    def _job(self):
        return backend_jobs.BackendCleanupGroup.model_construct(
            backend='backend',
            workflow_uuid='wf-1',
            group_name='g',
            cleanup_specs=[],
            error_log_spec=None,
            force_delete=False,
            max_log_lines=100,
            type='CleanupGroup', super_type='backend',
            job_id='cleanup-1',
        )

    def _failed_pod(self, *, name='failed-pod', task_uuid='uuid-a',
                    retry_id='2', task_name='task-a'):
        terminated = mock.Mock()
        terminated.exit_code = 1
        bad_status = mock.Mock()
        bad_status.state.terminated = terminated

        pod = mock.Mock()
        pod.metadata.name = name
        pod.metadata.labels = {
            'osmo.task_name': task_name,
            'osmo.task_uuid': task_uuid,
            'osmo.retry_id': retry_id,
        }
        pod.status.container_statuses = []
        pod.status.init_container_statuses = [bad_status]

        init_container = mock.Mock()
        init_container.name = 'init'
        user_container = mock.Mock()
        user_container.name = 'user'
        pod.spec.init_containers = [init_container]
        pod.spec.containers = [user_container]
        return pod

    def _healthy_pod(self):
        pod = mock.Mock()
        pod.status.container_statuses = []
        pod.status.init_container_statuses = []
        return pod

    def test_get_allowed_job_type_returns_cleanup_group(self):
        self.assertEqual(['CleanupGroup'],
                         backend_jobs.BackendCleanupGroup._get_allowed_job_type())

    def test_get_pod_logs_filters_to_failed_pods_and_yields_header_and_lines(self):
        job = self._job()

        v1 = mock.Mock()
        pods = mock.Mock()
        pods.items = [self._failed_pod(), self._healthy_pod()]
        v1.list_namespaced_pod.return_value = pods

        # Stream yields one valid line, one invalid-utf8 line, then None to stop.
        log_stream = mock.Mock()
        log_stream.stream.return_value = iter(
            [b'hello\n', b'\xffbad\n', None])
        v1.read_namespaced_pod_log.return_value = log_stream

        ctx = mock.Mock()
        ctx.get_kb_client.return_value = mock.Mock()
        ctx.get_kb_namespace.return_value = 'osmo-ns'

        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1):
            yielded = list(job.get_pod_logs(
                ctx, 'osmo.task_name=task-a', max_log_lines=100))

        v1.list_namespaced_pod.assert_called_once_with(
            'osmo-ns', label_selector='osmo.task_name=task-a')

        # Two containers (init + user) on the single failed pod.
        headers = [text for text, *_ in yielded if 'Logs for container' in text]
        self.assertEqual(2, len(headers))
        # Each emission carries the failed-pod task_uuid and retry_id.
        for _, task_uuid, retry_id, _mask in yielded:
            self.assertEqual('uuid-a', task_uuid)
            self.assertEqual('2', retry_id)

        # The decoded log line came through with the bad byte replaced.
        log_payloads = [text for text, _, _, mask in yielded if mask]
        self.assertTrue(any('hello' in line for line in log_payloads))
        self.assertTrue(any('�' in line or 'bad' in line
                            for line in log_payloads))

    def test_get_pod_logs_yields_warning_when_log_read_raises_api_exception(self):
        job = self._job()

        v1 = mock.Mock()
        pods = mock.Mock()
        pods.items = [self._failed_pod()]
        v1.list_namespaced_pod.return_value = pods
        v1.read_namespaced_pod_log.side_effect = _make_api_exception(
            'Forbidden', 'no log access')

        ctx = mock.Mock()
        ctx.get_kb_client.return_value = mock.Mock()
        ctx.get_kb_namespace.return_value = 'osmo-ns'

        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1):
            yielded = list(job.get_pod_logs(
                ctx, 'osmo.task_name=task-a', max_log_lines=100))

        # Should produce a header + warning yield for each container, with no
        # masked log lines (since the read raised before streaming).
        warnings = [text for text, _, _, mask in yielded
                    if 'Unable to get logs' in text and not mask]
        self.assertEqual(2, len(warnings))


if __name__ == '__main__':
    unittest.main()
