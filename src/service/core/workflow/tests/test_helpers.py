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
import hashlib
import http
import os
import unittest

from src.lib.utils import osmo_errors
from src.service.core.workflow import helpers, objects
from src.utils.job import task


def make_task(name: str, status: task.TaskGroupStatus) -> objects.TaskQueryResponse:
    return objects.TaskQueryResponse.model_construct(  # type: ignore[call-arg]
        name=name,
        retry_id=0,
        status=status,
        logs='',
        events='',
        pod_name=f'pod-{name}',
        task_uuid=f'uuid-{name}',
    )


def make_group(name: str,
               tasks: list,
               status: task.TaskGroupStatus = task.TaskGroupStatus.RUNNING
               ) -> objects.GroupQueryResponse:
    return objects.GroupQueryResponse.model_construct(  # type: ignore[call-arg]
        name=name,
        status=status,
        tasks=tasks,
    )


def make_workflow(name: str, groups: list) -> objects.WorkflowQueryResponse:
    return objects.WorkflowQueryResponse.model_construct(  # type: ignore[call-arg]
        name=name,
        groups=groups,
    )


class TestGetResourceNodeHash(unittest.TestCase):

    def test_get_resource_node_hash_empty_returns_hash_of_empty_string(self):
        result = helpers.get_resource_node_hash([])
        expected = hashlib.sha256(b'').hexdigest()
        self.assertEqual(result, expected)

    def test_get_resource_node_hash_single_resource_matches_manual_hash(self):
        result = helpers.get_resource_node_hash([('cpu', '4')])
        expected = hashlib.sha256(b'cpu:4,').hexdigest()
        self.assertEqual(result, expected)

    def test_get_resource_node_hash_multiple_resources_concatenated(self):
        result = helpers.get_resource_node_hash([('cpu', '4'), ('gpu', '2')])
        expected = hashlib.sha256(b'cpu:4,gpu:2,').hexdigest()
        self.assertEqual(result, expected)

    def test_get_resource_node_hash_order_matters(self):
        first = helpers.get_resource_node_hash([('cpu', '4'), ('gpu', '2')])
        second = helpers.get_resource_node_hash([('gpu', '2'), ('cpu', '4')])
        self.assertNotEqual(first, second)

    def test_get_resource_node_hash_is_deterministic(self):
        first = helpers.get_resource_node_hash([('cpu', '4'), ('gpu', '2')])
        second = helpers.get_resource_node_hash([('cpu', '4'), ('gpu', '2')])
        self.assertEqual(first, second)


class TestGetWorkflowFilePrefix(unittest.TestCase):

    def test_get_workflow_file_prefix_joins_workflow_name_and_file_name(self):
        result = helpers.get_workflow_file_prefix('my-workflow', 'spec.yaml')
        self.assertEqual(result, os.path.join('my-workflow', 'spec.yaml'))

    def test_get_workflow_file_prefix_with_empty_file_name(self):
        result = helpers.get_workflow_file_prefix('my-workflow', '')
        self.assertEqual(result, os.path.join('my-workflow', ''))

    def test_get_workflow_file_prefix_with_subdirectory_in_file_name(self):
        result = helpers.get_workflow_file_prefix('wf', 'logs/output.log')
        self.assertEqual(result, os.path.join('wf', 'logs/output.log'))


class TestGatherStreamContent(unittest.TestCase):

    def test_gather_stream_content_empty_generator_returns_empty_string(self):
        result = helpers.gather_stream_content(iter([]))
        self.assertEqual(result, '')

    def test_gather_stream_content_single_chunk(self):
        result = helpers.gather_stream_content(iter(['hello']))
        self.assertEqual(result, 'hello')

    def test_gather_stream_content_multiple_chunks_concatenated(self):
        result = helpers.gather_stream_content(iter(['hel', 'lo ', 'world']))
        self.assertEqual(result, 'hello world')


class TestGetRunningTask(unittest.TestCase):

    def test_get_running_task_returns_running_task(self):
        task_obj = make_task('t1', task.TaskGroupStatus.RUNNING)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        result = helpers.get_running_task(workflow_result, 't1')

        self.assertIs(result, task_obj)

    def test_get_running_task_missing_task_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [make_group('g1', [])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 'missing')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')
        self.assertIn('missing', ctx.exception.message)

    def test_get_running_task_prerunning_status_raises_too_early(self):
        task_obj = make_task('t1', task.TaskGroupStatus.SCHEDULING)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 't1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')

    def test_get_running_task_initializing_status_raises_too_early(self):
        task_obj = make_task('t1', task.TaskGroupStatus.INITIALIZING)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 't1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)

    def test_get_running_task_rescheduled_status_raises_too_early(self):
        task_obj = make_task('t1', task.TaskGroupStatus.RESCHEDULED)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 't1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)

    def test_get_running_task_completed_status_raises_not_found(self):
        task_obj = make_task('t1', task.TaskGroupStatus.COMPLETED)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 't1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertIn('not running', ctx.exception.message)

    def test_get_running_task_failed_status_raises_not_found(self):
        task_obj = make_task('t1', task.TaskGroupStatus.FAILED)
        workflow_result = make_workflow('wf-1', [make_group('g1', [task_obj])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_task(workflow_result, 't1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)

    def test_get_running_task_searches_across_groups(self):
        running_task = make_task('t2', task.TaskGroupStatus.RUNNING)
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('t1', task.TaskGroupStatus.COMPLETED)]),
            make_group('g2', [running_task]),
        ])

        result = helpers.get_running_task(workflow_result, 't2')

        self.assertIs(result, running_task)


