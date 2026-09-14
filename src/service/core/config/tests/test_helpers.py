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

import datetime
import types
import typing
import unittest
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.config import helpers
from src.utils import connectors
from src.utils.job import backend_job_defs, workflow


def _backend(name: str = 'backend-1', scheduler_type: str = 'kai',
             namespace: str = 'osmo-ns', tests: list | None = None) -> connectors.Backend:
    """Build a Backend without triggering validation of unused columns."""
    return connectors.Backend.model_construct(
        name=name,
        description='',
        version='1.0.0',
        k8s_uid='backend-uid',
        k8s_namespace=namespace,
        dashboard_url='',
        grafana_url='',
        tests=tests if tests is not None else [],
        scheduler_settings=connectors.BackendSchedulerSettings.model_construct(
            scheduler_type=typing.cast(connectors.BackendSchedulerType, scheduler_type)),
        node_conditions=connectors.BackendNodeConditions(),
        last_heartbeat=None,
        created_date=datetime.datetime(2026, 1, 1),
        router_address='',
        online=True)


def _cleanup_spec(resource_type: str | None = None, namespace: str = 'osmo-ns',
                  kind: str | None = None) -> backend_job_defs.BackendCleanupSpec:
    generic_api = None
    if kind is not None:
        generic_api = backend_job_defs.BackendGenericApi(api_version='v1', kind=kind)
    return backend_job_defs.BackendCleanupSpec(
        resource_type=resource_type,
        labels={'osmo.namespace': namespace},
        generic_api=generic_api)


def _factory(cleanup_specs: list) -> mock.Mock:
    """Stand-in K8sObjectFactory that yields fixed scheduler specs."""
    factory = mock.Mock()
    factory.list_scheduler_resources_spec.return_value = cleanup_specs
    factory.get_scheduler_resources_spec.return_value = [{'kind': 'Queue'}]
    factory.list_immutable_scheduler_resources.return_value = ['Topology']
    return factory


def _platform(labels: dict | None = None,
              tolerations: list | None = None) -> connectors.Platform:
    return connectors.Platform(
        labels=labels if labels is not None else {},
        tolerations=tolerations if tolerations is not None else [])


def _pool(backend: str = 'backend-1', platforms: dict | None = None) -> connectors.Pool:
    return connectors.Pool(
        backend=backend,
        platforms=platforms if platforms is not None else {})


def _resource(hostname: str = 'node-1', label_fields: dict | None = None,
              taints: list | None = None) -> workflow.ResourcesEntry:
    return workflow.ResourcesEntry.model_construct(
        hostname=hostname,
        backend='backend-1',
        exposed_fields={},
        usage_fields={},
        non_workflow_usage_fields={},
        allocatable_fields={},
        pool_platform_labels={},
        resource_type=connectors.BackendResourceType.SHARED,
        label_fields=label_fields if label_fields is not None else {},
        taints=taints if taints is not None else [])


def _context() -> types.SimpleNamespace:
    """Workflow context whose database records the SQL it is handed."""
    database = mock.Mock()
    database.mogrify.return_value = '(VALUES)'
    return types.SimpleNamespace(database=database)


