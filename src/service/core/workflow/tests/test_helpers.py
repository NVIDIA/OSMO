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
import contextlib
import datetime
import hashlib
import http
import os
import types
import unittest
from unittest import mock

from src.lib.utils import common, osmo_errors, priority as wf_priority
from src.service.core.workflow import helpers, objects
from src.utils import connectors
from src.utils.job import task, workflow as job_workflow


@contextlib.contextmanager
def _patch_context(database):
    """Patch WorkflowServiceContext.get() with a namespace exposing `database`."""
    fake_context = types.SimpleNamespace(database=database)
    with mock.patch.object(
        objects.WorkflowServiceContext, 'get', return_value=fake_context,
    ):
        yield fake_context


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


class TestUserRegistryCredential(unittest.TestCase):
    def test_valid_cred_preserves_path_scoped_registry(self):
        credential = objects.UserRegistryCredential(
            registry='nvcr.io/nvidia',
            username='user',
            auth='token',
        )
        workflow_config = mock.Mock()
        workflow_config.credential_config.disable_registry_validation = []

        with mock.patch(
            'src.service.core.workflow.objects.common.registry_auth',
            return_value=mock.Mock(status_code=200),
        ) as registry_auth:
            credential.valid_cred(workflow_config)

        self.assertEqual(credential.registry, 'nvcr.io/nvidia')
        registry_auth.assert_called_once_with('https://nvcr.io/v2/', 'user', 'token')


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


