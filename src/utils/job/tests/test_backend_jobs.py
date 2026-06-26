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
# pylint: disable=protected-access
import json
import unittest
from unittest import mock

import kubernetes.client.exceptions as kb_exceptions  # type: ignore
import kubernetes.dynamic.exceptions as kb_dynamic_exceptions  # type: ignore
import urllib3  # type: ignore

from src.lib.utils import osmo_errors
from src.utils import backend_messages
from src.utils.job import backend_job_defs, backend_jobs, jobs_base


def _make_api_exception(body_dict):
    """Builds a kubernetes ApiException whose .body is a JSON string."""
    err = kb_exceptions.ApiException(status=body_dict.get('code', 0))
    err.body = json.dumps(body_dict)
    return err


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

    def _make_job(self, k8s_resources, immutable_kinds=None):
        """Construct a BackendSynchronizeQueues without going through pydantic
        full validation — fields exercised by _sync_objects_for_spec only."""
        job = backend_jobs.BackendSynchronizeQueues.model_construct(
            backend='default',
            type='BackendSynchronizeQueues',
            super_type='backend',
            k8s_resources=k8s_resources,
            cleanup_specs=[],
            immutable_kinds=(['Topology'] if immutable_kinds is None
                             else immutable_kinds),
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

    def _cleanup_spec(self, kind='Topology'):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='kai.scheduler/v1alpha1', kind=kind),
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

    def test_mutable_existing_object_is_replaced_with_resource_version(self):
        """Non-immutable kinds use the update path: replace with resourceVersion."""
        queue = {
            'apiVersion': 'kai.scheduler/v1alpha1',
            'kind': 'Queue',
            'metadata': {'name': 'q1', 'labels': {'osmo.namespace': 'osmo-workflows'}},
            'spec': {'priority': 100},
        }
        existing = {
            'apiVersion': 'kai.scheduler/v1alpha1',
            'kind': 'Queue',
            'metadata': {
                'name': 'q1', 'labels': {'osmo.namespace': 'osmo-workflows'},
                'resourceVersion': '42',
            },
            'spec': {'priority': 50},
        }
        job = self._make_job([queue], immutable_kinds=[])
        with mock.patch.object(job, '_get_objects', return_value=[existing]), \
             mock.patch.object(job, '_apply_object') as mock_apply, \
             mock.patch.object(job, '_delete_object') as mock_delete:
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec(kind='Queue'))
        mock_delete.assert_not_called()
        mock_apply.assert_called_once()
        # resource_version arg is the third positional / kwarg -> '42'
        args, kwargs = mock_apply.call_args
        # Helper accepts (context, cleanup_spec, obj, resource_version)
        passed_rv = args[3] if len(args) > 3 else kwargs.get('resource_version')
        self.assertEqual(passed_rv, '42')

    def test_target_object_not_in_existing_is_created(self):
        queue = {
            'apiVersion': 'kai.scheduler/v1alpha1',
            'kind': 'Queue',
            'metadata': {'name': 'q-new',
                         'labels': {'osmo.namespace': 'osmo-workflows'}},
            'spec': {'priority': 1},
        }
        job = self._make_job([queue], immutable_kinds=[])
        with mock.patch.object(job, '_get_objects', return_value=[]), \
             mock.patch.object(job, '_apply_object') as mock_apply, \
             mock.patch.object(job, '_delete_object') as mock_delete:
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec(kind='Queue'))
        mock_apply.assert_called_once()
        mock_delete.assert_not_called()

    def test_orphaned_existing_object_is_deleted(self):
        """An existing object not in the target list is treated as orphan."""
        existing = {
            'apiVersion': 'kai.scheduler/v1alpha1',
            'kind': 'Queue',
            'metadata': {'name': 'q-old', 'resourceVersion': '1'},
            'spec': {'priority': 1},
        }
        job = self._make_job([], immutable_kinds=[])
        with mock.patch.object(job, '_get_objects', return_value=[existing]), \
             mock.patch.object(job, '_apply_object') as mock_apply, \
             mock.patch.object(job, '_delete_object') as mock_delete:
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec(kind='Queue'))
        mock_delete.assert_called_once()
        mock_apply.assert_not_called()

    def test_resource_not_found_skips_sync_quietly(self):
        """If the CRD is missing on the backend, skip without raising."""
        job = self._make_job([self._topology(levels=['zone'])])
        not_found = kb_dynamic_exceptions.ResourceNotFoundError('missing')
        with mock.patch.object(job, '_get_objects', side_effect=not_found), \
             mock.patch.object(job, '_apply_object') as mock_apply, \
             mock.patch.object(job, '_delete_object') as mock_delete:
            # Must not raise.
            job._sync_objects_for_spec(mock.Mock(), self._cleanup_spec())
        mock_apply.assert_not_called()
        mock_delete.assert_not_called()


