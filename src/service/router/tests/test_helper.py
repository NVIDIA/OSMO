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
import typing
import unittest

import fastapi
from starlette.datastructures import Headers

from src.service.router import helper


class _FakeWebSocket:
    """Minimal websocket stand-in that replays a fixed list of byte frames."""

    def __init__(self, frames):
        self.frames = list(frames)

    async def receive_bytes(self) -> bytes:
        if not self.frames:
            raise fastapi.WebSocketDisconnect(code=1000)
        return self.frames.pop(0)


def _fake_websocket(frames) -> fastapi.WebSocket:
    """Return a frame-replaying stand-in typed as a WebSocket for the helpers."""
    return typing.cast(fastapi.WebSocket, _FakeWebSocket(frames))


async def _noop_receive() -> typing.MutableMapping[str, typing.Any]:
    return {'type': 'websocket.connect'}


async def _noop_send(message: typing.MutableMapping[str, typing.Any]) -> None:
    del message


async def _collect(async_generator) -> list:
    """Drain an async generator into a list (loop kept out of test bodies)."""
    collected = []
    async for item in async_generator:
        collected.append(item)
    return collected


def _make_http_request(method: str, path: str, query: bytes, header_pairs) -> fastapi.Request:
    return fastapi.Request({
        'type': 'http',
        'http_version': '1.1',
        'scheme': 'http',
        'method': method,
        'server': ('router.osmo.local', 80),
        'root_path': '',
        'path': path,
        'raw_path': path.encode(),
        'query_string': query,
        'headers': header_pairs,
    })


class TestResolveSessionKey(unittest.TestCase):
    """Covers resolve_session_key_decorator (lines 39, 50-60, 62)."""

    def test_resolve_session_key_host_subdomain_returns_prefix(self):
        resolve = helper.resolve_session_key_decorator('router.osmo.local')

        session_key = resolve(Headers({'host': 'abc123.router.osmo.local'}))

        self.assertEqual(session_key, 'abc123')

    def test_resolve_session_key_host_equals_service_host_returns_none(self):
        resolve = helper.resolve_session_key_decorator('router.osmo.local')

        session_key = resolve(Headers({'host': 'router.osmo.local'}))

        self.assertIsNone(session_key)

    def test_resolve_session_key_forwarded_host_overrides_host(self):
        resolve = helper.resolve_session_key_decorator('router.osmo.local')

        session_key = resolve(Headers({
            'host': 'router.osmo.local',
            'x-forwarded-host': 'session-9.router.osmo.local',
        }))

        self.assertEqual(session_key, 'session-9')

    def test_resolve_session_key_strips_port_before_matching(self):
        resolve = helper.resolve_session_key_decorator('router.osmo.local')

        session_key = resolve(Headers({'host': 'abc123.router.osmo.local:8443'}))

        self.assertEqual(session_key, 'abc123')

    def test_resolve_session_key_suffix_without_dot_boundary_returns_none(self):
        resolve = helper.resolve_session_key_decorator('osmo.local')

        session_key = resolve(Headers({'host': 'evilosmo.local'}))

        self.assertIsNone(session_key)

    def test_resolve_session_key_missing_host_header_returns_none(self):
        resolve = helper.resolve_session_key_decorator('router.osmo.local')

        session_key = resolve(Headers({}))

        self.assertIsNone(session_key)


class TestHttp2Raw(unittest.IsolatedAsyncioTestCase):
    """Covers http2raw (lines 67-68, 73-74, 76)."""

    async def test_http2raw_http_request_includes_method_query_and_headers(self):
        request = _make_http_request(
            'POST', '/api/exec', b'task=t1', [(b'host', b'router'), (b'x-token', b'abc')])

        raw = await helper.http2raw(request)

        self.assertEqual(
            raw,
            b'POST /api/exec?task=t1 HTTP/1.1\r\nhost: router\r\nx-token: abc\r\n\r\n')

    async def test_http2raw_request_without_query_omits_question_mark(self):
        request = _make_http_request('GET', '/healthz', b'', [(b'host', b'router')])

        raw = await helper.http2raw(request)

        self.assertEqual(raw, b'GET /healthz HTTP/1.1\r\nhost: router\r\n\r\n')

    async def test_http2raw_websocket_uses_get_method(self):
        websocket = fastapi.WebSocket(
            {
                'type': 'websocket',
                'scheme': 'ws',
                'server': ('router.osmo.local', 80),
                'root_path': '',
                'path': '/ws/exec',
                'raw_path': b'/ws/exec',
                'query_string': b'',
                'headers': [(b'host', b'router')],
            },
            receive=_noop_receive,
            send=_noop_send)

        raw = await helper.http2raw(websocket)

        self.assertEqual(raw, b'GET /ws/exec HTTP/1.1\r\nhost: router\r\n\r\n')