class TestGetWorkflows(unittest.TestCase):
    """Covers get_workflows SQL construction (lines 50-112)."""

    def _run(self, database, **kwargs):
        with _patch_context(database):
            return helpers.get_workflows(**kwargs)

    def test_get_workflows_no_filters_uses_default_status_exclusion(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        result = self._run(database, order=connectors.ListOrder.ASC)

        self.assertEqual(result, [])
        args, _ = database.execute_fetch_command.call_args
        cmd, params, return_raw = args
        # Default (no statuses supplied) excludes FAILED_SUBMISSION.
        self.assertIn(f'status != %s', cmd)
        self.assertIn(job_workflow.WorkflowStatus.FAILED_SUBMISSION.name, params)
        self.assertNotIn('workflow_tags', cmd)
        self.assertIn('ORDER BY submit_time ASC', cmd)
        # Trailing ORDER BY on the wrapper query.
        self.assertTrue(cmd.rstrip().endswith(';'))
        # Ends with LIMIT/OFFSET.
        self.assertEqual(params[-2:], (20, 0))
        self.assertFalse(return_raw)

    def test_get_workflows_with_tags_joins_workflow_tags(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, tags=['t1', 't2'])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflow_tags', cmd)
        self.assertIn(('t1', 't2'), params)

    def test_get_workflows_with_app_info_adds_name_and_version(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        app_info = common.AppStructure('my-app:3')

        self._run(database, app_info=app_info)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('apps.name = %s', cmd)
        self.assertIn('workflows.app_version = %s', cmd)
        self.assertIn('my-app', params)
        self.assertIn(3, params)

    def test_get_workflows_with_app_info_no_version_omits_version(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        app_info = common.AppStructure('my-app')

        self._run(database, app_info=app_info)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('apps.name = %s', cmd)
        self.assertNotIn('workflows.app_version = %s', cmd)
        self.assertIn('my-app', params)

    def test_get_workflows_with_users_uses_fetch_user_names(self):
        database = mock.Mock()
        database.fetch_user_names.return_value = ['alice', 'bob']
        database.execute_fetch_command.return_value = []

        self._run(database, users=['alice', 'bob'])

        database.fetch_user_names.assert_called_once_with(['alice', 'bob'])
        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('submitted_by IN %s', cmd)
        self.assertIn(('alice', 'bob'), params)

    def test_get_workflows_with_pools_adds_pool_filter(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, pools=['pool-a', 'pool-b'])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('pool IN %s', cmd)
        self.assertIn(('pool-a', 'pool-b'), params)

    def test_get_workflows_with_name_escapes_special_chars(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, name='foo_bar%baz')

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflow_id LIKE %s', cmd)
        self.assertIn(r'%foo\_bar\%baz%', params)

    def test_get_workflows_with_statuses_uses_status_in(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, statuses=[job_workflow.WorkflowStatus.RUNNING,
                                      job_workflow.WorkflowStatus.COMPLETED])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('status IN %s', cmd)
        # Default exclusion should NOT appear when statuses supplied.
        self.assertNotIn('status != %s', cmd)
        self.assertIn(('RUNNING', 'COMPLETED'), params)

    def test_get_workflows_with_submitted_after_and_before(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        after = datetime.datetime(2026, 1, 1, 12, 0, 0)
        before = datetime.datetime(2026, 2, 1, 12, 0, 0)

        self._run(database, submitted_after=after, submitted_before=before)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('submit_time >= %s', cmd)
        self.assertIn('submit_time < %s', cmd)
        self.assertIn(after.replace(microsecond=0).isoformat(), params)
        self.assertIn(before.replace(microsecond=0).isoformat(), params)

    def test_get_workflows_with_priority_adds_priority_in(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, priority=[wf_priority.WorkflowPriority.HIGH])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('priority IN %s', cmd)
        self.assertIn(('HIGH',), params)

    def test_get_workflows_desc_order_uses_desc_in_sql(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, order=connectors.ListOrder.DESC)

        cmd, _, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('ORDER BY submit_time DESC', cmd)

    def test_get_workflows_return_raw_passed_through(self):
        database = mock.Mock()
        raw_rows = [{'workflow_id': 'wf-1'}]
        database.execute_fetch_command.return_value = raw_rows

        result = self._run(database, return_raw=True)

        self.assertEqual(result, raw_rows)
        _, _, return_raw = database.execute_fetch_command.call_args[0]
        self.assertTrue(return_raw)


class TestGetTasks(unittest.TestCase):
    """Covers get_tasks SQL construction (lines 130-227)."""

    def _run(self, database, **kwargs):
        with _patch_context(database):
            return helpers.get_tasks(**kwargs)

    def test_get_tasks_summary_selects_sums_and_filters_null_pool(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, summary=True)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('SUM(tasks.disk_count)', cmd)
        self.assertIn('workflows.pool IS NOT NULL', cmd)
        self.assertIn('GROUP BY workflows.submitted_by, workflows.pool, workflows.priority', cmd)
        # Summary limits are clamped to 1000.
        self.assertEqual(params[-2:], (20, 0))
        # ROW_NUMBER wrapper is always applied.
        self.assertIn('ROW_NUMBER() OVER ()', cmd)

    def test_get_tasks_aggregate_by_workflow_selects_workflow_id(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, aggregate_by_workflow=True, limit=5000)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflows.workflow_id', cmd)
        self.assertIn('SUM(tasks.disk_count)', cmd)
        self.assertIn(
            'GROUP BY workflows.workflow_id, workflows.submitted_by, '
            'workflows.pool, workflows.priority',
            cmd,
        )
        # Limit is clamped to 1000 for aggregate mode.
        self.assertEqual(params[-2:], (1000, 0))

    def test_get_tasks_default_selects_task_columns(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('tasks.*', cmd)
        # Default mode uses CASE-based status ordering.
        self.assertIn("WHEN tasks.status = 'SCHEDULING' THEN 1", cmd)
        self.assertIn("WHEN tasks.status = 'RUNNING' THEN 3", cmd)
        # Default mode does not require pool to be not null.
        self.assertNotIn('workflows.pool IS NOT NULL', cmd)
        self.assertEqual(params[-2:], (20, 0))

    def test_get_tasks_with_workflow_id_escapes_special_chars(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, workflow_id='wf_100%foo')

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('tasks.workflow_id LIKE %s', cmd)
        self.assertIn(r'%wf\_100\%foo%', params)

    def test_get_tasks_with_statuses_uses_status_in(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, statuses=[task.TaskGroupStatus.RUNNING])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('tasks.status IN %s', cmd)
        self.assertIn(('RUNNING',), params)

    def test_get_tasks_with_users_uses_fetch_user_names(self):
        database = mock.Mock()
        database.fetch_user_names.return_value = ['alice']
        database.execute_fetch_command.return_value = []

        self._run(database, users=['alice'])

        database.fetch_user_names.assert_called_once_with(['alice'])
        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflows.submitted_by IN %s', cmd)
        self.assertIn(('alice',), params)

    def test_get_tasks_with_pools_and_nodes(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, pools=['pool-a'], nodes=['node-1', 'node-2'])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflows.pool IN %s', cmd)
        self.assertIn('tasks.node_name IN %s', cmd)
        self.assertIn(('pool-a',), params)
        self.assertIn(('node-1', 'node-2'), params)

    def test_get_tasks_with_started_after_and_before(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []
        after = datetime.datetime(2026, 1, 1, 12, 0, 0)
        before = datetime.datetime(2026, 2, 1, 12, 0, 0)

        self._run(database, started_after=after, started_before=before)

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('tasks.start_time >= %s OR tasks.start_time is NULL', cmd)
        self.assertIn('tasks.start_time < %s AND tasks.start_time is not NULL', cmd)
        self.assertIn(after.replace(microsecond=0).isoformat(), params)
        self.assertIn(before.replace(microsecond=0).isoformat(), params)

    def test_get_tasks_with_priority_filter(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, priority=[wf_priority.WorkflowPriority.LOW])

        cmd, params, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('workflows.priority IN %s', cmd)
        self.assertIn(('LOW',), params)

    def test_get_tasks_asc_order_uses_rn_desc(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, order=connectors.ListOrder.ASC)

        cmd, _, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('ORDER BY rn DESC', cmd)

    def test_get_tasks_desc_order_uses_rn_asc(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        self._run(database, order=connectors.ListOrder.DESC)

        cmd, _, _ = database.execute_fetch_command.call_args[0]
        self.assertIn('ORDER BY rn ASC', cmd)


class TestGetPoolResources(unittest.TestCase):
    """Covers get_pool_resources (lines 240-310)."""

    def test_get_pool_resources_empty_returns_empty_response(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context(database):
            result = helpers.get_pool_resources()

        self.assertEqual(result.pools, [])
        cmd, params = database.execute_fetch_command.call_args[0]
        # No pool filter: WHERE clause is absent.
        self.assertNotIn('pools.name IN', cmd)
        self.assertEqual(params, ())

    def test_get_pool_resources_with_pools_filters_pool_names(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context(database):
            helpers.get_pool_resources(pools=['pool-a'])

        cmd, params = database.execute_fetch_command.call_args[0]
        self.assertIn('pools.name IN %s', cmd)
        self.assertIn(('pool-a',), params)

    def test_get_pool_resources_with_pools_and_platforms_filters_both(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context(database):
            helpers.get_pool_resources(pools=['pool-a'], platforms=['gpu-a100'])

        cmd, params = database.execute_fetch_command.call_args[0]
        self.assertIn('pools.name IN %s', cmd)
        self.assertIn('keys IN %s', cmd)
        self.assertIn(('pool-a',), params)
        self.assertIn(('gpu-a100',), params)

    def test_get_pool_resources_with_platforms_only_ignores_platforms(self):
        # Platforms is only applied when pools is truthy (per implementation).
        database = mock.Mock()
        database.execute_fetch_command.return_value = []

        with _patch_context(database):
            helpers.get_pool_resources(platforms=['gpu-a100'])

        cmd, params = database.execute_fetch_command.call_args[0]
        self.assertNotIn('keys IN', cmd)
        self.assertEqual(params, ())

    def test_get_pool_resources_maintenance_status(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [{
            'name': 'pool-m',
            'platform': 'gpu',
            'backend': 'k8s-1',
            'last_heartbeat': None,
            'enable_maintenance': True,
            'usage_fields': [],
            'allocatable_fields': [],
        }]

        with _patch_context(database):
            response = helpers.get_pool_resources()

        self.assertEqual(len(response.pools), 1)
        entry = response.pools[0]
        self.assertEqual(entry.status, connectors.PoolStatus.MAINTENANCE)
        self.assertEqual(entry.pool, 'pool-m')
        self.assertEqual(entry.platform, 'gpu')
        self.assertEqual(entry.backend, 'k8s-1')
        # Empty usage/allocatable defaults to zeros for each label.
        for label in common.ALLOCATABLE_RESOURCES_LABELS:
            self.assertEqual(entry.usage_fields[label.name], 0)
            self.assertEqual(entry.allocatable_fields[label.name], 0)

    def test_get_pool_resources_offline_status_when_no_heartbeat(self):
        database = mock.Mock()
        database.execute_fetch_command.return_value = [{
            'name': 'pool-o',
            'platform': 'gpu',
            'backend': 'k8s-1',
            'last_heartbeat': None,
            'enable_maintenance': False,
            'usage_fields': [],
            'allocatable_fields': [],
        }]

        with _patch_context(database):
            response = helpers.get_pool_resources()

        self.assertEqual(response.pools[0].status, connectors.PoolStatus.OFFLINE)

    def test_get_pool_resources_online_when_heartbeat_recent(self):
        database = mock.Mock()
        # common.current_time() returns a naive UTC datetime, so match that.
        recent = datetime.datetime.utcnow()
        database.execute_fetch_command.return_value = [{
            'name': 'pool-online',
            'platform': 'gpu',
            'backend': 'k8s-1',
            'last_heartbeat': recent,
            'enable_maintenance': False,
            'usage_fields': [],
            'allocatable_fields': [],
        }]

        with _patch_context(database):
            response = helpers.get_pool_resources()

        self.assertEqual(response.pools[0].status, connectors.PoolStatus.ONLINE)

    def test_get_pool_resources_accumulates_usage_and_allocatable(self):
        # Cover the resource-aggregation loop (lines 290-302). Patch the
        # underlying conversion helpers so we control the numeric output.
        database = mock.Mock()
        database.execute_fetch_command.return_value = [{
            'name': 'pool-agg',
            'platform': 'gpu',
            'backend': 'k8s-1',
            'last_heartbeat': None,
            'enable_maintenance': False,
            # Two non-empty jsonb aggregate entries — the loop should
            # accumulate over both.
            'usage_fields': [{'cpu': '2'}, {'cpu': '3'}],
            'allocatable_fields': [{'cpu': '4'}, {'cpu': '5'}],
        }]

        # convert_allocatable is a classmethod on BackendResource; the loop
        # feeds its return value into convert_allocatable_request_fields.
        with _patch_context(database), \
             mock.patch.object(
                 helpers.connectors.BackendResource, 'convert_allocatable',
                 side_effect=lambda x: dict(x)), \
             mock.patch.object(
                 helpers.common, 'convert_allocatable_request_fields',
                 return_value=(10, 1)):
            response = helpers.get_pool_resources()

        entry = response.pools[0]
        # Two iterations of the outer zip, four resource labels per iteration
        # -> each label ends up with 2 * 1 usage and 2 * 10 allocatable.
        self.assertEqual(entry.usage_fields['cpu'], 2)
        self.assertEqual(entry.allocatable_fields['cpu'], 20)

    def test_get_pool_resources_skips_empty_usage_or_allocatable(self):
        # None fields inside the jsonb aggregates are skipped by the loop.
        database = mock.Mock()
        database.execute_fetch_command.return_value = [{
            'name': 'pool-skip',
            'platform': 'gpu',
            'backend': 'k8s-1',
            'last_heartbeat': None,
            'enable_maintenance': False,
            'usage_fields': [None, None],
            'allocatable_fields': [None, None],
        }]

        with _patch_context(database):
            response = helpers.get_pool_resources()

        entry = response.pools[0]
        for label in common.ALLOCATABLE_RESOURCES_LABELS:
            self.assertEqual(entry.usage_fields[label.name], 0)
            self.assertEqual(entry.allocatable_fields[label.name], 0)


class TestSetWorkflowTags(unittest.TestCase):
    """Covers set_workflow_tags (lines 404-449)."""

    def _database_with_tags(self, allowed_tags):
        database = mock.Mock()
        workflow_configs = mock.Mock()
        workflow_configs.workflow_info.tags = list(allowed_tags)
        database.get_workflow_configs.return_value = workflow_configs
        return database

    def test_set_workflow_tags_invalid_add_tag_raises_user_error(self):
        database = self._database_with_tags(['approved'])

        with _patch_context(database):
            with self.assertRaises(osmo_errors.OSMOUserError) as ctx:
                helpers.set_workflow_tags('wf-1', add_tags=['not-allowed'],
                                          remove_tags=None)

        self.assertIn('Invalid tag detected', ctx.exception.message)
        database.execute_commit_command.assert_not_called()

    def test_set_workflow_tags_add_only_builds_insert_command(self):
        database = self._database_with_tags(['approved', 'reviewed'])

        with _patch_context(database):
            helpers.set_workflow_tags('wf-1', add_tags=['approved'], remove_tags=None)

        database.execute_commit_command.assert_called_once()
        cmd, params = database.execute_commit_command.call_args[0]
        self.assertIn('INSERT INTO workflow_tags', cmd)
        self.assertNotIn('DELETE FROM workflow_tags', cmd)
        self.assertEqual(params, ('wf-1', 'approved'))

    def test_set_workflow_tags_remove_only_builds_delete_command(self):
        database = self._database_with_tags(['approved'])

        with _patch_context(database):
            helpers.set_workflow_tags('wf-1', add_tags=None,
                                      remove_tags=['approved', 'stale'])

        cmd, params = database.execute_commit_command.call_args[0]
        self.assertIn('DELETE FROM workflow_tags', cmd)
        self.assertNotIn('INSERT INTO workflow_tags', cmd)
        # Params: workflow_id, workflow_id, tuple(remove_tags)
        self.assertEqual(params, ('wf-1', 'wf-1', ('approved', 'stale')))

    def test_set_workflow_tags_add_and_remove_combined(self):
        database = self._database_with_tags(['approved', 'reviewed'])

        with _patch_context(database):
            helpers.set_workflow_tags('wf-1', add_tags=['approved', 'reviewed'],
                                      remove_tags=['stale'])

        cmd, params = database.execute_commit_command.call_args[0]
        self.assertIn('DELETE FROM workflow_tags', cmd)
        self.assertIn('INSERT INTO workflow_tags', cmd)
        # First: delete params (workflow_id, workflow_id, tuple(remove_tags))
        # Then: insert params expanded from add_tags pairs.
        self.assertEqual(
            params,
            ('wf-1', 'wf-1', ('stale',), 'wf-1', 'approved', 'wf-1', 'reviewed'),
        )

    def test_set_workflow_tags_no_add_no_remove_still_commits(self):
        database = self._database_with_tags(['approved'])

        with _patch_context(database):
            helpers.set_workflow_tags('wf-1', add_tags=None, remove_tags=None)

        cmd, params = database.execute_commit_command.call_args[0]
        self.assertIn('BEGIN;', cmd)
        self.assertIn('COMMIT;', cmd)
        self.assertNotIn('INSERT INTO workflow_tags', cmd)
        self.assertNotIn('DELETE FROM workflow_tags', cmd)
        self.assertEqual(params, ())


if __name__ == '__main__':
    unittest.main()
