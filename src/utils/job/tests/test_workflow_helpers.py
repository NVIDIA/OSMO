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
import datetime
import unittest

import pydantic

from src.utils import connectors
from src.utils.job import workflow


class ActionQueueNameTest(unittest.TestCase):
    def test_action_queue_name_formats_workflow_task_retry(self):
        result = workflow.action_queue_name('wf-1', 'task-a', 0)
        self.assertEqual(result, 'client-connections:wf-1:task-a:0')

    def test_action_queue_name_includes_nonzero_retry_id(self):
        result = workflow.action_queue_name('wf-2', 'task-b', 5)
        self.assertEqual(result, 'client-connections:wf-2:task-b:5')


class WorkflowStatusAliveTest(unittest.TestCase):
    def test_pending_is_alive(self):
        self.assertTrue(workflow.WorkflowStatus.PENDING.alive())

    def test_running_is_alive(self):
        self.assertTrue(workflow.WorkflowStatus.RUNNING.alive())

    def test_waiting_is_alive(self):
        self.assertTrue(workflow.WorkflowStatus.WAITING.alive())

    def test_completed_is_not_alive(self):
        self.assertFalse(workflow.WorkflowStatus.COMPLETED.alive())

    def test_failed_is_not_alive(self):
        self.assertFalse(workflow.WorkflowStatus.FAILED.alive())

    def test_failed_canceled_is_not_alive(self):
        self.assertFalse(workflow.WorkflowStatus.FAILED_CANCELED.alive())


class WorkflowStatusFinishedTest(unittest.TestCase):
    def test_pending_is_not_finished(self):
        self.assertFalse(workflow.WorkflowStatus.PENDING.finished())

    def test_running_is_not_finished(self):
        self.assertFalse(workflow.WorkflowStatus.RUNNING.finished())

    def test_completed_is_finished(self):
        self.assertTrue(workflow.WorkflowStatus.COMPLETED.finished())

    def test_failed_is_finished(self):
        self.assertTrue(workflow.WorkflowStatus.FAILED.finished())

    def test_failed_exec_timeout_is_finished(self):
        self.assertTrue(workflow.WorkflowStatus.FAILED_EXEC_TIMEOUT.finished())


class WorkflowStatusFailedTest(unittest.TestCase):
    def test_completed_is_not_failed(self):
        self.assertFalse(workflow.WorkflowStatus.COMPLETED.failed())

    def test_failed_is_failed(self):
        self.assertTrue(workflow.WorkflowStatus.FAILED.failed())

    def test_failed_canceled_is_failed(self):
        self.assertTrue(workflow.WorkflowStatus.FAILED_CANCELED.failed())

    def test_pending_is_not_failed(self):
        self.assertFalse(workflow.WorkflowStatus.PENDING.failed())

    def test_running_is_not_failed(self):
        self.assertFalse(workflow.WorkflowStatus.RUNNING.failed())


class WorkflowStatusGetAliveStatusesTest(unittest.TestCase):
    def test_get_alive_statuses_returns_pending_running_waiting(self):
        statuses = workflow.WorkflowStatus.get_alive_statuses()
        self.assertEqual(statuses, [
            workflow.WorkflowStatus.PENDING,
            workflow.WorkflowStatus.RUNNING,
            workflow.WorkflowStatus.WAITING,
        ])


class TimeoutSpecValidateTimeoutTest(unittest.TestCase):
    def test_int_input_converted_to_timedelta_seconds(self):
        spec = workflow.TimeoutSpec(exec_timeout=30)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(seconds=30))

    def test_float_input_converted_to_timedelta_seconds(self):
        spec = workflow.TimeoutSpec(queue_timeout=1.5)
        self.assertEqual(spec.queue_timeout, datetime.timedelta(seconds=1.5))

    def test_none_input_remains_none(self):
        spec = workflow.TimeoutSpec(exec_timeout=None, queue_timeout=None)
        self.assertIsNone(spec.exec_timeout)
        self.assertIsNone(spec.queue_timeout)

    def test_timedelta_input_passes_through(self):
        delta = datetime.timedelta(minutes=5)
        spec = workflow.TimeoutSpec(exec_timeout=delta)
        self.assertEqual(spec.exec_timeout, delta)

    def test_iso_8601_string_input_parsed(self):
        spec = workflow.TimeoutSpec(exec_timeout='PT1H')
        self.assertEqual(spec.exec_timeout, datetime.timedelta(hours=1))

    def test_short_duration_string_input_parsed(self):
        spec = workflow.TimeoutSpec(queue_timeout='10s')
        self.assertEqual(spec.queue_timeout, datetime.timedelta(seconds=10))

    def test_invalid_string_raises_validation_error(self):
        with self.assertRaises(pydantic.ValidationError):
            workflow.TimeoutSpec(exec_timeout='not-a-duration')


