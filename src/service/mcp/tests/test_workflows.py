"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved. # pylint: disable=line-too-long

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

import asyncio
from collections.abc import AsyncIterator
import contextlib
import json
import unittest

import httpx
from fastmcp.exceptions import ToolError

from src.service.mcp import request_context, workflows
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'workflow-tool-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_list_workflows',
        'osmo_list_tasks',
        'osmo_get_workflow',
        'osmo_get_workflow_logs',
        'osmo_get_workflow_events',
        'osmo_get_workflow_spec',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id='workflow-request-123',
    request_timeout_seconds=5,
)
_PROFILE_RESULT = {
    'profile': {
        'username': 'alice@example.com',
        'pool': 'pool-a',
    },
    'roles': ['osmo-user'],
    'pools': ['pool-a', 'pool-b'],
    'token': None,
}
_SUMMARY = {
    'user': 'alice@example.com',
    'name': 'wf-1',
    'workflow_uuid': '11111111-1111-1111-1111-111111111111',
    'submit_time': '2026-07-15T12:00:00Z',
    'start_time': None,
    'end_time': None,
    'queued_time': 2.0,
    'duration': None,
    'status': 'RUNNING',
    'overview': 'https://osmo.test/workflows/wf-1',
    'logs': 'https://osmo.test/api/workflow/wf-1/logs',
    'error_logs': None,
    'grafana_url': None,
    'dashboard_url': None,
    'pool': 'pool-a',
    'app_owner': None,
    'app_name': None,
    'app_version': None,
    'priority': 'NORMAL',
    'labels': {
        'project': 'sim_alpha',
        'team': 'robotics',
    },
}
_TASK_SUMMARY = {
    'user': 'bob@example.com',
    'workflow_id': 'wf-2',
    'workflow_uuid': '33333333-3333-3333-3333-333333333333',
    'task_name': 'trainer',
    'retry_id': 1,
    'pool': 'pool-b',
    'node': 'node-1',
    'start_time': '2026-08-17T12:00:00Z',
    'end_time': None,
    'duration': 120.0,
    'status': 'RUNNING',
    'overview': 'https://osmo.test/workflows/wf-2',
    'logs': 'https://osmo.test/api/workflow/wf-2/logs',
    'error_logs': None,
    'grafana_url': None,
    'dashboard_url': None,
    'storage': 20.0,
    'cpu': 8,
    'memory': 64.0,
    'gpu': 4,
    'priority': 'HIGH',
}
_DETAIL: dict[str, object] = {
    'name': 'wf-1',
    'uuid': '11111111-1111-1111-1111-111111111111',
    'submitted_by': 'alice@example.com',
    'cancelled_by': None,
    'spec': 'must-not-be-returned-by-query-tool',
    'template_spec': 'must-not-be-returned-by-query-tool',
    'logs': 'https://osmo.test/api/workflow/wf-1/logs',
    'events': 'https://osmo.test/api/workflow/wf-1/events',
    'overview': 'https://osmo.test/workflows/wf-1',
    'parent_name': None,
    'parent_job_id': None,
    'dashboard_url': 'https://user:dashboard-secret@example.test/workflow',
    'grafana_url': 'https://grafana.test/view?token=grafana-secret#private',
    'tags': ['nightly'],
    'submit_time': '2026-07-15T12:00:00Z',
    'start_time': '2026-07-15T12:01:00Z',
    'end_time': None,
    'exec_timeout': None,
    'queue_timeout': None,
    'duration': None,
    'queued_time': 60.0,
    'status': 'RUNNING',
    'outputs': '',
    'groups': [{
        'name': 'train',
        'status': 'RUNNING',
        'start_time': '2026-07-15T12:01:00Z',
        'end_time': None,
        'failure_message': None,
        'tasks': [{
            'name': 'train-0',
            'retry_id': 0,
            'status': 'RUNNING',
            'failure_message': None,
            'exit_code': None,
            'start_time': '2026-07-15T12:01:00Z',
            'end_time': None,
            'node_name': 'node-1',
            'lead': True,
            'pod_name': 'pod-1',
            'task_uuid': '22222222-2222-2222-2222-222222222222',
        }],
    }],
    'pool': 'pool-a',
    'backend': 'backend-a',
    'app_owner': None,
    'app_name': None,
    'app_version': None,
    'plugins': {},
    'priority': 'NORMAL',
    'labels': {
        'project': 'sim_alpha',
        'team': 'robotics',
    },
    'warnings': [
        "Workflow is missing label 'cost-center'; add it before enforcement.",
    ],
}