class BackendSynchronizeBackendTestSelectorTest(unittest.TestCase):
    """Regression guard: backend test sync must only list this backend's resources."""

    def _make_job(self):
        return backend_jobs.BackendSynchronizeBackendTest.model_construct(
            backend='backend-a',
            job_type='BackendSynchronizeBackendTest',
            super_type='backend',
            job_id='backend-a-sync-tests-test',
            test_configs={},
            node_condition_prefix='example.com/',
        )

    def test_get_cronjobs_filters_by_backend(self):
        job = self._make_job()
        ctx = _FakeContext(test_runner_namespace='test-ns')
        batch_api = mock.MagicMock()
        batch_api.list_namespaced_cron_job.return_value.items = []
        with mock.patch.object(
            backend_jobs.kb_client, 'BatchV1Api', return_value=batch_api,
        ):
            self.assertEqual(job._get_cronjobs(ctx), [])

        batch_api.list_namespaced_cron_job.assert_called_once_with(
            'test-ns',
            label_selector=(
                'example.com/component=backend-test,'
                'example.com/backend=backend-a'
            ))

    def test_get_configmaps_filters_by_backend(self):
        job = self._make_job()
        ctx = _FakeContext(test_runner_namespace='test-ns')
        core_api = mock.MagicMock()
        core_api.list_namespaced_config_map.return_value.items = []
        with mock.patch.object(
            backend_jobs.kb_client, 'CoreV1Api', return_value=core_api,
        ):
            self.assertEqual(job._get_configmaps(ctx), [])

        core_api.list_namespaced_config_map.assert_called_once_with(
            'test-ns',
            label_selector=(
                'example.com/component=backend-test-config,'
                'example.com/backend=backend-a'
            ))


class BackendJobAbstractAndDefaultsTest(unittest.TestCase):
    """Cover abstract method bodies (pass statements) and default helpers."""

    def test_execution_context_abstract_methods_pass(self):
        """The class doesn't extend ABC, so we can call each abstract body."""
        # mypy flags this as abstract due to @abc.abstractmethod, but at
        # runtime BackendJobExecutionContext does not use ABCMeta so we can
        # still instantiate it and exercise each abstract body (which is a
        # bare `pass` returning None).
        ctx = backend_jobs.BackendJobExecutionContext()  # type: ignore[abstract]
        self.assertIsNone(ctx.get_kb_client())
        self.assertIsNone(ctx.get_kb_namespace())
        self.assertIsNone(ctx.get_test_runner_namespace())
        self.assertIsNone(ctx.get_test_runner_cronjob_spec_file())
        self.assertIsNone(ctx.send_message(mock.Mock()))

    def test_backend_job_execute_and_handle_failure_pass_through(self):
        """BackendJob.execute / handle_failure default bodies are pass."""
        # LabelNode is the simplest concrete BackendJob; reuse it to invoke
        # the inherited (default) handle_failure body.
        node_job = backend_jobs.LabelNode.model_construct(
            backend='back', workflow_uuid='wfid', node_name='n1',
            labels={'a': 'b'},
            job_type='LabelNode', super_type='backend',
            job_id='n1-x-labelnode')
        # Default handle_failure is `pass`; should return None without error.
        self.assertIsNone(node_job.handle_failure(mock.Mock(), 'err'))

    def test_get_redis_options_uses_backend_transport(self):
        node_job = backend_jobs.LabelNode.model_construct(
            backend='back-x', workflow_uuid='wfid', node_name='n1',
            labels={'a': 'b'},
            job_type='LabelNode', super_type='backend',
            job_id='n1-x-labelnode')
        with mock.patch.object(backend_jobs.connectors,
                               'get_backend_transport_option',
                               return_value='opt-q') as mock_opts:
            exchange, jobs_list, options = node_job.get_redis_options()
        self.assertEqual(options, 'opt-q')
        self.assertIs(exchange, backend_jobs.connectors.EXCHANGE)
        self.assertIs(jobs_list, backend_jobs.connectors.BACKEND_JOBS)
        mock_opts.assert_called_once_with('back-x')


class BackendWorkflowJobLogLabelsTest(unittest.TestCase):
    """Regression guard for BackendWorkflowJob.log_labels (lines 105-110)."""

    def _make(self, *, user='alice', job_id='n1-x-labelnode'):
        return backend_jobs.LabelNode.model_construct(
            backend='back',
            workflow_uuid='wf-uuid',
            user=user,
            node_name='n1',
            labels={'k': 'v'},
            job_type='LabelNode',
            super_type='backend',
            job_id=job_id,
        )

    def test_log_labels_includes_workflow_uuid(self):
        labels = self._make().log_labels()
        self.assertEqual(labels['workflow_uuid'], 'wf-uuid')
        self.assertEqual(labels['user_id'], 'alice')
        self.assertEqual(labels['job_id'], 'n1-x-labelnode')

    def test_log_labels_omits_user_when_blank(self):
        labels = self._make(user='').log_labels()
        self.assertNotIn('user_id', labels)

    def test_log_labels_omits_job_id_when_none(self):
        labels = self._make(job_id=None).log_labels()
        self.assertNotIn('job_id', labels)


