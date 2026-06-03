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

from src.utils import backend_messages
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


class BackendWorkflowJobLogLabelsTest(unittest.TestCase):
    """Covers BackendWorkflowJob.log_labels — labels propagated for log routing."""

    def _make_job(self, *, workflow_uuid='wf-1', user='', job_id=None):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='default',
            type='CreateGroup',
            super_type='backend',
            job_id=job_id,
            workflow_uuid=workflow_uuid,
            user=user,
            group_name='group-1',
            k8s_resources=[],
            backend_k8s_timeout=60,
            scheduler_settings={},
        )

    def test_log_labels_workflow_uuid_only(self):
        job = self._make_job(workflow_uuid='wf-abc', user='', job_id=None)
        self.assertEqual(job.log_labels(), {'workflow_uuid': 'wf-abc'})

    def test_log_labels_includes_user_when_set(self):
        job = self._make_job(workflow_uuid='wf-abc', user='alice', job_id=None)
        self.assertEqual(
            job.log_labels(),
            {'workflow_uuid': 'wf-abc', 'user_id': 'alice'})

    def test_log_labels_includes_job_id_when_set(self):
        job = self._make_job(workflow_uuid='wf-abc', user='alice', job_id='job-7')
        self.assertEqual(
            job.log_labels(),
            {'workflow_uuid': 'wf-abc', 'user_id': 'alice', 'job_id': 'job-7'})


class BackendCreateGroupExecuteTest(unittest.TestCase):
    """Covers BackendCreateGroup.execute create-resource paths.

    The four observable outcomes:
      - happy path: every resource is created, JobResult is SUCCESS
      - AlreadyExists from K8s: skipped with a warning, JobResult.message='AlreadyExists'
      - other ApiException: re-raised so the worker fails the job
      - urllib3.ProtocolError: short-circuits to FAILED_RETRY
    """

    def _make_job(self, k8s_resources):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='default',
            type='CreateGroup',
            super_type='backend',
            workflow_uuid='wf-1',
            group_name='group-1',
            k8s_resources=k8s_resources,
            backend_k8s_timeout=60,
            scheduler_settings={},
        )

    def _make_context(self):
        api = mock.MagicMock()
        context = mock.MagicMock(spec=backend_jobs.BackendJobExecutionContext)
        context.get_kb_client.return_value = api
        context.get_kb_namespace.return_value = 'osmo-workflows'
        return context, api

    @staticmethod
    def _resource(name='pod-1', kind='Pod', api_version='v1'):
        return {
            'apiVersion': api_version,
            'kind': kind,
            'metadata': {'name': name},
        }

    def test_execute_creates_resources_successfully(self):
        resource = self._resource()
        job = self._make_job([resource])
        context, api = self._make_context()
        progress_writer = mock.MagicMock()

        with mock.patch.object(
                backend_jobs.kb_dynamic, 'DynamicClient') as mock_dyn_cls:
            resource_api = mock.MagicMock()
            mock_dyn_cls.return_value.resources.get.return_value = resource_api

            result = job.execute(context, progress_writer)

        self.assertEqual(result.status, JobStatus.SUCCESS)
        self.assertIsNone(result.message)
        # namespace is injected into the resource dict before create
        self.assertEqual(resource['metadata']['namespace'], 'osmo-workflows')
        resource_api.create.assert_called_once_with(
            namespace='osmo-workflows', body=resource)
        # Configure timeout from job spec
        self.assertEqual(api.configuration.timeout, 60)

    def test_execute_treats_already_exists_as_success_with_message(self):
        resource = self._resource()
        job = self._make_job([resource])
        context, _ = self._make_context()
        progress_writer = mock.MagicMock()

        api_exc = kb_exceptions.ApiException(status=409, reason='Conflict')
        api_exc.body = json.dumps({'reason': 'AlreadyExists'})

        with mock.patch.object(
                backend_jobs.kb_dynamic, 'DynamicClient') as mock_dyn_cls:
            resource_api = mock.MagicMock()
            resource_api.create.side_effect = api_exc
            mock_dyn_cls.return_value.resources.get.return_value = resource_api

            result = job.execute(context, progress_writer)

        self.assertEqual(result.status, JobStatus.SUCCESS)
        self.assertEqual(result.message, 'AlreadyExists')

    def test_execute_reraises_non_already_exists_api_exception(self):
        resource = self._resource()
        job = self._make_job([resource])
        context, _ = self._make_context()
        progress_writer = mock.MagicMock()

        api_exc = kb_exceptions.ApiException(status=403, reason='Forbidden')
        api_exc.body = json.dumps({'reason': 'Forbidden', 'message': 'no perms'})

        with mock.patch.object(
                backend_jobs.kb_dynamic, 'DynamicClient') as mock_dyn_cls:
            resource_api = mock.MagicMock()
            resource_api.create.side_effect = api_exc
            mock_dyn_cls.return_value.resources.get.return_value = resource_api

            with self.assertRaises(kb_exceptions.ApiException):
                job.execute(context, progress_writer)

    def test_execute_returns_failed_retry_on_protocol_error(self):
        resource = self._resource()
        job = self._make_job([resource])
        context, _ = self._make_context()
        progress_writer = mock.MagicMock()

        with mock.patch.object(
                backend_jobs.kb_dynamic, 'DynamicClient') as mock_dyn_cls:
            resource_api = mock.MagicMock()
            resource_api.create.side_effect = urllib3.exceptions.ProtocolError(
                'connection broken')
            mock_dyn_cls.return_value.resources.get.return_value = resource_api

            result = job.execute(context, progress_writer)

        self.assertEqual(result.status, JobStatus.FAILED_RETRY)
        self.assertIsNotNone(result.message)
        self.assertIn('Connection error', result.message)