class TestGetRunningTasksFromGroup(unittest.TestCase):

    def test_get_running_tasks_from_group_missing_group_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [make_group('g1', [])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_group(workflow_result, 'missing-group')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')
        self.assertIn('missing-group', ctx.exception.message)

    def test_get_running_tasks_from_group_returns_running_tasks_only(self):
        running_a = make_task('a', task.TaskGroupStatus.RUNNING)
        running_b = make_task('b', task.TaskGroupStatus.RUNNING)
        completed = make_task('c', task.TaskGroupStatus.COMPLETED)
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [running_a, running_b, completed]),
        ])

        result = helpers.get_running_tasks_from_group(workflow_result, 'g1')

        self.assertEqual(result, [running_a, running_b])

    def test_get_running_tasks_from_group_only_prerunning_raises_too_early(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('a', task.TaskGroupStatus.SCHEDULING)]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_group(workflow_result, 'g1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')

    def test_get_running_tasks_from_group_only_rescheduled_raises_too_early(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('a', task.TaskGroupStatus.RESCHEDULED)]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_group(workflow_result, 'g1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)

    def test_get_running_tasks_from_group_only_finished_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [
                make_task('a', task.TaskGroupStatus.COMPLETED),
                make_task('b', task.TaskGroupStatus.FAILED),
            ]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_group(workflow_result, 'g1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertIn('No active tasks', ctx.exception.message)

    def test_get_running_tasks_from_group_empty_group_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [make_group('g1', [])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_group(workflow_result, 'g1')

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)


class TestGetRunningTasksFromWorkflow(unittest.TestCase):

    def test_get_running_tasks_from_workflow_no_groups_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertEqual(ctx.exception.workflow_id, 'wf-1')
        self.assertIn('No groups', ctx.exception.message)

    def test_get_running_tasks_from_workflow_returns_all_running_tasks(self):
        running_a = make_task('a', task.TaskGroupStatus.RUNNING)
        running_b = make_task('b', task.TaskGroupStatus.RUNNING)
        completed = make_task('c', task.TaskGroupStatus.COMPLETED)
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [running_a, completed]),
            make_group('g2', [running_b]),
        ])

        result = helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(result, [running_a, running_b])

    def test_get_running_tasks_from_workflow_only_prerunning_raises_too_early(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('a', task.TaskGroupStatus.WAITING)]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)

    def test_get_running_tasks_from_workflow_only_rescheduled_raises_too_early(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('a', task.TaskGroupStatus.RESCHEDULED)]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.TOO_EARLY.value)

    def test_get_running_tasks_from_workflow_only_finished_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [
            make_group('g1', [make_task('a', task.TaskGroupStatus.COMPLETED)]),
            make_group('g2', [make_task('b', task.TaskGroupStatus.FAILED)]),
        ])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)
        self.assertIn('No active tasks', ctx.exception.message)

    def test_get_running_tasks_from_workflow_groups_with_empty_tasks_raises_not_found(self):
        workflow_result = make_workflow('wf-1', [make_group('g1', [])])

        with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
            helpers.get_running_tasks_from_workflow(workflow_result)

        self.assertEqual(ctx.exception.status_code, http.HTTPStatus.NOT_FOUND.value)


class TestGetRouterCookie(unittest.TestCase):

    def test_get_router_cookie_http_scheme_raises_server_error(self):
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            helpers.get_router_cookie('http://router.example.com')

        self.assertIn('Invalid router address', ctx.exception.message)

    def test_get_router_cookie_https_scheme_raises_server_error(self):
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            helpers.get_router_cookie('https://router.example.com')

        self.assertIn('Invalid router address', ctx.exception.message)

    def test_get_router_cookie_unsupported_scheme_raises_server_error(self):
        with self.assertRaises(osmo_errors.OSMOServerError) as ctx:
            helpers.get_router_cookie('ftp://router.example.com')

        self.assertIn('Invalid router address', ctx.exception.message)


if __name__ == '__main__':
    unittest.main()