class _FakeContext:
    """Minimal BackendJobExecutionContext for tests."""

    def __init__(self, *, api_client=None, namespace='ns',
                 test_runner_namespace=None, cronjob_spec_file=None):
        self._api = api_client or mock.MagicMock()
        self._ns = namespace
        self._tr_ns = test_runner_namespace
        self._cj_spec = cronjob_spec_file
        self.sent_messages = []

    def get_kb_client(self):
        return self._api

    def get_kb_namespace(self):
        return self._ns

    def get_test_runner_namespace(self):
        return self._tr_ns

    def get_test_runner_cronjob_spec_file(self):
        return self._cj_spec

    def send_message(self, message):
        self.sent_messages.append(message)


class BackendCreateGroupExecuteTest(unittest.TestCase):
    """Cover BackendCreateGroup.execute branches + _get_allowed_job_type."""

    def _resource(self):
        return {
            'apiVersion': 'v1',
            'kind': 'Pod',
            'metadata': {'name': 'p1'},
            'spec': {},
        }

    def _make(self, resources=None, backend_k8s_timeout=60):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='back',
            workflow_uuid='wf-uuid',
            user='alice',
            group_name='g1',
            k8s_resources=resources if resources is not None else [self._resource()],
            backend_k8s_timeout=backend_k8s_timeout,
            scheduler_settings={},
            job_type='CreateGroup', super_type='backend',
            job_id='wf-uuid-g1-submit',
        )

    def test_get_allowed_job_type_is_create_group(self):
        self.assertEqual(
            backend_jobs.BackendCreateGroup._get_allowed_job_type(),
            ['CreateGroup'])

    def test_execute_creates_each_resource(self):
        job = self._make()
        api_client = mock.MagicMock()
        ctx = _FakeContext(api_client=api_client, namespace='ns-x')
        progress_writer = mock.Mock()

        resource_api = mock.Mock()
        dyn_client_inst = mock.Mock()
        dyn_client_inst.resources.get.return_value = resource_api
        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client_inst):
            result = job.execute(ctx, progress_writer)

        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)
        # Resource should have its namespace patched in.
        self.assertEqual(job.k8s_resources[0]['metadata']['namespace'], 'ns-x')
        resource_api.create.assert_called_once()
        # API timeout was set from backend_k8s_timeout.
        self.assertEqual(api_client.configuration.timeout, 60)

    def test_execute_swallows_already_exists_error(self):
        job = self._make()
        api_client = mock.MagicMock()
        ctx = _FakeContext(api_client=api_client)

        resource_api = mock.Mock()
        already = _make_api_exception({'reason': 'AlreadyExists', 'code': 409})
        resource_api.create.side_effect = already
        dyn_client_inst = mock.Mock()
        dyn_client_inst.resources.get.return_value = resource_api
        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client_inst):
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)
        self.assertEqual(result.message, 'AlreadyExists')

    def test_execute_reraises_unexpected_api_exception(self):
        job = self._make()
        ctx = _FakeContext(api_client=mock.MagicMock())

        resource_api = mock.Mock()
        # 'reason' missing, message present -> not 'AlreadyExists' branch
        unexpected = _make_api_exception({'message': 'Forbidden', 'code': 403})
        resource_api.create.side_effect = unexpected
        dyn_client_inst = mock.Mock()
        dyn_client_inst.resources.get.return_value = resource_api
        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client_inst):
            with self.assertRaises(kb_exceptions.ApiException):
                job.execute(ctx, mock.Mock())

    def test_execute_returns_failed_retry_on_protocol_error(self):
        job = self._make()
        ctx = _FakeContext(api_client=mock.MagicMock())

        resource_api = mock.Mock()
        resource_api.create.side_effect = urllib3.exceptions.ProtocolError(
            'connection lost')
        dyn_client_inst = mock.Mock()
        dyn_client_inst.resources.get.return_value = resource_api
        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_client_inst):
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)
        self.assertIn('Connection error', result.message)


def _make_pod(name='p1', failed=True, init_failed=False, labels=None,
              containers=('c1',), init_containers=()):
    """Build a minimal kubernetes V1Pod-shaped Mock."""
    pod = mock.Mock()
    pod.metadata = mock.Mock()
    pod.metadata.name = name
    pod.metadata.labels = labels if labels is not None else {
        'osmo.task_name': 't1',
        'osmo.task_uuid': 'tu1',
        'osmo.retry_id': 5,
    }

    def _status(exit_code):
        s = mock.Mock()
        s.state = mock.Mock()
        s.state.terminated = mock.Mock(exit_code=exit_code) if exit_code is not None else None
        return s

    pod.status = mock.Mock()
    if failed:
        pod.status.container_statuses = [_status(1)]
    else:
        pod.status.container_statuses = [_status(0)]
    pod.status.init_container_statuses = (
        [_status(1)] if init_failed else None
    )

    pod.spec = mock.Mock()
    pod.spec.containers = [mock.Mock(name=c) for c in containers]
    for container, name_ in zip(pod.spec.containers, containers):
        container.name = name_
    pod.spec.init_containers = [mock.Mock(name=c) for c in init_containers]
    for container, name_ in zip(pod.spec.init_containers, init_containers):
        container.name = name_
    return pod