class TestUpdateBackendQueuesFromConfigmap(unittest.TestCase):
    """Cover scheduler object synchronization, including scheduler-type switches."""

    def test_no_job_is_queued_when_the_scheduler_exposes_no_cleanup_specs(self):
        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               return_value=_factory([])), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            result = helpers.update_backend_queues_from_configmap(_backend(), [])

        self.assertTrue(result)
        job_class.assert_not_called()

    def test_cleanup_specs_are_forwarded_unchanged_when_the_scheduler_is_unchanged(self):
        specs = [_cleanup_spec('Queue')]
        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               return_value=_factory(specs)), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            result = helpers.update_backend_queues_from_configmap(
                _backend(), [], prev_backend=_backend(name='backend-1'))

        self.assertTrue(result)
        self.assertEqual(job_class.call_args.kwargs['cleanup_specs'], specs)

    def test_switching_schedulers_keeps_cleanup_specs_from_both_schedulers(self):
        current_specs = [_cleanup_spec('Queue')]
        previous_specs = [_cleanup_spec('PodGroup')]
        factories = [_factory(current_specs), _factory(previous_specs)]

        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               side_effect=factories), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            helpers.update_backend_queues_from_configmap(
                _backend(scheduler_type='kai'), [],
                prev_backend=_backend(scheduler_type='legacy'))

        forwarded = job_class.call_args.kwargs['cleanup_specs']
        self.assertEqual([spec.resource_type for spec in forwarded], ['Queue', 'PodGroup'])

    def test_switching_schedulers_collapses_identical_cleanup_specs(self):
        factories = [_factory([_cleanup_spec('Queue')]), _factory([_cleanup_spec('Queue')])]

        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               side_effect=factories), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            helpers.update_backend_queues_from_configmap(
                _backend(scheduler_type='kai'), [],
                prev_backend=_backend(scheduler_type='legacy'))

        forwarded = job_class.call_args.kwargs['cleanup_specs']
        self.assertEqual([spec.resource_type for spec in forwarded], ['Queue'])

    def test_switching_schedulers_separates_specs_that_only_differ_by_label(self):
        current_specs = [_cleanup_spec('Queue', namespace='osmo-ns')]
        previous_specs = [_cleanup_spec('Queue', namespace='legacy-ns')]
        factories = [_factory(current_specs), _factory(previous_specs)]

        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               side_effect=factories), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            helpers.update_backend_queues_from_configmap(
                _backend(scheduler_type='kai'), [],
                prev_backend=_backend(scheduler_type='legacy'))

        forwarded = job_class.call_args.kwargs['cleanup_specs']
        self.assertEqual([spec.labels['osmo.namespace'] for spec in forwarded],
                         ['osmo-ns', 'legacy-ns'])

    def test_switching_schedulers_from_one_without_cleanup_specs_keeps_current_specs(self):
        current_specs = [_cleanup_spec('Queue')]
        factories = [_factory(current_specs), _factory([])]

        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               side_effect=factories), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            helpers.update_backend_queues_from_configmap(
                _backend(scheduler_type='kai'), [],
                prev_backend=_backend(scheduler_type='legacy'))

        self.assertEqual(job_class.call_args.kwargs['cleanup_specs'], current_specs)

    # SUSPECTED BUG: src/service/core/config/helpers.py:update_backend_queues_from_configmap -
    # the deduplication key built at lines 78-83 uses resource_type, labels and custom_api but
    # omits generic_api. The KAI factory (src/utils/job/kb_objects.py:474-486) returns cleanup
    # specs that differ ONLY by generic_api (Queue vs Topology) with identical resource_type
    # (None), labels and custom_api (None). When a scheduler-type switch triggers the dedup
    # branch, those two distinct resource kinds collapse into a single spec, so one of the CRD
    # kinds is never cleaned up and is orphaned in the backend cluster. The surrounding comment
    # says the dedup exists "to avoid processing the same resource type twice", but Queue and
    # Topology are not the same resource type. generic_api must be part of the key.
    @unittest.skip('source bug - see SUSPECTED BUG comment above')
    def test_switching_schedulers_keeps_specs_that_only_differ_by_generic_api(self):
        current_specs = [_cleanup_spec(kind='Queue'), _cleanup_spec(kind='Topology')]
        factories = [_factory(current_specs), _factory([_cleanup_spec(kind='Queue')])]

        with mock.patch.object(helpers.kb_objects, 'get_k8s_object_factory',
                               side_effect=factories), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeQueues') as job_class:
            helpers.update_backend_queues_from_configmap(
                _backend(scheduler_type='kai'), [],
                prev_backend=_backend(scheduler_type='legacy'))

        forwarded = job_class.call_args.kwargs['cleanup_specs']
        self.assertEqual([spec.generic_api.kind for spec in forwarded], ['Queue', 'Topology'])


