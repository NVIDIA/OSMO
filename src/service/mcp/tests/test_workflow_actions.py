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

import json
import unittest

import httpx
from mcp.server.fastmcp.exceptions import ToolError

from src.service.mcp import workflow_actions
from src.service.mcp.tests import protocol_harness


_BEARER_SECRET = 'phase-two-opaque-bearer-secret'
_HARNESS = protocol_harness.ProtocolHarness(
    tool_names=(
        'osmo_cancel_workflow',
        'osmo_restart_workflow',
        'osmo_submit_workflow',
        'osmo_validate_workflow',
    ),
    bearer_secret=_BEARER_SECRET,
    request_id='workflow-action-request-123',
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
_WORKFLOW_SPEC = """\
version: 2
workflow:
  name: mcp-validation
  tasks:
  - name: check
    image: ubuntu:22.04
    command: [echo]
    args: [ok]
"""
_POLICY_WARNING = (
    "Workflow is missing label 'cost-center'; add it before enforcement."
)
_FAILED_WORKFLOW = {
    'name': 'source-workflow-1',
    'uuid': 'source-workflow-uuid',
    'submitted_by': 'alice@example.com',
    'submit_time': '2026-07-23T12:00:00Z',
    'status': 'FAILED',
    'priority': 'NORMAL',
    'tags': [],
    'pool': 'pool-a',
    'groups': [],
}


class WorkflowActionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise mutation mappings through the real Streamable HTTP protocol."""

    async def test_action_catalog_is_closed_and_not_read_only(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_cancel_workflow':
                    protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
                'osmo_restart_workflow':
                    protocol_harness.DESTRUCTIVE_WRITE_ANNOTATIONS,
                'osmo_submit_workflow':
                    protocol_harness.WRITE_ANNOTATIONS,
                'osmo_validate_workflow':
                    protocol_harness.WRITE_ANNOTATIONS,
            },
        )
        validation_schema = tools[
            'osmo_validate_workflow'
        ]['inputSchema']
        self.assertEqual(validation_schema['required'], ['workflow_spec'])
        self.assertEqual(
            validation_schema['properties']['pool']['default'],
            None,
        )
        self.assertEqual(
            validation_schema['properties']['set_variables']['default'],
            None,
        )
        self.assertEqual(
            validation_schema[
                'properties'
            ]['set_string_variables']['default'],
            None,
        )
        self.assertEqual(
            validation_schema['properties']['workflow_spec']['maxLength'],
            256 * 1024,
        )
        self.assertEqual(
            validation_schema['properties']['labels']['default'],
            None,
        )
        self.assertEqual(
            validation_schema['properties']['labels'][
                'anyOf'
            ][0]['maxItems'],
            50,
        )
        submit_schema = tools['osmo_submit_workflow']['inputSchema']
        self.assertEqual(submit_schema['required'], ['workflow_spec'])
        self.assertEqual(
            submit_schema['properties']['workflow_spec']['maxLength'],
            128 * 1024,
        )
        self.assertEqual(
            submit_schema['properties']['priority']['default'],
            'NORMAL',
        )
        for excluded_argument in (
            'workflow_id',
            'dry_run',
            'env_vars',
            'uploaded_templated_spec',
        ):
            self.assertNotIn(
                excluded_argument,
                submit_schema['properties'],
            )
        restart_schema = tools['osmo_restart_workflow']['inputSchema']
        self.assertEqual(restart_schema['required'], ['workflow_id'])
        self.assertEqual(
            restart_schema['properties']['pool']['default'],
            None,
        )
        cancel_schema = tools['osmo_cancel_workflow']['inputSchema']
        self.assertEqual(cancel_schema['required'], ['workflow_id'])
        self.assertEqual(
            cancel_schema['properties']['force']['default'],
            False,
        )
        self.assertNotIn('message', cancel_schema['properties'])

    async def test_submit_posts_exact_body_and_projects_result(self) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'submission-upstream-sensitive-value'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'name': 'mcp-submission-1',
                'overview': (
                    'https://user:password@example.test/'
                    f'?token={upstream_secret}'
                ),
                'logs': (
                    'https://example.test/logs'
                    f'?signature={upstream_secret}'
                ),
                'dashboard_url': (
                    f'https://example.test/?secret={upstream_secret}'
                ),
                'warnings': [
                    f'{_POLICY_WARNING} token={upstream_secret}',
                ],
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_submit_workflow',
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'pool': 'pool-a',
                'set_variables': ['replicas=2'],
                'set_string_variables': ['image_tag=latest'],
                'priority': 'HIGH',
                'labels': [
                    'project=old',
                    'project=sim_alpha',
                    'team=robotics',
                ],
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'mcp-submission-1',
            'pool': 'pool-a',
            'priority': 'HIGH',
            'warnings': [f'{_POLICY_WARNING} token=[REDACTED]'],
            'submitted': True,
        })
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(request.url.path, '/api/pool/pool-a/workflow')
        self.assertEqual(
            request.url.params.multi_items(),
            [
                ('priority', 'HIGH'),
                ('label', 'project=old'),
                ('label', 'project=sim_alpha'),
                ('label', 'team=robotics'),
            ],
        )
        self.assertEqual(json.loads(request.content), {
            'file': _WORKFLOW_SPEC,
            'set_variables': ['replicas=2'],
            'set_string_variables': ['image_tag=latest'],
        })

    async def test_submit_preserves_template_and_uses_defaults(self) -> None:
        captured_requests: list[httpx.Request] = []
        templated_spec = (
            _WORKFLOW_SPEC
            + '\ndefault-values:\n  replicas: 1\n'
            + '# {{ replicas }}\n'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_PROFILE_RESULT)
            return httpx.Response(200, json={
                'name': 'mcp-template-1',
                'overview': 'https://example.test/workflow',
                'logs': 'https://example.test/logs',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_submit_workflow',
            {'workflow_spec': templated_spec},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'mcp-template-1',
            'pool': 'pool-a',
            'priority': 'NORMAL',
            'warnings': [],
            'submitted': True,
        })
        self.assertEqual(
            [request.url.path for request in captured_requests],
            [
                '/api/profile/settings',
                '/api/pool/pool-a/workflow',
            ],
        )
        submit_request = captured_requests[1]
        self.assertEqual(submit_request.url.params.multi_items(), [])
        self.assertEqual(json.loads(submit_request.content), {
            'file': templated_spec,
            'set_variables': [],
            'set_string_variables': [],
            'uploaded_templated_spec': templated_spec,
        })

    async def test_submit_preserves_control_block_only_template(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        templated_spec = (
            _WORKFLOW_SPEC
            + '\n{% if enabled %}\n'
            + '# enabled\n'
            + '{% endif %}\n'
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'name': 'mcp-control-template-1',
                'overview': 'https://example.test/workflow',
                'logs': 'https://example.test/logs',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_submit_workflow',
            {
                'workflow_spec': templated_spec,
                'pool': 'pool-a',
                'set_variables': ['enabled=true'],
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(json.loads(captured_requests[0].content), {
            'file': templated_spec,
            'set_variables': ['enabled=true'],
            'set_string_variables': [],
            'uploaded_templated_spec': templated_spec,
        })

    async def test_submit_rejects_unsupported_or_invalid_arguments(
        self,
    ) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(200, json={})

        invalid_arguments: tuple[dict[str, object], ...] = (
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'workflow_id': 'private-workflow-1',
            },
            {'workflow_spec': _WORKFLOW_SPEC, 'dry_run': True},
            {'workflow_spec': _WORKFLOW_SPEC, 'priority': 'URGENT'},
            {'workflow_spec': _WORKFLOW_SPEC, 'labels': ['project']},
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'labels': [
                    f'label{index}=value'
                    for index in range(17)
                ],
            },
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'labels': [
                    'a' * 253 + '/' + 'b' * 63 + '=' + 'c' * 63
                ] * 50,
            },
            {'workflow_spec': 'x' * (128 * 1024 + 1)},
        )
        async with _HARNESS.client(handler) as client:
            for request_id, arguments in enumerate(
                invalid_arguments,
                start=1,
            ):
                with self.subTest(arguments=arguments):
                    response = await _HARNESS.call_tool_with_client(
                        client,
                        'osmo_submit_workflow',
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(transport_calls, 0)

    async def test_submit_ambiguous_results_are_not_retried(self) -> None:
        responses = [
            httpx.Response(503, content=b'private-server-detail'),
            httpx.Response(200, json={'name': 'mcp-submission-1'}),
        ]
        calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal calls
            calls += 1
            return responses.pop(0)

        async with _HARNESS.client(handler) as client:
            for request_id in range(1, 3):
                response = await _HARNESS.call_tool_with_client(
                    client,
                    'osmo_submit_workflow',
                    {
                        'workflow_spec': _WORKFLOW_SPEC,
                        'pool': 'pool-a',
                    },
                    request_id=request_id,
                )
                self.assertTrue(response.json()['result']['isError'])
                self.assertIn('write outcome is unknown', response.text)
                self.assertIn(
                    'Inspect OSMO state before retrying',
                    response.text,
                )
                self.assertNotIn('private-server-detail', response.text)

        self.assertEqual(calls, 2)

    async def test_restart_preflights_source_and_uses_its_pool(self) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'restart-upstream-sensitive-value'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            if request.method == 'GET':
                return httpx.Response(200, json=_FAILED_WORKFLOW)
            return httpx.Response(200, json={
                'name': 'restarted-workflow-2',
                'overview': (
                    f'https://example.test/?token={upstream_secret}'
                ),
                'logs': (
                    f'https://example.test/logs?secret={upstream_secret}'
                ),
                'warnings': [_POLICY_WARNING],
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_restart_workflow',
            {'workflow_id': 'source-workflow-1'},
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'restarted-workflow-2',
            'parent_workflow_id': 'source-workflow-1',
            'pool': 'pool-a',
            'warnings': [_POLICY_WARNING],
            'restart_submitted': True,
        })
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(len(captured_requests), 2)
        source_request = captured_requests[0]
        restart_request = captured_requests[1]
        self.assertEqual(source_request.method, 'GET')
        self.assertEqual(
            source_request.url.path,
            '/api/workflow/source-workflow-1',
        )
        self.assertEqual(
            source_request.url.params.multi_items(),
            [('skip_groups', 'true')],
        )
        self.assertEqual(restart_request.method, 'POST')
        self.assertEqual(
            restart_request.url.path,
            '/api/pool/pool-a/workflow/source-workflow-1/restart',
        )
        self.assertEqual(restart_request.content, b'')

    async def test_restart_explicit_pool_still_requires_source_read(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(403, json={
                'message': 'private authorization detail',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_restart_workflow',
            {
                'workflow_id': 'source-workflow-1',
                'pool': 'pool-b',
            },
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('authorization denied', response.text)
        self.assertNotIn('private authorization detail', response.text)
        self.assertNotIn('write outcome is unknown', response.text)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            captured_requests[0].url.path,
            '/api/workflow/source-workflow-1',
        )

    async def test_cancel_posts_force_and_projects_result(
        self,
    ) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'cancel-upstream-sensitive-value'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'name': 'source-workflow-1',
                'detail': upstream_secret,
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_cancel_workflow',
            {
                'workflow_id': 'source-workflow-1',
                'force': True,
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'workflow_id': 'source-workflow-1',
            'force': True,
            'cancellation_submitted': True,
        })
        self.assertNotIn(upstream_secret, response.text)
        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(
            request.url.path,
            '/api/workflow/source-workflow-1/cancel',
        )
        self.assertEqual(
            request.url.params.multi_items(),
            [('force', 'true')],
        )
        self.assertEqual(request.content, b'')

    async def test_lifecycle_rejects_invalid_arguments_before_relay(
        self,
    ) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(200, json={})

        calls: tuple[tuple[str, dict[str, object]], ...] = (
            (
                'osmo_restart_workflow',
                {'workflow_id': '../private-workflow-1'},
            ),
            (
                'osmo_cancel_workflow',
                {'workflow_id': '550e8400-e29b-41d4-a716-446655440000'},
            ),
            (
                'osmo_cancel_workflow',
                {'workflow_id': 'source-workflow-1', 'force': 1},
            ),
            (
                'osmo_cancel_workflow',
                {
                    'workflow_id': 'source-workflow-1',
                    'message': 'not accepted by the external MCP',
                },
            ),
        )
        async with _HARNESS.client(handler) as client:
            for request_id, (tool_name, arguments) in enumerate(
                calls,
                start=1,
            ):
                with self.subTest(
                    tool_name=tool_name,
                    arguments=arguments,
                ):
                    response = await _HARNESS.call_tool_with_client(
                        client,
                        tool_name,
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(transport_calls, 0)

    async def test_lifecycle_ambiguous_results_are_not_retried(
        self,
    ) -> None:
        restart_calls = 0

        async def restart_handler(
            request: httpx.Request,
        ) -> httpx.Response:
            nonlocal restart_calls
            restart_calls += 1
            if request.method == 'GET':
                return httpx.Response(200, json=_FAILED_WORKFLOW)
            return httpx.Response(503, content=b'private-restart-detail')

        restart_response = await _HARNESS.call_tool(
            restart_handler,
            'osmo_restart_workflow',
            {'workflow_id': 'source-workflow-1'},
        )
        self.assertTrue(restart_response.json()['result']['isError'])
        self.assertIn(
            'write outcome is unknown',
            restart_response.text,
        )
        self.assertNotIn('private-restart-detail', restart_response.text)
        self.assertEqual(restart_calls, 2)

        cancel_calls = 0

        async def cancel_handler(
            request: httpx.Request,
        ) -> httpx.Response:
            del request
            nonlocal cancel_calls
            cancel_calls += 1
            return httpx.Response(200, json={
                'name': 'different-workflow-2',
            })

        cancel_response = await _HARNESS.call_tool(
            cancel_handler,
            'osmo_cancel_workflow',
            {'workflow_id': 'source-workflow-1'},
        )
        self.assertTrue(cancel_response.json()['result']['isError'])
        self.assertIn(
            'write outcome is unknown',
            cancel_response.text,
        )
        self.assertEqual(cancel_calls, 1)

    async def test_explicit_pool_posts_exact_template_payload(self) -> None:
        captured_requests: list[httpx.Request] = []
        override_secret = 'synthetic-override-sensitive-value'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={
                'name': 'mcp-validation-1',
                'logs': 'Workflow validation succeeded.',
                'overview': 'https://user:url-secret@example.test/workflow',
                'dashboard_url': 'https://example.test/?token=url-secret',
                'warnings': [_POLICY_WARNING],
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_validate_workflow',
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'pool': 'pool-a',
                'set_variables': ['replicas=2'],
                'set_string_variables': [
                    f'password={override_secret}',
                ],
                'labels': ['project=sim_alpha', 'team=robotics'],
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'valid': True,
            'pool': 'pool-a',
            'logs': 'Workflow validation succeeded.',
            'warnings': [_POLICY_WARNING],
        })
        for sensitive_value in (
            _BEARER_SECRET,
            override_secret,
            'url-secret',
        ):
            self.assertNotIn(sensitive_value, response.text)

        self.assertEqual(len(captured_requests), 1)
        request = captured_requests[0]
        self.assertEqual(request.method, 'POST')
        self.assertEqual(request.url.path, '/api/pool/pool-a/workflow')
        self.assertEqual(
            request.url.params.multi_items(),
            [
                ('validation_only', 'true'),
                ('label', 'project=sim_alpha'),
                ('label', 'team=robotics'),
            ],
        )
        self.assertEqual(
            json.loads(request.content),
            {
                'file': _WORKFLOW_SPEC,
                'set_variables': ['replicas=2'],
                'set_string_variables': [
                    f'password={override_secret}',
                ],
            },
        )
        self.assertEqual(
            request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            request.headers['x-request-id'],
            'workflow-action-request-123',
        )
        self.assertNotIn('x-osmo-user', request.headers)

    async def test_omitted_pool_uses_accessible_profile_default(self) -> None:
        captured_paths: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_paths.append(request.url.path)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=_PROFILE_RESULT)
            return httpx.Response(200, json={
                'name': 'mcp-validation-1',
                'logs': 'Workflow validation succeeded.',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_validate_workflow',
            {'workflow_spec': _WORKFLOW_SPEC},
        )

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(captured_paths, [
            '/api/profile/settings',
            '/api/pool/pool-a/workflow',
        ])

    async def test_omitted_pool_uses_only_accessible_pool(self) -> None:
        captured_paths: list[str] = []
        profile_result = {
            'profile': {
                'username': 'alice@example.com',
                'pool': None,
            },
            'roles': ['osmo-user'],
            'pools': ['pool-only'],
            'token': None,
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_paths.append(request.url.path)
            if request.url.path == '/api/profile/settings':
                return httpx.Response(200, json=profile_result)
            return httpx.Response(200, json={
                'name': 'mcp-validation-1',
                'logs': 'Workflow validation succeeded.',
            })

        response = await _HARNESS.call_tool(
            handler,
            'osmo_validate_workflow',
            {'workflow_spec': _WORKFLOW_SPEC},
        )

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(captured_paths, [
            '/api/profile/settings',
            '/api/pool/pool-only/workflow',
        ])

    async def test_omitted_pool_rejects_ambiguous_access(self) -> None:
        captured_paths: list[str] = []
        profile_result = {
            'profile': {
                'username': 'alice@example.com',
                'pool': None,
            },
            'roles': ['osmo-user'],
            'pools': ['pool-a', 'pool-b'],
            'token': None,
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_paths.append(request.url.path)
            return httpx.Response(200, json=profile_result)

        response = await _HARNESS.call_tool(
            handler,
            'osmo_validate_workflow',
            {'workflow_spec': _WORKFLOW_SPEC},
        )

        self.assertTrue(response.json()['result']['isError'])
        self.assertIn(
            'No unambiguous accessible pool is configured.',
            response.text,
        )
        self.assertEqual(captured_paths, ['/api/profile/settings'])

    async def test_invalid_arguments_fail_before_relay(self) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(200, json={})

        invalid_arguments: tuple[dict[str, object], ...] = (
            {'workflow_spec': ''},
            {'workflow_spec': ' \n\t'},
            {'workflow_spec': 'version: 2\0'},
            {'workflow_spec': 'x' * (256 * 1024 + 1)},
            {'workflow_spec': _WORKFLOW_SPEC, 'pool': '../private'},
            {'workflow_spec': _WORKFLOW_SPEC, 'set_variables': ['missing']},
            {'workflow_spec': _WORKFLOW_SPEC, 'set_variables': [True]},
            {'workflow_spec': _WORKFLOW_SPEC, 'labels': ['project']},
            {'workflow_spec': _WORKFLOW_SPEC, 'labels': [True]},
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'set_string_variables': ['key=' + 'x' * 2048],
            },
        )
        async with _HARNESS.client(handler) as client:
            for request_id, arguments in enumerate(
                invalid_arguments,
                start=1,
            ):
                with self.subTest(arguments=arguments):
                    response = await _HARNESS.call_tool_with_client(
                        client,
                        'osmo_validate_workflow',
                        arguments,
                        request_id=request_id,
                    )
                    self.assertTrue(response.json()['result']['isError'])

        self.assertEqual(transport_calls, 0)

    async def test_errors_are_bounded_redacted_and_not_retried(self) -> None:
        calls = 0
        input_secret = 'synthetic-workflow-input-sensitive-value'

        async def client_error(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal calls
            calls += 1
            return httpx.Response(422, json={
                'message': input_secret,
                'error_code': 'SUBMISSION',
                'workflow_id': 'private-workflow-1',
            })

        response = await _HARNESS.call_tool(
            client_error,
            'osmo_validate_workflow',
            {
                'workflow_spec': (
                    _WORKFLOW_SPEC
                    + f'\n# password={input_secret}\n'
                ),
                'pool': 'pool-a',
            },
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('HTTP 422', response.text)
        self.assertNotIn('SUBMISSION', response.text)
        self.assertNotIn('private-workflow-1', response.text)
        self.assertNotIn(input_secret, response.text)
        self.assertEqual(calls, 1)

        async def server_error(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal calls
            calls += 1
            return httpx.Response(
                503,
                content=b'server-response-sensitive-value',
            )

        response = await _HARNESS.call_tool(
            server_error,
            'osmo_validate_workflow',
            {
                'workflow_spec': _WORKFLOW_SPEC,
                'pool': 'pool-a',
            },
        )
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn('write outcome is unknown', response.text)
        self.assertIn('Inspect OSMO state before retrying', response.text)
        self.assertNotIn('server-response-sensitive-value', response.text)
        self.assertEqual(calls, 2)

    async def test_malformed_and_oversized_success_responses_fail_closed(
        self,
    ) -> None:
        responses = [
            httpx.Response(200, content=b'[]'),
            httpx.Response(200, json={'name': 'workflow-1'}),
            httpx.Response(200, json={
                'name': 'workflow-1',
                'logs': 'password=upstream-success-secret',
            }),
            httpx.Response(200, json={
                'name': 'workflow-1',
                'logs': 'Workflow validation succeeded.',
                'warnings': ['x' * 1025],
            }),
            httpx.Response(200, json={
                'name': 'workflow-1',
                'logs': 'Workflow validation succeeded.',
                'warnings': ['\u200b'],
            }),
            httpx.Response(200, json={
                'name': 'workflow-1',
                'logs': 'Workflow validation succeeded.',
                'warnings': [_POLICY_WARNING] * 17,
            }),
            httpx.Response(200, content=b'x' * (64 * 1024 + 1)),
        ]

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return responses.pop(0)

        async with _HARNESS.client(handler) as client:
            for request_id in range(1, 8):
                response = await _HARNESS.call_tool_with_client(
                    client,
                    'osmo_validate_workflow',
                    {
                        'workflow_spec': _WORKFLOW_SPEC,
                        'pool': 'pool-a',
                    },
                    request_id=request_id,
                )
                self.assertTrue(response.json()['result']['isError'])
                self.assertIn('write outcome is unknown', response.text)
                self.assertLess(len(response.content), 16 * 1024)
                self.assertNotIn(_BEARER_SECRET, response.text)
                self.assertNotIn(
                    'upstream-success-secret',
                    response.text,
                )


class WorkflowActionValidationUnitTest(unittest.IsolatedAsyncioTestCase):
    async def test_direct_invalid_values_fail_before_context(self) -> None:
        with self.assertRaises(ToolError):
            await workflow_actions.osmo_validate_workflow(
                None,  # type: ignore[arg-type]
                'version: 2\0',
                pool='pool-a',
            )
        with self.assertRaises(ToolError):
            await workflow_actions.osmo_validate_workflow(
                None,  # type: ignore[arg-type]
                _WORKFLOW_SPEC,
                pool='pool-a',
                set_variables=['missing-equals'],
            )


if __name__ == '__main__':
    unittest.main()