class GetPodLogsTest(unittest.TestCase):
    """Cover BackendCleanupGroup.get_pod_logs (lines 178, 182-223)."""

    def _make(self, max_log_lines=100, error_log_spec=None):
        return backend_jobs.BackendCleanupGroup.model_construct(
            backend='back',
            workflow_uuid='wf-uuid',
            user='alice',
            group_name='g1',
            cleanup_specs=[],
            error_log_spec=error_log_spec,
            force_delete=False,
            max_log_lines=max_log_lines,
            job_type='CleanupGroup', super_type='backend',
            job_id='wf-uuid-g1-backend-cleanup',
        )

    def test_skips_pods_with_zero_exit_codes(self):
        job = self._make()
        ctx = _FakeContext()
        good_pod = _make_pod(name='good', failed=False)
        pods_resp = mock.Mock()
        pods_resp.items = [good_pod]
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = pods_resp
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            output = list(job.get_pod_logs(ctx, 'osmo.foo=bar', 100))
        self.assertEqual(output, [])

    def test_failed_pod_streams_logs_with_end_delimiter(self):
        job = self._make()
        ctx = _FakeContext()
        bad_pod = _make_pod(name='bad', failed=True, containers=('c1',))
        pods_resp = mock.Mock()
        pods_resp.items = [bad_pod]
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = pods_resp

        log_stream = mock.Mock()

        def stream_iter():
            yield b'line1\n'
            yield b'line2\n'
            yield None  # triggers the early break path
        log_stream.stream.return_value = stream_iter()
        v1_api.read_namespaced_pod_log.return_value = log_stream

        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            output = list(job.get_pod_logs(ctx, 'osmo.foo=bar', 100))

        # Header + 2 streamed lines + end delimiter
        kinds = [item[0] for item in output]
        self.assertTrue(kinds[0].startswith('Logs for container'))
        self.assertEqual(kinds[1], 'line1\n')
        self.assertEqual(kinds[2], 'line2\n')
        self.assertTrue(kinds[3].startswith('-'))
        # Mask flag is True for streamed lines, False for header/delimiter
        self.assertFalse(output[0][3])
        self.assertTrue(output[1][3])
        self.assertFalse(output[3][3])

    def test_log_read_api_exception_yields_warning_and_continues(self):
        job = self._make()
        ctx = _FakeContext()
        bad_pod = _make_pod(name='bad', containers=('c1',))
        pods_resp = mock.Mock()
        pods_resp.items = [bad_pod]
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = pods_resp
        v1_api.read_namespaced_pod_log.side_effect = _make_api_exception(
            {'message': 'forbidden', 'code': 403})

        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            output = list(job.get_pod_logs(ctx, 'sel', 50))

        # Should produce header + warning yield (no end delimiter — `continue` skips it)
        self.assertEqual(len(output), 2)
        self.assertTrue(output[0][0].startswith('Logs for container'))
        self.assertIn('Warning: Unable to get logs', output[1][0])

    def test_failed_init_container_status_marks_pod_failed(self):
        """is_failed_pod must consider init_container_statuses too."""
        job = self._make()
        ctx = _FakeContext()
        # container_statuses healthy, init_container_statuses failed
        pod = _make_pod(name='p1', failed=False, init_failed=True,
                        init_containers=('init-1',), containers=('c1',))
        pods_resp = mock.Mock()
        pods_resp.items = [pod]
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = pods_resp

        # Fresh log stream per call, otherwise the first iter() exhausts.
        def make_log_stream(*_args, **_kwargs):
            stream = mock.Mock()
            stream.stream.return_value = iter([b'x\n'])
            return stream
        v1_api.read_namespaced_pod_log.side_effect = make_log_stream

        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            output = list(job.get_pod_logs(ctx, 'sel', 10))

        # Should have iterated over init + main containers (2 containers).
        # Each container yields header + line + delimiter = 3 entries.
        self.assertEqual(len(output), 6)


