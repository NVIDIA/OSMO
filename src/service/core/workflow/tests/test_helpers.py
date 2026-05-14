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
import hashlib
import http
import os
import types
import unittest
from unittest import mock

from src.lib.utils import common, osmo_errors
from src.service.core.workflow import helpers, objects
from src.utils.job import task


class _FakeListedObject:
    """Minimal stand-in for storage list_objects result entries."""

    def __init__(self, key: str):
        self.key = key


class _FakeCookie:
    """Minimal cookie object compatible with _cookie_to_header_string."""

    def __init__(self, name: str, value: str, path: str = '/',
                 secure: bool = False, same_site: str = ''):
        self.name = name
        self.value = value
        self.path = path
        self.secure = secure
        self._rest = {'SameSite': same_site} if same_site else {}


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


class TestWorkflowFileExists(unittest.TestCase):

    def test_workflow_file_exists_returns_true_when_object_matches(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key='wf-1/spec.yaml'),
        ]

        result = helpers.workflow_file_exists('wf-1', 'spec.yaml', storage_client)

        self.assertTrue(result)
        storage_client.list_objects.assert_called_once_with(
            prefix=os.path.join('wf-1', 'spec.yaml'),
        )

    def test_workflow_file_exists_returns_false_when_no_matching_object(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key='wf-1/other.yaml'),
        ]

        result = helpers.workflow_file_exists('wf-1', 'spec.yaml', storage_client)

        self.assertFalse(result)

    def test_workflow_file_exists_returns_false_when_listing_empty(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = []

        result = helpers.workflow_file_exists('wf-1', 'spec.yaml', storage_client)

        self.assertFalse(result)

    def test_workflow_file_exists_matches_only_basename(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key='wf-1/sub/spec.yaml'),
        ]

        result = helpers.workflow_file_exists('wf-1', 'spec.yaml', storage_client)

        self.assertTrue(result)


