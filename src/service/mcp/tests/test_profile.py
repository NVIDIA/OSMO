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

from collections.abc import Callable, Coroutine
import json
import unittest

import httpx

from src.lib.utils import login
from src.service.mcp import server


_Handler = Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]
_BEARER_SECRET = 'profile-tool-bearer-secret'
_PROFILE_RESULT = {
    'profile': {
        'username': 'alice@example.com',
        'email_notification': True,
        'slack_notification': None,
        'pool': 'default',
    },
    'roles': ['osmo-user'],
    'pools': ['default', 'shared'],
    'token': {
        'name': 'desktop-client-token',
        'expires_at': '2026-07-10T12:30:00Z',
    },
}


def _error_response_handler(
    status_code: int,
    captured_requests: list[httpx.Request],
) -> _Handler:
    async def handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(
            status_code,
            content=b'upstream-profile-body-secret',
        )

    return handler


class ProfileToolProtocolTest(unittest.IsolatedAsyncioTestCase):
    """Exercise the profile tool through the real Streamable HTTP protocol."""

    @staticmethod
    def _headers() -> dict[str, str]:
        return {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: f'Bearer {_BEARER_SECRET}',
            login.OSMO_USER_HEADER: 'alice@example.com',
            'x-request-id': 'profile-request-123',
        }

    @staticmethod
    def _tool_call(
        arguments: dict[str, object] | None = None,
        *,
        tool_name: str = 'osmo_get_profile',
    ) -> dict[str, object]:
        return {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {
                'name': tool_name,
                'arguments': arguments or {},
            },
        }

    async def _invoke_tool(
        self,
        handler: _Handler,
        *,
        include_catalog: bool = False,
        arguments: dict[str, object] | None = None,
        tool_name: str = 'osmo_get_profile',
    ) -> tuple[httpx.Response, httpx.Response | None]:
        application = server.create_runtime_application(
            server.MCPServiceConfig(gateway_url='https://gateway.test'),
            http_transport=httpx.MockTransport(handler),
        )
        catalog_response = None
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                if include_catalog:
                    catalog_response = await client.post(
                        '/mcp',
                        headers=self._headers(),
                        json={
                            'jsonrpc': '2.0',
                            'id': 2,
                            'method': 'tools/list',
                            'params': {},
                        },
                    )
                tool_response = await client.post(
                    '/mcp',
                    headers=self._headers(),
                    json=self._tool_call(arguments, tool_name=tool_name),
                )
        return tool_response, catalog_response

    async def test_get_profile_relays_credentials_and_returns_typed_result(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_PROFILE_RESULT)

        response, catalog_response = await self._invoke_tool(
            handler,
            include_catalog=True,
        )

        self.assertIsNotNone(catalog_response)
        assert catalog_response is not None
        self.assertEqual(catalog_response.status_code, 200)
        tools = catalog_response.json()['result']['tools']
        self.assertEqual(len(tools), 1)
        self.assertEqual(tools[0]['name'], 'osmo_get_profile')
        self.assertEqual(tools[0]['title'], 'Get OSMO profile')
        self.assertEqual(tools[0]['inputSchema']['properties'], {})
        self.assertFalse(tools[0]['inputSchema']['additionalProperties'])
        self.assertEqual(tools[0]['annotations'], {
            'readOnlyHint': True,
            'destructiveHint': False,
            'idempotentHint': True,
            'openWorldHint': False,
        })
        self.assertEqual(tools[0]['outputSchema']['type'], 'object')

        self.assertEqual(response.status_code, 200)
        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertEqual(result['structuredContent'], _PROFILE_RESULT)
        self.assertNotIn(_BEARER_SECRET, response.text)

        self.assertEqual(len(captured_requests), 1)
        upstream_request = captured_requests[0]
        self.assertEqual(upstream_request.method, 'GET')
        self.assertEqual(
            str(upstream_request.url),
            'https://gateway.test/api/profile/settings',
        )
        self.assertEqual(
            upstream_request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            upstream_request.headers['x-request-id'],
            'profile-request-123',
        )
        self.assertNotIn(login.OSMO_USER_HEADER, upstream_request.headers)
        self.assertNotIn('cookie', upstream_request.headers)

    async def test_get_profile_maps_api_statuses_without_exposing_body(self) -> None:
        cases = (
            (401, 'rejected the active authentication'),
            (403, 'authorization denied profile access'),
            (429, 'profile access is rate limited'),
            (500, 'profile service is unavailable'),
            (418, 'profile request failed'),
        )
        for status_code, expected_error in cases:
            with self.subTest(status_code=status_code):
                captured_requests: list[httpx.Request] = []
                response, _ = await self._invoke_tool(
                    _error_response_handler(status_code, captured_requests)
                )

                self.assertEqual(len(captured_requests), 1)
                result = response.json()['result']
                self.assertTrue(result['isError'])
                result_text = json.dumps(result)
                self.assertIn(expected_error, result_text)
                self.assertIn(f'HTTP {status_code}', result_text)
                self.assertNotIn('upstream-profile-body-secret', result_text)
                self.assertNotIn(_BEARER_SECRET, result_text)

    async def test_get_profile_sanitizes_transport_and_schema_failures(self) -> None:
        async def transport_failure(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError(
                'upstream-transport-secret',
                request=request,
            )

        transport_response, _ = await self._invoke_tool(transport_failure)
        transport_result = transport_response.json()['result']
        self.assertTrue(transport_result['isError'])
        self.assertIn('Gateway is unavailable', json.dumps(transport_result))
        self.assertNotIn('upstream-transport-secret', json.dumps(transport_result))

        invalid_profile: dict[str, object] = dict(_PROFILE_RESULT)
        invalid_profile['internal_secret'] = 'upstream-schema-secret'

        async def invalid_schema(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, json=invalid_profile)

        schema_response, _ = await self._invoke_tool(invalid_schema)
        schema_result = schema_response.json()['result']
        self.assertTrue(schema_result['isError'])
        self.assertIn('invalid profile response', json.dumps(schema_result))
        self.assertNotIn('upstream-schema-secret', json.dumps(schema_result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(schema_result))

    async def test_get_profile_does_not_expose_internal_profile_fields(self) -> None:
        upstream_profile: dict[str, object] = dict(_PROFILE_RESULT)
        upstream_profile['profile'] = {
            'username': 'alice@example.com',
            'email_notification': True,
            'slack_notification': False,
            'pool': 'default',
            'internal_secret': 'upstream-internal-profile-secret',
        }

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, json=upstream_profile)

        response, _ = await self._invoke_tool(handler)
        result = response.json()['result']
        self.assertFalse(result['isError'])
        self.assertNotIn(
            'upstream-internal-profile-secret',
            json.dumps(result),
        )

    async def test_get_profile_bounds_and_sanitizes_invalid_bodies(self) -> None:
        async def malformed_body(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'upstream-malformed-body-secret')

        malformed_response, _ = await self._invoke_tool(malformed_body)
        malformed_result = malformed_response.json()['result']
        self.assertTrue(malformed_result['isError'])
        self.assertIn('invalid profile response', json.dumps(malformed_result))
        self.assertNotIn(
            'upstream-malformed-body-secret',
            json.dumps(malformed_result),
        )

        oversized_body = b'upstream-oversized-body-secret' + (b'x' * (65 * 1024))

        async def oversized_response(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=oversized_body)

        oversized_response_result, _ = await self._invoke_tool(oversized_response)
        oversized_result = oversized_response_result.json()['result']
        self.assertTrue(oversized_result['isError'])
        self.assertIn('exceeds the size limit', json.dumps(oversized_result))
        self.assertNotIn(
            'upstream-oversized-body-secret',
            json.dumps(oversized_result),
        )
        self.assertNotIn(_BEARER_SECRET, json.dumps(oversized_result))

    async def test_get_profile_rejects_unmapped_inputs_before_transport(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_PROFILE_RESULT)

        response, _ = await self._invoke_tool(
            handler,
            arguments={
                'authorization': 'Bearer tool-input-secret',
                'url': 'https://evil.example.com/api/profile/settings',
                'headers': {'x-osmo-user': 'mallory@example.com'},
            },
        )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertEqual(captured_requests, [])
        self.assertNotIn('tool-input-secret', json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))

        unknown_response, _ = await self._invoke_tool(
            handler,
            tool_name='unknown-tool-input-secret',
        )
        unknown_result = unknown_response.json()['result']
        self.assertTrue(unknown_result['isError'])
        self.assertEqual(captured_requests, [])
        self.assertNotIn('unknown-tool-input-secret', json.dumps(unknown_result))

    async def test_get_profile_fails_closed_without_runtime_context(self) -> None:
        application = server.create_application(server.create_mcp_server())
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                response = await client.post(
                    '/mcp',
                    headers=self._headers(),
                    json=self._tool_call(),
                )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('runtime context is unavailable', json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))


if __name__ == '__main__':
    unittest.main()