class CleanupGroupExecuteTest(unittest.TestCase):
    """Cover BackendCleanupGroup.execute branches (lines 225-347)."""

    def _spec(self, kind='Pod'):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='v1', kind=kind),
            labels={'osmo.namespace': 'ns'})

    def _make(self, *, cleanup_specs=None, error_log_spec=None,
              force_delete=False, max_log_lines=100):
        return backend_jobs.BackendCleanupGroup.model_construct(
            backend='back',
            workflow_uuid='wf-uuid',
            user='alice',
            group_name='g1',
            cleanup_specs=cleanup_specs if cleanup_specs is not None else [self._spec()],
            error_log_spec=error_log_spec,
            force_delete=force_delete,
            max_log_lines=max_log_lines,
            job_type='CleanupGroup', super_type='backend',
            job_id='wf-uuid-g1-backend-cleanup',
        )

    def test_get_allowed_job_type_is_cleanup_group(self):
        self.assertEqual(
            backend_jobs.BackendCleanupGroup._get_allowed_job_type(),
            ['CleanupGroup'])

    def test_execute_with_error_log_spec_emits_pod_log_messages(self):
        job = self._make(error_log_spec=self._spec(),
                         cleanup_specs=[self._spec(kind='Pod')])
        ctx = _FakeContext()

        # Stub get_pod_logs to yield a single log line.
        def fake_logs(*_args, **_kwargs):
            yield 'line\n', 'tu1', 0, True

        # Stub kb_methods.kb_methods_factory so we don't touch DynamicClient.
        methods = mock.Mock()
        list_resp = mock.Mock()
        list_resp.items = []
        methods.list_resource.return_value = list_resp

        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'get_pod_logs',
                               side_effect=fake_logs), \
             mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(ctx, mock.Mock())

        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)
        # 1 POD_LOG message + 2 LOGGING messages (before / after for Pod kind)
        types = [m.type for m in ctx.sent_messages]
        self.assertIn(backend_messages.MessageType.POD_LOG, types)
        self.assertEqual(types.count(backend_messages.MessageType.LOGGING), 2)

    def test_execute_force_delete_builds_v1_delete_options(self):
        job = self._make(force_delete=True,
                         cleanup_specs=[self._spec(kind='Pod')])
        methods = mock.Mock()
        list_resp = mock.Mock()
        list_resp.items = []
        methods.list_resource.return_value = list_resp
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(_FakeContext(), mock.Mock())
        # delete_resource shouldn't fire (no items), but the path that builds
        # V1DeleteOptions must run.
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)

    def test_execute_max_retry_error_during_list_returns_failed_retry(self):
        job = self._make(cleanup_specs=[self._spec(kind='ConfigMap')])
        methods = mock.Mock()
        methods.list_resource.side_effect = urllib3.exceptions.MaxRetryError(
            mock.Mock(), 'http://x', Exception('down'))
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)
        assert result.message is not None
        self.assertIn('Listing resource type ConfigMap', result.message)

    def test_execute_api_exception_during_list_returns_failed_retry(self):
        job = self._make(cleanup_specs=[self._spec(kind='ConfigMap')])
        methods = mock.Mock()
        methods.list_resource.side_effect = _make_api_exception(
            {'message': 'denied', 'code': 403})
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)

    def test_execute_delete_404_swallowed(self):
        job = self._make(cleanup_specs=[self._spec(kind='Pod')])
        methods = mock.Mock()
        item = mock.Mock()
        item.metadata = mock.Mock()
        item.metadata.name = 'p1'
        # First list succeeds with one item, second list (after delete) is empty.
        list_resp_with_item = mock.Mock(items=[item])
        empty_list = mock.Mock(items=[])
        methods.list_resource.side_effect = [list_resp_with_item, empty_list]
        methods.delete_resource.side_effect = _make_api_exception(
            {'code': 404, 'message': 'not found'})
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(_FakeContext(), mock.Mock())
        # 404 is benign -> SUCCESS.
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)

    def test_execute_delete_5xx_marks_for_retry(self):
        job = self._make(cleanup_specs=[self._spec(kind='Pod')])
        methods = mock.Mock()
        item = mock.Mock()
        item.metadata = mock.Mock()
        item.metadata.name = 'p1'
        list_resp_with_item = mock.Mock(items=[item])
        empty_list = mock.Mock(items=[])
        methods.list_resource.side_effect = [list_resp_with_item, empty_list]
        methods.delete_resource.side_effect = _make_api_exception(
            {'code': 503, 'message': 'unavailable'})
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)

    def test_execute_delete_4xx_other_reraises(self):
        job = self._make(cleanup_specs=[self._spec(kind='Pod')])
        methods = mock.Mock()
        item = mock.Mock()
        item.metadata = mock.Mock()
        item.metadata.name = 'p1'
        methods.list_resource.return_value = mock.Mock(items=[item])
        methods.delete_resource.side_effect = _make_api_exception(
            {'code': 403, 'message': 'forbidden'})
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            with self.assertRaises(kb_exceptions.ApiException):
                job.execute(_FakeContext(), mock.Mock())

    def test_execute_post_delete_list_error_is_logged_in_message(self):
        """If the final list (Pod kind) raises, error string is captured."""
        job = self._make(cleanup_specs=[self._spec(kind='Pod')])
        methods = mock.Mock()
        # First list ok, second list (after delete) raises.
        methods.list_resource.side_effect = [
            mock.Mock(items=[]),
            kb_exceptions.ApiException(reason='down'),
        ]
        ctx = _FakeContext()
        with mock.patch.object(backend_jobs.kb_methods, 'kb_methods_factory',
                               return_value=methods):
            job.execute(ctx, mock.Mock())
        # The "after deletion" LOGGING message should mention the error.
        after_msgs = [
            m for m in ctx.sent_messages
            if m.type == backend_messages.MessageType.LOGGING
            and 'after deletion' in m.body.text
        ]
        self.assertEqual(len(after_msgs), 1)
        self.assertIn('Error', after_msgs[0].body.text)


