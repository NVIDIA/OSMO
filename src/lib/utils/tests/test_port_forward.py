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
# pylint: disable=protected-access

import asyncio
import json
import socket
import time
from typing import Any, cast
import unittest
from unittest import mock

import websockets.exceptions

from src.lib.utils import osmo_errors, port_forward


def _free_udp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.bind(('127.0.0.1', 0))
        return probe.getsockname()[1]


async def _send_datagrams_until_forwarded(port: int, payload: bytes, websocket) -> int:
    """Repeatedly sends payload to port until the websocket attempts a send."""
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
        sender.bind(('127.0.0.1', 0))
        source_port = sender.getsockname()[1]
        deadline = time.monotonic() + 5.0
        while not websocket.send_attempted.is_set() and time.monotonic() < deadline:
            sender.sendto(payload, ('127.0.0.1', port))
            await asyncio.sleep(0.02)
        return source_port


class _FakeCookie:
    """Minimal cookie object compatible with _cookie_to_header_string."""

    def __init__(self, name, value, path='/', secure=False, same_site=''):
        self.name = name
        self.value = value
        self.path = path
        self.secure = secure
        self._rest = {'SameSite': same_site} if same_site else {}


class _FakeWebsocket:
    """Control websocket double with configurable send and close failures."""

    def __init__(self, send_error=None, close_error=None):
        self.closed = False
        self.close_attempted = False
        self.send_attempts = 0
        self.sent: list = []
        self._send_error = send_error
        self._close_error = close_error

    async def wait_closed(self):
        await asyncio.Event().wait()

    async def send(self, data):
        self.send_attempts += 1
        if self._send_error:
            raise self._send_error
        self.sent.append(data)

    async def close(self):
        self.close_attempted = True
        if self._close_error:
            raise self._close_error
        self.closed = True


class _FakeServiceClient:
    def __init__(self, websocket: _FakeWebsocket):
        self.websocket = websocket

    async def create_websocket(self, *_args, **_kwargs):
        return self.websocket


class _SequenceServiceClient:
    """Service client that hands out one queued websocket per create_websocket call."""

    def __init__(self, websockets_to_return, error=None):
        self._websockets = list(websockets_to_return)
        self._error = error
        self.calls: list = []

    async def create_websocket(self, address, path, headers=None, **kwargs):
        _ = kwargs
        self.calls.append({'address': address, 'path': path, 'headers': headers})
        if self._websockets:
            return self._websockets.pop(0)
        raise self._error


class _FailingServiceClient:
    def __init__(self, error):
        self._error = error

    async def create_websocket(self, *_args, **_kwargs):
        raise self._error


class _DataWebsocket:
    """Data-plane websocket that immediately reports EOF to write_data."""

    def __init__(self):
        self.closed = False
        self.close_event = asyncio.Event()

    async def recv(self):
        return b''

    async def send(self, data):
        _ = data

    async def close(self):
        self.closed = True
        self.close_event.set()


class _CloseFailingServer:
    """asyncio server double whose close() fails the way a reused socket does."""

    def close(self):
        raise ValueError('server socket already closed')

    async def wait_closed(self):
        pass


class _ChunkReader:
    """StreamReader double that yields queued chunks and then EOF."""

    def __init__(self, chunks):
        self._chunks = list(chunks)
        self.read_sizes: list = []

    async def read(self, size):
        self.read_sizes.append(size)
        if self._chunks:
            return self._chunks.pop(0)
        return b''


class _RecordingWriter:
    """StreamWriter double recording writes, drains and closes."""

    def __init__(self):
        self.written: list = []
        self.drain_count = 0
        self.closed = False

    def write(self, data):
        self.written.append(data)

    async def drain(self):
        self.drain_count += 1

    def close(self):
        self.closed = True

    async def wait_closed(self):
        pass


class _FakeServer:
    """asyncio server double for tests that drive the connection handler directly."""

    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True

    async def wait_closed(self):
        pass


