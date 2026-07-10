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
import unittest

import httpx

from src.service.mcp import server


GatewayHandler = (
    Callable[[httpx.Request], httpx.Response] |
    Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]
)
_TEST_TIMEOUT_SECONDS = 1


class MCPToolsTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        self.config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
        )

    async def test_profile_relays_exact_token_and_returns_safe_fields(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return self._profile_response('alice@example.com')

        response = await self._call_tool(
            handler,
            token='caller-token',
            user_name='alice@example.com',
            request_id='request-123',
        )

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(
            response.json()['result']['structuredContent'],
            {
                'username': 'alice@example.com',
                'email_notification': False,
                'slack_notification': False,
                'pool': None,
                'roles': ['osmo-user'],
                'pools': ['default'],
            },
        )
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.method, 'GET')
        self.assertEqual(request.url, 'https://gateway.test/api/profile/settings')
        self.assertEqual(request.headers['authorization'], 'Bearer caller-token')
        self.assertEqual(request.headers['x-request-id'], 'request-123')
        self.assertEqual(request.headers['user-agent'], 'osmo-mcp')
        for header in ('x-osmo-user', 'x-osmo-roles', 'cookie', 'origin'):
            self.assertNotIn(header, request.headers)
        self.assertNotIn('caller-token', response.text)
        self.assertNotIn('token-name-not-exposed', response.text)

    async def test_profile_authentication_and_permission_errors_are_not_retried(self) -> None:
        cases = (
            (401, 'OSMO authentication was rejected.'),
            (403, 'OSMO denied access to the current profile.'),
        )
        for status_code, expected_error in cases:
            with self.subTest(status_code=status_code):
                requests: list[httpx.Request] = []
                handler = self._status_handler(status_code, requests)

                response = await self._call_tool(
                    handler,
                    token='caller-secret-token',
                    user_name='alice@example.com',
                )

                self._assert_tool_error(response, expected_error)
                self.assertEqual(len(requests), 1)
                self.assertNotIn('upstream-secret', response.text)
                self.assertNotIn('caller-secret-token', response.text)

    async def test_profile_rejects_mismatched_or_malformed_gateway_data(self) -> None:
        invalid_responses = (
            self._profile_response('bob@example.com'),
            httpx.Response(200, json={
                'profile': {
                    'username': 'alice@example.com',
                    'email_notification': 'false',
                    'slack_notification': False,
                    'pool': None,
                },
                'roles': ['osmo-user'],
                'pools': [],
                'token': None,
            }),
            httpx.Response(200, text='not-json-secret'),
        )

        for invalid_response in invalid_responses:
            with self.subTest(body=invalid_response.text[:80]):
                def handler(
                    request: httpx.Request,
                    response: httpx.Response = invalid_response,
                ) -> httpx.Response:
                    del request
                    return response

                response = await self._call_tool(
                    handler,
                    token='caller-token',
                    user_name='alice@example.com',
                )
                self._assert_tool_error(
                    response, 'Unable to retrieve the current OSMO profile.')
                self.assertNotIn('not-json-secret', response.text)

    async def test_profile_response_size_and_deadline_are_bounded(self) -> None:
        def oversized_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(
                200,
                content=b'oversized-secret' + b'x' * (128 * 1024),
            )

        response = await self._call_tool(
            oversized_handler,
            token='caller-token',
            user_name='alice@example.com',
        )
        self._assert_tool_error(
            response, 'Unable to retrieve the current OSMO profile.')
        self.assertNotIn('oversized-secret', response.text)

        async def slow_handler(request: httpx.Request) -> httpx.Response:
            del request
            await asyncio.sleep(1)
            return self._profile_response('alice@example.com')

        short_timeout_config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            request_timeout_seconds=0.01,
        )
        response = await self._call_tool(
            slow_handler,
            token='caller-token',
            user_name='alice@example.com',
            config=short_timeout_config,
        )
        self._assert_tool_error(
            response, 'Unable to retrieve the current OSMO profile.')

    async def test_profile_transport_errors_do_not_expose_request_details(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError('transport-secret', request=request)

        response = await self._call_tool(
            handler,
            token='caller-secret-token',
            user_name='alice@example.com',
        )

        self._assert_tool_error(
            response, 'Unable to retrieve the current OSMO profile.')
        self.assertNotIn('transport-secret', response.text)
        self.assertNotIn('caller-secret-token', response.text)

    async def test_tool_rejects_undeclared_identity_input(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return self._profile_response('alice@example.com')

        response = await self._call_tool(
            handler,
            token='caller-token',
            user_name='alice@example.com',
            arguments={'username': 'bob@example.com'},
        )

        self._assert_tool_error(response, 'Error executing tool get_current_profile')
        self.assertEqual(requests, [])

    async def test_concurrent_tool_calls_keep_tokens_and_users_isolated(self) -> None:
        both_started = asyncio.Event()
        requests: list[tuple[str, str]] = []
        started_count = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal started_count
            authorization = request.headers['authorization']
            request_id = request.headers['x-request-id']
            requests.append((authorization, request_id))
            started_count += 1
            if started_count == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), _TEST_TIMEOUT_SECONDS)
            user_name = (
                'alice@example.com'
                if authorization == 'Bearer token-alice'
                else 'bob@example.com'
            )
            return self._profile_response(user_name)

        application = server.create_application(
            self.config,
            http_transport=httpx.MockTransport(handler),
        )
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                responses = await asyncio.gather(
                    client.post(
                        '/mcp',
                        headers=self._headers(
                            'token-alice', 'alice@example.com', 'request-alice'),
                        json=self._tool_request(1, {}),
                    ),
                    client.post(
                        '/mcp',
                        headers=self._headers(
                            'token-bob', 'bob@example.com', 'request-bob'),
                        json=self._tool_request(2, {}),
                    ),
                )

        profiles = {
            response.json()['result']['structuredContent']['username']
            for response in responses
        }
        self.assertEqual(profiles, {'alice@example.com', 'bob@example.com'})
        self.assertEqual(
            set(requests),
            {
                ('Bearer token-alice', 'request-alice'),
                ('Bearer token-bob', 'request-bob'),
            },
        )
        for response in responses:
            self.assertNotIn('token-alice', response.text)
            self.assertNotIn('token-bob', response.text)

    async def _call_tool(
        self,
        handler: GatewayHandler,
        *,
        token: str,
        user_name: str,
        request_id: str | None = None,
        arguments: dict[str, object] | None = None,
        config: server.MCPServiceConfig | None = None,
    ) -> httpx.Response:
        application = server.create_application(
            config or self.config,
            http_transport=httpx.MockTransport(handler),
        )
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                return await client.post(
                    '/mcp',
                    headers=self._headers(token, user_name, request_id),
                    json=self._tool_request(1, arguments or {}),
                )

    @staticmethod
    def _headers(
        token: str,
        user_name: str,
        request_id: str | None = None,
    ) -> list[tuple[str, str]]:
        headers = [
            ('Accept', 'application/json, text/event-stream'),
            ('Content-Type', 'application/json'),
            ('Authorization', f'Bearer {token}'),
            ('x-osmo-user', user_name),
            ('x-osmo-roles', 'untrusted-client-role'),
            ('Cookie', 'untrusted-client-cookie'),
            ('Origin', 'https://client.test'),
        ]
        if request_id is not None:
            headers.append(('x-request-id', request_id))
        return headers

    @staticmethod
    def _tool_request(
        request_id: int,
        arguments: dict[str, object],
    ) -> dict[str, object]:
        return {
            'jsonrpc': '2.0',
            'id': request_id,
            'method': 'tools/call',
            'params': {
                'name': 'get_current_profile',
                'arguments': arguments,
            },
        }

    @staticmethod
    def _profile_response(user_name: str) -> httpx.Response:
        return httpx.Response(200, json={
            'profile': {
                'username': user_name,
                'email_notification': False,
                'slack_notification': False,
                'pool': None,
            },
            'roles': ['osmo-user'],
            'pools': ['default'],
            'token': {
                'name': 'token-name-not-exposed',
                'expires_at': None,
            },
        })

    @staticmethod
    def _status_handler(
        status_code: int,
        requests: list[httpx.Request],
    ) -> Callable[[httpx.Request], httpx.Response]:
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(status_code, text='upstream-secret')

        return handler

    def _assert_tool_error(
        self,
        response: httpx.Response,
        expected_error: str,
    ) -> None:
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn(expected_error, response.text)


if __name__ == '__main__':
    unittest.main()