class RescheduleTaskTest(unittest.TestCase):
    """Cover BackendRescheduleTask paths (lines 359, 363-376, 386-413)."""

    def _spec(self, labels=None):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='v1', kind='Pod'),
            labels=labels or {'osmo.task_uuid': 'tu1', 'osmo.retry_id': '0'})

    def _cleanup(self, error_log_spec=None):
        return backend_jobs.BackendCleanupGroup.model_construct(
            backend='back', workflow_uuid='wf-uuid', user='alice',
            group_name='g1',
            cleanup_specs=[self._spec()],
            error_log_spec=error_log_spec,
            force_delete=False, max_log_lines=10,
            job_type='CleanupGroup', super_type='backend',
            job_id='wf-uuid-g1-backend-cleanup')

    def _create(self):
        return backend_jobs.BackendCreateGroup.model_construct(
            backend='back', workflow_uuid='wf-uuid', user='alice',
            group_name='g1',
            k8s_resources=[],
            backend_k8s_timeout=60,
            scheduler_settings={},
            job_type='CreateGroup', super_type='backend',
            job_id='wf-uuid-g1-submit')

    def _make(self, *, retry_id=1, error_log_spec=None):
        return backend_jobs.BackendRescheduleTask.model_construct(
            backend='back', workflow_uuid='wf-uuid', user='alice',
            retry_id=retry_id,
            create_job=self._create(),
            cleanup_job=self._cleanup(error_log_spec=error_log_spec),
            job_type='RescheduleTask', super_type='backend',
            job_id='wf-uuid-g1-reschedule')

    def test_get_allowed_job_type_is_reschedule(self):
        self.assertEqual(
            backend_jobs.BackendRescheduleTask._get_allowed_job_type(),
            ['RescheduleTask'])

    def test_list_pod_retry_id_returns_none_when_no_error_log_spec(self):
        rt = self._make(error_log_spec=None)
        self.assertIsNone(rt._list_pod_retry_id(_FakeContext()))

    def test_list_pod_retry_id_returns_int_from_existing_pod(self):
        rt = self._make(error_log_spec=self._spec(
            labels={'osmo.task_uuid': 'tu1', 'osmo.retry_id': '7'}))
        pod = mock.Mock()
        pod.metadata = mock.Mock(labels={'osmo.retry_id': '9'})
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = mock.Mock(items=[pod])
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            value = rt._list_pod_retry_id(_FakeContext())
        self.assertEqual(value, 9)

    def test_list_pod_retry_id_returns_none_when_no_pods(self):
        rt = self._make(error_log_spec=self._spec())
        v1_api = mock.Mock()
        v1_api.list_namespaced_pod.return_value = mock.Mock(items=[])
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            value = rt._list_pod_retry_id(_FakeContext())
        self.assertIsNone(value)

    def test_execute_returns_early_when_cleanup_fails(self):
        rt = self._make(error_log_spec=self._spec())
        cleanup_failure = jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_RETRY, message='nope')
        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'execute',
                               return_value=cleanup_failure), \
             mock.patch.object(backend_jobs.BackendCreateGroup, 'execute') \
                 as mock_create, \
             mock.patch.object(backend_jobs.time, 'sleep'):
            result = rt.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)
        mock_create.assert_not_called()

    def test_execute_returns_create_failure_directly(self):
        rt = self._make(error_log_spec=self._spec())
        ok = jobs_base.JobResult()
        create_failure = jobs_base.JobResult(
            status=jobs_base.JobStatus.FAILED_NO_RETRY, message='boom')
        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'execute',
                               return_value=ok), \
             mock.patch.object(backend_jobs.BackendCreateGroup, 'execute',
                               return_value=create_failure), \
             mock.patch.object(backend_jobs.time, 'sleep'):
            result = rt.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_NO_RETRY)

    def test_execute_returns_success_on_already_exists_with_newer_pod(self):
        """If a newer pod is observed, treat AlreadyExists as success."""
        rt = self._make(retry_id=2, error_log_spec=self._spec())
        ok = jobs_base.JobResult()
        already = jobs_base.JobResult(message='AlreadyExists')
        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'execute',
                               return_value=ok), \
             mock.patch.object(backend_jobs.BackendCreateGroup, 'execute',
                               return_value=already), \
             mock.patch.object(backend_jobs.BackendRescheduleTask,
                               '_list_pod_retry_id', return_value=5), \
             mock.patch.object(backend_jobs.time, 'sleep'):
            result = rt.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)
        self.assertEqual(result.message, 'AlreadyExists')

    def test_execute_returns_create_success(self):
        """Normal success path: create succeeds without AlreadyExists."""
        rt = self._make(error_log_spec=self._spec())
        ok = jobs_base.JobResult()
        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'execute',
                               return_value=ok), \
             mock.patch.object(backend_jobs.BackendCreateGroup, 'execute',
                               return_value=ok), \
             mock.patch.object(backend_jobs.time, 'sleep'):
            result = rt.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)

    def test_execute_loops_and_force_deletes_on_retry(self):
        """AlreadyExists with stale pod -> retry; force_delete is enabled."""
        rt = self._make(retry_id=5, error_log_spec=self._spec())
        ok = jobs_base.JobResult()
        already = jobs_base.JobResult(message='AlreadyExists')

        # First iteration: AlreadyExists + stale pod (retry_id < self.retry_id)
        # Then exhaust MAX_RETRY iterations with the same path.
        with mock.patch.object(backend_jobs.BackendCleanupGroup, 'execute',
                               return_value=ok), \
             mock.patch.object(backend_jobs.BackendCreateGroup, 'execute',
                               return_value=already), \
             mock.patch.object(backend_jobs.BackendRescheduleTask,
                               '_list_pod_retry_id', return_value=0), \
             mock.patch.object(backend_jobs.time, 'sleep'):
            result = rt.execute(_FakeContext(), mock.Mock())

        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)
        assert result.message is not None
        self.assertIn('max retry', result.message)
        self.assertTrue(rt.cleanup_job.force_delete)