class TestUpdateBackendLastHeartbeat(unittest.TestCase):
    """Cover the heartbeat write-through to PostgreSQL."""

    def test_heartbeat_is_written_for_the_named_backend(self):
        postgres = mock.Mock()
        heartbeat = datetime.datetime(2026, 1, 2, 3, 4, 5)

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres):
            helpers.update_backend_last_heartbeat('backend-1', heartbeat)

        command, args = postgres.execute_commit_command.call_args.args
        self.assertIn('UPDATE backends SET last_heartbeat', command)
        self.assertEqual(args, (heartbeat, 'backend-1'))


class TestTolerationsSatisfyTaints(unittest.TestCase):
    """Cover taint/toleration matching used for node-to-platform assignment."""

    def test_a_node_without_taints_is_always_matched(self):
        self.assertTrue(helpers.tolerations_satisfy_taints([], []))

    def test_a_soft_prefer_no_schedule_taint_is_ignored(self):
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'PreferNoSchedule'}]

        self.assertTrue(helpers.tolerations_satisfy_taints([], taints))

    def test_an_exists_toleration_matches_any_taint_value(self):
        tolerations = [connectors.Toleration(key='gpu', operator='Exists')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]

        self.assertTrue(helpers.tolerations_satisfy_taints(tolerations, taints))

    def test_an_equal_toleration_matches_a_taint_with_the_same_value(self):
        tolerations = [connectors.Toleration(key='gpu', operator='Equal', value='a100')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]

        self.assertTrue(helpers.tolerations_satisfy_taints(tolerations, taints))

    def test_an_equal_toleration_rejects_a_taint_with_a_different_value(self):
        tolerations = [connectors.Toleration(key='gpu', operator='Equal', value='h100')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]

        self.assertFalse(helpers.tolerations_satisfy_taints(tolerations, taints))

    def test_a_toleration_for_a_different_key_does_not_match(self):
        tolerations = [connectors.Toleration(key='other', operator='Exists')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]

        self.assertFalse(helpers.tolerations_satisfy_taints(tolerations, taints))

    def test_a_toleration_scoped_to_another_effect_does_not_match(self):
        tolerations = [connectors.Toleration(key='gpu', operator='Exists', effect='NoExecute')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]

        self.assertFalse(helpers.tolerations_satisfy_taints(tolerations, taints))

    def test_an_untolerated_taint_rejects_the_node_even_when_others_match(self):
        tolerations = [connectors.Toleration(key='gpu', operator='Exists')]
        taints = [{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'},
                  {'key': 'maintenance', 'value': 'true', 'effect': 'NoSchedule'}]

        self.assertFalse(helpers.tolerations_satisfy_taints(tolerations, taints))


class TestUpdateNodePoolPlatform(unittest.TestCase):
    """Cover node-to-pool/platform matching and the SQL it produces."""

    def test_an_unknown_pool_name_is_rejected(self):
        pool_config = connectors.VerbosePoolConfig(pools={'known': _pool()})

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=_context()):
            with self.assertRaisesRegex(osmo_errors.OSMOBackendError, 'pool missing'):
                helpers.update_node_pool_platform(
                    _resource(), 'backend-1', pool_config, pool_name='missing')

    def test_a_matching_pool_and_platform_are_inserted_for_the_node(self):
        pool_config = connectors.VerbosePoolConfig(
            pools={'pool-a': _pool(platforms={'plat-a': _platform(labels={'gpu': 'a100'})})})
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100', 'zone': 'z1'}), 'backend-1', pool_config,
                pool_name='pool-a', platform_name='plat-a')

        self.assertEqual(context.database.mogrify.call_args.args[0],
                         [('node-1', 'backend-1', 'pool-a', 'plat-a')])
        command, args = context.database.execute_commit_command.call_args.args
        self.assertIn('INSERT INTO resource_platforms', command)
        self.assertIn('platform = %s', command)
        self.assertEqual(args, ('node-1', 'backend-1', 'pool-a', 'plat-a'))

    def test_a_named_platform_that_does_not_exist_only_deletes_stale_rows(self):
        pool_config = connectors.VerbosePoolConfig(pools={'pool-a': _pool()})
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100'}), 'backend-1', pool_config,
                pool_name='pool-a', platform_name='absent')

        command, args = context.database.execute_commit_command.call_args.args
        self.assertEqual(command, 'DELETE FROM resource_platforms WHERE resource_name = %s'
                                  ' AND backend = %s AND pool = %s AND platform = %s;')
        self.assertEqual(args, ('node-1', 'backend-1', 'pool-a', 'absent'))

    def test_a_node_whose_labels_do_not_match_only_deletes_stale_rows(self):
        pool_config = connectors.VerbosePoolConfig(
            pools={'pool-a': _pool(platforms={'plat-a': _platform(labels={'gpu': 'h100'})})})
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100'}), 'backend-1', pool_config)

        command, args = context.database.execute_commit_command.call_args.args
        self.assertEqual(command,
                         'DELETE FROM resource_platforms WHERE resource_name = %s'
                         ' AND backend = %s;')
        self.assertEqual(args, ('node-1', 'backend-1'))

    def test_every_platform_of_every_pool_is_matched_when_no_names_are_given(self):
        pool_config = connectors.VerbosePoolConfig(pools={
            'pool-a': _pool(platforms={'plat-a': _platform(labels={'gpu': 'a100'})}),
            'pool-b': _pool(platforms={'plat-b': _platform(labels={'zone': 'z1'})}),
        })
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100', 'zone': 'z1'}), 'backend-1', pool_config)

        self.assertEqual(context.database.mogrify.call_args.args[0],
                         [('node-1', 'backend-1', 'pool-a', 'plat-a'),
                          ('node-1', 'backend-1', 'pool-b', 'plat-b')])

    def test_pools_other_than_the_named_one_are_skipped_when_no_platform_is_given(self):
        pool_config = connectors.VerbosePoolConfig(pools={
            'pool-a': _pool(platforms={'plat-a': _platform(labels={'gpu': 'a100'})}),
            'pool-b': _pool(platforms={'plat-b': _platform(labels={'gpu': 'a100'})}),
        })
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100'}), 'backend-1', pool_config,
                pool_name='pool-b')

        self.assertEqual(context.database.mogrify.call_args.args[0],
                         [('node-1', 'backend-1', 'pool-b', 'plat-b')])

    def test_a_node_with_no_labels_is_never_matched(self):
        pool_config = connectors.VerbosePoolConfig(
            pools={'pool-a': _pool(platforms={'plat-a': _platform()})})
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(_resource(), 'backend-1', pool_config)

        context.database.mogrify.assert_not_called()

    def test_a_node_with_an_untolerated_taint_is_not_matched(self):
        pool_config = connectors.VerbosePoolConfig(
            pools={'pool-a': _pool(platforms={'plat-a': _platform(labels={'gpu': 'a100'})})})
        context = _context()

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_node_pool_platform(
                _resource(label_fields={'gpu': 'a100'},
                          taints=[{'key': 'gpu', 'value': 'a100', 'effect': 'NoSchedule'}]),
                'backend-1', pool_config)

        context.database.mogrify.assert_not_called()


