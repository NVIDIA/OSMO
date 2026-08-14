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
import json
import unittest
from unittest import mock

from fastmcp.server.auth import AccessToken
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.service.mcp import request_context


class OIDCRequestCredentialsTest(unittest.TestCase):
    def test_verified_upstream_token_is_relayed_to_gateway(self) -> None:
        access_token = AccessToken(
            token='verified-entra-token-value',
            client_id='codex-client',
            scopes=['access_as_user'],
            claims={'preferred_username': 'alice@example.com'},
        )
        request = Request({
            'type': 'http',
            'method': 'POST',
            'path': '/mcp',
            'headers': [
                (b'authorization', b'Bearer client-supplied-token'),
                (b'x-osmo-user', b'mallory@example.com'),
                (b'x-request-id', b'oidc-request-123'),
            ],
        })
        with (
            mock.patch.object(
                request_context,
                'get_access_token',
                return_value=access_token,
            ),
            mock.patch.object(
                request_context,
                'get_http_request',
                return_value=request,
            ),
        ):
            credentials = request_context.get_request_credentials()

        self.assertEqual(
            credentials.authorization_header,
            'Bearer verified-entra-token-value',
        )
        self.assertEqual(credentials.user_name, 'alice@example.com')
        self.assertEqual(credentials.request_id, 'oidc-request-123')

    def test_unverified_request_headers_are_not_credentials(self) -> None:
        request = Request({
            'type': 'http',
            'method': 'POST',
            'path': '/mcp',
            'headers': [
                (b'authorization', b'Bearer client-supplied-token'),
                (b'x-osmo-user', b'mallory@example.com'),
            ],
        })
        with (
            mock.patch.object(
                request_context,
                'get_access_token',
                return_value=None,
            ),
            mock.patch.object(
                request_context,
                'get_http_request',
                return_value=request,
            ),
            self.assertRaisesRegex(
                request_context.RequestContextUnavailable,
                'credentials are unavailable',
            ),
        ):
            request_context.get_request_credentials()

    def test_verified_token_rejects_invalid_request_ids(self) -> None:
        access_token = AccessToken(
            token='verified-entra-token-value',
            client_id='codex-client',
            scopes=['access_as_user'],
            claims={'preferred_username': 'alice@example.com'},
        )
        invalid_headers = (
            [(b'x-request-id', b'')],
            [(b'x-request-id', b'invalid/request')],
            [
                (b'x-request-id', b'first-request'),
                (b'X-Request-ID', b'second-request'),
            ],
            [(b'x-request-id', b'verified-entra-token-value')],
        )

        for headers in invalid_headers:
            with self.subTest(headers=headers):
                request = Request({
                    'type': 'http',
                    'method': 'POST',
                    'path': '/mcp',
                    'headers': headers,
                })
                with (
                    mock.patch.object(
                        request_context,
                        'get_access_token',
                        return_value=access_token,
                    ),
                    mock.patch.object(
                        request_context,
                        'get_http_request',
                        return_value=request,
                    ),
                    self.assertRaisesRegex(
                        request_context.RequestContextUnavailable,
                        'credentials are unavailable',
                    ),
                ):
                    request_context.get_request_credentials()