class _ForwardHarness:
    """Runs run_tcp_with_sock against a stubbed server and exposes its handler."""

    def __init__(self, service_client):
        self._service_client = service_client
        self.close_event = asyncio.Event()
        self.server = _FakeServer()
        self.handler: Any = None
        self.task: Any = None
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._patcher: Any = None

    async def start(self):
        async def capture_handler(handler, **kwargs):
            _ = kwargs
            self.handler = handler
            return self.server

        self._patcher = mock.patch.object(port_forward.asyncio, 'start_server',
                                         new=mock.AsyncMock(side_effect=capture_handler))
        self._patcher.start()
        self._sock.bind(('127.0.0.1', 0))
        ready_event = asyncio.Event()
        self.task = asyncio.create_task(port_forward.run_tcp_with_sock(
            cast(Any, self._service_client),
            self._sock,
            'test port forward',
            'api/router/portforward',
            1,
            'ws://router',
            'ctrl-key',
            'ctrl=cookie',
            ready_event=ready_event,
            close_event=self.close_event,
        ))
        await ready_event.wait()

    async def handle_connection(self, writer):
        await self.handler(cast(Any, _ChunkReader([])), cast(Any, writer))

    async def stop(self):
        self.close_event.set()
        await self.task
        self._patcher.stop()
        self._sock.close()


class _RecvWebsocket:
    """Websocket double that yields queued frames, then raises or reports EOF."""

    def __init__(self, frames, recv_error=None):
        self._frames = list(frames)
        self._recv_error = recv_error

    async def recv(self):
        if self._frames:
            return self._frames.pop(0)
        if self._recv_error:
            raise self._recv_error
        return b''


class _RateLimiter:
    """TokenBucket double recording the token amounts requested."""

    def __init__(self):
        self.token_requests: list = []

    async def wait_for_tokens(self, tokens):
        self.token_requests.append(tokens)


class _RecvThenClosedWebsocket:
    """UDP control websocket that yields frames, then reports the connection closed."""

    def __init__(self, frames):
        self._frames = list(frames)
        self.sent: list = []
        self.closed = False

    async def recv(self):
        if self._frames:
            return self._frames.pop(0)
        raise websockets.exceptions.ConnectionClosedError(None, None)

    async def send(self, data):
        self.sent.append(data)

    async def close(self):
        self.closed = True


class _BlockingRecvWebsocket:
    """UDP control websocket whose recv unblocks once a datagram is forwarded."""

    def __init__(self, send_error=None):
        self.sent: list = []
        self.closed = False
        self.send_attempted = asyncio.Event()
        self._send_error = send_error

    async def recv(self):
        await self.send_attempted.wait()
        raise websockets.exceptions.ConnectionClosedError(None, None)

    async def send(self, data):
        self.send_attempted.set()
        if self._send_error:
            raise self._send_error
        self.sent.append(data)

    async def close(self):
        self.closed = True


class _SocketClosingEvent:
    """Fake close event that closes the socket when awaited."""

    def __init__(self, sock: socket.socket):
        self._sock = sock

    async def wait(self):
        self._sock.close()


class TestRunTcpWithSock(unittest.TestCase):
    """Tests for run_tcp_with_sock shutdown error handling."""

    def test_suppresses_server_shutdown_after_external_socket_close(self):
        async def run_test():
            ctrl_ws = _FakeWebsocket()
            service_client = _FakeServiceClient(ctrl_ws)
            ready_event = asyncio.Event()

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', 0))
                await port_forward.run_tcp_with_sock(
                    cast(Any, service_client),
                    sock,
                    'test port forward',
                    'api/router/test',
                    1,
                    'ws://router',
                    'key',
                    'cookie=value',
                    ready_event=ready_event,
                    close_event=cast(Any, _SocketClosingEvent(sock)),
                )

            self.assertTrue(ready_event.is_set())
            self.assertTrue(ctrl_ws.closed)

        asyncio.run(run_test())

    def test_reraises_value_error_when_socket_is_open(self):
        async def raise_value_error(coroutines):
            for coroutine in coroutines:
                coroutine.close()
            raise ValueError('unexpected value error')

        async def run_test():
            ctrl_ws = _FakeWebsocket()
            service_client = _FakeServiceClient(ctrl_ws)

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', 0))
                with mock.patch.object(
                    port_forward.common,
                    'first_completed',
                    side_effect=raise_value_error,
                ):
                    with self.assertRaisesRegex(ValueError, 'unexpected value error'):
                        await port_forward.run_tcp_with_sock(
                            cast(Any, service_client),
                            sock,
                            'test port forward',
                            'api/router/test',
                            1,
                            'ws://router',
                            'key',
                            'cookie=value',
                        )

        asyncio.run(run_test())