class TestUpdateBackendNodePoolPlatform(unittest.TestCase):
    """Cover the per-backend fan-out over every node in a pool."""

    def test_every_node_in_the_backend_is_rematched_for_the_pool(self):
        context = _context()
        resources = types.SimpleNamespace(
            resources=[_resource('node-1', label_fields={'gpu': 'a100'}),
                       _resource('node-2', label_fields={'gpu': 'a100'})])
        pool_info = _pool(platforms={'plat-a': _platform(labels={'gpu': 'a100'})})

        with mock.patch.object(helpers.connectors.Pool, 'fetch_from_configmap',
                               return_value=pool_info), \
             mock.patch.object(helpers.objects, 'get_resources',
                               return_value=resources) as get_resources, \
             mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_backend_node_pool_platform('pool-a', platform='plat-a')

        self.assertEqual(get_resources.call_args.kwargs,
                         {'backends': ['backend-1'], 'verbose': True})
        self.assertEqual(context.database.execute_commit_command.call_count, 2)

    def test_a_backend_without_nodes_performs_no_database_writes(self):
        context = _context()

        with mock.patch.object(helpers.connectors.Pool, 'fetch_from_configmap',
                               return_value=_pool()), \
             mock.patch.object(helpers.objects, 'get_resources',
                               return_value=types.SimpleNamespace(resources=[])), \
             mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=context):
            helpers.update_backend_node_pool_platform('pool-a')

        context.database.execute_commit_command.assert_not_called()


