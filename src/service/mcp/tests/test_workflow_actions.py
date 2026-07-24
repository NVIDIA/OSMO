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
    tool_names=('osmo_validate_workflow',),
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


class WorkflowActionProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise mutation mappings through the real Streamable HTTP protocol."""

    async def test_validation_catalog_is_closed_and_not_read_only(self) -> None:
        response = await _HARNESS.list_tools()
        tools = _HARNESS.assert_closed_catalog(
            self,
            response,
            expected_annotations={
                'osmo_validate_workflow':
                    protocol_harness.WRITE_ANNOTATIONS,
            },
        )
        schema = tools['osmo_validate_workflow']['inputSchema']
        self.assertEqual(schema['required'], ['workflow_spec'])
        self.assertEqual(schema['properties']['pool']['default'], None)
        self.assertEqual(
            schema['properties']['set_variables']['default'],
            None,
        )
        self.assertEqual(
            schema['properties']['set_string_variables']['default'],
            None,
        )
        self.assertEqual(
            schema['properties']['workflow_spec']['maxLength'],
            256 * 1024,
        )

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
            },
        )

        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], {
            'valid': True,
            'pool': 'pool-a',
            'logs': 'Workflow validation succeeded.',
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
            [('validation_only', 'true')],
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
            httpx.Response(200, content=b'x' * (64 * 1024 + 1)),
        ]

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return responses.pop(0)

        async with _HARNESS.client(handler) as client:
            for request_id in range(1, 5):
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