class LabelNodeTest(unittest.TestCase):
    """Cover LabelNode.execute (lines 425, 435, 437-450)."""

    def _make(self, node_name='n1', labels=None):
        return backend_jobs.LabelNode.model_construct(
            backend='back',
            workflow_uuid='wf-uuid',
            user='alice',
            node_name=node_name,
            labels=labels or {'foo': 'bar'},
            job_type='LabelNode', super_type='backend',
            job_id=f'{node_name}-x-labelnode')

    def test_get_job_id_includes_node_name_and_suffix(self):
        values = {'node_name': 'gpu-node-3'}
        job_id = backend_jobs.LabelNode._get_job_id(values)
        self.assertTrue(job_id.startswith('gpu-node-3-'))
        self.assertTrue(job_id.endswith('-labelnode'))

    def test_execute_patches_node_with_labels(self):
        job = self._make(labels={'osmo/role': 'gpu'})
        v1_api = mock.Mock()
        ctx = _FakeContext()
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            result = job.execute(ctx, mock.Mock())
        v1_api.patch_node.assert_called_once_with(
            'n1', {'metadata': {'labels': {'osmo/role': 'gpu'}}})
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)

    def test_execute_returns_failed_retry_on_api_exception(self):
        job = self._make()
        v1_api = mock.Mock()
        v1_api.patch_node.side_effect = _make_api_exception(
            {'message': 'unauthorized', 'code': 401})
        with mock.patch.object(backend_jobs.kb_client, 'CoreV1Api',
                               return_value=v1_api):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)


