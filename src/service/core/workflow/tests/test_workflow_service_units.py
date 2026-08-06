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
import http
import unittest
from types import SimpleNamespace
from unittest import mock

from src.lib.utils import osmo_errors
from src.service.core.workflow import objects, workflow_service
from src.utils.job import task, workflow as job_workflow


def _make_workflow_response(name='wf-1', uuid='uuid-1', status=None, backend='k8s-1',
                            plugins=None, queue_timeout=None, exec_timeout=None):
    """Construct a minimal WorkflowQueryResponse for tests."""
    # Using SimpleNamespace avoids Pydantic strict-field checking that mypy trips on;
    # callers use attribute access, so a namespace suffices.
    return SimpleNamespace(
        name=name,
        uuid=uuid,
        status=status if status is not None else job_workflow.WorkflowStatus.RUNNING,
        backend=backend,
        plugins=plugins if plugins is not None else SimpleNamespace(rsync=False),
        queue_timeout=queue_timeout,
        exec_timeout=exec_timeout,
    )


def _make_task_query(name='t1', retry_id=0, status=None):
    return SimpleNamespace(
        name=name,
        retry_id=retry_id,
        status=status if status is not None else task.TaskGroupStatus.RUNNING,
        logs='',
        events='',
        pod_name=f'pod-{name}',
        task_uuid=f'uuid-{name}',
    )


class TestNodeSetIter(unittest.TestCase):
    """Covers NodeSet.__iter__ (lines 82-83)."""

    def test_iter_yields_backend_node_tuples(self):
        nodeset = workflow_service.NodeSet(
            backend='k8s-1', nodes=frozenset({'node-a', 'node-b'}))

        result = sorted(nodeset)

        self.assertEqual(result, [('k8s-1', 'node-a'), ('k8s-1', 'node-b')])

    def test_iter_empty_nodeset_yields_nothing(self):
        nodeset = workflow_service.NodeSet(backend='k8s-1', nodes=frozenset())

        result = list(nodeset)

        self.assertEqual(result, [])


class TestGetPools(unittest.TestCase):
    """Covers get_pools (lines 109-110)."""

    def test_get_pools_delegates_to_fetch_minimal_pool_config(self):
        sentinel_config = mock.Mock(name='MinimalPoolConfig')
        postgres_instance = mock.Mock(name='postgres')

        with mock.patch.object(workflow_service.connectors,
                               'PostgresConnector') as postgres_cls, \
             mock.patch.object(workflow_service.connectors,
                               'fetch_minimal_pool_config',
                               return_value=sentinel_config) as fetch:
            postgres_cls.get_instance.return_value = postgres_instance
            result = workflow_service.get_pools(all_pools=True, pools=None)

        self.assertIs(result, sentinel_config)
        fetch.assert_called_once_with(postgres_instance, pools=None, all_pools=True)

    def test_get_pools_passes_pool_names_and_flag(self):
        sentinel_config = mock.Mock()
        postgres_instance = mock.Mock()

        with mock.patch.object(workflow_service.connectors,
                               'PostgresConnector') as postgres_cls, \
             mock.patch.object(workflow_service.connectors,
                               'fetch_minimal_pool_config',
                               return_value=sentinel_config) as fetch:
            postgres_cls.get_instance.return_value = postgres_instance
            workflow_service.get_pools(all_pools=False, pools=['p-1', 'p-2'])

        fetch.assert_called_once_with(
            postgres_instance, pools=['p-1', 'p-2'], all_pools=False)


class TestGetPoolQuotas(unittest.TestCase):
    """Covers get_pool_quotas (lines 300-330)."""

    def test_get_pool_quotas_paginates_and_stops_on_short_page(self):
        pool_configs_container = mock.Mock()
        pool_configs_container.pools = {}
        empty_response = objects.PoolResponse(
            node_sets=[],
            resource_sum=objects.ResourceUsage(
                quota_used='0', quota_free='0', quota_limit='0',
                total_usage='0', total_capacity='0', total_free='0'))

        with mock.patch.object(workflow_service.connectors,
                               'PostgresConnector') as postgres_cls, \
             mock.patch.object(workflow_service.connectors,
                               'fetch_minimal_pool_config',
                               return_value=pool_configs_container) as fetch, \
             mock.patch.object(workflow_service.helpers,
                               'get_tasks', return_value=[]) as get_tasks, \
             mock.patch.object(workflow_service.objects,
                               'get_resources') as get_resources, \
             mock.patch.object(workflow_service, 'calculate_pool_quotas',
                               return_value=empty_response) as calc:
            postgres_cls.get_instance.return_value = mock.Mock()
            get_resources.return_value = objects.ResourcesResponse(resources=[])
            result = workflow_service.get_pool_quotas(
                all_pools=False, pools=['p-1'])

        self.assertIs(result, empty_response)
        fetch.assert_called_once()
        # Only one page since the returned summary count < FETCH_TASK_LIMIT
        self.assertEqual(get_tasks.call_count, 1)
        # calculate_pool_quotas invoked with the empty results
        calc.assert_called_once()
        _, kwargs = calc.call_args
        self.assertEqual(kwargs['pool_configs'], {})
        self.assertEqual(kwargs['all_pools'], False)