class BackendCleanupGroupGetPodLogsTest(unittest.TestCase):
    """Covers BackendCleanupGroup.get_pod_logs — failed-pod log streaming.

    Validates the four observable yield shapes:
      - 'Logs for container ...' header before each container
      - decoded log lines while the stream produces bytes
      - 'Warning: Unable to get logs ...' on ApiException from
         read_namespaced_pod_log
      - end_delimiter after each container completes
    """

    def _make_job(self):
        return backend_jobs.BackendCleanupGroup.model_construct(
            backend='default',
            type='CleanupGroup',
            super_type='backend',
            workflow_uuid='wf-1',
            group_name='group-1',
            cleanup_specs=[],
            error_log_spec=None,
            force_delete=False,
            max_log_lines=100,
        )

    @staticmethod
    def _make_status(*, exit_code):
        terminated = mock.MagicMock()
        terminated.exit_code = exit_code
        state = mock.MagicMock()
        state.terminated = terminated
        status = mock.MagicMock()
        status.state = state
        return status

    @staticmethod
    def _make_pod(*, name, container_names, init_container_names,
                  failed=True, labels=None):
        pod = mock.MagicMock()
        pod.metadata.name = name
        pod.metadata.labels = labels or {
            'osmo.task_name': 'task-name',
            'osmo.task_uuid': 'task-uuid-1',
            'osmo.retry_id': '0',
        }
        # Container statuses; one failing terminated status if `failed`
        container_statuses = []
        if failed:
            failing = mock.MagicMock()
            failing.state.terminated.exit_code = 1
            container_statuses.append(failing)
        pod.status.container_statuses = container_statuses
        pod.status.init_container_statuses = []
        # spec.init_containers and spec.containers — used to enumerate logs
        pod.spec.init_containers = [
            mock.MagicMock(name=n) for n in init_container_names]
        for container, n in zip(pod.spec.init_containers, init_container_names):
            container.name = n
        pod.spec.containers = [mock.MagicMock(name=n) for n in container_names]
        for container, n in zip(pod.spec.containers, container_names):
            container.name = n
        return pod

    def _make_context(self, pods):
        api = mock.MagicMock()
        context = mock.MagicMock(spec=backend_jobs.BackendJobExecutionContext)
        context.get_kb_client.return_value = api
        context.get_kb_namespace.return_value = 'ns'
        # The pod list returned by v1_api.list_namespaced_pod
        pod_list = mock.MagicMock()
        pod_list.items = pods
        return context, api, pod_list

    def test_get_pod_logs_yields_header_lines_and_delimiter_for_failed_pod(self):
        pod = self._make_pod(
            name='pod-A', container_names=['main'], init_container_names=[])
        context, _, pod_list = self._make_context([pod])
        log_stream = mock.MagicMock()
        log_stream.stream.return_value = iter([b'line1\n', b'line2\n'])

        job = self._make_job()
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api') as mock_core:
            v1_api = mock_core.return_value
            v1_api.list_namespaced_pod.return_value = pod_list
            v1_api.read_namespaced_pod_log.return_value = log_stream

            results = list(job.get_pod_logs(context, 'app=osmo', max_log_lines=10))

        # Expect: header, log line, log line, end delimiter
        self.assertEqual(len(results), 4)
        header_line, _, _, header_mask = results[0]
        self.assertIn('Logs for container', header_line)
        self.assertFalse(header_mask)
        # decoded lines preserve content
        line_a, _, _, line_mask = results[1]
        self.assertEqual(line_a, 'line1\n')
        self.assertTrue(line_mask)
        # final entry is the dashed delimiter
        delimiter_line, _, _, delim_mask = results[-1]
        self.assertTrue(delimiter_line.startswith('-' * 80))
        self.assertFalse(delim_mask)

    def test_get_pod_logs_skips_pod_with_no_failed_status(self):
        # Pod with no container statuses is not flagged as failed
        pod = self._make_pod(
            name='pod-A', container_names=['main'], init_container_names=[],
            failed=False)
        context, _, pod_list = self._make_context([pod])
        job = self._make_job()
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api') as mock_core:
            v1_api = mock_core.return_value
            v1_api.list_namespaced_pod.return_value = pod_list

            results = list(job.get_pod_logs(context, 'app=osmo', max_log_lines=10))

        self.assertEqual(results, [])
        v1_api.read_namespaced_pod_log.assert_not_called()

    def test_get_pod_logs_handles_api_exception_during_log_read(self):
        pod = self._make_pod(
            name='pod-A', container_names=['main'], init_container_names=[])
        context, _, pod_list = self._make_context([pod])

        api_exc = kb_exceptions.ApiException(status=500, reason='Internal')

        job = self._make_job()
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api') as mock_core:
            v1_api = mock_core.return_value
            v1_api.list_namespaced_pod.return_value = pod_list
            v1_api.read_namespaced_pod_log.side_effect = api_exc

            results = list(job.get_pod_logs(context, 'app=osmo', max_log_lines=10))

        # Header, then warning message — no decoded lines and no delimiter
        # because the function `continue`s before yielding the delimiter.
        self.assertEqual(len(results), 2)
        header_line, _, _, _ = results[0]
        self.assertIn('Logs for container', header_line)
        warning, _, _, mask = results[1]
        self.assertIn('Warning: Unable to get logs', warning)
        self.assertIn('ApiException', warning)
        self.assertFalse(mask)

    def test_get_pod_logs_breaks_on_none_in_stream(self):
        pod = self._make_pod(
            name='pod-A', container_names=['main'], init_container_names=[])
        context, _, pod_list = self._make_context([pod])
        log_stream = mock.MagicMock()
        # First a real bytes line, then None — must terminate iteration
        log_stream.stream.return_value = iter([b'first\n', None, b'never'])

        job = self._make_job()
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api') as mock_core:
            v1_api = mock_core.return_value
            v1_api.list_namespaced_pod.return_value = pod_list
            v1_api.read_namespaced_pod_log.return_value = log_stream

            results = list(job.get_pod_logs(context, 'app=osmo', max_log_lines=10))

        # header + 'first\n' + delimiter, but 'never' must be excluded
        decoded_lines = [r[0] for r in results]
        self.assertIn('first\n', decoded_lines)
        self.assertNotIn('never', decoded_lines)


