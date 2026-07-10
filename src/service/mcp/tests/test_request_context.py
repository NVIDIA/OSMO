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
import unittest

import httpx
from starlette.responses import JSONResponse
from starlette.types import Message

from src.service.mcp import request_context


class RequestContextTest(unittest.IsolatedAsyncioTestCase):

    async def test_valid_headers_establish_request_credentials(self) -> None:
        observed: list[request_context.RequestCredentials] = []

        async def application(scope, receive, send) -> None:
            observed.append(request_context.get_request_credentials())
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        response = await self._request(
            application,
            headers=self._headers(request_id='request-123'),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0].authorization_header, 'Bearer token-alice')
        self.assertEqual(observed[0].user_name, 'alice@example.com')
        self.assertEqual(observed[0].request_id, 'request-123')
        with self.assertRaisesRegex(RuntimeError, 'unavailable'):
            request_context.get_request_credentials()

    async def test_invalid_authentication_headers_fail_closed(self) -> None:
        invalid_headers = (
            [('x-osmo-user', 'alice@example.com')],
            [('Authorization', ''), ('x-osmo-user', 'alice@example.com')],
            [('Authorization', 'Basic secret'), ('x-osmo-user', 'alice@example.com')],
            [('Authorization', 'Bearer'), ('x-osmo-user', 'alice@example.com')],
            [('Authorization', 'Bearer token with-space'),
             ('x-osmo-user', 'alice@example.com')],
            [('Authorization', 'Bearer first'), ('Authorization', 'Bearer second'),
             ('x-osmo-user', 'alice@example.com')],
        )
        calls = 0

        async def application(scope, receive, send) -> None:
            del scope, receive, send
            nonlocal calls
            calls += 1

        for headers in invalid_headers:
            with self.subTest(headers=headers):
                response = await self._request(application, headers=headers)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(
                    response.json(), {'error': 'Invalid MCP authentication context.'})
                self.assertNotIn('secret', response.text)
                self.assertNotIn('first', response.text)
                self.assertNotIn('second', response.text)
        self.assertEqual(calls, 0)

    async def test_authorization_header_size_and_encoding_are_bounded(self) -> None:
        max_token_bytes = request_context._MAX_AUTHORIZATION_BYTES - len(b'Bearer ')  # pylint: disable=protected-access

        async def application(scope, receive, send) -> None:
            self.assertEqual(
                len(request_context.get_request_credentials().authorization_header),
                request_context._MAX_AUTHORIZATION_BYTES,  # pylint: disable=protected-access
            )
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        valid_status = await self._raw_request_status(
            application,
            headers=[
                (b'authorization', b'Bearer ' + b'a' * max_token_bytes),
                (b'x-osmo-user', b'alice@example.com'),
            ],
        )
        oversized_status = await self._raw_request_status(
            application,
            headers=[
                (b'authorization', b'Bearer ' + b'a' * (max_token_bytes + 1)),
                (b'x-osmo-user', b'alice@example.com'),
            ],
        )
        invalid_encoding_status = await self._raw_request_status(
            application,
            headers=[
                (b'authorization', b'Bearer token-\xff'),
                (b'x-osmo-user', b'alice@example.com'),
            ],
        )

        self.assertEqual(valid_status, 200)
        self.assertEqual(oversized_status, 401)
        self.assertEqual(invalid_encoding_status, 401)

    async def test_invalid_identity_or_request_id_fails_closed(self) -> None:
        invalid_headers = (
            [('Authorization', 'Bearer token')],
            self._headers(user_name=' alice@example.com'),
            self._headers(user_name='alice\n@example.com'),
            self._headers(user_name='a' * 257),
            self._headers() + [('x-osmo-user', 'bob@example.com')],
            self._headers(request_id='contains space'),
            self._headers(request_id='request-1') + [('x-request-id', 'request-2')],
        )

        async def application(scope, receive, send) -> None:
            del scope, receive, send
            self.fail('Invalid credentials must not reach the MCP application.')

        for headers in invalid_headers:
            with self.subTest(headers=headers):
                response = await self._request(application, headers=headers)
                self.assertEqual(response.status_code, 401)

    async def test_unrelated_paths_do_not_require_credentials(self) -> None:
        context_available = True

        async def application(scope, receive, send) -> None:
            nonlocal context_available
            try:
                request_context.get_request_credentials()
            except RuntimeError:
                context_available = False
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        response = await self._request(application, path='/health', headers=[])

        self.assertEqual(response.status_code, 200)
        self.assertFalse(context_available)

    async def test_context_is_reset_after_application_error(self) -> None:
        async def application(scope, receive, send) -> None:
            del scope, receive, send
            self.assertEqual(
                request_context.get_request_credentials().user_name,
                'alice@example.com',
            )
            raise ValueError('test failure')

        with self.assertRaisesRegex(ValueError, 'test failure'):
            await self._request(application, headers=self._headers())
        with self.assertRaisesRegex(RuntimeError, 'unavailable'):
            request_context.get_request_credentials()

    async def test_context_is_reset_after_cancellation(self) -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        async def application(scope, receive, send) -> None:
            del scope, receive, send
            self.assertEqual(
                request_context.get_request_credentials().authorization_header,
                'Bearer token-alice',
            )
            started.set()
            await release.wait()

        async def cancelled_request() -> None:
            try:
                await self._request(application, headers=self._headers())
            except asyncio.CancelledError:
                # ASGITransport invokes the middleware in this task, so this
                # assertion observes the same ContextVar after its finally block.
                with self.assertRaisesRegex(RuntimeError, 'unavailable'):
                    request_context.get_request_credentials()
                raise

        task = asyncio.create_task(cancelled_request())
        await started.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        with self.assertRaisesRegex(RuntimeError, 'unavailable'):
            request_context.get_request_credentials()

    async def test_concurrent_requests_keep_credentials_isolated(self) -> None:
        both_started = asyncio.Event()
        observations: dict[str, list[request_context.RequestCredentials]] = {}
        started_count = 0

        async def application(scope, receive, send) -> None:
            nonlocal started_count
            before = request_context.get_request_credentials()
            started_count += 1
            if started_count == 2:
                both_started.set()
            await both_started.wait()
            after = request_context.get_request_credentials()
            observations[before.user_name] = [before, after]
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        await asyncio.gather(
            self._request(
                application,
                headers=self._headers(
                    user_name='alice@example.com', token='token-alice')),
            self._request(
                application,
                headers=self._headers(
                    user_name='bob@example.com', token='token-bob')),
        )

        self.assertEqual(set(observations), {'alice@example.com', 'bob@example.com'})
        for user_name, credentials in observations.items():
            expected_token = 'token-alice' if user_name.startswith('alice') else 'token-bob'
            self.assertTrue(all(item.user_name == user_name for item in credentials))
            self.assertTrue(all(
                item.authorization_header == f'Bearer {expected_token}'
                for item in credentials
            ))

    def test_credentials_repr_does_not_expose_authorization(self) -> None:
        credentials = request_context.RequestCredentials(
            authorization_header='Bearer secret-token',
            user_name='alice@example.com',
            request_id='request-123',
        )

        self.assertNotIn('secret-token', repr(credentials))
        self.assertNotIn('secret-token', str(credentials))

    async def _request(
        self,
        application,
        *,
        headers: list[tuple[str, str]],
        path: str = '/mcp',
    ) -> httpx.Response:
        middleware = request_context.RequestContextMiddleware(application)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=middleware),
            base_url='http://mcp.test',
        ) as client:
            return await client.post(path, headers=headers)

    async def _raw_request_status(
        self,
        application,
        *,
        headers: list[tuple[bytes, bytes]],
    ) -> int:
        messages: list[Message] = []

        async def receive() -> Message:
            return {'type': 'http.disconnect'}

        async def send(message: Message) -> None:
            messages.append(message)

        middleware = request_context.RequestContextMiddleware(application)
        await middleware(
            {
                'type': 'http',
                'method': 'POST',
                'path': '/mcp',
                'headers': headers,
            },
            receive,
            send,
        )
        return messages[0]['status']

    @staticmethod
    def _headers(
        *,
        user_name: str = 'alice@example.com',
        token: str = 'token-alice',
        request_id: str | None = None,
    ) -> list[tuple[str, str]]:
        headers = [
            ('Authorization', f'Bearer {token}'),
            ('x-osmo-user', user_name),
        ]
        if request_id is not None:
            headers.append(('x-request-id', request_id))
        return headers


if __name__ == '__main__':
    unittest.main()