class TestSubmitWorkflow(unittest.TestCase):
    """Covers submit_workflow branches (lines 355-450)."""

    def test_submit_workflow_rejects_both_spec_and_id(self):
        template_spec = mock.Mock(name='TemplateSpec')

        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=template_spec,
                workflow_id='wf-1')

        self.assertIn('not both', ctx.exception.message)

    def test_submit_workflow_rejects_neither_spec_nor_id(self):
        with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
            workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=None,
                workflow_id=None)

        self.assertIn('Need to provide', ctx.exception.message)

    def test_submit_workflow_dry_run_returns_yaml_spec(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            response = workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=template_spec,
                dry_run=True,
                env_vars=[],
                label_overrides=['team=alpha'],
                roles_header=None)

        self.assertEqual(response.name, 'wf-name')
        self.assertIn('workflow', response.spec or '')
        submit_info.construct_workflow_dict.assert_called_once_with(
            template_spec, label_overrides=['team=alpha'], canonical_labels=None)

    def test_submit_workflow_malformed_env_var_raises(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        # workflow_spec with no groups (uses tasks path)
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            with self.assertRaises(osmo_errors.OSMOUsageError) as ctx:
                workflow_service.submit_workflow(
                    pool_name='p-1',
                    template_spec=template_spec,
                    env_vars=['NO_EQUALS_HERE'],
                    roles_header=None)

        self.assertIn('incorrectly formatted', ctx.exception.message)

    def test_submit_workflow_env_vars_applied_to_tasks(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        # workflow_spec with no groups but tasks
        task_a = mock.Mock()
        task_a.environment = {}
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = [task_a]
        workflow_spec.get_num_tasks.return_value = 1
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 1
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        workflow_config.user_workflow_limits.max_num_workflows = 0
        workflow_config.user_workflow_limits.max_num_tasks = 0
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        submit_info.send_submit_workflow_to_queue.return_value = objects.SubmitResponse(
            name='wf-name', logs='ok')

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            response = workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=template_spec,
                env_vars=['FOO=bar'],
                roles_header=None)

        self.assertEqual(response.name, 'wf-name')
        self.assertEqual(task_a.environment, {'FOO': 'bar'})

    def test_submit_workflow_exceeds_max_num_tasks(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 200
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.submit_workflow(
                    pool_name='p-1',
                    template_spec=template_spec,
                    env_vars=[],
                    roles_header=None)

        self.assertIn('more than 100 tasks', ctx.exception.message)

    def test_submit_workflow_validation_only_returns_early(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 1
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        submit_info.validate_workflow_spec.return_value = [
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
        ]

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            response = workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=template_spec,
                validation_only=True,
                env_vars=[],
                roles_header=None)

        self.assertEqual(response.name, 'wf-name')
        self.assertIn('validation succeeded', response.logs or '')
        self.assertEqual(
            response.warnings,
            [
                "Workflow is missing label 'project'; add it now to avoid "
                "rejected submissions once it is required.",
            ],
        )
        submit_info.send_submit_workflow_to_queue.assert_not_called()

    def test_submit_workflow_exceeds_max_workflows_per_user(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.user = 'user-1'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 1
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        workflow_config.user_workflow_limits.max_num_workflows = 5
        workflow_config.user_workflow_limits.max_num_tasks = 0
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'), \
             mock.patch.object(workflow_service.workflow,
                               'get_num_workflows_and_tasks',
                               return_value=(5, 0)):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.submit_workflow(
                    pool_name='p-1',
                    template_spec=template_spec,
                    env_vars=[],
                    roles_header=None)

        self.assertIn('more than 5 ongoing workflows', ctx.exception.message)

    def test_submit_workflow_exceeds_max_tasks_per_user(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.user = 'user-1'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = []
        workflow_spec.get_num_tasks.return_value = 3
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 3
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        workflow_config.user_workflow_limits.max_num_workflows = 0
        workflow_config.user_workflow_limits.max_num_tasks = 10
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'), \
             mock.patch.object(workflow_service.workflow,
                               'get_num_workflows_and_tasks',
                               return_value=(0, 8)):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.submit_workflow(
                    pool_name='p-1',
                    template_spec=template_spec,
                    env_vars=[],
                    roles_header=None)

        self.assertIn('more than 10 ongoing tasks', ctx.exception.message)

    def test_submit_workflow_env_vars_applied_to_groups(self):
        template_spec = mock.Mock(name='TemplateSpec')
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        # workflow_spec with groups, each with tasks
        task_a = mock.Mock()
        task_a.environment = {}
        task_b = mock.Mock()
        task_b.environment = {}
        group_1 = mock.Mock()
        group_1.tasks = [task_a, task_b]
        workflow_spec = mock.Mock()
        workflow_spec.groups = [group_1]
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        rendered_spec.get_num_tasks.return_value = 2
        workflow_spec.parse.return_value = rendered_spec
        workflow_config = mock.Mock()
        workflow_config.max_num_tasks = 100
        workflow_config.user_workflow_limits.max_num_workflows = 0
        workflow_config.user_workflow_limits.max_num_tasks = 0
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        submit_info.send_submit_workflow_to_queue.return_value = objects.SubmitResponse(
            name='wf-name', logs='ok')

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            workflow_service.submit_workflow(
                pool_name='p-1',
                template_spec=template_spec,
                env_vars=['A=1', 'B=2'],
                roles_header=None)

        self.assertEqual(task_a.environment, {'A': '1', 'B': '2'})
        self.assertEqual(task_b.environment, {'A': '1', 'B': '2'})

    def test_submit_workflow_from_workflow_id_downloads_spec(self):
        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'wf-name'
        submit_info.construct_workflow_dict.return_value = {'workflow': {'name': 'wf-name'}}
        context = mock.Mock()
        source_workflow = mock.Mock(labels={'team': 'database'})

        with mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'), \
             mock.patch.object(workflow_service.workflow.Workflow, 'fetch_from_db',
                               return_value=source_workflow) as fetch_workflow, \
             mock.patch.object(workflow_service, 'download_workflow_spec',
                               return_value=iter(['w:', 'orkflow'])) as dl, \
             mock.patch.object(workflow_service.helpers,
                               'gather_stream_content',
                               return_value='workflow:\n  name: wf-name') as gather, \
             mock.patch.object(workflow_service.workflow, 'TemplateSpec') as ts_cls:
            ts_cls.return_value = mock.Mock()
            workflow_service.submit_workflow(
                pool_name='p-1',
                workflow_id='parent-wf',
                dry_run=True,
                env_vars=[],
                label_overrides=['team=alpha'],
                roles_header=None)

        dl.assert_called_once_with('parent-wf')
        fetch_workflow.assert_called_once_with(
            context.database, 'parent-wf', fetch_groups=False)
        gather.assert_called_once()
        ts_cls.assert_called_once()
        submit_info.construct_workflow_dict.assert_called_once_with(
            ts_cls.return_value,
            label_overrides=['team=alpha'],
            canonical_labels={'team': 'database'})


class TestRestartWorkflow(unittest.TestCase):
    """Covers restart_workflow (lines 467-541)."""

    def test_restart_workflow_rejects_non_failed(self):
        # A COMPLETED workflow is not failed → OSMOSubmissionError
        workflow_obj = mock.Mock()
        workflow_obj.workflow_id = 'wf-1'
        workflow_obj.status.failed.return_value = False
        workflow_obj.status.__str__ = lambda self: 'COMPLETED'  # type: ignore

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.workflow.Workflow, 'fetch_from_db',
                               return_value=workflow_obj):
            with self.assertRaises(osmo_errors.OSMOSubmissionError) as ctx:
                workflow_service.restart_workflow(
                    pool_name='p-1', workflow_id='wf-1',
                    user_header=None, roles_header=None)

        self.assertIn('FAILED workflows', ctx.exception.message)

    def test_restart_workflow_rewrites_groups_and_tasks(self):
        # workflow with 2 groups: g1 completed, g2 failed. Verify:
        # - g2 remains in new_groups but g1 excluded
        # - Inputs referencing g1's tasks get workflow_id prefix (parent succeeded)
        # - Inputs referencing g2's tasks are left unprefixed (parent failed → rerun)
        workflow_obj = mock.Mock()
        workflow_obj.workflow_id = 'parent-wf'
        workflow_obj.status.failed.return_value = True
        workflow_obj.priority = 'NORMAL'
        workflow_obj.labels = {'team': 'database'}
        # First group succeeded, second failed
        g1_task = SimpleNamespace(name='g1-t1')
        g1 = SimpleNamespace(
            name='g1', tasks=[g1_task],
            status=SimpleNamespace(failed=lambda: False))
        g2_task = SimpleNamespace(name='g2-t1')
        g2 = SimpleNamespace(
            name='g2', tasks=[g2_task],
            status=SimpleNamespace(failed=lambda: True))
        workflow_obj.groups = [g1, g2]

        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'restart-wf'
        submit_info.construct_workflow_dict.return_value = {
            'workflow': {'name': 'restart-wf'}}

        # Build spec object with matching groups/tasks - g2 will be rewritten
        # Input pointing to g1's task -> should be rewritten with prefix
        # Input pointing to g2's task -> should NOT be rewritten
        parent_input = task.TaskInputOutput(task='g1-t1')
        sibling_input = task.TaskInputOutput(task='g2-t1')
        prev_workflow_input = task.TaskInputOutput(task='old-wf:some-task')

        g2_spec_task = mock.Mock()
        g2_spec_task.inputs = [parent_input, sibling_input, prev_workflow_input]
        g2_spec = mock.Mock()
        g2_spec.name = 'g2'
        g2_spec.tasks = [g2_spec_task]

        # g1 will be filtered out (completed)
        g1_spec_task = mock.Mock()
        g1_spec_task.inputs = []
        g1_spec = mock.Mock()
        g1_spec.name = 'g1'
        g1_spec.tasks = [g1_spec_task]

        workflow_spec = mock.Mock()
        workflow_spec.groups = [g1_spec, g2_spec]
        workflow_spec.tasks = []
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        workflow_spec.parse.return_value = rendered_spec
        submit_info.validate_workflow_spec.return_value = [
            "Workflow is missing label 'project'; add it now to avoid rejected "
            "submissions once it is required.",
        ]
        submit_info.send_submit_workflow_to_queue.return_value = objects.SubmitResponse(
            name='restart-wf', logs='ok')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.workflow.Workflow, 'fetch_from_db',
                               return_value=workflow_obj), \
             mock.patch.object(workflow_service, 'download_workflow_spec',
                               return_value=iter(['spec'])), \
             mock.patch.object(workflow_service.helpers, 'gather_stream_content',
                               return_value='spec'), \
             mock.patch.object(workflow_service.workflow, 'TemplateSpec'), \
             mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            workflow_service.restart_workflow(
                pool_name='p-1', workflow_id='parent-wf',
                user_header=None, roles_header=None)

        # g1 was completed so it's excluded; only g2 remains
        self.assertEqual(workflow_spec.groups, [g2_spec])
        # parent_input (references succeeded g1) -> prefixed
        self.assertEqual(parent_input.task, 'parent-wf:g1-t1')
        # sibling_input (references failed g2) -> left unchanged
        self.assertEqual(sibling_input.task, 'g2-t1')
        # prev_workflow_input (already has workflow prefix) -> unchanged
        self.assertEqual(prev_workflow_input.task, 'old-wf:some-task')
        self.assertEqual(
            submit_info.send_submit_workflow_to_queue.call_args.kwargs['warnings'],
            [
                "Workflow is missing label 'project'; add it now to avoid "
                "rejected submissions once it is required.",
            ],
        )
        self.assertNotIn(
            'label_overrides',
            submit_info.construct_workflow_dict.call_args.kwargs,
        )
        self.assertEqual(
            submit_info.construct_workflow_dict.call_args.kwargs['canonical_labels'],
            {'team': 'database'},
        )

    def test_restart_workflow_rewrites_top_level_tasks(self):
        # workflow_spec.tasks path (top-level tasks, no groups)
        workflow_obj = mock.Mock()
        workflow_obj.workflow_id = 'parent-wf'
        workflow_obj.status.failed.return_value = True
        workflow_obj.priority = 'NORMAL'
        # Completed groups map for the tasks: t1 was succeeded, t2 failed
        t1_status = SimpleNamespace(failed=lambda: False)
        t2_status = SimpleNamespace(failed=lambda: True)
        g_succ = SimpleNamespace(
            name='g0',
            tasks=[SimpleNamespace(name='t1'), SimpleNamespace(name='t2')],
            status=t1_status)
        # Use two groups so that per-task completion is derived from group failure
        g_fail = SimpleNamespace(
            name='g1',
            tasks=[SimpleNamespace(name='t3')],
            status=t2_status)
        workflow_obj.groups = [g_succ, g_fail]

        submit_info = mock.Mock(name='WorkflowSubmitInfo')
        submit_info.name = 'restart-wf'
        submit_info.construct_workflow_dict.return_value = {
            'workflow': {'name': 'restart-wf'}}

        # Only task t3 is not completed
        t3_input = task.TaskInputOutput(task='t1')  # parent succeeded → prefixed
        t3_spec = mock.Mock()
        t3_spec.name = 't3'
        t3_spec.inputs = [t3_input]

        workflow_spec = mock.Mock()
        workflow_spec.groups = []
        workflow_spec.tasks = [
            mock.Mock(name='t1_spec', spec=[], inputs=[]),
            t3_spec]
        workflow_spec.tasks[0].name = 't1'  # will be filtered out
        submit_info.construct_workflow_spec_from_dict.return_value = workflow_spec
        rendered_spec = mock.Mock()
        workflow_spec.parse.return_value = rendered_spec
        submit_info.send_submit_workflow_to_queue.return_value = objects.SubmitResponse(
            name='restart-wf', logs='ok')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.workflow.Workflow, 'fetch_from_db',
                               return_value=workflow_obj), \
             mock.patch.object(workflow_service, 'download_workflow_spec',
                               return_value=iter(['spec'])), \
             mock.patch.object(workflow_service.helpers, 'gather_stream_content',
                               return_value='spec'), \
             mock.patch.object(workflow_service.workflow, 'TemplateSpec'), \
             mock.patch.object(workflow_service.objects, 'WorkflowSubmitInfo',
                               return_value=submit_info), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-1'), \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='abc'):
            workflow_service.restart_workflow(
                pool_name='p-1', workflow_id='parent-wf',
                user_header=None, roles_header=None)

        # After rewrite: only t3 is kept (t1 is completed)
        self.assertEqual(workflow_spec.tasks, [t3_spec])
        # t3's input references t1 which succeeded → workflow-id prefixed
        self.assertEqual(t3_input.task, 'parent-wf:t1')