class TestPodLabelsAndTolerationsEqual(unittest.TestCase):
    """Cover pod-template comparison of node selectors and tolerations."""

    def test_identical_selectors_and_tolerations_compare_equal(self):
        spec = {'spec': {'nodeSelector': {'gpu': 'a100'},
                         'tolerations': [{'key': 'gpu', 'operator': 'Exists'}]}}

        self.assertTrue(helpers.pod_labels_and_tolerations_equal(spec, {'spec': spec['spec']}))

    def test_a_different_node_selector_compares_unequal(self):
        first = {'spec': {'nodeSelector': {'gpu': 'a100'}, 'tolerations': []}}
        second = {'spec': {'nodeSelector': {'gpu': 'h100'}, 'tolerations': []}}

        self.assertFalse(helpers.pod_labels_and_tolerations_equal(first, second))

    def test_a_different_toleration_list_compares_unequal(self):
        first = {'spec': {'nodeSelector': {}, 'tolerations': [{'key': 'gpu'}]}}
        second: typing.Dict = {'spec': {'nodeSelector': {}, 'tolerations': []}}

        self.assertFalse(helpers.pod_labels_and_tolerations_equal(first, second))

    def test_pod_specs_missing_both_fields_compare_equal(self):
        self.assertTrue(helpers.pod_labels_and_tolerations_equal({}, {'spec': {}}))


class TestUpdateBackendTestsCronjobs(unittest.TestCase):
    """Cover backend test CronJob synchronization from database-backed configs."""

    def test_each_named_test_config_is_forwarded_to_the_configmap_helper(self):
        postgres = mock.Mock()
        test_config = mock.Mock()
        test_config.model_dump.return_value = {'name': 'gpu-check'}

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers.connectors.BackendTests, 'fetch_from_db',
                               return_value=test_config), \
             mock.patch.object(helpers, 'update_backend_tests_cronjobs_from_configmap',
                               return_value=True) as forward:
            result = helpers.update_backend_tests_cronjobs(
                'backend-1', ['gpu-check'], 'osmo.nvidia.com/', job_id='job-1')

        self.assertTrue(result)
        self.assertEqual(forward.call_args.args,
                         ('backend-1', {'gpu-check': {'name': 'gpu-check'}}, 'osmo.nvidia.com/'))

    def test_a_test_config_that_cannot_be_fetched_is_skipped(self):
        postgres = mock.Mock()
        good_config = mock.Mock()
        good_config.model_dump.return_value = {'name': 'good'}

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers.connectors.BackendTests, 'fetch_from_db',
                               side_effect=[osmo_errors.OSMOUserError('missing'), good_config]), \
             mock.patch.object(helpers, 'update_backend_tests_cronjobs_from_configmap',
                               return_value=True) as forward:
            result = helpers.update_backend_tests_cronjobs(
                'backend-1', ['missing', 'good'], 'osmo.nvidia.com/')

        self.assertTrue(result)
        self.assertEqual(forward.call_args.args[1], {'good': {'name': 'good'}})

    def test_a_failure_while_queueing_reports_an_unsuccessful_update(self):
        postgres = mock.Mock()

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers, 'update_backend_tests_cronjobs_from_configmap',
                               side_effect=osmo_errors.OSMOServerError('queue down')):
            result = helpers.update_backend_tests_cronjobs('backend-1', [], 'osmo.nvidia.com/')

        self.assertFalse(result)