class BackendSynchronizeQueuesValidationAndApisTest(unittest.TestCase):
    """Cover validator + helper paths (lines 487, 500, 507-534, 542-548)."""

    def _spec(self, kind='Topology'):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='kai.scheduler/v1alpha1', kind=kind),
            labels={'osmo.namespace': 'osmo-workflows'})

    def _make(self, *, cleanup_specs=None, k8s_resources=None,
              immutable_kinds=None):
        return backend_jobs.BackendSynchronizeQueues.model_construct(
            backend='default',
            type='BackendSynchronizeQueues',
            super_type='backend',
            cleanup_specs=cleanup_specs if cleanup_specs is not None
                else [self._spec()],
            k8s_resources=k8s_resources or [],
            immutable_kinds=immutable_kinds or [],
            job_type='BackendSynchronizeQueues',
            job_id='default-modify-queues-x',
        )

    def test_get_allowed_job_type_is_synchronize_queues(self):
        self.assertEqual(
            backend_jobs.BackendSynchronizeQueues._get_allowed_job_type(),
            ['BackendSynchronizeQueues'])

    def test_validate_job_id_rejects_bad_id(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            backend_jobs.BackendSynchronizeQueues(
                backend='default',
                cleanup_specs=[],
                k8s_resources=[],
                immutable_kinds=[],
                job_id='no-magic-here')

    def test_validate_job_id_accepts_well_formed_id(self):
        good = backend_jobs.BackendSynchronizeQueues(
            backend='default',
            cleanup_specs=[],
            k8s_resources=[],
            immutable_kinds=[],
            job_id='default-modify-queues-abc123')
        self.assertEqual(good.backend, 'default')

    def test_resource_api_for_spec_uses_dynamic_client(self):
        job = self._make()
        dyn_inst = mock.Mock()
        with mock.patch.object(backend_jobs.kb_dynamic, 'DynamicClient',
                               return_value=dyn_inst):
            ret = job._resource_api_for_spec(mock.Mock(), self._spec())
        dyn_inst.resources.get.assert_called_once_with(
            api_version='kai.scheduler/v1alpha1', kind='Topology')
        self.assertIs(ret, dyn_inst.resources.get.return_value)

    def test_get_objects_returns_items_list(self):
        job = self._make()
        resource_api = mock.Mock()
        resource_api.get.return_value.to_dict.return_value = {
            'items': [{'metadata': {'name': 'a'}}]
        }
        with mock.patch.object(job, '_resource_api_for_spec',
                               return_value=resource_api):
            items = job._get_objects(_FakeContext(), self._spec())
        self.assertEqual(items, [{'metadata': {'name': 'a'}}])

    def test_get_objects_returns_empty_when_no_items_key(self):
        job = self._make()
        resource_api = mock.Mock()
        resource_api.get.return_value.to_dict.return_value = {}
        with mock.patch.object(job, '_resource_api_for_spec',
                               return_value=resource_api):
            items = job._get_objects(_FakeContext(), self._spec())
        self.assertEqual(items, [])

    def test_apply_object_creates_when_no_resource_version(self):
        job = self._make()
        resource_api = mock.Mock()
        with mock.patch.object(job, '_resource_api_for_spec',
                               return_value=resource_api):
            job._apply_object(_FakeContext(), self._spec(),
                              {'metadata': {'name': 'a'}})
        resource_api.create.assert_called_once()
        resource_api.replace.assert_not_called()

    def test_apply_object_replaces_when_resource_version_provided(self):
        job = self._make()
        resource_api = mock.Mock()
        obj = {'metadata': {'name': 'a'}}
        with mock.patch.object(job, '_resource_api_for_spec',
                               return_value=resource_api):
            job._apply_object(_FakeContext(), self._spec(), obj,
                              resource_version='100')
        # resourceVersion was injected into the body before replace.
        self.assertEqual(obj['metadata']['resourceVersion'], '100')
        resource_api.replace.assert_called_once_with(name='a', body=obj)
        resource_api.create.assert_not_called()

    def test_delete_object_calls_resource_api_delete(self):
        job = self._make()
        resource_api = mock.Mock()
        with mock.patch.object(job, '_resource_api_for_spec',
                               return_value=resource_api):
            job._delete_object(_FakeContext(), self._spec(), 'a')
        resource_api.delete.assert_called_once_with(name='a')


class BackendSynchronizeQueuesExecuteTest(unittest.TestCase):
    """Cover BackendSynchronizeQueues.execute including error branches."""

    def _spec(self, kind='Topology'):
        return backend_job_defs.BackendCleanupSpec(
            generic_api=backend_job_defs.BackendGenericApi(
                api_version='kai.scheduler/v1alpha1', kind=kind),
            labels={'osmo.namespace': 'osmo-workflows'})

    def _make(self, *, cleanup_specs):
        return backend_jobs.BackendSynchronizeQueues.model_construct(
            backend='default',
            cleanup_specs=cleanup_specs,
            k8s_resources=[],
            immutable_kinds=[],
            super_type='backend',
            job_type='BackendSynchronizeQueues',
            job_id='default-modify-queues-x')

    def test_execute_normalizes_single_cleanup_spec(self):
        """Backwards-compat: a single (non-list) cleanup_spec is wrapped."""
        spec = self._spec()
        job = self._make(cleanup_specs=spec)  # single, not list
        with mock.patch.object(job, '_sync_objects_for_spec') as mock_sync:
            result = job.execute(_FakeContext(), mock.Mock())
        mock_sync.assert_called_once()
        self.assertEqual(result.status, jobs_base.JobStatus.SUCCESS)

    def test_execute_iterates_each_cleanup_spec(self):
        job = self._make(cleanup_specs=[self._spec(kind='Topology'),
                                         self._spec(kind='Queue')])
        with mock.patch.object(job, '_sync_objects_for_spec') as mock_sync:
            job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(mock_sync.call_count, 2)

    def test_execute_returns_failed_retry_on_max_retry_error(self):
        job = self._make(cleanup_specs=[self._spec()])
        err = urllib3.exceptions.MaxRetryError(
            mock.Mock(), 'http://x', Exception('down'))
        with mock.patch.object(job, '_sync_objects_for_spec',
                               side_effect=err):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)
        assert result.message is not None
        self.assertIn('Synchronizing', result.message)

    def test_execute_returns_failed_retry_on_api_exception(self):
        job = self._make(cleanup_specs=[self._spec()])
        err = _make_api_exception({'message': 'forbidden', 'code': 403})
        with mock.patch.object(job, '_sync_objects_for_spec',
                               side_effect=err):
            result = job.execute(_FakeContext(), mock.Mock())
        self.assertEqual(result.status, jobs_base.JobStatus.FAILED_RETRY)


if __name__ == '__main__':
    unittest.main()
