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

from starlette.applications import Starlette
from starlette.background import BackgroundTask
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import ClientDisconnect
from starlette.routing import Route
from starlette.types import Receive

from src.service.asgi import responses


def _http_scope(spec_version: str = '2.4') -> dict:
    """Minimal ASGI HTTP scope for calling a response directly."""
    return {
        'type': 'http',
        'asgi': {'version': '3.0', 'spec_version': spec_version},
    }


def _request_scope(spec_version: str = '2.4') -> dict:
    """ASGI HTTP scope complete enough for Starlette to route a request."""
    return {
        **_http_scope(spec_version),
        'http_version': '1.1',
        'method': 'GET',
        'scheme': 'http',
        'path': '/logs',
        'raw_path': b'/logs',
        'query_string': b'',
        'headers': [],
        'client': ('127.0.0.1', 12345),
        'server': ('testserver', 80),
    }


async def _idle_receive():
    """ASGI receive for a client that stays connected and sends nothing further."""
    await asyncio.Future()


async def _discard_send(message) -> None:  # pylint: disable=unused-argument
    """ASGI send that drops every message."""


def _disconnect_receive(after: asyncio.Event) -> Receive:
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


def _stalling_body(closed: asyncio.Event):
    """Body that yields one chunk and then blocks, recording its closure."""

    async def body():
        try:
            yield 'first chunk\n'
            await asyncio.Future()
        finally:
            closed.set()

    return body()


class TestClosingStreamingResponse(unittest.IsolatedAsyncioTestCase):
    """Covers resource release when a streaming response loses its client."""

    async def test_quiet_body_is_closed_when_client_disconnects(self):
        started = asyncio.Event()
        closed = asyncio.Event()

        response = responses.ClosingStreamingResponse(_quiet_body(started, closed))
        await asyncio.wait_for(
            response(_http_scope(), _disconnect_receive(started), _discard_send),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'A quiet body was not closed on disconnect.')

    async def test_quiet_body_is_closed_on_a_pre_2_4_server(self):
        started = asyncio.Event()
        closed = asyncio.Event()

        response = responses.ClosingStreamingResponse(_quiet_body(started, closed))
        await asyncio.wait_for(
            response(_http_scope('2.3'), _disconnect_receive(started), _discard_send),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'The guarantee depends on the ASGI spec version.')

    async def test_failed_send_closes_body_and_reports_a_disconnect(self):
        closed = asyncio.Event()

        async def failing_send(message):
            if message['type'] == 'http.response.body':
                raise OSError('client disconnected')

        response = responses.ClosingStreamingResponse(_stalling_body(closed))
        with self.assertRaises(ClientDisconnect):
            await asyncio.wait_for(
                response(_http_scope(), _idle_receive, failing_send),
                timeout=1,
            )

        self.assertTrue(closed.is_set(), 'The body was not closed after a failed send.')

    async def test_body_failure_is_not_reported_as_a_client_disconnect(self):

        async def failing_body():
            # The unreachable yield is what makes this an async generator; the
            # raise fires on the first __anext__.
            if False:  # pylint: disable=using-constant-test
                yield 'unreachable\n'
            raise OSError('backend read failed')

        response = responses.ClosingStreamingResponse(failing_body())
        with self.assertRaisesRegex(OSError, 'backend read failed'):
            await asyncio.wait_for(
                response(_http_scope(), _idle_receive, _discard_send),
                timeout=1,
            )

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
            response(_http_scope(), _idle_receive, collecting_send),
            timeout=1,
        )

        self.assertEqual(b''.join(sent), b'one\ntwo\n')
        self.assertTrue(closed.is_set(), 'The body was not closed after a full send.')

    async def test_synchronous_body_is_closed_when_client_disconnects(self):
        closed = asyncio.Event()
        chunk_sent = asyncio.Event()

        def body():
            try:
                yield 'first chunk\n'
                while True:
                    yield 'more\n'
            finally:
                closed.set()

        async def send_first_chunk_only(message):
            if message['type'] == 'http.response.body':
                chunk_sent.set()

        response = responses.ClosingStreamingResponse(body())
        await asyncio.wait_for(
            response(_http_scope(), _disconnect_receive(chunk_sent), send_first_chunk_only),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'A synchronous body was not closed on disconnect.')

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
            response(_http_scope(), _idle_receive, _discard_send),
            timeout=1,
        )

        self.assertEqual(order, ['body closed', 'background'])

    async def test_quiet_body_is_closed_behind_http_middleware(self):
        started = asyncio.Event()
        closed = asyncio.Event()
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
            app(_request_scope(), receive, _discard_send),
            timeout=1,
        )

        self.assertTrue(closed.is_set(), 'A quiet body was not closed through HTTP middleware.')


if __name__ == '__main__':
    unittest.main()