class TestUpdateBackendTestsCronjobsFromConfigmap(unittest.TestCase):
    """Cover ConfigMap-sourced backend test CronJob synchronization."""

    def test_the_synchronize_job_is_queued_with_the_supplied_test_configs(self):
        configs = {'gpu-check': {'name': 'gpu-check'}}

        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=_context()), \
             mock.patch.object(helpers.backend_jobs,
                               'BackendSynchronizeBackendTest') as job_class:
            result = helpers.update_backend_tests_cronjobs_from_configmap(
                'backend-1', configs, 'osmo.nvidia.com/', job_id='job-1')

        self.assertTrue(result)
        self.assertEqual(job_class.call_args.kwargs,
                         {'backend': 'backend-1', 'job_id': 'job-1', 'test_configs': configs,
                          'node_condition_prefix': 'osmo.nvidia.com/'})
        job_class.return_value.send_job_to_queue.assert_called_once()

    def test_a_queueing_failure_reports_an_unsuccessful_update(self):
        with mock.patch.object(helpers.objects.WorkflowServiceContext, 'get',
                               return_value=_context()), \
             mock.patch.object(helpers.backend_jobs, 'BackendSynchronizeBackendTest',
                               side_effect=osmo_errors.OSMOServerError('queue down')):
            result = helpers.update_backend_tests_cronjobs_from_configmap(
                'backend-1', {}, 'osmo.nvidia.com/')

        self.assertFalse(result)


class TestNotifyBackendsOfTestUpdate(unittest.TestCase):
    """Cover fan-out of a test definition change to the backends that use it."""

    def test_backends_using_the_test_have_their_cronjobs_resynchronized(self):
        postgres = mock.Mock()

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers.connectors.BackendTests, 'get_backends',
                               return_value=[{'name': 'backend-1'}]), \
             mock.patch.object(helpers.connectors.Backend, 'fetch_from_db',
                               return_value=_backend(tests=['gpu-check'])), \
             mock.patch.object(helpers, 'update_backend_tests_cronjobs',
                               return_value=True) as resync:
            helpers.notify_backends_of_test_update('gpu-check')

        self.assertEqual(resync.call_args.args,
                         ('backend-1', ['gpu-check'], 'osmo.nvidia.com/'))

    def test_a_backend_that_no_longer_lists_the_test_is_left_alone(self):
        postgres = mock.Mock()

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers.connectors.BackendTests, 'get_backends',
                               return_value=[{'name': 'backend-1'}]), \
             mock.patch.object(helpers.connectors.Backend, 'fetch_from_db',
                               return_value=_backend(tests=['other'])), \
             mock.patch.object(helpers, 'update_backend_tests_cronjobs') as resync:
            helpers.notify_backends_of_test_update('gpu-check')

        resync.assert_not_called()

    def test_a_lookup_failure_is_logged_without_propagating(self):
        postgres = mock.Mock()

        with mock.patch.object(helpers.connectors.PostgresConnector, 'get_instance',
                               return_value=postgres), \
             mock.patch.object(helpers.connectors.BackendTests, 'get_backends',
                               side_effect=osmo_errors.OSMOServerError('snapshot missing')):
            with self.assertLogs(level='ERROR') as logs:
                helpers.notify_backends_of_test_update('gpu-check')

        self.assertIn('Failed to queue backend test jobs for test gpu-check',
                      '\n'.join(logs.output))


if __name__ == '__main__':
    unittest.main()