class TestCancelWorkflow(unittest.TestCase):
    """Covers cancel_workflow (lines 554-572)."""

    def test_cancel_workflow_already_finished_without_force_raises(self):
        workflow_response = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.COMPLETED)

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.cancel_workflow(name='wf-1', user='user-1')

        self.assertIn('already finished', ctx.exception.message)

    def test_cancel_workflow_running_sends_cancel_job(self):
        workflow_response = _make_workflow_response(
            name='wf-1', uuid='uuid-1',
            status=job_workflow.WorkflowStatus.RUNNING)

        cancel_job = mock.Mock()
        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response), \
             mock.patch.object(workflow_service.jobs, 'CancelWorkflow',
                               return_value=cancel_job) as cancel_cls:
            response = workflow_service.cancel_workflow(
                name='wf-1', message='stopping', user='user-1')

        self.assertEqual(response.name, 'wf-1')
        _, kwargs = cancel_cls.call_args
        self.assertEqual(kwargs['job_id'], 'uuid-1-cancel')
        self.assertEqual(kwargs['force'], False)
        cancel_job.send_job_to_queue.assert_called_once()

    def test_cancel_workflow_force_uses_unique_job_id(self):
        workflow_response = _make_workflow_response(
            name='wf-1', uuid='uuid-1',
            status=job_workflow.WorkflowStatus.COMPLETED)

        cancel_job = mock.Mock()
        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response), \
             mock.patch.object(workflow_service.jobs, 'CancelWorkflow',
                               return_value=cancel_job) as cancel_cls, \
             mock.patch.object(workflow_service.common, 'generate_unique_id',
                               return_value='RAND1'):
            workflow_service.cancel_workflow(
                name='wf-1', force=True, user='user-1')

        _, kwargs = cancel_cls.call_args
        self.assertEqual(kwargs['job_id'], 'uuid-1-RAND1-force-cancel')
        self.assertEqual(kwargs['force'], True)