class TestGetWorkflowFile(unittest.TestCase):

    def test_get_workflow_file_streams_non_templated_file_with_existence_precheck(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key='wf-1/output.log'),
        ]
        sentinel_stream = object()
        storage_client.get_object_stream.return_value = sentinel_stream

        result = helpers.get_workflow_file('output.log', 'wf-1', storage_client)

        self.assertIs(result, sentinel_stream)
        storage_client.list_objects.assert_called_once_with(
            prefix=os.path.join('wf-1', 'output.log'),
        )
        storage_client.get_object_stream.assert_called_once_with(
            os.path.join('wf-1', 'output.log'),
            as_lines=True,
        )

    def test_get_workflow_file_with_last_n_lines_passes_through(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key='wf-1/output.log'),
        ]
        sentinel_stream = object()
        storage_client.get_object_stream.return_value = sentinel_stream

        result = helpers.get_workflow_file(
            'output.log', 'wf-1', storage_client, last_n_lines=10,
        )

        self.assertIs(result, sentinel_stream)
        storage_client.get_object_stream.assert_called_once_with(
            os.path.join('wf-1', 'output.log'),
            last_n_lines=10,
        )

    def test_get_workflow_file_templated_uses_templated_when_present(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = [
            _FakeListedObject(key=f'wf-1/{common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME}'),
        ]
        sentinel_stream = object()
        storage_client.get_object_stream.return_value = sentinel_stream

        result = helpers.get_workflow_file(
            common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME, 'wf-1', storage_client,
        )

        self.assertIs(result, sentinel_stream)
        storage_client.get_object_stream.assert_called_once_with(
            os.path.join('wf-1', common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME),
            as_lines=True,
        )

    def test_get_workflow_file_templated_falls_back_to_rendered_spec(self):
        storage_client = mock.Mock()
        storage_client.list_objects.return_value = []
        sentinel_stream = object()
        storage_client.get_object_stream.return_value = sentinel_stream

        result = helpers.get_workflow_file(
            common.TEMPLATED_WORKFLOW_SPEC_FILE_NAME, 'wf-1', storage_client,
        )

        self.assertIs(result, sentinel_stream)
        storage_client.get_object_stream.assert_called_once_with(
            os.path.join('wf-1', common.WORKFLOW_SPEC_FILE_NAME),
            as_lines=True,
        )


class TestGetRouterCookieSuccess(unittest.TestCase):

    def test_get_router_cookie_wss_scheme_calls_https(self):
        fake_response = mock.Mock()
        fake_response.cookies = []

        with mock.patch.object(helpers.requests, 'get',
                               return_value=fake_response) as mock_get:
            result = helpers.get_router_cookie('wss://router.example.com', timeout=5)

        self.assertEqual(result, '')
        mock_get.assert_called_once_with(
            'https://router.example.com/api/router/version', timeout=5,
        )

    def test_get_router_cookie_ws_scheme_calls_http(self):
        fake_response = mock.Mock()
        fake_response.cookies = []

        with mock.patch.object(helpers.requests, 'get',
                               return_value=fake_response) as mock_get:
            result = helpers.get_router_cookie('ws://router.example.com', timeout=5)

        self.assertEqual(result, '')
        mock_get.assert_called_once_with(
            'http://router.example.com/api/router/version', timeout=5,
        )

    def test_get_router_cookie_formats_single_cookie(self):
        fake_response = mock.Mock()
        fake_response.cookies = [
            _FakeCookie(name='session', value='abc', path='/'),
        ]

        with mock.patch.object(helpers.requests, 'get', return_value=fake_response):
            result = helpers.get_router_cookie('wss://router.example.com')

        self.assertEqual(result, 'session=abc; Path=/')

    def test_get_router_cookie_secure_cookie_includes_secure(self):
        fake_response = mock.Mock()
        fake_response.cookies = [
            _FakeCookie(name='session', value='abc', path='/', secure=True),
        ]

        with mock.patch.object(helpers.requests, 'get', return_value=fake_response):
            result = helpers.get_router_cookie('wss://router.example.com')

        self.assertEqual(result, 'session=abc; Path=/; Secure')

    def test_get_router_cookie_same_site_cookie_includes_same_site(self):
        fake_response = mock.Mock()
        fake_response.cookies = [
            _FakeCookie(name='session', value='abc', path='/api', same_site='Strict'),
        ]

        with mock.patch.object(helpers.requests, 'get', return_value=fake_response):
            result = helpers.get_router_cookie('wss://router.example.com')

        self.assertEqual(result, 'session=abc; Path=/api; SameSite=Strict')

    def test_get_router_cookie_joins_multiple_cookies_with_comma(self):
        fake_response = mock.Mock()
        fake_response.cookies = [
            _FakeCookie(name='a', value='1', path='/'),
            _FakeCookie(name='b', value='2', path='/'),
        ]

        with mock.patch.object(helpers.requests, 'get', return_value=fake_response):
            result = helpers.get_router_cookie('wss://router.example.com')

        self.assertEqual(result, 'a=1; Path=/, b=2; Path=/')


class TestGetRecentTasks(unittest.TestCase):

    def test_get_recent_tasks_passes_cutoff_time_to_database(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        fixed_now = datetime.datetime(2026, 5, 14, 12, 0, 0,
                                      tzinfo=datetime.timezone.utc)
        fake_datetime = types.SimpleNamespace(
            datetime=mock.Mock(wraps=datetime.datetime),
            timedelta=datetime.timedelta,
            timezone=datetime.timezone,
        )
        fake_datetime.datetime.now = mock.Mock(return_value=fixed_now)

        with mock.patch.object(helpers, 'datetime', fake_datetime):
            result = helpers.get_recent_tasks(database, minutes_ago=5)

        self.assertEqual(result, [])
        args, _ = database.execute_fetch_command.call_args
        cutoff = args[1][0]
        self.assertEqual(
            cutoff,
            fixed_now - datetime.timedelta(minutes=5),
        )
        self.assertIs(args[2], True)

    def test_get_recent_tasks_returns_database_rows(self):
        rows = [{'pool': 'p1', 'user': 'u1', 'workflow_uuid': 'wf-1',
                 'status': 'RUNNING'}]
        database = mock.Mock()
        database.execute_fetch_command.return_value = rows

        result = helpers.get_recent_tasks(database, minutes_ago=10)

        self.assertEqual(result, rows)

    def test_get_recent_tasks_default_minutes_ago_is_five(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        fixed_now = datetime.datetime(2026, 5, 14, 12, 0, 0,
                                      tzinfo=datetime.timezone.utc)
        fake_datetime = types.SimpleNamespace(
            datetime=mock.Mock(wraps=datetime.datetime),
            timedelta=datetime.timedelta,
            timezone=datetime.timezone,
        )
        fake_datetime.datetime.now = mock.Mock(return_value=fixed_now)

        with mock.patch.object(helpers, 'datetime', fake_datetime):
            helpers.get_recent_tasks(database)

        args, _ = database.execute_fetch_command.call_args
        cutoff = args[1][0]
        self.assertEqual(
            cutoff,
            fixed_now - datetime.timedelta(minutes=5),
        )


if __name__ == '__main__':
    unittest.main()