class RequestContextMiddlewareTest(unittest.IsolatedAsyncioTestCase):

    @staticmethod
    def _headers(
        authorization: bytes = b'Bearer test-token-value',
        user_name: bytes = b'alice@example.com',
        request_id: bytes | None = b'request-123',
    ) -> list[tuple[bytes, bytes]]:
        headers = [
            (b'Authorization', authorization),
            (b'X-Osmo-User', user_name),
        ]
        if request_id is not None:
            headers.append((b'X-Request-ID', request_id))
        return headers

    @staticmethod
    async def _invoke(
        application: ASGIApp,
        headers: list[tuple[bytes, bytes]],
        *,
        path: str = '/mcp',
        query_string: bytes = b'',
        scope_type: str = 'http',
    ) -> list[Message]:
        scope: Scope = {
            'type': scope_type,
            'asgi': {'version': '3.0', 'spec_version': '2.3'},
            'http_version': '1.1',
            'method': 'POST',
            'scheme': 'http',
            'path': path,
            'raw_path': path.encode('ascii'),
            'query_string': query_string,
            'root_path': '',
            'headers': headers,
            'server': ('mcp.test', 80),
            'client': ('test-client', 1234),
            'state': {},
        }
        messages: list[Message] = []

        async def receive() -> Message:
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def send(message: Message) -> None:
            messages.append(message)

        await application(scope, receive, send)
        return messages

    @staticmethod
    def _status(messages: list[Message]) -> int:
        starts = [
            message for message in messages
            if message['type'] == 'http.response.start'
        ]
        if len(starts) != 1:
            raise AssertionError(f'Expected one response start, got {starts!r}.')
        return starts[0]['status']

    @staticmethod
    def _body(messages: list[Message]) -> bytes:
        return b''.join(
            message.get('body', b'')
            for message in messages
            if message['type'] == 'http.response.body'
        )

    async def test_valid_headers_create_context_and_are_consumed(self) -> None:
        captured: list[request_context.RequestCredentials] = []
        downstream_headers: list[tuple[bytes, bytes]] = []

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            captured.append(request_context.get_request_credentials())
            downstream_headers.extend(scope['headers'])
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(downstream)
        headers = self._headers(
            authorization=b'bEaReR opaque.a-b_c~+/==',
            user_name=b'alice+tag#EXT#@example.com',
            request_id=b'req-123_ABC.trace:span',
        )
        headers.append((b'x-unrelated', b'kept'))

        messages = await self._invoke(middleware, headers)

        self.assertEqual(self._status(messages), 200)
        self.assertEqual(len(captured), 1)
        self.assertEqual(
            captured[0].authorization_header,
            'bEaReR opaque.a-b_c~+/==',
        )
        self.assertEqual(captured[0].user_name, 'alice+tag#EXT#@example.com')
        self.assertEqual(captured[0].request_id, 'req-123_ABC.trace:span')
        self.assertEqual(downstream_headers, [(b'x-unrelated', b'kept')])
        with self.assertRaisesRegex(RuntimeError, 'credentials are unavailable'):
            request_context.get_request_credentials()

    async def test_optional_request_id_is_absent(self) -> None:
        captured: list[request_context.RequestCredentials] = []

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            captured.append(request_context.get_request_credentials())
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(downstream)
        messages = await self._invoke(
            middleware,
            self._headers(request_id=None),
        )

        self.assertEqual(self._status(messages), 200)
        self.assertIsNone(captured[0].request_id)

    async def test_duplicate_context_headers_are_rejected(self) -> None:
        downstream_calls = 0

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive, send
            nonlocal downstream_calls
            downstream_calls += 1

        middleware = request_context.RequestContextMiddleware(downstream)
        duplicate_headers = (
            (b'authorization', b'Bearer test-token'),
            (b'x-osmo-user', b'alice@example.com'),
            (b'x-request-id', b'request-123'),
        )

        for duplicate_name, duplicate_value in duplicate_headers:
            with self.subTest(header=duplicate_name):
                headers = self._headers()
                headers.append((duplicate_name.upper(), duplicate_value))
                messages = await self._invoke(middleware, headers)
                self.assertEqual(self._status(messages), 400)
                self.assertEqual(
                    json.loads(self._body(messages)),
                    {'error': 'Invalid MCP authentication context.'},
                )

        self.assertEqual(downstream_calls, 0)

    async def test_malformed_authorization_headers_are_rejected(self) -> None:
        invalid_values = (
            b'',
            b'Bearer',
            b'Bearer ',
            b'Basic token',
            b' Bearer token',
            b'Bearer\ttoken',
            b'Bearer token extra',
            b'Bearer token\x00',
            b'Bearer \xff',
            b'Bearer token=middle=value',
            b'a' * (request_context.MAX_AUTHORIZATION_HEADER_BYTES + 1),
        )

        for invalid_value in invalid_values:
            with self.subTest(value=invalid_value[:32]):
                middleware = request_context.RequestContextMiddleware(
                    self._success_application,
                )
                messages = await self._invoke(
                    middleware,
                    self._headers(authorization=invalid_value),
                )
                self.assertEqual(self._status(messages), 400)
                response_body = self._body(messages)
                if invalid_value:
                    self.assertNotIn(invalid_value, response_body)

    async def test_short_bearer_token_is_rejected(self) -> None:
        middleware = request_context.RequestContextMiddleware(
            self._success_application,
        )

        messages = await self._invoke(
            middleware,
            self._headers(authorization=b'Bearer short-token'),
        )

        self.assertEqual(self._status(messages), 400)
        self.assertNotIn(b'short-token', self._body(messages))

        middleware = request_context.RequestContextMiddleware(
            self._success_application,
        )
        messages = await self._invoke(
            middleware,
            [(b'x-osmo-user', b'alice@example.com')],
        )
        self.assertEqual(self._status(messages), 400)

    async def test_malformed_user_headers_are_rejected(self) -> None:
        invalid_values = (
            b'',
            b' ',
            b' alice@example.com',
            b'alice@example.com ',
            b'alice\x00@example.com',
            b'alice\n@example.com',
            b'\xff',
            b'a' * (request_context.MAX_USER_HEADER_BYTES + 1),
        )

        for invalid_value in invalid_values:
            with self.subTest(value=invalid_value[:32]):
                middleware = request_context.RequestContextMiddleware(
                    self._success_application,
                )
                messages = await self._invoke(
                    middleware,
                    self._headers(user_name=invalid_value),
                )
                self.assertEqual(self._status(messages), 400)

        middleware = request_context.RequestContextMiddleware(
            self._success_application,
        )
        messages = await self._invoke(
            middleware,
            [(b'authorization', b'Bearer test-token')],
        )
        self.assertEqual(self._status(messages), 400)

    async def test_malformed_request_ids_are_rejected(self) -> None:
        invalid_values = (
            b'',
            b' ',
            b' request-123',
            b'request-123 ',
            b'request/123',
            b'request\x00123',
            b'request\n123',
            b'\xff',
            b'a' * (request_context.MAX_REQUEST_ID_HEADER_BYTES + 1),
        )

        for invalid_value in invalid_values:
            with self.subTest(value=invalid_value[:32]):
                middleware = request_context.RequestContextMiddleware(
                    self._success_application,
                )
                messages = await self._invoke(
                    middleware,
                    self._headers(request_id=invalid_value),
                )
                self.assertEqual(self._status(messages), 400)

    async def test_request_ids_overlapping_bearer_are_rejected(self) -> None:
        bearer_token = b'opaque-token-segment-1234567890'
        overlapping_request_ids = (
            bearer_token,
            b'opaque-token-segment',
            b'request-opaque-token-segment-suffix',
            b'token-segment-1234',
        )

        for request_id in overlapping_request_ids:
            with self.subTest(request_id=request_id):
                middleware = request_context.RequestContextMiddleware(
                    self._success_application,
                )
                messages = await self._invoke(
                    middleware,
                    self._headers(
                        authorization=b'Bearer ' + bearer_token,
                        request_id=request_id,
                    ),
                )

                self.assertEqual(self._status(messages), 400)
                self.assertNotIn(bearer_token, self._body(messages))

    async def test_header_length_boundaries_are_accepted(self) -> None:
        authorization = b'Bearer ' + b'a' * (
            request_context.MAX_AUTHORIZATION_HEADER_BYTES - len(b'Bearer ')
        )
        user_name = b'a' * request_context.MAX_USER_HEADER_BYTES
        request_id = b'b' * request_context.MAX_REQUEST_ID_HEADER_BYTES
        middleware = request_context.RequestContextMiddleware(
            self._success_application,
        )

        messages = await self._invoke(
            middleware,
            self._headers(
                authorization=authorization,
                user_name=user_name,
                request_id=request_id,
            ),
        )

        self.assertEqual(self._status(messages), 200)

    async def test_non_mcp_requests_bypass_context_validation(self) -> None:
        observations: list[tuple[str, list[tuple[bytes, bytes]]]] = []

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            with self.assertRaisesRegex(RuntimeError, 'credentials are unavailable'):
                request_context.get_request_credentials()
            observations.append((scope['type'], scope.get('headers', [])))
            if scope['type'] == 'http':
                await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(downstream)
        invalid_headers = [
            (b'authorization', b'not-a-bearer'),
            (b'x-osmo-user', b''),
        ]

        for path in ('/health', '/health/ready', '/mcp/neighbor'):
            messages = await self._invoke(
                middleware,
                invalid_headers,
                path=path,
            )
            self.assertEqual(self._status(messages), 200)

        await self._invoke(
            middleware,
            invalid_headers,
            scope_type='websocket',
        )
        self.assertEqual(len(observations), 4)
        self.assertTrue(all(headers == invalid_headers for _, headers in observations))

        messages = await self._invoke(
            middleware,
            invalid_headers,
            query_string=b'client=test',
        )
        self.assertEqual(self._status(messages), 400)

    async def test_non_mcp_request_masks_inherited_credentials(self) -> None:
        inner_context_was_empty = False

        async def inner_downstream(
            scope: Scope,
            receive: Receive,
            send: Send,
        ) -> None:
            nonlocal inner_context_was_empty
            with self.assertRaisesRegex(RuntimeError, 'credentials are unavailable'):
                request_context.get_request_credentials()
            inner_context_was_empty = True
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        inner_middleware = request_context.RequestContextMiddleware(
            inner_downstream,
        )

        async def outer_downstream(
            scope: Scope,
            receive: Receive,
            send: Send,
        ) -> None:
            self.assertEqual(
                request_context.get_request_credentials().user_name,
                'alice@example.com',
            )
            await self._invoke(inner_middleware, [], path='/health')
            self.assertEqual(
                request_context.get_request_credentials().user_name,
                'alice@example.com',
            )
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        outer_middleware = request_context.RequestContextMiddleware(
            outer_downstream,
        )
        messages = await self._invoke(outer_middleware, self._headers())

        self.assertEqual(self._status(messages), 200)
        self.assertTrue(inner_context_was_empty)

    async def test_context_resets_after_exception(self) -> None:
        sentinel = RuntimeError('downstream failure')

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive, send
            self.assertEqual(
                request_context.get_request_credentials().user_name,
                'alice@example.com',
            )
            raise sentinel

        middleware = request_context.RequestContextMiddleware(downstream)
        with self.assertRaises(RuntimeError) as raised:
            await self._invoke(middleware, self._headers())
        self.assertIs(raised.exception, sentinel)
        with self.assertRaisesRegex(RuntimeError, 'credentials are unavailable'):
            request_context.get_request_credentials()

    async def test_context_resets_after_cancellation(self) -> None:
        entered = asyncio.Event()
        reset_after_cancellation = False

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            del scope, receive, send
            request_context.get_request_credentials()
            entered.set()
            await asyncio.Future()

        middleware = request_context.RequestContextMiddleware(downstream)

        async def invoke_and_check_reset() -> None:
            nonlocal reset_after_cancellation
            try:
                await self._invoke(middleware, self._headers())
            finally:
                try:
                    request_context.get_request_credentials()
                except RuntimeError:
                    reset_after_cancellation = True

        request_task = asyncio.create_task(invoke_and_check_reset())
        await asyncio.wait_for(entered.wait(), timeout=5)
        request_task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request_task
        self.assertTrue(reset_after_cancellation)

    async def test_request_completion_invalidates_copied_task_context(self) -> None:
        release_background = asyncio.Event()
        background_context_was_invalidated = False
        background_task: asyncio.Task[None] | None = None

        async def inspect_context_after_request() -> None:
            nonlocal background_context_was_invalidated
            await release_background.wait()
            try:
                request_context.get_request_credentials()
            except RuntimeError:
                background_context_was_invalidated = True

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            nonlocal background_task
            request_context.get_request_credentials()
            background_task = asyncio.create_task(inspect_context_after_request())
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(downstream)
        messages = await self._invoke(middleware, self._headers())
        self.assertEqual(self._status(messages), 200)

        release_background.set()
        if background_task is None:
            self.fail('Downstream did not create the background task.')
        await background_task
        self.assertTrue(background_context_was_invalidated)

    async def test_concurrent_requests_keep_credentials_isolated(self) -> None:
        entered = {
            'alice@example.com': asyncio.Event(),
            'bob@example.com': asyncio.Event(),
        }
        release = asyncio.Event()
        observations: dict[
            str,
            tuple[request_context.RequestCredentials, request_context.RequestCredentials],
        ] = {}

        async def downstream(scope: Scope, receive: Receive, send: Send) -> None:
            before = request_context.get_request_credentials()
            entered[before.user_name].set()
            await release.wait()
            after = request_context.get_request_credentials()
            observations[before.user_name] = (before, after)
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        middleware = request_context.RequestContextMiddleware(downstream)
        alice_request = asyncio.create_task(self._invoke(
            middleware,
            self._headers(
                authorization=b'Bearer alice-token-value',
                user_name=b'alice@example.com',
                request_id=b'alice-request',
            ),
        ))
        bob_request = asyncio.create_task(self._invoke(
            middleware,
            self._headers(
                authorization=b'Bearer bob-token-value-1',
                user_name=b'bob@example.com',
                request_id=b'bob-request',
            ),
        ))
        await asyncio.wait_for(asyncio.gather(
            entered['alice@example.com'].wait(),
            entered['bob@example.com'].wait(),
        ), timeout=5)
        release.set()
        await asyncio.gather(alice_request, bob_request)

        alice_before, alice_after = observations['alice@example.com']
        bob_before, bob_after = observations['bob@example.com']
        self.assertEqual(alice_before, alice_after)
        self.assertEqual(bob_before, bob_after)
        self.assertEqual(
            alice_before.authorization_header,
            'Bearer alice-token-value',
        )
        self.assertEqual(
            bob_before.authorization_header,
            'Bearer bob-token-value-1',
        )
        self.assertNotEqual(alice_before, bob_before)
        with self.assertRaisesRegex(RuntimeError, 'credentials are unavailable'):
            request_context.get_request_credentials()

    def test_credentials_repr_does_not_expose_authorization(self) -> None:
        credentials = request_context.RequestCredentials(
            authorization_header='Bearer highly-sensitive-token',
            user_name='alice@example.com',
            request_id='request-123',
        )

        self.assertNotIn('highly-sensitive-token', repr(credentials))
        self.assertNotIn('highly-sensitive-token', str(credentials))
        self.assertIn('alice@example.com', repr(credentials))
        self.assertIn('request-123', repr(credentials))

    @staticmethod
    async def _success_application(
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        request_context.get_request_credentials()
        await JSONResponse({'status': 'ok'})(scope, receive, send)


if __name__ == '__main__':
    unittest.main()