class TestListWorkflow(unittest.TestCase):
    """Covers list_workflow (lines 598-624)."""

    def _kwargs(self, **overrides):
        base = {
            'users': None,
            'name': None,
            'statuses': None,
            'pools': None,
            'all_users': False,
            'all_pools': False,
            'offset': 0,
            'limit': 20,
            'order': workflow_service.connectors.ListOrder.ASC,
            'submitted_before': None,
            'submitted_after': None,
            'tags': None,
            'app': None,
            'priority': None,
            'label_filters': None,
            'missing_label_filters': None,
            'user_header': None,
        }
        base.update(overrides)
        return base

    def test_list_workflow_negative_offset_raises(self):
        with self.assertRaises(osmo_errors.OSMOUsageError):
            workflow_service.list_workflow(**self._kwargs(offset=-1))

    def test_list_workflow_limit_too_large_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            workflow_service.list_workflow(**self._kwargs(limit=1001))

    def test_list_workflow_uses_user_header_when_no_users(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'
        list_response = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors.UserProfile,
                               'fetch_from_db',
                               return_value=SimpleNamespace(pool='user-pool')), \
             mock.patch.object(workflow_service.helpers, 'get_workflows',
                               return_value=[]), \
             mock.patch.object(workflow_service.objects.ListResponse,
                               'from_db_rows',
                               return_value=list_response) as from_rows:
            result = workflow_service.list_workflow(**self._kwargs(user_header='user-x'))

        self.assertIs(result, list_response)
        from_rows.assert_called_once()

    def test_list_workflow_no_pool_raises_when_not_all_pools(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors.UserProfile,
                               'fetch_from_db',
                               return_value=SimpleNamespace(pool='')):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.list_workflow(**self._kwargs(user_header='user-x'))

        self.assertIn('No pool selected', ctx.exception.message)

    def test_list_workflow_all_pools_clears_pools(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.helpers, 'get_workflows',
                               return_value=[]) as get_workflows, \
             mock.patch.object(workflow_service.objects.ListResponse,
                               'from_db_rows',
                               return_value=mock.Mock()):
            workflow_service.list_workflow(
                **self._kwargs(all_users=True, all_pools=True))

        # Verify get_workflows called with empty list for pools
        args, _ = get_workflows.call_args
        # signature: users, name, statuses, pools, offset, limit+1, order,
        # submitted_after, submitted_before, tags, app_info
        pools_arg = args[3]
        self.assertEqual(pools_arg, [])

    def test_list_workflow_truncates_when_has_more(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors.UserProfile,
                               'fetch_from_db',
                               return_value=SimpleNamespace(pool='p1')), \
             mock.patch.object(workflow_service.helpers, 'get_workflows',
                               return_value=[{'row': i} for i in range(21)]), \
             mock.patch.object(workflow_service.objects.ListResponse,
                               'from_db_rows',
                               return_value=mock.Mock()) as from_rows:
            workflow_service.list_workflow(
                **self._kwargs(user_header='u', limit=20))

        args, kwargs = from_rows.call_args
        # rows arg limited to 20 (since 21 > 20 -> more entries True)
        self.assertEqual(len(args[0]), 20)
        self.assertTrue(kwargs['more_entries'])

    def test_list_workflow_forwards_label_filters(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.helpers, 'get_workflows',
                               return_value=[]) as get_workflows, \
             mock.patch.object(workflow_service.objects.ListResponse,
                               'from_db_rows', return_value=mock.Mock()):
            workflow_service.list_workflow(**self._kwargs(
                all_users=True,
                all_pools=True,
                label_filters=['team=alpha'],
                missing_label_filters=['project'],
            ))

        self.assertEqual(get_workflows.call_args.kwargs['label_filters'], ['team=alpha'])
        self.assertEqual(
            get_workflows.call_args.kwargs['missing_label_filters'],
            ['project'],
        )


class TestListTask(unittest.TestCase):
    """Covers list_task (lines 666-690)."""

    def _kwargs(self, **overrides):
        base = {
            'workflow_id': None,
            'statuses': None,
            'users': None,
            'all_users': False,
            'pools': None,
            'all_pools': False,
            'nodes': None,
            'started_after': None,
            'started_before': None,
            'offset': 0,
            'limit': 20,
            'order': workflow_service.connectors.ListOrder.ASC,
            'summary': False,
            'aggregate_by_workflow': False,
            'priority': None,
            'user_header': None,
        }
        base.update(overrides)
        return base

    def test_list_task_zero_limit_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError):
            workflow_service.list_task(**self._kwargs(limit=0))

    def test_list_task_negative_offset_raises(self):
        with self.assertRaises(osmo_errors.OSMOUsageError):
            workflow_service.list_task(**self._kwargs(offset=-1))

    def test_list_task_no_pool_raises(self):
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors.UserProfile,
                               'fetch_from_db',
                               return_value=SimpleNamespace(pool=None)):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.list_task(**self._kwargs(user_header='user-x'))

        self.assertIn('No pool selected', ctx.exception.message)

    def test_list_task_summary_response(self):
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.helpers, 'get_tasks',
                               return_value=[]), \
             mock.patch.object(workflow_service.objects.ListTaskSummaryResponse,
                               'from_db_rows',
                               return_value=mock.sentinel.summary) as from_rows:
            result = workflow_service.list_task(
                **self._kwargs(summary=True, all_users=True, all_pools=True))

        self.assertIs(result, mock.sentinel.summary)
        from_rows.assert_called_once()

    def test_list_task_aggregated_response(self):
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.helpers, 'get_tasks',
                               return_value=[]), \
             mock.patch.object(workflow_service.objects.ListTaskAggregatedResponse,
                               'from_db_rows',
                               return_value=mock.sentinel.aggregated) as from_rows:
            result = workflow_service.list_task(
                **self._kwargs(aggregate_by_workflow=True, all_users=True,
                               all_pools=True))

        self.assertIs(result, mock.sentinel.aggregated)
        from_rows.assert_called_once()

    def test_list_task_full_response(self):
        context = mock.Mock()
        context.database.get_workflow_service_url.return_value = 'http://svc'

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.helpers, 'get_tasks',
                               return_value=[]), \
             mock.patch.object(workflow_service.objects.ListTaskResponse,
                               'from_db_rows',
                               return_value=mock.sentinel.full) as from_rows:
            result = workflow_service.list_task(
                **self._kwargs(all_users=True, all_pools=True))

        self.assertIs(result, mock.sentinel.full)
        from_rows.assert_called_once()


class TestGetWorkflow(unittest.TestCase):
    """Covers get_workflow (lines 700-701) and get_workflow_task (lines 634-636)."""

    def test_get_workflow_delegates_to_query_response(self):
        context = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.objects.WorkflowQueryResponse,
                               'fetch_from_db',
                               return_value=mock.sentinel.wf) as fetch:
            result = workflow_service.get_workflow('wf-1')

        self.assertIs(result, mock.sentinel.wf)
        fetch.assert_called_once_with(context.database, 'wf-1',
                                      skip_groups=False, verbose=False)

    def test_get_workflow_task_delegates_to_task_entry(self):
        context = mock.Mock()
        row = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.task.Task, 'fetch_row_from_db',
                               return_value=row), \
             mock.patch.object(workflow_service.objects.TaskEntry, 'from_db_row',
                               return_value=mock.sentinel.entry) as from_row:
            result = workflow_service.get_workflow_task('wf-1', 't1')

        self.assertIs(result, mock.sentinel.entry)
        from_row.assert_called_once_with(row)


