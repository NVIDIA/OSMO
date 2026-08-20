"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
from unittest import mock

import fastapi.responses

from src.service.asgi import responses
from src.service.core import service


def _request_scope(headers=None) -> dict:
    """ASGI HTTP scope for a request that carries no client version header."""
    return {
        'type': 'http',
        'asgi': {'version': '3.0', 'spec_version': '2.4'},
        'http_version': '1.1',
        'method': 'GET',
        'scheme': 'http',
        'path': '/api/workflow',
        'raw_path': b'/api/workflow',
        'query_string': b'',
        'headers': headers or [],
        'client': ('127.0.0.1', 12345),
        'server': ('testserver', 80),
    }


async def _empty_receive():
    """ASGI receive for a client that stays connected and sends nothing further."""
    await asyncio.Future()


async def _discard_send(message) -> None:  # pylint: disable=unused-argument
    """ASGI send that drops every message."""


class TestClientVersionMiddleware(unittest.IsolatedAsyncioTestCase):
    """Covers the ASGI client version middleware wrapping the core service."""

    async def test_send_failure_reaches_the_wrapped_response(self):
        """The disconnect signal a streaming response relies on must not be swallowed."""
        closed = asyncio.Event()

        async def body():
            try:
                yield 'first chunk\n'
                await asyncio.Future()
            finally:
                closed.set()

        async def application(scope, receive, send):
            await responses.ClosingStreamingResponse(body())(scope, receive, send)

        async def failing_send(message):
            if message['type'] == 'http.response.body':
                raise OSError('client disconnected')

        middleware = service.ClientVersionMiddleware(application)
        with self.assertRaises(Exception):
            await asyncio.wait_for(
                middleware(_request_scope(), _empty_receive, failing_send),
                timeout=1,
            )

        self.assertTrue(
            closed.is_set(),
            'The middleware hid the failed send from the streaming response.',
        )

    async def test_quiet_stream_is_closed_on_disconnect(self):
        started = asyncio.Event()
        closed = asyncio.Event()

        async def body():
            try:
                started.set()
                await asyncio.Future()
                yield 'unreachable\n'
            finally:
                closed.set()

        async def application(scope, receive, send):
            await responses.ClosingStreamingResponse(body())(scope, receive, send)

        async def receive():
            await started.wait()
            return {'type': 'http.disconnect'}

        middleware = service.ClientVersionMiddleware(application)
        await asyncio.wait_for(
            middleware(_request_scope(), receive, _discard_send),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'A quiet stream survived the client disconnect.')

    async def test_check_headers_are_added_to_the_response(self):
        sent = []

        async def application(scope, receive, send):
            await send({'type': 'http.response.start', 'status': 200,
                        'headers': [(b'content-type', b'text/plain')]})
            await send({'type': 'http.response.body', 'body': b'ok', 'more_body': False})

        async def collecting_send(message):
            sent.append(message)

        check = service.ClientVersionCheck(response_headers={'x-osmo-warning': 'update'})
        middleware = service.ClientVersionMiddleware(application)
        with mock.patch.object(service, '_check_client_version', return_value=check):
            await asyncio.wait_for(
                middleware(_request_scope(), _empty_receive, collecting_send),
                timeout=1,
            )

        self.assertIn((b'x-osmo-warning', b'update'), sent[0]['headers'])
        self.assertIn((b'content-type', b'text/plain'), sent[0]['headers'])

    async def test_rejection_short_circuits_the_application(self):
        called = False

        async def application(scope, receive, send):
            nonlocal called
            called = True

        sent = []

        async def collecting_send(message):
            sent.append(message)

        check = service.ClientVersionCheck(
            rejection=fastapi.responses.JSONResponse(status_code=400, content={'m': 'old'}))
        middleware = service.ClientVersionMiddleware(application)
        with mock.patch.object(service, '_check_client_version', return_value=check):
            await asyncio.wait_for(
                middleware(_request_scope(), _empty_receive, collecting_send),
                timeout=1,
            )

        self.assertFalse(called, 'A rejected request still reached the application.')
        self.assertEqual(sent[0]['status'], 400)

    async def test_non_http_scopes_pass_straight_through(self):
        seen = []

        async def application(scope, receive, send):
            seen.append(scope['type'])

        middleware = service.ClientVersionMiddleware(application)
        await middleware({'type': 'websocket'}, _empty_receive, _discard_send)

        self.assertEqual(seen, ['websocket'])


if __name__ == '__main__':
    unittest.main()