class TestSplitHeadersBody(unittest.TestCase):
    """Covers split_headers_body (lines 81-82, 85-87, 90-94, 96)."""

    def test_split_headers_body_parses_status_headers_and_body(self):
        response_bytes = (b'HTTP/1.1 200 OK\r\n'
                          b'Content-Type: text/plain\r\n'
                          b'Content-Length: 5\r\n'
                          b'\r\n'
                          b'hello')

        status_code, headers, body = helper.split_headers_body(response_bytes)

        self.assertEqual(status_code, 200)
        self.assertEqual(headers,
                         {'content-type': 'text/plain', 'content-length': '5'})
        self.assertEqual(body, b'hello')

    def test_split_headers_body_error_status_with_empty_body(self):
        response_bytes = b'HTTP/1.1 404 Not Found\r\nTransfer-Encoding: chunked\r\n\r\n'

        status_code, headers, body = helper.split_headers_body(response_bytes)

        self.assertEqual(status_code, 404)
        self.assertEqual(headers, {'transfer-encoding': 'chunked'})
        self.assertEqual(body, b'')


class TestStreamContent(unittest.IsolatedAsyncioTestCase):
    """Covers stream_content (lines 101-110, 112-113)."""

    async def test_stream_content_yields_initial_body_and_remaining_frames(self):
        websocket = _fake_websocket([b'def', b'ghi'])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_content(websocket, close, b'abc', 9))

        self.assertEqual(chunks, [b'abc', b'def', b'ghi'])
        self.assertTrue(close.is_set())

    async def test_stream_content_empty_initial_body_is_not_yielded(self):
        websocket = _fake_websocket([b'payload'])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_content(websocket, close, b'', 7))

        self.assertEqual(chunks, [b'payload'])

    async def test_stream_content_disconnect_before_length_sets_close(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_content(websocket, close, b'abc', 100))

        self.assertEqual(chunks, [b'abc'])
        self.assertTrue(close.is_set())


class TestStreamChunked(unittest.IsolatedAsyncioTestCase):
    """Covers stream_chunked (lines 121-122, 124, 126, 128-129, 131, 134-140,
    142-145, 148-150, 152, 154, 157-159, 162, 165-167, 170-175)."""

    async def test_stream_chunked_single_chunk_then_end_marker(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()
        initial_body = b'5\r\nhello\r\n0\r\n\r\n'

        chunks = await _collect(
            helper.stream_chunked(websocket, close, initial_body))

        self.assertEqual(chunks, [b'hello'])
        self.assertTrue(close.is_set())

    async def test_stream_chunked_multiple_chunks_in_initial_body(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()
        initial_body = b'3\r\nabc\r\n3\r\ndef\r\n0\r\n\r\n'

        chunks = await _collect(
            helper.stream_chunked(websocket, close, initial_body))

        self.assertEqual(chunks, [b'abc', b'def'])

    async def test_stream_chunked_chunk_body_split_across_frames(self):
        websocket = _fake_websocket([b'llo\r\n', b'0\r\n\r\n'])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_chunked(websocket, close, b'5\r\nhe'))

        self.assertEqual(chunks, [b'hello'])
        self.assertTrue(close.is_set())

    async def test_stream_chunked_incomplete_size_line_waits_for_more_data(self):
        websocket = _fake_websocket([b'\r\nhello\r\n0\r\n\r\n'])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_chunked(websocket, close, b'5'))

        self.assertEqual(chunks, [b'hello'])

    async def test_stream_chunked_hex_size_larger_than_sixteen_is_parsed(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()
        initial_body = b'10\r\n' + b'x' * 16 + b'\r\n0\r\n\r\n'

        chunks = await _collect(
            helper.stream_chunked(websocket, close, initial_body))

        self.assertEqual(chunks, [b'x' * 16])

    async def test_stream_chunked_invalid_size_stops_and_sets_close(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_chunked(websocket, close, b'zz\r\nhello\r\n'))

        self.assertEqual(chunks, [])
        self.assertTrue(close.is_set())

    async def test_stream_chunked_disconnect_without_end_marker_stops(self):
        websocket = _fake_websocket([])
        close = asyncio.Event()

        chunks = await _collect(
            helper.stream_chunked(websocket, close, b'3\r\nabc\r\n'))

        self.assertEqual(chunks, [b'abc'])
        self.assertFalse(close.is_set())


if __name__ == '__main__':
    unittest.main()