class TestEncodeDecodeAddr(unittest.TestCase):
    """Tests for _encode_addr / _decode_addr binary IP+port framing."""

    def test_round_trip_preserves_payload_ip_and_port(self):
        encoded = port_forward._encode_addr(b'hello', ('192.168.1.42', 5555))

        payload, ip, port = port_forward._decode_addr(encoded)

        self.assertEqual(payload, b'hello')
        self.assertEqual(ip, '192.168.1.42')
        self.assertEqual(port, 5555)

    def test_round_trip_with_empty_payload(self):
        encoded = port_forward._encode_addr(b'', ('10.0.0.1', 80))

        payload, ip, port = port_forward._decode_addr(encoded)

        self.assertEqual(payload, b'')
        self.assertEqual(ip, '10.0.0.1')
        self.assertEqual(port, 80)

    def test_round_trip_with_max_port(self):
        encoded = port_forward._encode_addr(b'data', ('255.255.255.255', 65535))

        payload, ip, port = port_forward._decode_addr(encoded)

        self.assertEqual(payload, b'data')
        self.assertEqual(ip, '255.255.255.255')
        self.assertEqual(port, 65535)

    def test_round_trip_with_zero_port(self):
        encoded = port_forward._encode_addr(b'\x00\x01\x02', ('0.0.0.0', 0))

        payload, ip, port = port_forward._decode_addr(encoded)

        self.assertEqual(payload, b'\x00\x01\x02')
        self.assertEqual(ip, '0.0.0.0')
        self.assertEqual(port, 0)

    def test_encoded_header_is_six_bytes(self):
        encoded = port_forward._encode_addr(b'payload', ('1.2.3.4', 1024))

        self.assertEqual(len(encoded), 6 + len(b'payload'))

    def test_encode_invalid_ip_raises(self):
        with self.assertRaises(OSError):
            port_forward._encode_addr(b'data', ('not-an-ip', 1234))


class TestExponentialBackoffDelay(unittest.TestCase):
    """Tests for get_exponential_backoff_delay bounded math."""

    def test_retry_zero_returns_one_when_random_is_zero(self):
        with mock.patch.object(port_forward.random, 'random', return_value=0.0):
            delay = port_forward.get_exponential_backoff_delay(0)

        self.assertEqual(delay, 1.0)

    def test_retry_three_returns_eight_plus_random(self):
        with mock.patch.object(port_forward.random, 'random', return_value=0.0):
            delay = port_forward.get_exponential_backoff_delay(3)

        self.assertEqual(delay, 8.0)

    def test_retry_five_caps_exponent_at_thirty_two(self):
        with mock.patch.object(port_forward.random, 'random', return_value=0.0):
            delay = port_forward.get_exponential_backoff_delay(5)

        self.assertEqual(delay, 32.0)

    def test_retry_above_five_remains_capped_at_thirty_two(self):
        with mock.patch.object(port_forward.random, 'random', return_value=0.0):
            delay = port_forward.get_exponential_backoff_delay(100)

        self.assertEqual(delay, 32.0)

    def test_random_jitter_adds_up_to_five(self):
        with mock.patch.object(port_forward.random, 'random', return_value=0.999):
            delay = port_forward.get_exponential_backoff_delay(0)

        self.assertAlmostEqual(delay, 1.0 + 0.999 * 5)

    def test_max_delay_with_full_jitter(self):
        with mock.patch.object(port_forward.random, 'random', return_value=1.0):
            delay = port_forward.get_exponential_backoff_delay(10)

        self.assertEqual(delay, 32.0 + 5.0)