class TestTagWorkflow(unittest.TestCase):
    """Covers tag_workflow (lines 934-937)."""

    def test_tag_workflow_no_add_no_remove_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            workflow_service.tag_workflow(name='wf-1', add=None, remove=None)

        self.assertIn('No tags specified', ctx.exception.message)

    def test_tag_workflow_calls_set_workflow_tags(self):
        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service.helpers,
                               'set_workflow_tags') as set_tags:
            workflow_service.tag_workflow(name='wf-1', add=['a'], remove=None)

        set_tags.assert_called_once_with('wf-1', ['a'], None)


class TestGetResources(unittest.TestCase):
    """Covers get_resources (lines 953-962)."""

    def test_get_resources_concise_returns_pool_resources(self):
        with mock.patch.object(workflow_service.helpers,
                               'get_pool_resources',
                               return_value=mock.sentinel.pool_res) as pr:
            result = workflow_service.get_resources(
                pools=['p1'], platforms=['plat'], concise=True)

        self.assertIs(result, mock.sentinel.pool_res)
        pr.assert_called_once_with(pools=['p1'], platforms=['plat'])

    def test_get_resources_non_concise_uses_objects_get_resources(self):
        with mock.patch.object(workflow_service.objects, 'get_resources',
                               return_value=mock.sentinel.full) as gr:
            result = workflow_service.get_resources(
                pools=['p1'], platforms=['plat'], concise=False)

        self.assertIs(result, mock.sentinel.full)
        gr.assert_called_once_with(pools=['p1'], platforms=['plat'])

    def test_get_resources_all_pools_calls_get_all_pool_names(self):
        with mock.patch.object(workflow_service.connectors.Pool,
                               'get_all_pool_names',
                               return_value=['p1', 'p2']), \
             mock.patch.object(workflow_service.objects, 'get_resources',
                               return_value=mock.sentinel.full) as gr:
            workflow_service.get_resources(all_pools=True)

        # pools arg came from get_all_pool_names
        _, kwargs = gr.call_args
        self.assertEqual(kwargs['pools'], ['p1', 'p2'])

    def test_get_resources_platforms_only_used_when_pools_set(self):
        with mock.patch.object(workflow_service.objects, 'get_resources',
                               return_value=mock.sentinel.full) as gr:
            workflow_service.get_resources(
                pools=None, platforms=['plat'],
                allowed_pools_header='allowed-1,allowed-2')

        _, kwargs = gr.call_args
        self.assertEqual(kwargs['pools'], ['allowed-1', 'allowed-2'])
        # platforms=None because pools is falsy → platforms arg becomes None
        self.assertIsNone(kwargs['platforms'])


class TestGetOneResource(unittest.TestCase):
    """Covers get_one_resource (lines 972-975)."""

    def test_get_one_resource_returns_when_present(self):
        result_container = SimpleNamespace(resources=[mock.Mock()])

        with mock.patch.object(workflow_service.objects, 'get_resources',
                               return_value=result_container):
            result = workflow_service.get_one_resource('node-1')

        self.assertIs(result, result_container)

    def test_get_one_resource_missing_raises_not_found(self):
        result_container = SimpleNamespace(resources=[])

        with mock.patch.object(workflow_service.objects, 'get_resources',
                               return_value=result_container):
            with self.assertRaises(osmo_errors.OSMONotFoundError) as ctx:
                workflow_service.get_one_resource('node-1')

        self.assertIn('Resource node-1 does not exist', ctx.exception.message)


class TestSetUserCredential(unittest.TestCase):
    """Covers set_user_credential (lines 1004-1025)."""

    def test_set_user_credential_invalid_name_raises(self):
        cred_option = mock.Mock()
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            workflow_service.set_user_credential(
                cred_name='has spaces!', credential_option=cred_option)

        self.assertIn('Invalid name', ctx.exception.message)

    def test_set_user_credential_new_user_adds_secret(self):
        context = mock.Mock()
        context.database.execute_fetch_command.return_value = []
        cred_option = mock.Mock()
        credential = mock.Mock()
        cred_option.get_credential.return_value = credential
        credential.to_db_row.return_value = ('a', 'b')
        workflow_config = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        postgres_instance = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'), \
             mock.patch.object(workflow_service.connectors,
                               'PostgresConnector') as postgres_cls, \
             mock.patch.object(workflow_service.connectors.UserProfile,
                               'fetch_from_db', return_value=mock.Mock()):
            postgres_cls.get_instance.return_value = postgres_instance
            workflow_service.set_user_credential(
                cred_name='validname', credential_option=cred_option)

        credential.valid_cred.assert_called_once_with(workflow_config)
        context.database.secret_manager.add_new_user.assert_called_once_with('user-x')
        context.database.execute_commit_command.assert_called_once()

    def test_set_user_credential_existing_user_skips_add_new(self):
        context = mock.Mock()
        context.database.execute_fetch_command.return_value = [{'uid': 'user-x'}]
        cred_option = mock.Mock()
        credential = mock.Mock()
        cred_option.get_credential.return_value = credential
        credential.to_db_row.return_value = ('a',)

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'):
            workflow_service.set_user_credential(
                cred_name='validname', credential_option=cred_option)

        context.database.secret_manager.add_new_user.assert_not_called()

    def test_set_user_credential_database_error_maps_to_user_error(self):
        context = mock.Mock()
        context.database.execute_fetch_command.return_value = [{'uid': 'user-x'}]
        cred_option = mock.Mock()
        credential = mock.Mock()
        cred_option.get_credential.return_value = credential
        credential.to_db_row.return_value = ('a',)
        context.database.execute_commit_command.side_effect = \
            osmo_errors.OSMODatabaseError('DB: table not found')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.set_user_credential(
                    cred_name='validname', credential_option=cred_option)

        self.assertIn('table not found', ctx.exception.message)


class TestDeleteUsersCredential(unittest.TestCase):
    """Covers delete_users_credential (lines 1034-1055)."""

    def test_delete_users_credential_invalid_name_raises(self):
        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            workflow_service.delete_users_credential(cred_name='has space')

        self.assertIn('Invalid name', ctx.exception.message)

    def test_delete_users_credential_no_rows_raises(self):
        context = mock.Mock()
        context.database.execute_fetch_command.return_value = []

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.delete_users_credential(cred_name='validname')

        self.assertIn('does not exits', ctx.exception.message)

    def test_delete_users_credential_deletes_and_returns_row(self):
        context = mock.Mock()
        row = mock.Mock()
        context.database.execute_fetch_command.return_value = [row]

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'), \
             mock.patch.object(workflow_service.objects.UserCredential,
                               'from_db_row', return_value=[]) as from_row:
            response = workflow_service.delete_users_credential(cred_name='validname')

        context.database.execute_commit_command.assert_called_once()
        self.assertEqual(response.credentials, [])
        from_row.assert_called_once_with([row])

    def test_delete_users_credential_database_error_maps_to_user_error(self):
        context = mock.Mock()
        row = mock.Mock()
        context.database.execute_fetch_command.return_value = [row]
        context.database.execute_commit_command.side_effect = \
            osmo_errors.OSMODatabaseError('DB: fk violation')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.delete_users_credential(cred_name='validname')

        self.assertIn('fk violation', ctx.exception.message)