class _StalledTextStream(httpx.AsyncByteStream):
    """Yield one text prefix and remain open like a running workflow stream."""

    def __init__(self, prefix: bytes) -> None:
        self._prefix = prefix
        self.close_count = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield self._prefix
        await asyncio.Future()

    async def aclose(self) -> None:
        self.close_count += 1


@contextlib.asynccontextmanager
async def _mcp_client(
    handler: protocol_harness.AsyncUpstreamHandler,
    *,
    accessible_pools: list[str] | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    async def scoped_handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == '/api/profile/settings':
            profile_result = dict(_PROFILE_RESULT)
            if accessible_pools is not None:
                profile_result['pools'] = accessible_pools
            return httpx.Response(200, json=profile_result)
        return await handler(request)

    async with _HARNESS.client(scoped_handler) as client:
        yield client


async def _call_tool(
    client: httpx.AsyncClient,
    name: str,
    arguments: dict[str, object] | None = None,
    *,
    request_id: int = 1,
) -> httpx.Response:
    return await _HARNESS.call_tool_with_client(
        client,
        name,
        arguments,
        request_id=request_id,
    )


class WorkflowToolProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise workflow tools through the real Streamable HTTP protocol."""

    async def test_catalog_has_closed_schemas_and_read_annotations(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_read_only_closed_catalog(self, response)

        list_properties = tools['osmo_list_workflows']['inputSchema']['properties']
        self.assertEqual(list_properties['limit']['default'], 50)
        self.assertEqual(list_properties['limit']['minimum'], 1)
        self.assertEqual(list_properties['limit']['maximum'], 50)
        self.assertEqual(list_properties['offset']['minimum'], 0)
        self.assertEqual(list_properties['labels']['default'], None)
        self.assertEqual(list_properties['no_labels']['default'], None)
        self.assertEqual(
            list_properties['labels']['anyOf'][0]['maxItems'],
            50,
        )
        self.assertEqual(
            list_properties['no_labels']['anyOf'][0]['maxItems'],
            50,
        )
        task_properties = tools['osmo_list_tasks']['inputSchema']['properties']
        self.assertEqual(task_properties['limit']['default'], 50)
        self.assertEqual(task_properties['limit']['minimum'], 1)
        self.assertEqual(task_properties['limit']['maximum'], 50)
        self.assertEqual(task_properties['offset']['minimum'], 0)
        self.assertEqual(task_properties['node']['minItems'], 1)
        self.assertEqual(
            tools['osmo_list_tasks']['inputSchema']['required'],
            ['node'],
        )
        task_schema = json.dumps(task_properties)
        for value in (
            'SUBMITTING',
            'PROCESSING',
            'SCHEDULING',
            'RUNNING',
            'RESCHEDULED',
            'FAILED_UPSTREAM',
        ):
            self.assertIn(value, task_schema)
        list_schema = json.dumps(list_properties)
        for value in ('RUNNING', 'FAILED_PREEMPTED', 'HIGH', 'NORMAL', 'LOW'):
            self.assertIn(value, list_schema)
        workflow_id_schema = json.dumps(
            tools['osmo_get_workflow']['inputSchema']['properties']['workflow_id']
        )
        self.assertIn('Canonical OSMO workflow ID', workflow_id_schema)
        self.assertIn(
            'skip_groups',
            tools['osmo_get_workflow']['inputSchema']['properties'],
        )

        log_properties = tools['osmo_get_workflow_logs']['inputSchema']['properties']
        self.assertEqual(log_properties['last_n_lines']['anyOf'][0]['minimum'], 1)
        self.assertEqual(log_properties['last_n_lines']['anyOf'][0]['maximum'], 10_000)
        self.assertEqual(log_properties['retry_id']['anyOf'][0]['minimum'], 0)

    async def test_default_list_is_current_user_accessible_pools_newest_first(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'workflows': [_SUMMARY],
                'more_entries': True,
            })

        async with _mcp_client(handler) as client:
            response = await _call_tool(client, 'osmo_list_workflows')

        result = response.json()['result']
        self.assertFalse(result['isError'])
        structured = result['structuredContent']
        self.assertEqual(structured['count'], 1)
        self.assertEqual(structured['limit'], 50)
        self.assertEqual(structured['offset'], 0)
        self.assertTrue(structured['more_entries'])
        self.assertEqual(structured['workflows'][0]['name'], 'wf-1')
        self.assertEqual(
            structured['workflows'][0]['labels'],
            {'project': 'sim_alpha', 'team': 'robotics'},
        )
        self.assertNotIn('logs', structured['workflows'][0])
        self.assertNotIn(_BEARER_SECRET, response.text)

        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.url.path, '/api/workflow')
        self.assertEqual(request.url.params.multi_items(), [
            ('limit', '50'),
            ('offset', '0'),
            ('order', 'DESC'),
            ('pools', 'pool-a'),
            ('pools', 'pool-b'),
        ])
        self.assertNotIn('users', request.url.params)
        self.assertNotIn('all_users', request.url.params)
        self.assertEqual(
            request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            request.headers[request_context.REQUEST_ID_HEADER],
            'workflow-request-123',
        )

    async def test_filtered_list_maps_only_approved_queries(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'workflows': [],
                'more_entries': False,
            })

        async with _mcp_client(handler) as client:
            response = await _call_tool(client, 'osmo_list_workflows', {
                'status': ['FAILED', 'RUNNING'],
                'name': 'training',
                'pool': ['pool-a', 'pool-b'],
                'tags': ['nightly', 'gpu'],
                'app': 'trainer:2',
                'priority': ['HIGH', 'LOW'],
                'labels': [
                    'project=(sim_*|hil_*)',
                    'team=robotics',
                ],
                'no_labels': ['deprecated.example.com/owner'],
                'limit': 7,
                'offset': 3,
            })

        self.assertFalse(response.json()['result']['isError'])
        request = captured_requests[0]
        self.assertEqual(request.url.params.multi_items(), [
            ('limit', '7'),
            ('offset', '3'),
            ('order', 'DESC'),
            ('statuses', 'FAILED'),
            ('statuses', 'RUNNING'),
            ('name', 'training'),
            ('tags', 'nightly'),
            ('tags', 'gpu'),
            ('app', 'trainer:2'),
            ('priority', 'HIGH'),
            ('priority', 'LOW'),
            ('label', 'project=(sim_*|hil_*)'),
            ('label', 'team=robotics'),
            ('no_label', 'deprecated.example.com/owner'),
            ('pools', 'pool-a'),
            ('pools', 'pool-b'),
        ])
        self.assertNotIn('all_pools', request.url.params)

    async def test_task_list_maps_node_filters_and_projects_owner_fields(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={'tasks': [
                {**_TASK_SUMMARY, 'status': 'SUBMITTING'},
                {
                    **_TASK_SUMMARY,
                    'workflow_id': 'wf-3',
                    'status': 'RESCHEDULED',
                },
            ]})

        async with _mcp_client(handler) as client:
            response = await _call_tool(client, 'osmo_list_tasks', {
                'node': ['node-1', 'node-2'],
                'status': ['SUBMITTING', 'RESCHEDULED'],
                'priority': ['HIGH', 'LOW'],
                'all_users': True,
                'limit': 1,
                'offset': 3,
            })

        result = response.json()['result']
        self.assertFalse(result['isError'])
        structured = result['structuredContent']
        self.assertEqual(structured['count'], 1)
        self.assertTrue(structured['more_entries'])
        self.assertEqual(structured['tasks'][0], {
            'user': 'bob@example.com',
            'workflow_id': 'wf-2',
            'task_name': 'trainer',
            'retry_id': 1,
            'status': 'SUBMITTING',
            'priority': 'HIGH',
            'pool': 'pool-b',
            'node': 'node-1',
            'start_time': '2026-08-17T12:00:00Z',
            'end_time': None,
            'duration': 120.0,
        })
        self.assertNotIn('logs', structured['tasks'][0])
        self.assertNotIn('overview', structured['tasks'][0])
        self.assertEqual(
            captured_requests[0].url.params.multi_items(),
            [
                ('nodes', 'node-1'),
                ('nodes', 'node-2'),
                ('limit', '2'),
                ('offset', '3'),
                ('order', 'DESC'),
                ('statuses', 'SUBMITTING'),
                ('statuses', 'RESCHEDULED'),
                ('priority', 'HIGH'),
                ('priority', 'LOW'),
                ('all_users', 'true'),
                ('pools', 'pool-a'),
                ('pools', 'pool-b'),
            ],
        )

    async def test_task_list_omits_status_filter_when_unspecified(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={'tasks': [
                {**_TASK_SUMMARY, 'status': 'SUBMITTING'},
                {
                    **_TASK_SUMMARY,
                    'status': 'FUTURE_TASK_STATUS',
                    'priority': 'URGENT',
                },
            ]})

        async with _mcp_client(handler) as client:
            response = await _call_tool(
                client,
                'osmo_list_tasks',
                {'node': ['node-1']},
            )

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(
            [
                task['status']
                for task in response.json()['result']['structuredContent']['tasks']
            ],
            ['SUBMITTING', 'FUTURE_TASK_STATUS'],
        )
        self.assertEqual(
            [
                task['priority']
                for task in response.json()['result']['structuredContent']['tasks']
            ],
            ['HIGH', 'URGENT'],
        )
        self.assertEqual(
            captured_requests[0].url.params.multi_items(),
            [
                ('nodes', 'node-1'),
                ('limit', '51'),
                ('offset', '0'),
                ('order', 'DESC'),
                ('pools', 'pool-a'),
                ('pools', 'pool-b'),
            ],
        )
        self.assertNotIn('all_users', captured_requests[0].url.params)

    async def test_task_list_with_no_accessible_pools_returns_empty_page(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={'tasks': []})

        async with _mcp_client(handler, accessible_pools=[]) as client:
            response = await _call_tool(
                client,
                'osmo_list_tasks',
                {'node': ['node-1'], 'status': ['RUNNING']},
            )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'tasks': [],
            'count': 0,
            'more_entries': False,
            'offset': 0,
            'limit': 50,
        })
        self.assertEqual(captured_requests, [])

    async def test_list_rejects_inaccessible_pool_before_workflow_relay(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'workflows': [],
                'more_entries': False,
            })

        async with _mcp_client(handler) as client:
            response = await _call_tool(client, 'osmo_list_workflows', {
                'pool': ['private-pool'],
            })

        self.assertTrue(response.json()['result']['isError'])
        self.assertEqual(captured_requests, [])

    async def test_list_with_no_accessible_pools_returns_empty_page(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'workflows': [],
                'more_entries': False,
            })

        async with _mcp_client(handler, accessible_pools=[]) as client:
            response = await _call_tool(client, 'osmo_list_workflows')

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflows': [],
            'count': 0,
            'more_entries': False,
            'offset': 0,
            'limit': 50,
        })
        self.assertEqual(captured_requests, [])

    async def test_get_and_text_tools_use_exact_routes_and_queries(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/workflow/wf-1':
                return httpx.Response(200, json=_DETAIL)
            if request.url.path == '/api/workflow/wf-1/error_logs':
                return httpx.Response(200, content=b'error line\n')
            if request.url.path == '/api/workflow/wf-1/logs':
                return httpx.Response(200, content=b'normal line\n')
            if request.url.path == '/api/workflow/wf-1/events':
                return httpx.Response(200, content=b'scheduled\n')
            if request.url.path == '/api/workflow/wf-1/spec':
                return httpx.Response(200, content=b'name: workflow\n')
            raise AssertionError(f'unexpected path: {request.url.path}')

        async with _mcp_client(handler) as client:
            get_response = await _call_tool(
                client,
                'osmo_get_workflow',
                {
                    'workflow_id': 'wf-1',
                    'verbose': True,
                    'skip_groups': True,
                },
                request_id=1,
            )
            logs_response = await _call_tool(
                client,
                'osmo_get_workflow_logs',
                {
                    'workflow_id': 'wf-1',
                    'task_name': 'train-0',
                    'error_logs': True,
                    'last_n_lines': 25,
                    'retry_id': 2,
                },
                request_id=2,
            )
            normal_logs_response = await _call_tool(
                client,
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1'},
                request_id=3,
            )
            events_response = await _call_tool(
                client,
                'osmo_get_workflow_events',
                {
                    'workflow_id': 'wf-1',
                    'task_name': 'train-0',
                    'retry_id': 2,
                },
                request_id=4,
            )
            spec_response = await _call_tool(
                client,
                'osmo_get_workflow_spec',
                {'workflow_id': 'wf-1', 'use_template': True},
                request_id=5,
            )

        get_result = get_response.json()['result']['structuredContent']['workflow']
        self.assertEqual(get_result['groups'][0]['tasks'][0]['node_name'], 'node-1')
        self.assertEqual(
            get_result['labels'],
            {'project': 'sim_alpha', 'team': 'robotics'},
        )
        self.assertEqual(get_result['warnings'], _DETAIL['warnings'])
        self.assertNotIn('spec', get_result)
        self.assertNotIn('template_spec', get_result)
        self.assertNotIn('dashboard_url', get_result)
        self.assertNotIn('grafana_url', get_result)
        self.assertEqual(
            logs_response.json()['result']['structuredContent']['logs'],
            'error line\n',
        )
        self.assertEqual(
            normal_logs_response.json()['result']['structuredContent']['logs'],
            'normal line\n',
        )
        self.assertEqual(
            events_response.json()['result']['structuredContent']['events'],
            'scheduled\n',
        )
        self.assertEqual(
            spec_response.json()['result']['structuredContent']['spec'],
            'name: workflow\n',
        )
        for text_response in (
            logs_response,
            normal_logs_response,
            events_response,
            spec_response,
        ):
            structured_content = text_response.json()['result']['structuredContent']
            self.assertFalse(structured_content['truncated'])
            self.assertIsNone(structured_content['truncation_reason'])
        self.assertNotIn('dashboard-secret', get_response.text)
        self.assertNotIn('grafana-secret', get_response.text)

        self.assertEqual(
            [request.url.path for request in captured_requests],
            [
                '/api/workflow/wf-1',
                '/api/workflow/wf-1/error_logs',
                '/api/workflow/wf-1/logs',
                '/api/workflow/wf-1/events',
                '/api/workflow/wf-1/spec',
            ],
        )
        self.assertEqual(captured_requests[0].url.params.multi_items(), [
            ('verbose', 'true'),
            ('skip_groups', 'true'),
        ])
        self.assertEqual(captured_requests[1].url.params.multi_items(), [
            ('task_name', 'train-0'),
            ('last_n_lines', '25'),
            ('retry_id', '2'),
        ])
        self.assertEqual(captured_requests[2].url.params.multi_items(), [])
        self.assertEqual(captured_requests[3].url.params.multi_items(), [
            ('task_name', 'train-0'),
            ('retry_id', '2'),
        ])
        self.assertEqual(captured_requests[4].url.params.multi_items(), [
            ('use_template', 'true'),
        ])

    async def test_running_log_stream_returns_marked_partial_text(
        self,
    ) -> None:
        stream = _StalledTextStream(b'partial running log\n')
        timeout_harness = protocol_harness.ProtocolHarness(
            tool_names=('osmo_get_workflow_logs',),
            bearer_secret=_BEARER_SECRET,
            request_id='workflow-timeout-request-123',
            request_timeout_seconds=0.01,
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.url.path, '/api/workflow/wf-1/logs')
            return httpx.Response(200, stream=stream)

        async with timeout_harness.client(handler) as client:
            response = await timeout_harness.call_tool_with_client(
                client,
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1'},
            )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        structured = result['structuredContent']
        self.assertTrue(structured['truncated'])
        self.assertEqual(
            structured['truncation_reason'],
            'response_timeout',
        )
        self.assertTrue(
            structured['logs'].startswith('partial running log\n')
        )
        self.assertIn('truncated', structured['logs'])
        self.assertNotIn(_BEARER_SECRET, response.text)
        self.assertEqual(stream.close_count, 1)

    async def test_invalid_paths_queries_and_cross_fields_fail_before_relay(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={})

        invalid_calls: tuple[tuple[str, dict[str, object]], ...] = (
            ('osmo_get_workflow', {'workflow_id': '../escape'}),
            ('osmo_get_workflow', {'workflow_id': '..'}),
            ('osmo_get_workflow', {
                'workflow_id': '11111111-1111-1111-1111-111111111111',
            }),
            ('osmo_get_workflow', {'workflow_id': 'workflow-name'}),
            ('osmo_list_workflows', {'limit': 0}),
            ('osmo_list_workflows', {'limit': True}),
            ('osmo_list_workflows', {'limit': 51}),
            ('osmo_list_workflows', {'offset': -1}),
            ('osmo_list_workflows', {'offset': True}),
            ('osmo_list_workflows', {'status': []}),
            ('osmo_list_workflows', {'status': ['NOT_A_STATUS']}),
            ('osmo_list_workflows', {'priority': []}),
            ('osmo_list_workflows', {'priority': 'HIGH'}),
            ('osmo_list_workflows', {'name': 'bad\nquery'}),
            ('osmo_list_workflows', {'labels': []}),
            ('osmo_list_workflows', {'labels': ['project']}),
            ('osmo_list_workflows', {'labels': ['project=(sim|)']}),
            ('osmo_list_workflows', {'no_labels': []}),
            ('osmo_list_workflows', {'no_labels': ['Bad Prefix/team']}),
            ('osmo_list_workflows', {'pool': ['p' * 500] * 40}),
            ('osmo_list_tasks', {}),
            ('osmo_list_tasks', {'node': [], 'status': ['RUNNING']}),
            ('osmo_list_tasks', {
                'node': ['node-1'], 'status': ['RUNNING'], 'limit': 0,
            }),
            ('osmo_list_tasks', {
                'node': ['node-1'], 'status': ['RUNNING'], 'limit': 51,
            }),
            ('osmo_list_tasks', {
                'node': ['node-1'], 'status': ['RUNNING'], 'offset': -1,
            }),
            ('osmo_list_tasks', {'node': ['node-1'], 'status': []}),
            ('osmo_list_tasks', {'node': ['node-1'], 'status': ['INVALID']}),
            ('osmo_list_tasks', {
                'node': ['node-1'], 'status': ['RUNNING'], 'priority': [],
            }),
            ('osmo_list_tasks', {
                'node': ['node-1'], 'status': ['RUNNING'],
                'priority': ['INVALID'],
            }),
            ('osmo_list_tasks', {'node': ['n' * 513], 'status': ['RUNNING']}),
            (
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1', 'error_logs': True},
            ),
            (
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1', 'retry_id': 1},
            ),
            (
                'osmo_get_workflow_events',
                {'workflow_id': 'wf-1', 'retry_id': 1},
            ),
            (
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1', 'last_n_lines': 0},
            ),
            (
                'osmo_get_workflow_logs',
                {'workflow_id': 'wf-1', 'last_n_lines': True},
            ),
            (
                'osmo_get_workflow_events',
                {'workflow_id': 'wf-1', 'task_name': 'task', 'retry_id': True},
            ),
            (
                'osmo_get_workflow_events',
                {'workflow_id': 'wf-1', 'task_name': 'bad\ntask'},
            ),
        )

        async with _mcp_client(handler) as client:
            for request_id, (tool_name, arguments) in enumerate(
                invalid_calls,
                start=1,
            ):
                with self.subTest(tool_name=tool_name, arguments=arguments):
                    response = await _call_tool(
                        client,
                        tool_name,
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(captured_requests, [])

    async def test_status_malformed_and_oversized_responses_are_sanitized(self) -> None:
        async def invoke(
            handler: protocol_harness.AsyncUpstreamHandler,
            tool_name: str,
            arguments: dict[str, object],
        ) -> httpx.Response:
            async with _mcp_client(handler) as client:
                return await _call_tool(client, tool_name, arguments)

        async def not_found_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(404, content=b'upstream-body-secret')

        response = await invoke(
            not_found_handler,
            'osmo_get_workflow',
            {'workflow_id': 'missing-1'},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('HTTP 404', response.text)
        self.assertNotIn('upstream-body-secret', response.text)

        async def malformed_json_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'[]')

        response = await invoke(
            malformed_json_handler,
            'osmo_list_workflows',
            {},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)

        async def malformed_page_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, json={'workflows': []})

        response = await invoke(
            malformed_page_handler,
            'osmo_list_workflows',
            {},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)

        response = await invoke(
            malformed_page_handler,
            'osmo_list_tasks',
            {'node': ['node-1'], 'status': ['RUNNING']},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)

        async def invalid_labels_handler(
            request: httpx.Request,
        ) -> httpx.Response:
            del request
            return httpx.Response(200, json={
                'workflows': [{
                    **_SUMMARY,
                    'labels': {'invalid label': 'value'},
                }],
                'more_entries': False,
            })

        response = await invoke(
            invalid_labels_handler,
            'osmo_list_workflows',
            {},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)

        async def invalid_warnings_handler(
            request: httpx.Request,
        ) -> httpx.Response:
            del request
            return httpx.Response(200, json={
                **_DETAIL,
                'warnings': ['unsafe\nsecond line'],
            })

        response = await invoke(
            invalid_warnings_handler,
            'osmo_get_workflow',
            {'workflow_id': 'wf-1'},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)

        async def oversized_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'x' * (1024 * 1024 + 1))

        response = await invoke(
            oversized_handler,
            'osmo_get_workflow_logs',
            {'workflow_id': 'wf-1'},
        )
        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertTrue(result['structuredContent']['truncated'])
        self.assertIsNotNone(
            result['structuredContent']['truncation_reason'],
        )
        self.assertIn('truncated', result['structuredContent']['logs'])
        self.assertLess(len(response.content), 256 * 1024)
        self.assertNotIn(_BEARER_SECRET, response.text)

        async def invalid_text_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'\xff')

        response = await invoke(
            invalid_text_handler,
            'osmo_get_workflow_events',
            {'workflow_id': 'wf-1'},
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('invalid response', response.text)


class WorkflowValidationUnitTest(unittest.IsolatedAsyncioTestCase):
    """Pin validation that must run before a request context is needed."""

    async def test_cross_field_and_direct_argument_validation(self) -> None:
        with self.assertRaises(ToolError):
            await workflows.osmo_get_workflow_logs(
                None,  # type: ignore[arg-type]
                'wf-1',
                error_logs=True,
            )
        with self.assertRaises(ToolError):
            await workflows.osmo_get_workflow_events(
                None,  # type: ignore[arg-type]
                'wf-1',
                retry_id=1,
            )
        with self.assertRaises(ToolError):
            await workflows.osmo_list_workflows(
                None,  # type: ignore[arg-type]
                status=['INVALID'],  # type: ignore[list-item]
            )
        with self.assertRaises(ToolError):
            await workflows.osmo_list_workflows(
                None,  # type: ignore[arg-type]
                limit=True,  # type: ignore[arg-type]
            )
        with self.assertRaises(ToolError):
            await workflows.osmo_list_tasks(
                None,  # type: ignore[arg-type]
                ['node-1'],
                status=['INVALID'],  # type: ignore[list-item]
            )


if __name__ == '__main__':
    unittest.main()