class TestCookieToHeaderString(unittest.TestCase):
    """Tests for _cookie_to_header_string formatting."""

    def test_minimal_cookie_includes_name_value_and_path(self):
        cookie = _FakeCookie(name='session', value='abc', path='/')

        result = port_forward._cookie_to_header_string(cookie)

        self.assertEqual(result, 'session=abc; Path=/')

    def test_cookie_with_secure_flag_appends_secure(self):
        cookie = _FakeCookie(name='session', value='abc', path='/', secure=True)

        result = port_forward._cookie_to_header_string(cookie)

        self.assertEqual(result, 'session=abc; Path=/; Secure')

    def test_cookie_with_same_site_appends_same_site(self):
        cookie = _FakeCookie(name='session', value='abc', path='/api', same_site='Strict')

        result = port_forward._cookie_to_header_string(cookie)

        self.assertEqual(result, 'session=abc; Path=/api; SameSite=Strict')

    def test_cookie_with_all_attributes(self):
        cookie = _FakeCookie(
            name='auth',
            value='token123',
            path='/api',
            secure=True,
            same_site='Lax',
        )

        result = port_forward._cookie_to_header_string(cookie)

        self.assertEqual(result, 'auth=token123; Path=/api; SameSite=Lax; Secure')

    def test_empty_same_site_is_omitted(self):
        cookie = _FakeCookie(name='id', value='1', path='/', same_site='')

        result = port_forward._cookie_to_header_string(cookie)

        self.assertNotIn('SameSite', result)