class TestGetUserCredential(unittest.TestCase):
    """Covers get_user_credential (lines 987-993)."""

    def test_get_user_credential_returns_response_from_rows(self):
        context = mock.Mock()
        rows = [mock.Mock()]
        context.database.execute_fetch_command.return_value = rows

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.connectors, 'parse_username',
                               return_value='user-x'), \
             mock.patch.object(workflow_service.objects.UserCredential,
                               'from_db_row',
                               return_value=[]) as from_row:
            response = workflow_service.get_user_credential(user_header='u')

        self.assertEqual(response.credentials, [])
        from_row.assert_called_once_with(rows)


class TestActionRequestHelper(unittest.TestCase):
    """Covers action_request_helper (lines 1064-1130)."""

    def test_action_helper_no_backend_raises_not_found(self):
        workflow_result = _make_workflow_response(
            name='wf-1', backend=None,
            status=job_workflow.WorkflowStatus.RUNNING)

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result):
            with self.assertRaises(osmo_errors.OSMONotFoundError) as ctx:
                workflow_service.action_request_helper(
                    workflow_service.ActionType.EXEC, {}, 'wf-1')

        self.assertEqual(ctx.exception.status_code,
                         http.HTTPStatus.UNPROCESSABLE_ENTITY.value)

    def test_action_helper_finished_workflow_raises(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.COMPLETED)

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            workflow_service.action_request_helper(
                workflow_service.ActionType.EXEC, {}, 'wf-1',
                cached_workflow_response=workflow_result)

        self.assertEqual(ctx.exception.status_code,
                         http.HTTPStatus.GONE.value)
        self.assertIn('is not running', ctx.exception.message)

    def test_action_helper_pending_workflow_raises_too_early(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.PENDING)

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            workflow_service.action_request_helper(
                workflow_service.ActionType.EXEC, {}, 'wf-1',
                cached_workflow_response=workflow_result)

        self.assertEqual(ctx.exception.status_code,
                         http.HTTPStatus.TOO_EARLY.value)

    def test_action_helper_no_router_address_raises(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.RUNNING)
        backend_config = SimpleNamespace(router_address='')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.connectors.Backend,
                               'fetch_from_db',
                               return_value=backend_config):
            with self.assertRaises(osmo_errors.OSMONotFoundError) as ctx:
                workflow_service.action_request_helper(
                    workflow_service.ActionType.EXEC, {}, 'wf-1',
                    cached_workflow_response=workflow_result)

        self.assertEqual(ctx.exception.status_code,
                         http.HTTPStatus.UNPROCESSABLE_ENTITY.value)

    def test_action_helper_task_dispatches_single_task(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.RUNNING)
        backend_config = SimpleNamespace(router_address='wss://router')
        redis_client = mock.Mock()
        redis_instance = SimpleNamespace(client=redis_client)
        target_task = _make_task_query(name='t1', retry_id=2)

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.connectors.Backend,
                               'fetch_from_db',
                               return_value=backend_config), \
             mock.patch.object(workflow_service.helpers, 'get_running_task',
                               return_value=target_task) as get_task, \
             mock.patch.object(workflow_service.connectors.RedisConnector,
                               'get_instance',
                               return_value=redis_instance), \
             mock.patch.object(workflow_service.job_common,
                               'calculate_total_timeout',
                               return_value=60), \
             mock.patch.object(workflow_service.helpers, 'get_router_cookie',
                               return_value='c=v'), \
             mock.patch.object(workflow_service.common,
                               'generate_unique_id',
                               return_value='ID1'):
            result = workflow_service.action_request_helper(
                workflow_service.ActionType.EXEC, {'entry_command': 'ls'},
                'wf-1', task_name='t1',
                cached_workflow_response=workflow_result)

        self.assertIn('t1', result)
        self.assertEqual(result['t1'].router_address, 'wss://router')
        self.assertEqual(result['t1'].key, 'EXEC-ID1')
        self.assertEqual(result['t1'].cookie, 'c=v')
        get_task.assert_called_once_with(workflow_result, 't1')
        redis_client.set.assert_called_once()
        redis_client.lpush.assert_called_once()

    def test_action_helper_group_dispatches_group_tasks(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.RUNNING)
        backend_config = SimpleNamespace(router_address='wss://router')
        redis_client = mock.Mock()
        redis_instance = SimpleNamespace(client=redis_client)
        task_1 = _make_task_query(name='t1', retry_id=0)
        task_2 = _make_task_query(name='t2', retry_id=0)

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.connectors.Backend,
                               'fetch_from_db',
                               return_value=backend_config), \
             mock.patch.object(workflow_service.helpers,
                               'get_running_tasks_from_group',
                               return_value=[task_1, task_2]) as get_group, \
             mock.patch.object(workflow_service.connectors.RedisConnector,
                               'get_instance',
                               return_value=redis_instance), \
             mock.patch.object(workflow_service.job_common,
                               'calculate_total_timeout',
                               return_value=60), \
             mock.patch.object(workflow_service.helpers, 'get_router_cookie',
                               return_value=''), \
             mock.patch.object(workflow_service.common,
                               'generate_unique_id',
                               return_value='ID'):
            result = workflow_service.action_request_helper(
                workflow_service.ActionType.EXEC, {'entry_command': 'ls'},
                'wf-1', group_name='g1',
                cached_workflow_response=workflow_result)

        self.assertEqual(set(result.keys()), {'t1', 't2'})
        get_group.assert_called_once_with(workflow_result, 'g1')

    def test_action_helper_no_task_or_group_dispatches_all(self):
        workflow_result = _make_workflow_response(
            name='wf-1', status=job_workflow.WorkflowStatus.RUNNING)
        backend_config = SimpleNamespace(router_address='wss://router')
        redis_client = mock.Mock()
        redis_instance = SimpleNamespace(client=redis_client)
        wf_task = _make_task_query(name='wf-task', retry_id=1)

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=mock.Mock()), \
             mock.patch.object(workflow_service.connectors.Backend,
                               'fetch_from_db',
                               return_value=backend_config), \
             mock.patch.object(workflow_service.helpers,
                               'get_running_tasks_from_workflow',
                               return_value=[wf_task]) as get_all, \
             mock.patch.object(workflow_service.connectors.RedisConnector,
                               'get_instance',
                               return_value=redis_instance), \
             mock.patch.object(workflow_service.job_common,
                               'calculate_total_timeout',
                               return_value=60), \
             mock.patch.object(workflow_service.helpers, 'get_router_cookie',
                               return_value=''), \
             mock.patch.object(workflow_service.common,
                               'generate_unique_id',
                               return_value='ID'):
            result = workflow_service.action_request_helper(
                workflow_service.ActionType.EXEC, {}, 'wf-1',
                cached_workflow_response=workflow_result)

        self.assertIn('wf-task', result)
        get_all.assert_called_once_with(workflow_result)