class BackendCleanupGroupExecuteErrorLogSpecTest(unittest.TestCase):
    """Covers BackendCleanupGroup.execute error_log_spec branch.

    The error_log_spec branch streams pod logs to context.send_message before
    falling through to the cleanup loop. With empty cleanup_specs, only this
    branch executes, exercising the logging side-effect in isolation.
    """

    def test_execute_streams_error_logs_via_send_message(self):
        error_spec = backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='v1', kind='Pod'),
            labels={'app': 'osmo'})
        job = backend_jobs.BackendCleanupGroup.model_construct(
            backend='default',
            type='CleanupGroup',
            super_type='backend',
            workflow_uuid='wf-1',
            group_name='group-1',
            cleanup_specs=[],  # leave the second loop a no-op
            error_log_spec=error_spec,
            force_delete=False,
            max_log_lines=10,
        )
        context = mock.MagicMock(spec=backend_jobs.BackendJobExecutionContext)
        context.get_kb_client.return_value = mock.MagicMock()
        context.get_kb_namespace.return_value = 'ns'

        progress_writer = mock.MagicMock()

        # Drive the loop with two yields and then early-return.
        log_yields = [
            ('header\n', 'task-uuid-1', 0, False),
            ('decoded\n', 'task-uuid-1', 0, True),
        ]
        with mock.patch.object(
                backend_jobs.BackendCleanupGroup, 'get_pod_logs',
                return_value=iter(log_yields)):
            result = job.execute(context, progress_writer)

        self.assertEqual(result.status, JobStatus.SUCCESS)
        # Two log-yields → two send_message invocations of POD_LOG type
        self.assertEqual(context.send_message.call_count, 2)
        for call in context.send_message.call_args_list:
            (message,) = call.args
            self.assertEqual(message.type, backend_messages.MessageType.POD_LOG)
        progress_writer.report_progress.assert_called()


class BackendJobAllowedTypesTest(unittest.TestCase):
    """Covers the `_get_allowed_job_type` classmethods on the concrete jobs."""

    def test_create_group_allows_create_group_only(self):
        self.assertEqual(
            backend_jobs.BackendCreateGroup._get_allowed_job_type(),
            ['CreateGroup'])

    def test_cleanup_group_allows_cleanup_group_only(self):
        self.assertEqual(
            backend_jobs.BackendCleanupGroup._get_allowed_job_type(),
            ['CleanupGroup'])


class BackendJobHandleFailureTest(unittest.TestCase):
    """Covers BackendJob.handle_failure default no-op implementation.

    handle_failure is the failure hook subclasses can override; the base
    class implementation is intentionally a no-op to make overriding optional.
    """

    def test_handle_failure_default_is_no_op(self):
        job = backend_jobs.BackendCreateGroup.model_construct(
            backend='default',
            type='CreateGroup',
            super_type='backend',
            workflow_uuid='wf-1',
            group_name='group-1',
            k8s_resources=[],
            backend_k8s_timeout=60,
            scheduler_settings={},
        )
        context = mock.MagicMock(spec=backend_jobs.BackendJobExecutionContext)
        # Must not raise; returns None
        self.assertIsNone(job.handle_failure(context, 'an error'))


if __name__ == '__main__':
    unittest.main()