class TestGetSessionCookie(unittest.TestCase):
    """Tests for _get_session_cookie scheme handling."""

    def test_invalid_scheme_raises_osmo_server_error(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            port_forward._get_session_cookie('http://router.example', timeout=1)

    def test_empty_scheme_raises_osmo_server_error(self):
        with self.assertRaises(osmo_errors.OSMOServerError):
            port_forward._get_session_cookie('router.example', timeout=1)

    def test_wss_scheme_is_converted_to_https(self):
        fake_response = mock.Mock()
        fake_response.cookies = []

        with mock.patch.object(port_forward.requests, 'get',
                               return_value=fake_response) as mock_get:
            port_forward._get_session_cookie('wss://router.example', timeout=5)

        mock_get.assert_called_once_with(
            'https://router.example/api/router/version', timeout=5)

    def test_ws_scheme_is_converted_to_http(self):
        fake_response = mock.Mock()
        fake_response.cookies = []

        with mock.patch.object(port_forward.requests, 'get',
                               return_value=fake_response) as mock_get:
            port_forward._get_session_cookie('ws://router.example', timeout=5)

        mock_get.assert_called_once_with(
            'http://router.example/api/router/version', timeout=5)

    def test_session_cookie_serializes_each_response_cookie(self):
        fake_response = mock.Mock()
        fake_response.cookies = [
            _FakeCookie(name='a', value='1', path='/'),
            _FakeCookie(name='b', value='2', path='/api', secure=True),
        ]

        with mock.patch.object(port_forward.requests, 'get', return_value=fake_response):
            result = port_forward._get_session_cookie('wss://router.example', timeout=5)

        self.assertEqual(result, 'a=1; Path=/, b=2; Path=/api; Secure')


class TestReadData(unittest.TestCase):
    """Tests for read_data forwarding from a stream reader to a websocket."""

    def test_forwards_every_chunk_until_reader_reports_eof(self):
        reader = _ChunkReader([b'first', b'second'])
        data_socket = _FakeWebsocket()

        result = asyncio.run(port_forward.read_data(cast(Any, reader), cast(Any, data_socket)))

        self.assertEqual(data_socket.sent, [b'first', b'second'])
        self.assertIsInstance(result, EOFError)

    def test_uses_requested_buffer_size_for_reads(self):
        reader = _ChunkReader([])
        data_socket = _FakeWebsocket()

        asyncio.run(port_forward.read_data(cast(Any, reader), cast(Any, data_socket),
                                           buffer_size=16))

        self.assertEqual(reader.read_sizes, [16])

    def test_requests_tokens_for_each_chunk_when_rate_limited(self):
        reader = _ChunkReader([b'a', b'bcd'])
        rate_limiter = _RateLimiter()

        asyncio.run(port_forward.read_data(cast(Any, reader), cast(Any, _FakeWebsocket()),
                                           cast(Any, rate_limiter)))

        self.assertEqual(rate_limiter.token_requests, [1, 3])

    def test_returns_connection_closed_error_raised_by_websocket_send(self):
        closed_error = websockets.exceptions.ConnectionClosedError(None, None)
        data_socket = _FakeWebsocket(send_error=closed_error)

        result = asyncio.run(port_forward.read_data(cast(Any, _ChunkReader([b'payload'])),
                                                    cast(Any, data_socket)))

        self.assertIs(result, closed_error)


class TestWriteData(unittest.TestCase):
    """Tests for write_data forwarding from a websocket to a stream writer."""

    def test_writes_and_drains_every_frame_until_empty_frame(self):
        writer = _RecordingWriter()
        data_socket = _RecvWebsocket([b'one', b'two'])

        result = asyncio.run(port_forward.write_data(cast(Any, writer), cast(Any, data_socket)))

        self.assertEqual(writer.written, [b'one', b'two'])
        self.assertEqual(writer.drain_count, 2)
        self.assertIsNone(result)

    def test_swallows_connection_closed_ok(self):
        writer = _RecordingWriter()
        data_socket = _RecvWebsocket(
            [], recv_error=websockets.exceptions.ConnectionClosedOK(None, None))

        result = asyncio.run(port_forward.write_data(cast(Any, writer), cast(Any, data_socket)))

        self.assertEqual(writer.written, [])
        self.assertIsNone(result)

    def test_returns_connection_closed_error(self):
        closed_error = websockets.exceptions.ConnectionClosedError(None, None)
        data_socket = _RecvWebsocket([], recv_error=closed_error)

        result = asyncio.run(port_forward.write_data(cast(Any, _RecordingWriter()),
                                                     cast(Any, data_socket)))

        self.assertIs(result, closed_error)


class TestRunTcp(unittest.TestCase):
    """Tests for run_tcp socket setup."""

    def test_binds_requested_host_and_port_before_delegating(self):
        bound_address = {}

        async def capture_socket(*args, **kwargs):
            _ = kwargs
            bound_address['value'] = args[1].getsockname()

        with mock.patch.object(port_forward, 'run_tcp_with_sock',
                               new=mock.AsyncMock(side_effect=capture_socket)):
            asyncio.run(port_forward.run_tcp(
                cast(Any, None), '127.0.0.1', 0, 'test message', 'api/router/portforward',
                1, 'ws://router', 'ctrl-key', 'ctrl=cookie'))

        self.assertEqual(bound_address['value'][0], '127.0.0.1')
        self.assertNotEqual(bound_address['value'][1], 0)


class TestRunTcpConnectionHandling(unittest.TestCase):
    """Tests for the per-connection handler inside run_tcp_with_sock.

    asyncio.start_server is stubbed so the handler it registers can be invoked
    directly with stream doubles; a real accepted connection would keep
    Server.wait_closed() from ever completing on the handler error paths.
    """

    def test_client_connection_opens_data_websocket_with_fresh_key_and_cookie(self):
        async def run_test():
            ctrl_websocket = _FakeWebsocket()
            data_websocket = _DataWebsocket()
            service_client = _SequenceServiceClient([ctrl_websocket, data_websocket])
            writer = _RecordingWriter()

            harness = _ForwardHarness(service_client)
            await harness.start()
            await harness.handle_connection(writer)
            await harness.stop()

            control_payload = json.loads(ctrl_websocket.sent[0].decode())
            connection_key = control_payload['key']
            self.assertTrue(connection_key.startswith('PORTFORWARD-'))
            self.assertEqual(control_payload['cookie'], 'sticky=abc')
            self.assertEqual(service_client.calls[1]['path'],
                             f'api/router/portforward/{connection_key}')
            self.assertEqual(service_client.calls[1]['headers'], {'Cookie': 'sticky=abc'})
            self.assertTrue(data_websocket.closed)
            self.assertTrue(writer.closed)

        with mock.patch.object(port_forward, '_get_session_cookie', return_value='sticky=abc'):
            asyncio.run(run_test())

    def test_control_websocket_failure_stops_forwarding_without_data_websocket(self):
        async def run_test():
            ctrl_websocket = _FakeWebsocket(
                send_error=websockets.exceptions.ConnectionClosedError(None, None))
            service_client = _SequenceServiceClient([ctrl_websocket])

            harness = _ForwardHarness(service_client)
            await harness.start()
            await harness.handle_connection(_RecordingWriter())

            self.assertTrue(harness.close_event.is_set())

            await harness.stop()

            self.assertEqual(len(service_client.calls), 1)
            self.assertTrue(ctrl_websocket.closed)

        with mock.patch.object(port_forward, '_get_session_cookie', return_value='sticky=abc'):
            asyncio.run(run_test())

    def test_refused_data_websocket_leaves_forwarding_running(self):
        async def run_test():
            ctrl_websocket = _FakeWebsocket()
            service_client = _SequenceServiceClient([ctrl_websocket],
                                                    error=ConnectionRefusedError())

            harness = _ForwardHarness(service_client)
            await harness.start()
            await harness.handle_connection(_RecordingWriter())

            self.assertFalse(harness.task.done())
            self.assertFalse(harness.close_event.is_set())
            self.assertTrue(service_client.calls[1]['path'].startswith(
                'api/router/portforward/PORTFORWARD-'))

            await harness.stop()

            self.assertTrue(ctrl_websocket.closed)

        with mock.patch.object(port_forward, '_get_session_cookie', return_value='sticky=abc'):
            asyncio.run(run_test())


class TestRunTcpShutdown(unittest.TestCase):
    """Tests for run_tcp_with_sock shutdown and error handling."""

    def test_reraises_server_close_value_error_when_socket_is_still_open(self):
        async def run_test():
            ctrl_websocket = _FakeWebsocket()
            close_event = asyncio.Event()
            close_event.set()

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', 0))
                with mock.patch.object(
                    port_forward.asyncio,
                    'start_server',
                    new=mock.AsyncMock(return_value=_CloseFailingServer()),
                ):
                    with self.assertRaisesRegex(ValueError, 'server socket already closed'):
                        await port_forward.run_tcp_with_sock(
                            cast(Any, _FakeServiceClient(ctrl_websocket)),
                            sock,
                            'test port forward',
                            'api/router/portforward',
                            1,
                            'ws://router',
                            'ctrl-key',
                            'ctrl=cookie',
                            close_event=close_event,
                        )

            self.assertTrue(ctrl_websocket.closed)

        asyncio.run(run_test())

    def test_refused_control_websocket_returns_without_raising(self):
        async def run_test():
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', 0))
                result = await port_forward.run_tcp_with_sock(
                    cast(Any, _FailingServiceClient(ConnectionRefusedError('refused'))),
                    sock,
                    'test port forward',
                    'api/router/portforward',
                    1,
                    'ws://router',
                    'ctrl-key',
                    'ctrl=cookie',
                )

            self.assertIsNone(result)

        asyncio.run(run_test())

    def test_control_websocket_close_failure_is_suppressed(self):
        async def run_test():
            ctrl_websocket = _FakeWebsocket(close_error=RuntimeError('already closed'))
            close_event = asyncio.Event()
            close_event.set()

            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                sock.bind(('127.0.0.1', 0))
                result = await port_forward.run_tcp_with_sock(
                    cast(Any, _FakeServiceClient(ctrl_websocket)),
                    sock,
                    'test port forward',
                    'api/router/portforward',
                    1,
                    'ws://router',
                    'ctrl-key',
                    'ctrl=cookie',
                    close_event=close_event,
                )

            self.assertIsNone(result)
            self.assertTrue(ctrl_websocket.close_attempted)
            self.assertFalse(ctrl_websocket.closed)

        asyncio.run(run_test())


class TestRunUdp(unittest.TestCase):
    """Tests for run_udp datagram framing and shutdown."""

    def test_router_datagram_is_decoded_and_delivered_to_the_local_address(self):
        async def run_test():
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as destination:
                destination.bind(('127.0.0.1', 0))
                destination.settimeout(5)
                destination_port = destination.getsockname()[1]
                frame = port_forward._encode_addr(b'pong', ('127.0.0.1', destination_port))
                ctrl_websocket = _RecvThenClosedWebsocket([frame])

                await port_forward.run_udp(
                    cast(Any, _FakeServiceClient(cast(Any, ctrl_websocket))),
                    '127.0.0.1', 0, 'test udp forward', 'api/router/udp', 1,
                    'ws://router', 'ctrl-key', 'ctrl=cookie')

                payload, _ = destination.recvfrom(1024)

            self.assertEqual(payload, b'pong')
            self.assertTrue(ctrl_websocket.closed)

        asyncio.run(run_test())

    def test_local_datagram_is_framed_with_source_address_and_sent_to_router(self):
        async def run_test():
            app_port = _free_udp_port()
            ctrl_websocket = _BlockingRecvWebsocket()
            forward = asyncio.create_task(port_forward.run_udp(
                cast(Any, _FakeServiceClient(cast(Any, ctrl_websocket))),
                '127.0.0.1', app_port, 'test udp forward', 'api/router/udp', 1,
                'ws://router', 'ctrl-key', 'ctrl=cookie'))
            source_port = await _send_datagrams_until_forwarded(app_port, b'hello',
                                                                ctrl_websocket)
            await forward

            payload, ip, port = port_forward._decode_addr(ctrl_websocket.sent[0])
            self.assertEqual(payload, b'hello')
            self.assertEqual(ip, '127.0.0.1')
            self.assertEqual(port, source_port)

        asyncio.run(run_test())

    def test_closed_router_connection_during_send_shuts_down_cleanly(self):
        async def run_test():
            app_port = _free_udp_port()
            ctrl_websocket = _BlockingRecvWebsocket(
                send_error=websockets.exceptions.ConnectionClosedError(None, None))
            forward = asyncio.create_task(port_forward.run_udp(
                cast(Any, _FakeServiceClient(cast(Any, ctrl_websocket))),
                '127.0.0.1', app_port, 'test udp forward', 'api/router/udp', 1,
                'ws://router', 'ctrl-key', 'ctrl=cookie'))
            await _send_datagrams_until_forwarded(app_port, b'hello', ctrl_websocket)
            await forward

            self.assertEqual(ctrl_websocket.sent, [])
            self.assertTrue(ctrl_websocket.closed)

        asyncio.run(run_test())

    def test_localhost_is_bound_as_ipv4_on_macos(self):
        created_endpoints = []
        real_create_datagram_endpoint = asyncio.BaseEventLoop.create_datagram_endpoint

        async def record_local_addr(self, protocol_factory, local_addr=None, **kwargs):
            created_endpoints.append(local_addr)
            return await real_create_datagram_endpoint(
                self, protocol_factory, local_addr=local_addr, **kwargs)

        async def run_test():
            ctrl_websocket = _RecvThenClosedWebsocket([])

            await port_forward.run_udp(
                cast(Any, _FakeServiceClient(cast(Any, ctrl_websocket))),
                'localhost', 0, 'test udp forward', 'api/router/udp', 1,
                'ws://router', 'ctrl-key', 'ctrl=cookie')

            self.assertEqual(created_endpoints, [('127.0.0.1', 0)])
            self.assertTrue(ctrl_websocket.closed)

        with mock.patch.object(port_forward.platform, 'system', return_value='Darwin'):
            with mock.patch.object(asyncio.BaseEventLoop, 'create_datagram_endpoint',
                                   record_local_addr):
                asyncio.run(run_test())

    def test_refused_control_websocket_returns_without_raising(self):
        result = asyncio.run(port_forward.run_udp(
            cast(Any, _FailingServiceClient(ConnectionRefusedError('refused'))),
            '127.0.0.1', 0, 'test udp forward', 'api/router/udp', 1,
            'ws://router', 'ctrl-key', 'ctrl=cookie'))

        self.assertIsNone(result)


if __name__ == '__main__':
    unittest.main()