class TimeoutSpecFillDefaultsTest(unittest.TestCase):
    def _make_workflow_config(
        self,
        default_exec: str = '60d',
        default_queue: str = '60d',
        max_exec: str = '60d',
        max_queue: str = '60d',
    ) -> connectors.WorkflowConfig:
        return connectors.WorkflowConfig(
            default_exec_timeout=default_exec,
            default_queue_timeout=default_queue,
            max_exec_timeout=max_exec,
            max_queue_timeout=max_queue,
        )

    def _make_pool(
        self,
        default_exec: str = '',
        default_queue: str = '',
        max_exec: str = '',
        max_queue: str = '',
    ) -> connectors.Pool:
        return connectors.Pool(
            backend='test-backend',
            default_exec_timeout=default_exec,
            default_queue_timeout=default_queue,
            max_exec_timeout=max_exec,
            max_queue_timeout=max_queue,
        )

    def test_fill_defaults_uses_pool_defaults_when_unset(self):
        spec = workflow.TimeoutSpec()
        pool = self._make_pool(default_exec='1h', default_queue='30m',
                               max_exec='2h', max_queue='1h')
        spec.fill_defaults(self._make_workflow_config(), pool)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(hours=1))
        self.assertEqual(spec.queue_timeout, datetime.timedelta(minutes=30))

    def test_fill_defaults_falls_back_to_workflow_config(self):
        spec = workflow.TimeoutSpec()
        pool = self._make_pool()
        cfg = self._make_workflow_config(default_exec='2h', default_queue='1h',
                                         max_exec='10h', max_queue='10h')
        spec.fill_defaults(cfg, pool)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(hours=2))
        self.assertEqual(spec.queue_timeout, datetime.timedelta(hours=1))

    def test_fill_defaults_caps_at_pool_max(self):
        spec = workflow.TimeoutSpec(exec_timeout='10h', queue_timeout='10h')
        pool = self._make_pool(default_exec='1h', default_queue='1h',
                               max_exec='2h', max_queue='3h')
        spec.fill_defaults(self._make_workflow_config(), pool)
        self.assertEqual(spec.exec_timeout, datetime.timedelta(hours=2))
        self.assertEqual(spec.queue_timeout, datetime.timedelta(hours=3))


class SplitAssertionRulesTest(unittest.TestCase):
    def _make_assertion(self, left: str, right: str) -> connectors.ResourceAssertion:
        return connectors.ResourceAssertion(
            operator=connectors.ResourceAssertion.OperatorType.GE,
            left_operand=left,
            right_operand=right,
            assert_message='message',
        )

    def test_empty_input_returns_two_empty_lists(self):
        static_rules, k8_rules = workflow.split_assertion_rules([])
        self.assertEqual(static_rules, [])
        self.assertEqual(k8_rules, [])

    def test_left_operand_with_k8_token_classified_as_k8(self):
        assertion = self._make_assertion('{{K8_GPU}}', '1')
        static_rules, k8_rules = workflow.split_assertion_rules([assertion])
        self.assertEqual(static_rules, [])
        self.assertEqual(k8_rules, [assertion])

    def test_right_operand_with_k8_token_classified_as_k8(self):
        assertion = self._make_assertion('{{USER_CPU}}', '{{K8_CPU}}')
        static_rules, k8_rules = workflow.split_assertion_rules([assertion])
        self.assertEqual(static_rules, [])
        self.assertEqual(k8_rules, [assertion])

    def test_assertion_without_k8_token_classified_as_static(self):
        assertion = self._make_assertion('{{USER_CPU}}', '1')
        static_rules, k8_rules = workflow.split_assertion_rules([assertion])
        self.assertEqual(static_rules, [assertion])
        self.assertEqual(k8_rules, [])

    def test_assertion_without_jinja_tokens_classified_as_static(self):
        assertion = self._make_assertion('100', '50')
        static_rules, k8_rules = workflow.split_assertion_rules([assertion])
        self.assertEqual(static_rules, [assertion])
        self.assertEqual(k8_rules, [])