class TestExecPortForwardRsyncHelpers(unittest.TestCase):
    """Covers exec_into_*, port_forward_*, rsync_task (lines 1137-1210)."""

    def test_exec_into_group_calls_helper_with_group_name(self):
        workflow_result = _make_workflow_response(name='wf-1')

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service, 'action_request_helper',
                               return_value=mock.sentinel.result) as helper:
            result = workflow_service.exec_into_group('wf-1', 'g1', 'ls')

        self.assertIs(result, mock.sentinel.result)
        args, kwargs = helper.call_args
        self.assertEqual(args[0], workflow_service.ActionType.EXEC)
        self.assertEqual(args[1], {'entry_command': 'ls'})
        self.assertEqual(kwargs['group_name'], 'g1')

    def test_exec_into_task_returns_task_key_from_helper(self):
        workflow_result = _make_workflow_response(name='wf-1')

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service, 'action_request_helper',
                               return_value={'t1': mock.sentinel.info}) as helper:
            result = workflow_service.exec_into_task('wf-1', 't1', 'ls')

        self.assertIs(result, mock.sentinel.info)
        _, kwargs = helper.call_args
        self.assertEqual(kwargs['task_name'], 't1')

    def test_port_forward_task_no_ports_raises(self):
        workflow_result = _make_workflow_response(name='wf-1')

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.port_forward_task('wf-1', 't1', task_ports=None)

        self.assertIn('No port is provided', ctx.exception.message)

    def test_port_forward_task_exceeds_max_ports(self):
        workflow_result = _make_workflow_response(name='wf-1')
        workflow_config = mock.Mock()
        workflow_config.max_num_ports_per_task = 2
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.port_forward_task(
                    'wf-1', 't1', task_ports=[80, 443, 8080])

        self.assertIn('exceeds the maximum', ctx.exception.message)

    def test_port_forward_task_returns_one_router_info_per_port(self):
        workflow_result = _make_workflow_response(name='wf-1')
        workflow_config = mock.Mock()
        workflow_config.max_num_ports_per_task = 10
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service, 'action_request_helper',
                               return_value={'t1': mock.sentinel.router}) as helper:
            result = workflow_service.port_forward_task(
                'wf-1', 't1', task_ports=[80, 443])

        self.assertEqual(result, [mock.sentinel.router, mock.sentinel.router])
        self.assertEqual(helper.call_count, 2)
        # First call carries port=80 in payload
        first_args = helper.call_args_list[0]
        self.assertEqual(first_args[0][1]['task_port'], 80)

    def test_port_forward_webserver_returns_router_info(self):
        workflow_result = _make_workflow_response(name='wf-1')

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service, 'action_request_helper',
                               return_value={'t1': mock.sentinel.router}) as helper:
            result = workflow_service.port_forward_webserver(
                'wf-1', 't1', task_port=8080)

        self.assertIs(result, mock.sentinel.router)
        args, kwargs = helper.call_args
        self.assertEqual(args[0], workflow_service.ActionType.WEBSERVER)
        self.assertEqual(args[1], {'task_port': 8080})
        self.assertEqual(kwargs['task_name'], 't1')

    def test_rsync_task_without_rsync_plugin_raises(self):
        workflow_result = _make_workflow_response(
            name='wf-1', plugins=SimpleNamespace(rsync=False))

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.rsync_task('wf-1', 't1')

        self.assertEqual(ctx.exception.status_code,
                         http.HTTPStatus.FORBIDDEN.value)
        self.assertIn('Rsync is not enabled', ctx.exception.message)

    def test_rsync_task_calls_helper_with_telemetry_flag(self):
        workflow_result = _make_workflow_response(
            name='wf-1', plugins=SimpleNamespace(rsync=True))
        workflow_config = mock.Mock()
        workflow_config.plugins_config.rsync.enable_telemetry = True
        context = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_result), \
             mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service, 'action_request_helper',
                               return_value={'t1': mock.sentinel.router}) as helper:
            result = workflow_service.rsync_task('wf-1', 't1')

        self.assertIs(result, mock.sentinel.router)
        args, _ = helper.call_args
        self.assertEqual(args[0], workflow_service.ActionType.RSYNC)
        self.assertEqual(args[1], {'enable_telemetry': True})


class TestDownloadWorkflowSpec(unittest.TestCase):
    """Covers download_workflow_spec (lines 887-898)."""

    def test_download_workflow_spec_raises_when_no_credential(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = None
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context):
            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                workflow_service.download_workflow_spec('wf-1')

        self.assertIn('credential is not set', ctx.exception.message)

    def test_download_workflow_spec_returns_workflow_file(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        storage_client = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=storage_client), \
             mock.patch.object(workflow_service, 'get_workflow',
                               return_value=_make_workflow_response(name='wf-1')), \
             mock.patch.object(workflow_service.helpers, 'get_workflow_file',
                               return_value=mock.sentinel.stream) as get_file:
            result = workflow_service.download_workflow_spec(
                'wf-1', use_template=True)

        self.assertIs(result, mock.sentinel.stream)
        # use_template=True uses TEMPLATED_WORKFLOW_SPEC_FILE_NAME
        args, _ = get_file.call_args
        self.assertEqual(
            args[0], workflow_service.common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME)


