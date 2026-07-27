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
    def _headers(
        *,
        bearer_secret: str = _BEARER_SECRET,
        user_name: str = 'alice@example.com',
        request_id: str = 'profile-request-123',
    ) -> dict[str, str]:
        return {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: f'Bearer {bearer_secret}',
            login.OSMO_USER_HEADER: user_name,
            'x-request-id': request_id,
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
        bearer_secret: str = _BEARER_SECRET,
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
                        headers=self._headers(bearer_secret=bearer_secret),
                        json={
                            'jsonrpc': '2.0',
                            'id': 2,
                            'method': 'tools/list',
                            'params': {},
                        },
                    )
                tool_response = await client.post(
                    '/mcp',
                    headers=self._headers(bearer_secret=bearer_secret),
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
        tools_by_name = {tool['name']: tool for tool in tools}
        profile_tool = tools_by_name['osmo_get_profile']
        self.assertEqual(profile_tool['title'], 'Get OSMO profile')
        self.assertEqual(profile_tool['inputSchema']['properties'], {})
        self.assertFalse(profile_tool['inputSchema']['additionalProperties'])
        self.assertEqual(profile_tool['annotations'], {
            'readOnlyHint': True,
            'destructiveHint': False,
            'idempotentHint': True,
            'openWorldHint': False,
        })
        self.assertEqual(profile_tool['outputSchema']['type'], 'object')
        for definition in profile_tool['outputSchema'].get('$defs', {}).values():
            if definition.get('type') == 'object':
                self.assertFalse(definition['additionalProperties'])

        self.assertEqual(response.status_code, 200)
        result = response.json()['result']
        self.assertFalse(result['isError'], result)
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

    async def test_set_profile_pool_relays_one_closed_mutation(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, content=b'null')

        response, catalog_response = await self._invoke_tool(
            handler,
            arguments={
                'setting': 'pool',
                'value': 'training-pool',
            },
            include_catalog=True,
            tool_name='osmo_set_profile',
        )

        self.assertIsNotNone(catalog_response)
        assert catalog_response is not None
        tools = {
            item['name']: item
            for item in catalog_response.json()['result']['tools']
        }
        tool = tools['osmo_set_profile']
        self.assertEqual(tool['name'], 'osmo_set_profile')
        self.assertFalse(tool['inputSchema']['additionalProperties'])
        self.assertEqual(
            tool['inputSchema']['properties']['setting']['enum'],
            ['pool', 'notifications'],
        )
        enabled_schema = tool['inputSchema']['properties']['enabled']
        self.assertIn(
            {'type': 'boolean'},
            enabled_schema['anyOf'],
        )
        self.assertFalse(tool['outputSchema']['additionalProperties'])
        self.assertEqual(tool['annotations'], {
            'readOnlyHint': False,
            'destructiveHint': True,
            'idempotentHint': True,
            'openWorldHint': False,
        })

        result = response.json()['result']
        self.assertFalse(result['isError'], result)
        self.assertEqual(result['structuredContent'], {
            'setting': 'pool',
            'value': 'training-pool',
            'enabled': None,
            'updated': True,
        })
        self.assertEqual(len(captured_requests), 1)
        upstream_request = captured_requests[0]
        self.assertEqual(upstream_request.method, 'POST')
        self.assertEqual(
            str(upstream_request.url),
            'https://gateway.test/api/profile/settings',
        )
        self.assertEqual(
            upstream_request.content,
            b'{"pool":"training-pool"}',
        )
        self.assertEqual(
            upstream_request.headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertEqual(
            upstream_request.headers['x-request-id'],
            'profile-request-123',
        )
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_set_profile_notifications_default_and_explicit_enabled(
        self,
    ) -> None:
        cases: tuple[
            tuple[dict[str, object], dict[str, object], bool],
            ...,
        ] = (
            (
                {'setting': 'notifications', 'value': 'email'},
                {'email_notification': True},
                True,
            ),
            (
                {
                    'setting': 'notifications',
                    'value': 'slack',
                    'enabled': False,
                },
                {'slack_notification': False},
                False,
            ),
        )

        def success_handler(
            captured_requests: list[httpx.Request],
        ) -> _Handler:
            async def handler(request: httpx.Request) -> httpx.Response:
                captured_requests.append(request)
                return httpx.Response(200, content=b'null')

            return handler

        for arguments, expected_payload, expected_enabled in cases:
            with self.subTest(arguments=arguments):
                captured_requests: list[httpx.Request] = []

                response, _ = await self._invoke_tool(
                    success_handler(captured_requests),
                    arguments=arguments,
                    tool_name='osmo_set_profile',
                )
                result = response.json()['result']
                self.assertFalse(result['isError'], result)
                self.assertEqual(
                    result['structuredContent']['enabled'],
                    expected_enabled,
                )
                self.assertEqual(len(captured_requests), 1)
                self.assertEqual(
                    json.loads(captured_requests[0].content),
                    expected_payload,
                )

    async def test_set_profile_rejects_invalid_combinations_before_transport(
        self,
    ) -> None:
        input_secret = 'profile-invalid-input-secret'
        cases: tuple[dict[str, object], ...] = (
            {
                'setting': 'pool',
                'value': 'training-pool',
                'enabled': True,
            },
            {
                'setting': 'notifications',
                'value': 'sms',
            },
            {
                'setting': 'notifications',
                'value': 'email',
                'enabled': 1,
            },
            {
                'setting': 'bucket',
                'value': input_secret,
            },
            {
                'setting': 'notifications',
                'value': 'email',
                'enabled': input_secret,
            },
        )

        async def unexpected_handler(
            request: httpx.Request,
        ) -> httpx.Response:
            raise AssertionError(f'unexpected request: {request.url}')

        for arguments in cases:
            with self.subTest(arguments=arguments):
                response, _ = await self._invoke_tool(
                    unexpected_handler,
                    arguments=arguments,
                    tool_name='osmo_set_profile',
                )
                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertNotIn(input_secret, json.dumps(result))
                self.assertNotIn(_BEARER_SECRET, json.dumps(result))

    async def test_set_profile_write_failures_do_not_reflect_or_retry(
        self,
    ) -> None:
        upstream_secret = 'profile-write-upstream-secret'
        cases = (
            httpx.Response(
                422,
                json={
                    'error_code': 'USER',
                    'message': upstream_secret,
                },
            ),
            httpx.Response(
                200,
                json={
                    'unexpected': upstream_secret,
                },
            ),
        )

        def fixed_response_handler(
            upstream_response: httpx.Response,
        ) -> tuple[_Handler, list[httpx.Request]]:
            captured_requests: list[httpx.Request] = []

            async def handler(request: httpx.Request) -> httpx.Response:
                captured_requests.append(request)
                return upstream_response

            return handler, captured_requests

        for upstream_response in cases:
            with self.subTest(status=upstream_response.status_code):
                handler, captured_requests = fixed_response_handler(
                    upstream_response
                )

                response, _ = await self._invoke_tool(
                    handler,
                    arguments={
                        'setting': 'pool',
                        'value': 'training-pool',
                    },
                    tool_name='osmo_set_profile',
                )
                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertEqual(len(captured_requests), 1)
                self.assertNotIn(upstream_secret, json.dumps(result))
                self.assertNotIn(_BEARER_SECRET, json.dumps(result))
                if upstream_response.status_code == 200:
                    self.assertIn(
                        'write outcome is unknown',
                        json.dumps(result),
                    )

        transport_calls = 0

        async def transport_failure(
            request: httpx.Request,
        ) -> httpx.Response:
            nonlocal transport_calls
            transport_calls += 1
            raise httpx.ConnectError(upstream_secret, request=request)

        response, _ = await self._invoke_tool(
            transport_failure,
            arguments={
                'setting': 'pool',
                'value': 'training-pool',
            },
            tool_name='osmo_set_profile',
        )
        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertEqual(transport_calls, 1)
        self.assertIn('write outcome is unknown', json.dumps(result))
        self.assertNotIn(upstream_secret, json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))

    async def test_health_is_a_minimal_caller_bound_profile_probe(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json=_PROFILE_RESULT)

        response, catalog_response = await self._invoke_tool(
            handler,
            include_catalog=True,
            tool_name='osmo_health',
        )

        self.assertIsNotNone(catalog_response)
        assert catalog_response is not None
        tools = {
            tool['name']: tool
            for tool in catalog_response.json()['result']['tools']
        }
        health_tool = tools['osmo_health']
        self.assertEqual(health_tool['inputSchema']['properties'], {})
        self.assertFalse(health_tool['inputSchema']['additionalProperties'])
        self.assertEqual(health_tool['annotations'], {
            'readOnlyHint': True,
            'destructiveHint': False,
            'idempotentHint': True,
            'openWorldHint': False,
        })

        result = response.json()['result']
        self.assertFalse(result['isError'], result)
        self.assertEqual(result['structuredContent'], {'status': 'healthy'})
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(
            str(captured_requests[0].url),
            'https://gateway.test/api/profile/settings',
        )
        self.assertEqual(
            captured_requests[0].headers['authorization'],
            f'Bearer {_BEARER_SECRET}',
        )
        self.assertNotIn(_BEARER_SECRET, response.text)

    async def test_health_propagates_sanitized_profile_failures(self) -> None:
        captured_requests: list[httpx.Request] = []
        response, _ = await self._invoke_tool(
            _error_response_handler(503, captured_requests),
            tool_name='osmo_health',
        )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('HTTP 503', json.dumps(result))
        self.assertNotIn('upstream-profile-body-secret', json.dumps(result))
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))

    async def test_concurrent_profile_calls_keep_requests_and_results_isolated(self) -> None:
        captured_credentials: list[tuple[str, str | None]] = []
        both_requests_arrived = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            authorization = request.headers['authorization']
            captured_credentials.append((
                authorization,
                request.headers.get('x-request-id'),
            ))
            if len(captured_credentials) == 2:
                both_requests_arrived.set()
            await asyncio.wait_for(both_requests_arrived.wait(), timeout=1)

            caller = authorization.removeprefix('Bearer concurrent-').removesuffix(
                '-secret'
            )
            result: dict[str, object] = dict(_PROFILE_RESULT)
            result['profile'] = {
                'username': f'{caller}@example.com',
                'email_notification': False,
                'slack_notification': False,
                'pool': caller,
            }
            result['token'] = None
            return httpx.Response(200, json=result)

        application = server.create_runtime_application(
            server.MCPServiceConfig(gateway_url='https://gateway.test'),
            http_transport=httpx.MockTransport(handler),
        )
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                responses = await asyncio.gather(*(
                    client.post(
                        '/mcp',
                        headers=self._headers(
                            bearer_secret=f'concurrent-{caller}-secret',
                            user_name=f'{caller}@example.com',
                            request_id=f'request-{caller}',
                        ),
                        json=self._tool_call(),
                    )
                    for caller in ('alice', 'bob')
                ))

        for caller, response in zip(('alice', 'bob'), responses, strict=True):
            result = response.json()['result']
            other_caller = 'bob' if caller == 'alice' else 'alice'
            self.assertFalse(result['isError'])
            self.assertEqual(
                result['structuredContent']['profile']['username'],
                f'{caller}@example.com',
            )
            self.assertNotIn(
                f'concurrent-{other_caller}-secret',
                response.text,
            )

        self.assertCountEqual(captured_credentials, [
            ('Bearer concurrent-alice-secret', 'request-alice'),
            ('Bearer concurrent-bob-secret', 'request-bob'),
        ])

    async def test_cancelled_mcp_request_cancels_active_gateway_relay(self) -> None:
        handler_entered = asyncio.Event()
        release_handler = asyncio.Event()
        handler_cancelled = asyncio.Event()
        handler_completed = asyncio.Event()
        captured_authorization: list[str] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_authorization.append(request.headers['authorization'])
            handler_entered.set()
            try:
                await release_handler.wait()
            except asyncio.CancelledError:
                handler_cancelled.set()
                raise
            handler_completed.set()
            return httpx.Response(200, json=_PROFILE_RESULT)

        application = server.create_runtime_application(
            server.MCPServiceConfig(gateway_url='https://gateway.test'),
            http_transport=httpx.MockTransport(handler),
        )
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                request_task = asyncio.create_task(client.post(
                    '/mcp',
                    headers=self._headers(),
                    json=self._tool_call(),
                ))
                try:
                    await asyncio.wait_for(handler_entered.wait(), timeout=1)
                    request_task.cancel()
                    with self.assertRaises(asyncio.CancelledError):
                        await request_task
                    await asyncio.wait_for(handler_cancelled.wait(), timeout=1)
                    self.assertFalse(handler_completed.is_set())
                    release_handler.set()
                    followup_response = await client.post(
                        '/mcp',
                        headers=self._headers(),
                        json=self._tool_call(),
                    )
                    self.assertFalse(
                        followup_response.json()['result']['isError'])
                finally:
                    release_handler.set()
                    if not request_task.done():
                        request_task.cancel()
                        await asyncio.gather(
                            request_task,
                            return_exceptions=True,
                        )

        self.assertEqual(
            captured_authorization,
            [f'Bearer {_BEARER_SECRET}', f'Bearer {_BEARER_SECRET}'],
        )

    async def test_get_profile_uses_central_sanitized_status_mapping(self) -> None:
        cases = (
            (401, 'rejected the active authentication'),
            (403, 'authorization denied the request'),
            (429, 'rate limited the request'),
            (500, 'service is unavailable'),
            (418, 'request failed'),
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

    async def test_get_profile_preserves_safe_structured_error_metadata(self) -> None:
        captured_requests: list[httpx.Request] = []
        upstream_secret = 'profile-error-secret'

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(400, json={
                'message': (
                    'Invalid profile update: '
                    f'password={upstream_secret}'
                ),
                'error_code': 'USER',
            })

        response, _ = await self._invoke_tool(handler)

        self.assertEqual(len(captured_requests), 1)
        result = response.json()['result']
        self.assertTrue(result['isError'])
        result_text = json.dumps(result)
        self.assertIn('HTTP 400', result_text)
        self.assertIn('error_code=USER', result_text)
        self.assertNotIn('Invalid profile update', result_text)
        self.assertNotIn(upstream_secret, result_text)
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

    async def test_get_profile_drops_extra_nested_profile_fields(self) -> None:
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
        self.assertFalse(result['isError'], result)
        self.assertNotIn(
            'upstream-internal-profile-secret',
            json.dumps(result),
        )

    async def test_get_profile_rejects_semantically_reflected_credentials(
        self,
    ) -> None:
        short_secret = 'minimum-token-16'
        short_reflection: dict[str, object] = dict(_PROFILE_RESULT)
        short_reflection['token'] = {
            'name': short_secret,
            'expires_at': None,
        }

        long_secret = 'escaped-profile-bearer-secret'
        escaped_reflection: dict[str, object] = dict(_PROFILE_RESULT)
        escaped_reflection['token'] = {
            'name': long_secret,
            'expires_at': None,
        }
        escaped_body = json.dumps(escaped_reflection).replace(
            long_secret,
            ''.join(f'\\u{ord(character):04x}' for character in long_secret),
        ).encode()
        self.assertNotIn(long_secret.encode(), escaped_body)

        cases = (
            (short_secret, json.dumps(short_reflection).encode()),
            (long_secret, escaped_body),
        )

        def response_handler(response_body: bytes) -> _Handler:
            async def handler(request: httpx.Request) -> httpx.Response:
                del request
                return httpx.Response(200, content=response_body)

            return handler

        for bearer_secret, response_body in cases:
            with self.subTest(bearer_secret=bearer_secret):
                response, _ = await self._invoke_tool(
                    response_handler(response_body),
                    bearer_secret=bearer_secret,
                )

                result = response.json()['result']
                self.assertTrue(result['isError'])
                self.assertIn('invalid response', json.dumps(result))
                self.assertNotIn(f'Bearer {bearer_secret}', json.dumps(result))
                if len(bearer_secret) >= 16:
                    self.assertNotIn(bearer_secret, json.dumps(result))

    async def test_get_profile_bounds_and_sanitizes_invalid_bodies(self) -> None:
        async def malformed_body(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'upstream-malformed-body-secret')

        malformed_response, _ = await self._invoke_tool(malformed_body)
        malformed_result = malformed_response.json()['result']
        self.assertTrue(malformed_result['isError'])
        self.assertIn('invalid response', json.dumps(malformed_result))
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

    async def test_active_credentials_cannot_be_forwarded_as_tool_inputs(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, json={'apps': [], 'more_entries': False})

        response, _ = await self._invoke_tool(
            handler,
            tool_name='osmo_list_apps',
            arguments={'name': _BEARER_SECRET},
        )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertEqual(captured_requests, [])
        self.assertNotIn(_BEARER_SECRET, json.dumps(result))

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
