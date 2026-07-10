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
from collections.abc import AsyncIterator, Callable, Coroutine
import unittest

import httpx

from src.service.mcp import gateway, request_context


_Handler = Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]


class _TrackingStream(httpx.AsyncByteStream):
    """Track streaming iteration and cleanup for response-bound tests."""

    def __init__(
        self,
        chunks: list[bytes],
        *,
        block_after_chunks: bool = False,
    ) -> None:
        self._chunks = chunks
        self._block_after_chunks = block_after_chunks
        self.iterated_chunks = 0
        self.close_count = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self._chunks:
            self.iterated_chunks += 1
            yield chunk
        if self._block_after_chunks:
            await asyncio.Future()

    async def aclose(self) -> None:
        self.close_count += 1


class _TrackingTransport(httpx.MockTransport):
    """Track connection-pool cleanup through the HTTPX transport seam."""

    def __init__(self, handler: _Handler) -> None:
        super().__init__(handler)
        self.close_count = 0

    async def aclose(self) -> None:
        self.close_count += 1
        await super().aclose()


class GatewayClientTest(unittest.IsolatedAsyncioTestCase):
    """Validate fixed-origin Gateway request and response boundaries."""

    @staticmethod
    def _credentials(
        *,
        authorization_header: str = 'Bearer original.token+/_==',
        request_id: str | None = 'request-123',
    ) -> request_context.RequestCredentials:
        return request_context.RequestCredentials(
            authorization_header=authorization_header,
            user_name='alice@example.com',
            request_id=request_id,
        )

    async def test_request_uses_fixed_origin_and_approved_headers(self) -> None:
        captured_requests: list[httpx.Request] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_requests.append(request)
            return httpx.Response(200, content=b'{"status":"ok"}')

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            response = await app_context.gateway.request(
                'GET',
                '/api/profile/settings',
                credentials=self._credentials(
                    authorization_header='bEaReR original.token+/_=='
                ),
                max_response_bytes=1024,
            )
            response_without_request_id = await app_context.gateway.request(
                'GET',
                '/api/profile/settings',
                credentials=self._credentials(request_id=None),
                max_response_bytes=1024,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.body, b'{"status":"ok"}')
        self.assertEqual(response_without_request_id.status_code, 200)
        self.assertEqual(len(captured_requests), 2)
        self.assertEqual(
            str(captured_requests[0].url),
            'https://gateway.test/api/profile/settings',
        )
        self.assertEqual(
            captured_requests[0].headers['authorization'],
            'bEaReR original.token+/_==',
        )
        self.assertEqual(
            captured_requests[0].headers['x-request-id'],
            'request-123',
        )
        self.assertEqual(captured_requests[0].headers['accept-encoding'], 'identity')
        self.assertEqual(captured_requests[0].headers['user-agent'], 'osmo-mcp')
        self.assertNotIn('x-osmo-user', captured_requests[0].headers)
        self.assertNotIn('cookie', captured_requests[0].headers)
        self.assertNotIn('proxy-authorization', captured_requests[0].headers)
        self.assertNotIn('x-request-id', captured_requests[1].headers)

    async def test_only_fixed_api_paths_and_methods_are_allowed(self) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(200, content=b'{}')

        invalid_paths = (
            '',
            'api/profile/settings',
            '/profile/settings',
            'https://evil.test/api/profile/settings',
            '//evil.test/api/profile/settings',
            '/api/../profile/settings',
            '/api/%2e%2e/profile/settings',
            '/api/%252e%252e/profile/settings',
            '/api\\profile',
            '/api//profile',
            '/api/profile?user=alice',
            '/api/profile#fragment',
            '/api/profile%00suffix',
        )

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            for invalid_path in invalid_paths:
                with self.subTest(path=invalid_path):
                    with self.assertRaises(ValueError):
                        await app_context.gateway.request(
                            'GET',
                            invalid_path,
                            credentials=self._credentials(),
                            max_response_bytes=1024,
                        )

            for invalid_method in ('get', 'PUT', 'OPTIONS'):
                with self.subTest(method=invalid_method):
                    with self.assertRaises(ValueError):
                        await app_context.gateway.request(
                            invalid_method,
                            '/api/profile/settings',
                            credentials=self._credentials(),
                            max_response_bytes=1024,
                        )

            with self.assertRaises(ValueError):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=0,
                )

        self.assertEqual(transport_calls, 0)

    async def test_response_cookies_are_never_replayed(self) -> None:
        captured_cookies: list[str | None] = []

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_cookies.append(request.headers.get('cookie'))
            if len(captured_cookies) == 1:
                return httpx.Response(
                    200,
                    headers={'set-cookie': 'session=upstream-secret; Secure'},
                    content=b'{}',
                )
            return httpx.Response(200, content=b'{}')

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            for _ in range(2):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=1024,
                )
                self.assertEqual(
                    len(app_context.gateway._client.cookies),  # pylint: disable=protected-access
                    0,
                )

        self.assertEqual(captured_cookies, [None, None])

    async def test_concurrent_callers_keep_authorization_headers_isolated(self) -> None:
        captured_authorization_headers: list[str] = []
        both_requests_arrived = asyncio.Event()

        async def handler(request: httpx.Request) -> httpx.Response:
            captured_authorization_headers.append(request.headers['authorization'])
            if len(captured_authorization_headers) == 2:
                both_requests_arrived.set()
            await asyncio.wait_for(both_requests_arrived.wait(), timeout=1)
            return httpx.Response(200, content=b'{}')

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            await asyncio.gather(*(
                app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(
                        authorization_header=f'Bearer caller-{caller}'
                    ),
                    max_response_bytes=1024,
                )
                for caller in ('alice', 'bob')
            ))

        self.assertCountEqual(
            captured_authorization_headers,
            ['Bearer caller-alice', 'Bearer caller-bob'],
        )

    async def test_redirect_is_rejected_without_following(self) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            nonlocal transport_calls
            transport_calls += 1
            return httpx.Response(
                307,
                headers={'location': 'https://evil.test/upstream-secret'},
            )

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'unsafe redirect',
            ) as raised:
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=1024,
                )

        self.assertEqual(transport_calls, 1)
        self.assertNotIn('evil.test', str(raised.exception))
        self.assertNotIn('upstream-secret', repr(raised.exception))

    async def test_transport_failure_is_sanitized_and_not_retried(self) -> None:
        transport_calls = 0

        async def handler(request: httpx.Request) -> httpx.Response:
            nonlocal transport_calls
            transport_calls += 1
            raise httpx.ConnectError('connection-upstream-secret', request=request)

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'Gateway is unavailable',
            ) as raised:
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=1024,
                )

        self.assertEqual(transport_calls, 1)
        self.assertNotIn('connection-upstream-secret', str(raised.exception))
        self.assertIsNone(raised.exception.__cause__)

    async def test_error_status_body_is_not_read_or_exposed(self) -> None:
        stream = _TrackingStream([b'upstream-body-secret'])

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(403, stream=stream)

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            response = await app_context.gateway.request(
                'GET',
                '/api/profile/settings',
                credentials=self._credentials(),
                max_response_bytes=1024,
            )

        self.assertEqual(response, gateway.GatewayResponse(403, b''))
        self.assertEqual(stream.iterated_chunks, 0)
        self.assertEqual(stream.close_count, 1)
        self.assertNotIn('upstream-body-secret', repr(response))

    async def test_success_response_cannot_reflect_relayed_credentials(self) -> None:
        bearer_token = 'reflected-bearer-token-secret'
        reflected_bodies = [
            f'{{"authorization":"Bearer {bearer_token}"}}'.encode(),
            f'{{"token":"{bearer_token}"}}'.encode(),
        ]

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=reflected_bodies.pop(0))

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            for _ in range(2):
                with self.assertRaisesRegex(
                    gateway.GatewayClientError,
                    'invalid response',
                ) as raised:
                    await app_context.gateway.request(
                        'GET',
                        '/api/profile/settings',
                        credentials=self._credentials(
                            authorization_header=f'Bearer {bearer_token}'
                        ),
                        max_response_bytes=1024,
                    )
                self.assertNotIn(bearer_token, str(raised.exception))

    async def test_streaming_response_is_cumulatively_bounded(self) -> None:
        exact_stream = _TrackingStream([b'ab', b'cd'])
        oversized_stream = _TrackingStream([
            b'ab',
            b'cde',
            b'later-upstream-secret',
        ])
        streams = [exact_stream, oversized_stream]

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, stream=streams.pop(0))

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            response = await app_context.gateway.request(
                'GET',
                '/api/profile/settings',
                credentials=self._credentials(),
                max_response_bytes=4,
            )
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'exceeds the size limit',
            ) as raised:
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=4,
                )

        self.assertEqual(response.body, b'abcd')
        self.assertEqual(exact_stream.close_count, 1)
        self.assertEqual(oversized_stream.iterated_chunks, 2)
        self.assertEqual(oversized_stream.close_count, 1)
        self.assertNotIn('later-upstream-secret', str(raised.exception))

    async def test_content_length_is_validated_before_streaming(self) -> None:
        oversized_stream = _TrackingStream([b'upstream-secret'])
        invalid_stream = _TrackingStream([b'upstream-secret'])
        streams_and_headers = [
            (oversized_stream, {'content-length': '5'}),
            (invalid_stream, {'content-length': '-1'}),
        ]

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            stream, headers = streams_and_headers.pop(0)
            return httpx.Response(200, headers=headers, stream=stream)

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            for expected_error in ('exceeds the size limit', 'invalid response'):
                with self.subTest(error=expected_error):
                    with self.assertRaisesRegex(
                        gateway.GatewayClientError,
                        expected_error,
                    ):
                        await app_context.gateway.request(
                            'GET',
                            '/api/profile/settings',
                            credentials=self._credentials(),
                            max_response_bytes=4,
                        )

        self.assertEqual(oversized_stream.iterated_chunks, 0)
        self.assertEqual(invalid_stream.iterated_chunks, 0)
        self.assertEqual(oversized_stream.close_count, 1)
        self.assertEqual(invalid_stream.close_count, 1)

    async def test_compressed_response_is_rejected_before_decoding(self) -> None:
        stream = _TrackingStream([b'compressed-upstream-secret'])

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(
                200,
                headers={'content-encoding': 'gzip'},
                stream=stream,
            )

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'invalid response',
            ):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=100,
                )

        self.assertEqual(stream.iterated_chunks, 0)
        self.assertEqual(stream.close_count, 1)

    async def test_app_context_rejects_unsafe_origins_and_timeouts(self) -> None:
        invalid_origins = (
            'http://gateway.test',
            'https://user:secret@gateway.test',
            'https://gateway.test/api',
            'https://gateway.test?query=value',
            'https://gateway.test#fragment',
            'https://gateway.test\\@evil.test',
            'https://gateway.test%40evil.test',
        )
        for invalid_origin in invalid_origins:
            with self.subTest(origin=invalid_origin):
                with self.assertRaises(ValueError):
                    async with gateway.create_app_context(
                        gateway_url=invalid_origin,
                        request_timeout_seconds=5,
                    ):
                        self.fail('unsafe Gateway origin was accepted')

        for invalid_timeout in (0, -1, 61, float('inf'), float('nan')):
            with self.subTest(timeout=invalid_timeout):
                with self.assertRaises(ValueError):
                    async with gateway.create_app_context(
                        gateway_url='https://gateway.test',
                        request_timeout_seconds=invalid_timeout,
                    ):
                        self.fail('unsafe Gateway timeout was accepted')

    async def test_total_timeout_bounds_headers_and_streaming(self) -> None:
        streaming_response = False
        blocked_stream = _TrackingStream(
            [b'a'],
            block_after_chunks=True,
        )

        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            if streaming_response:
                return httpx.Response(200, stream=blocked_stream)
            await asyncio.Future()
            raise AssertionError('unreachable')

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=0.01,
            transport=httpx.MockTransport(handler),
        ) as app_context:
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'Gateway is unavailable',
            ):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=4,
                )

            streaming_response = True
            with self.assertRaisesRegex(
                gateway.GatewayClientError,
                'Gateway is unavailable',
            ):
                await app_context.gateway.request(
                    'GET',
                    '/api/profile/settings',
                    credentials=self._credentials(),
                    max_response_bytes=4,
                )

        self.assertEqual(blocked_stream.iterated_chunks, 1)
        self.assertEqual(blocked_stream.close_count, 1)

    async def test_app_context_owns_and_closes_transport(self) -> None:
        async def handler(request: httpx.Request) -> httpx.Response:
            del request
            return httpx.Response(200, content=b'{}')

        transport = _TrackingTransport(handler)
        self.assertEqual(transport.close_count, 0)

        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=5,
            transport=transport,
        ) as app_context:
            self.assertIsInstance(app_context.gateway, gateway.GatewayClient)
            await app_context.gateway.request(
                'GET',
                '/api/profile/settings',
                credentials=self._credentials(),
                max_response_bytes=4,
            )
            self.assertEqual(transport.close_count, 0)

        self.assertEqual(transport.close_count, 1)

    def test_gateway_response_repr_hides_body(self) -> None:
        response = gateway.GatewayResponse(200, b'upstream-body-secret')
        self.assertNotIn('upstream-body-secret', repr(response))
        self.assertNotIn('upstream-body-secret', str(response))


if __name__ == '__main__':
    unittest.main()