class WorkflowSpecValidateTasksGroupsTest(unittest.TestCase):
    def _minimal_task(self, name: str) -> dict:
        return {'name': name, 'image': 'img', 'command': ['cmd']}

    def test_both_tasks_and_groups_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                tasks=[self._minimal_task('task1')],
                groups=[{'name': 'group1', 'tasks': [self._minimal_task('task2')]}],
            )
        self.assertIn('Cannot use both groups and tasks', str(ctx.exception))

    def test_neither_tasks_nor_groups_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(name='wf')
        self.assertIn('at least one group or one task', str(ctx.exception))

    def test_duplicate_task_names_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                tasks=[self._minimal_task('task1'), self._minimal_task('task1')],
            )
        self.assertIn('same name', str(ctx.exception))

    def test_duplicate_names_case_insensitive_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                tasks=[self._minimal_task('Task_1'), self._minimal_task('task-1')],
            )
        self.assertIn('same name', str(ctx.exception))

    def test_duplicate_group_names_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                groups=[
                    {'name': 'group1', 'tasks': [self._minimal_task('task1')]},
                    {'name': 'group1', 'tasks': [self._minimal_task('task2')]},
                ],
            )
        self.assertIn('same name', str(ctx.exception))

    def test_task_name_collides_with_group_name_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.WorkflowSpec(
                name='wf',
                groups=[
                    {'name': 'shared', 'tasks': [self._minimal_task('shared')]},
                ],
            )
        self.assertIn('same name', str(ctx.exception))

    def test_valid_tasks_only_succeeds(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            tasks=[self._minimal_task('task1'), self._minimal_task('task2')],
        )
        self.assertEqual(len(spec.tasks), 2)
        self.assertEqual(len(spec.groups), 0)

    def test_valid_groups_only_succeeds(self):
        spec = workflow.WorkflowSpec(
            name='wf',
            groups=[
                {'name': 'group1', 'tasks': [self._minimal_task('task1')]},
                {'name': 'group2', 'tasks': [self._minimal_task('task2')]},
            ],
        )
        self.assertEqual(len(spec.groups), 2)
        self.assertEqual(len(spec.tasks), 0)


class VersionedWorkflowSpecValidateVersionTest(unittest.TestCase):
    def _minimal_workflow_kwargs(self) -> dict:
        return {
            'workflow': {
                'name': 'wf',
                'tasks': [{'name': 'task1', 'image': 'img', 'command': ['cmd']}],
            }
        }

    def test_int_2_succeeds(self):
        spec = workflow.VersionedWorkflowSpec(version=2, **self._minimal_workflow_kwargs())
        self.assertEqual(spec.version, 2)

    def test_str_2_succeeds(self):
        spec = workflow.VersionedWorkflowSpec(version='2', **self._minimal_workflow_kwargs())
        self.assertEqual(spec.version, 2)

    def test_float_2_0_succeeds(self):
        spec = workflow.VersionedWorkflowSpec(version=2.0, **self._minimal_workflow_kwargs())
        self.assertEqual(spec.version, 2)

    def test_bool_true_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version=True, **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_bool_false_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version=False, **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_non_integer_float_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version=2.5, **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_non_numeric_string_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version='abc', **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_unsupported_int_version_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version=3, **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_unsupported_string_version_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version='1', **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))

    def test_non_coercible_type_raises(self):
        with self.assertRaises(pydantic.ValidationError) as ctx:
            workflow.VersionedWorkflowSpec(version=[2], **self._minimal_workflow_kwargs())
        self.assertIn('Unsupported workflow version', str(ctx.exception))


