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
from collections.abc import AsyncIterator, Callable
import unittest

import httpx
from starlette.responses import JSONResponse

from src.service.mcp import gateway, request_context


class _ChunkStream(httpx.AsyncByteStream):  # pylint: disable=too-few-public-methods

    def __init__(self, chunks: list[bytes]) -> None:
        self._chunks = chunks
        self.was_read = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        self.was_read = True
        for chunk in self._chunks:
            yield chunk


class GatewayClientTest(unittest.IsolatedAsyncioTestCase):

    async def test_request_relays_only_the_active_credentials(self) -> None:
        requests: list[httpx.Request] = []

        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(200, content=b'{"ok":true}')

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            response = await self._call_in_request(
                app_context.gateway,
                inbound_headers=[
                    ('Authorization', 'Bearer caller-token'),
                    ('x-osmo-user', 'alice@example.com'),
                    ('x-request-id', 'request-123'),
                    ('x-osmo-roles', 'osmo-admin'),
                    ('Cookie', 'session=secret'),
                    ('Origin', 'https://client.test'),
                ],
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, b'{"ok":true}')
        self.assertEqual(len(requests), 1)
        request = requests[0]
        self.assertEqual(request.url, 'https://gateway.test/api/profile/settings')
        self.assertEqual(request.headers['authorization'], 'Bearer caller-token')
        self.assertEqual(request.headers['x-request-id'], 'request-123')
        self.assertEqual(request.headers['user-agent'], 'osmo-mcp')
        for header in ('x-osmo-user', 'x-osmo-roles', 'cookie', 'origin'):
            self.assertNotIn(header, request.headers)

    async def test_shared_client_has_no_default_credentials(self) -> None:
        authorizations: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            authorizations.append(request.headers['authorization'])
            return httpx.Response(200, content=b'{}')

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            self.assertNotIn(
                'authorization',
                app_context.gateway._client.headers,  # pylint: disable=protected-access
            )
            await self._call_in_request(
                app_context.gateway,
                inbound_headers=self._headers('token-alice', 'alice@example.com'),
            )
            await self._call_in_request(
                app_context.gateway,
                inbound_headers=self._headers('token-bob', 'bob@example.com'),
            )

        self.assertEqual(
            authorizations,
            ['Bearer token-alice', 'Bearer token-bob'],
        )

    async def test_shared_client_never_replays_gateway_cookies(self) -> None:
        cookies: list[str | None] = []

        def handler(request: httpx.Request) -> httpx.Response:
            cookies.append(request.headers.get('cookie'))
            return httpx.Response(
                200,
                headers={'Set-Cookie': 'session=upstream-secret; Path=/'},
                content=b'{}',
            )

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            await self._call_in_request(
                app_context.gateway,
                inbound_headers=self._headers('token-alice', 'alice@example.com'),
            )
            await self._call_in_request(
                app_context.gateway,
                inbound_headers=self._headers('token-bob', 'bob@example.com'),
            )

        self.assertEqual(cookies, [None, None])

    async def test_untrusted_paths_fail_before_credentials_are_attached(self) -> None:
        upstream_calls = 0

        def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal upstream_calls
            upstream_calls += 1
            return httpx.Response(200, content=b'{}')

        invalid_paths = (
            'https://evil.test/api/profile/settings',
            '//evil.test/api/profile/settings',
            '/not-api/profile',
            '/api/profile/settings#fragment',
            '/api/profile/settings?redirect=https://evil.test',
            '/api/../mcp',
            '/api/%2e%2e/mcp',
            '/api/%252e%252e/mcp',
            '/api/..%5cmcp',
        )
        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            for path in invalid_paths:
                with self.subTest(path=path):
                    with self.assertRaisesRegex(ValueError, 'relative OSMO API path'):
                        await self._call_in_request(
                            app_context.gateway,
                            inbound_headers=self._headers(
                                'secret-token', 'alice@example.com'),
                            path=path,
                        )

        self.assertEqual(upstream_calls, 0)

    async def test_error_responses_are_not_followed_read_or_retried(self) -> None:
        for status_code in (301, 401, 403, 429, 500):
            with self.subTest(status_code=status_code):
                requests: list[httpx.Request] = []
                response_stream = _ChunkStream([b'upstream-secret'])
                handler = self._error_handler(
                    status_code, requests, response_stream)

                async with gateway.create_app_context(
                    api_url='https://gateway.test',
                    request_timeout_seconds=1,
                    transport=httpx.MockTransport(handler),
                ) as app_context:
                    response = await self._call_in_request(
                        app_context.gateway,
                        inbound_headers=self._headers(
                            'caller-token', 'alice@example.com'),
                    )

                self.assertEqual(response.status_code, status_code)
                self.assertEqual(response.body, b'')
                self.assertEqual(len(requests), 1)
                self.assertEqual(requests[0].url.host, 'gateway.test')
                self.assertFalse(response_stream.was_read)

    async def test_response_size_and_total_deadline_are_bounded(self) -> None:
        def oversized_handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(
                200,
                stream=_ChunkStream([b'secret', b'x' * 4, b'x' * 8]),
            )

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(oversized_handler),
        ) as app_context:
            with self.assertRaisesRegex(gateway.GatewayClientError, 'size limit') as ctx:
                await self._call_in_request(
                    app_context.gateway,
                    inbound_headers=self._headers(
                        'caller-token', 'alice@example.com'),
                    max_response_bytes=8,
                )
        self.assertNotIn('secret', str(ctx.exception))

        async def slow_handler(request: httpx.Request) -> httpx.Response:
            del request
            await asyncio.sleep(1)
            return httpx.Response(200, content=b'{}')

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=0.01,
            transport=httpx.MockTransport(slow_handler),
        ) as app_context:
            with self.assertRaisesRegex(gateway.GatewayClientError, 'unavailable'):
                await self._call_in_request(
                    app_context.gateway,
                    inbound_headers=self._headers(
                        'caller-token', 'alice@example.com'),
                )

    async def test_request_requires_an_active_mcp_context(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            del request
            self.fail('A request without MCP credentials must not reach Gateway.')

        async with gateway.create_app_context(
            api_url='https://gateway.test',
            request_timeout_seconds=1,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    max_response_bytes=1024,
                )

    async def _call_in_request(
        self,
        gateway_client: gateway.GatewayClient,
        *,
        inbound_headers: list[tuple[str, str]],
        path: str = '/api/profile/settings',
        max_response_bytes: int = 1024,
    ) -> gateway.GatewayResponse:
        result: gateway.GatewayResponse | None = None

        async def application(scope, receive, send) -> None:
            nonlocal result
            result = await gateway_client.request(
                'GET', path, max_response_bytes=max_response_bytes)
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(application)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=middleware),
            base_url='http://mcp.test',
        ) as client:
            response = await client.post('/mcp', headers=inbound_headers)
        self.assertEqual(response.status_code, 200)
        if result is None:
            self.fail('Gateway request did not produce a response.')
        return result

    @staticmethod
    def _headers(token: str, user_name: str) -> list[tuple[str, str]]:
        return [
            ('Authorization', f'Bearer {token}'),
            ('x-osmo-user', user_name),
        ]

    @staticmethod
    def _error_handler(
        status_code: int,
        requests: list[httpx.Request],
        response_stream: httpx.AsyncByteStream,
    ) -> Callable[[httpx.Request], httpx.Response]:
        def handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            return httpx.Response(
                status_code,
                headers={'Location': 'https://evil.test/steal'},
                stream=response_stream,
            )

        return handler


if __name__ == '__main__':
    unittest.main()