class TestGetWorkflowLogs(unittest.TestCase):
    """Covers get_workflow_logs (lines 776-805)."""

    def test_get_workflow_logs_no_credential_raises_server_error(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = None
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context):
            with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
                workflow_service.get_workflow_logs('wf-1')

        self.assertIn('credential is not set', ctx.exception.message)

    def test_get_workflow_logs_no_task_uses_workflow_defaults(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        storage_client = mock.Mock()

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=storage_client), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            result = workflow_service.get_workflow_logs('wf-1', query='ERR')

        self.assertIs(result, mock.sentinel.resp)
        _, kwargs = get_info.call_args
        self.assertEqual(kwargs['regexes'], ['ERR'])

    def test_get_workflow_logs_with_task_uses_task_log_file_when_exists(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        storage_client = mock.Mock()
        task_obj = SimpleNamespace(retry_id=0, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=storage_client), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers,
                               'workflow_file_exists', return_value=True), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_logs(
                'wf-1', task_name='t1', retry_id=None)

        _, kwargs = get_info.call_args
        # Task log file was found, so no regex fallback added
        self.assertEqual(kwargs['regexes'], [])

    def test_get_workflow_logs_task_no_file_falls_back_to_regex(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        storage_client = mock.Mock()
        task_obj = SimpleNamespace(retry_id=2, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=storage_client), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers,
                               'workflow_file_exists', return_value=False), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_logs(
                'wf-1', task_name='t1', retry_id=None)

        _, kwargs = get_info.call_args
        # Regex includes retry- prefix since retry_id > 0
        self.assertEqual(len(kwargs['regexes']), 1)
        self.assertIn('retry-2', kwargs['regexes'][0])

    def test_get_workflow_logs_task_no_retry_uses_bare_regex(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        task_obj = SimpleNamespace(retry_id=0, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers,
                               'workflow_file_exists', return_value=False), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_logs(
                'wf-1', task_name='t1')

        _, kwargs = get_info.call_args
        self.assertEqual(len(kwargs['regexes']), 1)
        self.assertNotIn('retry-', kwargs['regexes'][0])


class TestGetWorkflowPodConditions(unittest.TestCase):
    """Covers get_workflow_pod_conditions (lines 816-835)."""

    def test_no_credential_raises_server_error(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = None
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context):
            with self.assertRaises(osmo_errors.OSMOServerError):
                workflow_service.get_workflow_pod_conditions('wf-1')

    def test_no_task_returns_events_stream(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        # get_workflow_events_redis_name asserts a 32-char hex uuid.
        valid_uuid = '0' * 31 + '1'
        workflow_response = _make_workflow_response(name='wf-1', uuid=valid_uuid)

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            result = workflow_service.get_workflow_pod_conditions('wf-1')

        self.assertIs(result, mock.sentinel.resp)
        _, kwargs = get_info.call_args
        self.assertEqual(kwargs['regexes'], [])

    def test_with_task_adds_task_regex(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        valid_uuid = '0' * 31 + '1'
        workflow_response = _make_workflow_response(name='wf-1', uuid=valid_uuid)
        task_obj = SimpleNamespace(retry_id=3, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_pod_conditions('wf-1', task_name='t1')

        _, kwargs = get_info.call_args
        self.assertEqual(len(kwargs['regexes']), 1)
        self.assertIn('retry-3', kwargs['regexes'][0])


class TestGetWorkflowErrorLogs(unittest.TestCase):
    """Covers get_workflow_error_logs (lines 848-877)."""

    def test_no_task_returns_json_table(self):
        # Ensure that when task_name is None, the JSON summary is returned.
        wf_task = SimpleNamespace(name='t1', retry_id=0, error_logs='err-url')
        group = SimpleNamespace(tasks=[wf_task])
        workflow_response = SimpleNamespace(groups=[group])

        with mock.patch.object(workflow_service, 'get_workflow',
                               return_value=workflow_response):
            result = workflow_service.get_workflow_error_logs('wf-1')

        self.assertIn('Specify task', result)
        self.assertIn('err-url', result)

    def test_no_credential_raises(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = None
        context.database.get_workflow_configs.return_value = workflow_config

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context):
            with self.assertRaises(osmo_errors.OSMOServerError):
                workflow_service.get_workflow_error_logs(
                    'wf-1', task_name='t1')

    def test_old_error_logs_file_takes_precedence(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        task_obj = SimpleNamespace(retry_id=1, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers, 'workflow_file_exists',
                               return_value=True), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_error_logs(
                'wf-1', task_name='t1', query='ERROR')

        args, kwargs = get_info.call_args
        # file_name should be the OLD error logs file when it exists
        self.assertEqual(args[2],
                         workflow_service.common.OLD_WORKFLOW_ERROR_LOGS_FILE_NAME)
        self.assertEqual(kwargs['regexes'], ['ERROR'])

    def test_retry_id_zero_uses_legacy_file(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        task_obj = SimpleNamespace(retry_id=0, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers, 'workflow_file_exists',
                               return_value=False), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_error_logs(
                'wf-1', task_name='t1')

        args, _ = get_info.call_args
        self.assertTrue(args[2].startswith('t1'))
        self.assertNotIn('_0', args[2])

    def test_retry_id_positive_appends_retry_suffix(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.workflow_log.credential = mock.Mock()
        context.database.get_workflow_configs.return_value = workflow_config
        task_obj = SimpleNamespace(retry_id=2, name='t1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.storage.Client, 'create',
                               return_value=mock.Mock()), \
             mock.patch.object(workflow_service.task.Task, 'fetch_from_db',
                               return_value=task_obj), \
             mock.patch.object(workflow_service.helpers, 'workflow_file_exists',
                               return_value=False), \
             mock.patch.object(workflow_service, 'get_file_info',
                               return_value=mock.sentinel.resp) as get_info:
            workflow_service.get_workflow_error_logs(
                'wf-1', task_name='t1')

        args, _ = get_info.call_args
        self.assertIn('t1_2', args[2])


class TestGetFileInfo(unittest.TestCase):
    """Covers get_file_info (lines 711-716, 720-766)."""

    def test_negative_last_n_lines_raises(self):
        context = mock.Mock()
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.get_file_info(
                    'wf-1', 'redis-key', 'log.txt',
                    storage_client=mock.Mock(),
                    last_n_lines=-1)

        self.assertIn('positive value', ctx.exception.message)

    def test_invalid_regex_raises(self):
        context = mock.Mock()
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                workflow_service.get_file_info(
                    'wf-1', 'redis-key', 'log.txt',
                    storage_client=mock.Mock(),
                    regexes=['[invalid'])

        self.assertIn('Invalid regex', ctx.exception.message)

    def test_redis_scheme_uses_redis_formatter(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.max_log_lines = 1000
        context.database.get_workflow_configs.return_value = workflow_config
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info), \
             mock.patch.object(workflow_service.connectors,
                               'redis_log_formatter',
                               return_value=iter([])) as redis_fmt:
            response = workflow_service.get_file_info(
                'wf-1', 'redis-key', 'log.txt',
                storage_client=mock.Mock(),
                last_n_lines=10)

        # Redis formatter was invoked
        redis_fmt.assert_called_once()
        self.assertEqual(response.headers['Content-type'],
                         'text/plain; charset=us-ascii')
        self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')

    def test_download_forces_storage_path(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.max_log_lines = 1000
        context.database.get_workflow_configs.return_value = workflow_config
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info), \
             mock.patch.object(workflow_service.helpers, 'get_workflow_file',
                               return_value=iter([])) as get_file:
            workflow_service.get_file_info(
                'wf-1', 'redis-key', 'log.txt',
                storage_client=mock.Mock(),
                download=True)

        # Even though scheme is redis, download=True routes to storage path
        get_file.assert_called_once()

    def test_max_log_lines_clamps_last_n_lines(self):
        context = mock.Mock()
        workflow_config = mock.Mock()
        workflow_config.max_log_lines = 5
        context.database.get_workflow_configs.return_value = workflow_config
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info), \
             mock.patch.object(workflow_service.connectors,
                               'redis_log_formatter',
                               return_value=iter([])) as redis_fmt:
            workflow_service.get_file_info(
                'wf-1', 'redis-key', 'log.txt',
                storage_client=mock.Mock(),
                last_n_lines=100)

        # last_n_lines should have been clamped to None when >= max_log_lines
        args, _ = redis_fmt.call_args
        self.assertIsNone(args[2])

    def test_backend_error_is_swallowed(self):
        context = mock.Mock()
        context.database.get_workflow_configs.side_effect = \
            osmo_errors.OSMOBackendError('backend down')
        log_info = SimpleNamespace(logs='redis://localhost/wf-1')

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service.workflow.LogInfo,
                               'fetch_log_info_from_db',
                               return_value=log_info), \
             mock.patch.object(workflow_service.connectors,
                               'redis_log_formatter',
                               return_value=iter([])):
            # Should not raise; the OSMOBackendError is swallowed.
            response = workflow_service.get_file_info(
                'wf-1', 'redis-key', 'log.txt',
                storage_client=mock.Mock(),
                last_n_lines=10)
        self.assertIsNotNone(response)


class TestGetWorkflowSpec(unittest.TestCase):
    """Covers get_workflow_spec (lines 905-923)."""

    def test_get_workflow_spec_returns_streaming_response(self):
        context = mock.Mock()
        # execute_fetch_command returns rows with .name attribute
        context.database.execute_fetch_command.return_value = [
            SimpleNamespace(name='cred-a'), SimpleNamespace(name='cred-b')]

        with mock.patch.object(workflow_service.objects.WorkflowServiceContext,
                               'get', return_value=context), \
             mock.patch.object(workflow_service, 'download_workflow_spec',
                               return_value=iter(['spec'])), \
             mock.patch.object(workflow_service, 'redact_secrets',
                               return_value=iter(['redacted'])) as redact:
            response = workflow_service.get_workflow_spec('wf-1')

        self.assertEqual(response.media_type, 'text/plain; charset=utf-8')
        # frozenset containing the fetched cred names is passed to redact_secrets
        args, _ = redact.call_args
        self.assertEqual(args[1], frozenset({'cred-a', 'cred-b'}))


if __name__ == '__main__':
    unittest.main()