class BuildResourceLookupTableTest(unittest.TestCase):
    def _make_resource_entry(
        self,
        exposed_fields: dict,
        platform_workflow_allocatable_fields: dict | None,
    ) -> workflow.ResourcesEntry:
        return workflow.ResourcesEntry.model_construct(
            hostname='node-1',
            exposed_fields=exposed_fields,
            taints=[],
            usage_fields={},
            non_workflow_usage_fields={},
            allocatable_fields={},
            platform_allocatable_fields=None,
            platform_available_fields=None,
            platform_workflow_allocatable_fields=platform_workflow_allocatable_fields,
            config_fields=None,
            backend='test-backend',
            label_fields=None,
            pool_platform_labels={},
            resource_type=connectors.BackendResourceType.SHARED,
        )

    def test_uses_platform_workflow_allocatable_fields_when_present(self):
        entry = self._make_resource_entry(
            exposed_fields={},
            platform_workflow_allocatable_fields={
                'pool1': {
                    'platform1': {
                        'cpu': '4',
                        'gpu': '2',
                        'storage': '4Gi',
                        'memory': '8Gi',
                    }
                }
            },
        )
        result = workflow.build_resource_lookup_table(entry, 'pool1', 'platform1')
        self.assertEqual(result['K8_CPU'], '4')
        self.assertEqual(result['K8_GPU'], '2')
        self.assertIn('Ki', result['K8_STORAGE'])
        self.assertIn('Ki', result['K8_MEMORY'])

    def test_uses_zero_default_for_missing_unitless_field(self):
        entry = self._make_resource_entry(
            exposed_fields={},
            platform_workflow_allocatable_fields={
                'pool1': {
                    'platform1': {
                        'storage': '0',
                        'memory': '0',
                    }
                }
            },
        )
        result = workflow.build_resource_lookup_table(entry, 'pool1', 'platform1')
        self.assertEqual(result['K8_CPU'], '0')
        self.assertEqual(result['K8_GPU'], '0')

    # SUSPECTED BUG: workflow.py:build_resource_lookup_table raises IndexError
    # when platform_workflow_allocatable_fields is None/empty, but the except
    # clause only catches KeyError. The None/empty fallback path appears
    # unreachable. We exercise the KeyError fallback path below instead.

    def test_falls_back_when_pool_missing_from_platform_workflow_fields(self):
        entry = self._make_resource_entry(
            exposed_fields={
                'cpu': '8',
                'gpu': '4',
                'storage': '100',
                'memory': '32',
            },
            platform_workflow_allocatable_fields={
                'other-pool': {'platform1': {'cpu': '99'}}
            },
        )
        result = workflow.build_resource_lookup_table(entry, 'pool1', 'platform1')
        self.assertEqual(result['K8_CPU'], '8')
        self.assertEqual(result['K8_GPU'], '4')
        self.assertEqual(result['K8_STORAGE'], '100Gi')
        self.assertEqual(result['K8_MEMORY'], '32Gi')

    def test_falls_back_when_platform_missing_from_pool_entry(self):
        entry = self._make_resource_entry(
            exposed_fields={'cpu': '16'},
            platform_workflow_allocatable_fields={
                'pool1': {'other-platform': {'cpu': '99'}}
            },
        )
        result = workflow.build_resource_lookup_table(entry, 'pool1', 'platform1')
        self.assertEqual(result['K8_CPU'], '16')

    def test_fallback_uses_zero_string_when_unitless_field_absent(self):
        entry = self._make_resource_entry(
            exposed_fields={},
            platform_workflow_allocatable_fields={
                'other-pool': {'platform1': {'cpu': '99'}}
            },
        )
        result = workflow.build_resource_lookup_table(entry, 'pool1', 'platform1')
        self.assertEqual(result['K8_CPU'], '0')
        self.assertEqual(result['K8_GPU'], '0')
        self.assertEqual(result['K8_STORAGE'], '0')
        self.assertEqual(result['K8_MEMORY'], '0')


if __name__ == '__main__':
    unittest.main()
