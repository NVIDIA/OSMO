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
import socket
import unittest
from typing import Literal

import uvicorn

from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.routing import Route

from src.service.core import responses


def _scope(spec_version: str = '2.4') -> dict:
    """Minimal ASGI HTTP scope for calling a response directly."""
    return {'type': 'http', 'asgi': {'version': '3.0', 'spec_version': spec_version}}


async def _idle_receive():
    """ASGI receive for a client that stays connected and sends nothing further."""
    await asyncio.Future()


async def _discard_send(message) -> None:  # pylint: disable=unused-argument
    """ASGI send that drops every message."""


def _disconnect_once(after: asyncio.Event):
    """ASGI receive that reports a disconnect once `after` is set."""

    async def receive():
        await after.wait()
        return {'type': 'http.disconnect'}

    return receive


def _quiet_body(started: asyncio.Event, closed: asyncio.Event):
    """Body that blocks before its first chunk, recording start and closure."""

    async def body():
        try:
            started.set()
            await asyncio.Future()
            yield 'unreachable\n'
        finally:
            closed.set()

    return body()


class TestClosingStreamingResponse(unittest.IsolatedAsyncioTestCase):
    """Covers release of an idle body when the client disconnects."""

    async def test_quiet_body_is_closed_when_client_disconnects(self):
        for spec_version in ('2.3', '2.4'):
            with self.subTest(spec_version=spec_version):
                started, closed = asyncio.Event(), asyncio.Event()
                response = responses.ClosingStreamingResponse(_quiet_body(started, closed))
                await asyncio.wait_for(
                    response(_scope(spec_version), _disconnect_once(started), _discard_send),
                    timeout=1,
                )
                self.assertTrue(closed.is_set(), 'A quiet body outlived its client.')

    async def test_body_is_closed_after_it_is_fully_sent(self):
        closed = asyncio.Event()
        sent = []

        async def body():
            try:
                yield 'one\n'
                yield 'two\n'
            finally:
                closed.set()

        async def collecting_send(message):
            if message['type'] == 'http.response.body':
                sent.append(message['body'])

        response = responses.ClosingStreamingResponse(body())
        await asyncio.wait_for(
            response(_scope(), _idle_receive, collecting_send), timeout=1)

        self.assertEqual(b''.join(sent), b'one\ntwo\n')
        self.assertTrue(closed.is_set(), 'The body was not closed after a full send.')

    async def test_body_failure_propagates(self):

        async def failing_body():
            # The unreachable yield is what makes this an async generator; the
            # raise fires on the first __anext__.
            if False:  # pylint: disable=using-constant-test
                yield 'unreachable\n'
            raise OSError('backend read failed')

        response = responses.ClosingStreamingResponse(failing_body())
        with self.assertRaisesRegex(OSError, 'backend read failed'):
            await asyncio.wait_for(
                response(_scope(), _idle_receive, _discard_send), timeout=1)

    async def test_background_task_runs_after_the_body_is_closed(self):
        order = []

        async def body():
            try:
                yield 'one\n'
            finally:
                order.append('body closed')

        async def background():
            order.append('background')

        response = responses.ClosingStreamingResponse(
            body(), background=BackgroundTask(background))
        await asyncio.wait_for(
            response(_scope(), _idle_receive, _discard_send), timeout=1)

        self.assertEqual(order, ['body closed', 'background'])

    async def test_socket_disconnect_closes_idle_and_active_streams(self):
        """Exercise real HTTP disconnects, including servers that discard sends."""
        for protocol in ('h11', 'httptools'):
            for active in (False, True):
                with self.subTest(protocol=protocol, active=active):
                    await self._check_socket_disconnect(protocol, active)

    async def _check_socket_disconnect(
        self, protocol: Literal['h11', 'httptools'], active: bool,
    ):
        closed = asyncio.Event()

        async def body():
            try:
                yield 'first line\n'
                while True:
                    if active:
                        await asyncio.sleep(0.01)
                        yield 'next line\n'
                    else:
                        await asyncio.Future()
            finally:
                closed.set()

        async def endpoint(request):  # pylint: disable=unused-argument
            return responses.ClosingStreamingResponse(body())

        async def pass_through(request, call_next):
            return await call_next(request)

        app = Starlette(routes=[Route('/logs', endpoint)])
        app.add_middleware(BaseHTTPMiddleware, dispatch=pass_through)
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            server = uvicorn.Server(uvicorn.Config(
                app, http=protocol, lifespan='off', log_level='critical',
                timeout_graceful_shutdown=1))
            serving = asyncio.create_task(server.serve(sockets=[listener]))
            try:
                async def wait_started():
                    while not server.started:
                        if serving.done():
                            serving.result()
                        await asyncio.sleep(0.01)

                await asyncio.wait_for(wait_started(), timeout=5)
                reader, writer = await asyncio.open_connection(
                    '127.0.0.1', listener.getsockname()[1])
                try:
                    writer.write(b'GET /logs HTTP/1.1\r\nHost: localhost\r\n\r\n')
                    await writer.drain()
                    await asyncio.wait_for(reader.readuntil(b'first line\n'), timeout=2)
                finally:
                    writer.close()
                    await writer.wait_closed()

                await asyncio.wait_for(closed.wait(), timeout=2)

                async def wait_requests_finished():
                    while server.server_state.tasks:
                        await asyncio.sleep(0.01)

                await asyncio.wait_for(wait_requests_finished(), timeout=2)
            finally:
                server.should_exit = True
                await asyncio.wait_for(serving, timeout=5)

    async def test_quiet_body_is_closed_behind_http_middleware(self):
        """The core service wraps requests in BaseHTTPMiddleware; it must not
        prevent the disconnect from reaching the response."""
        started, closed = asyncio.Event(), asyncio.Event()
        request_sent = False

        async def endpoint(request):  # pylint: disable=unused-argument
            return responses.ClosingStreamingResponse(_quiet_body(started, closed))

        async def pass_through(request, call_next):
            return await call_next(request)

        async def receive():
            nonlocal request_sent
            if not request_sent:
                request_sent = True
                return {'type': 'http.request', 'body': b'', 'more_body': False}
            await started.wait()
            return {'type': 'http.disconnect'}

        app = Starlette(routes=[Route('/logs', endpoint)])
        app.add_middleware(BaseHTTPMiddleware, dispatch=pass_through)
        await asyncio.wait_for(
            app({**_scope(), 'http_version': '1.1', 'method': 'GET', 'scheme': 'http',
                 'path': '/logs', 'raw_path': b'/logs', 'query_string': b'', 'headers': [],
                 'client': ('127.0.0.1', 12345), 'server': ('testserver', 80)},
                receive, _discard_send),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'A quiet body was not closed through HTTP middleware.')


if __name__ == '__main__':
    unittest.main()
