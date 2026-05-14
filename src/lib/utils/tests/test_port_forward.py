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
import socket
from typing import Any, cast
import unittest
from unittest import mock

from src.lib.utils import osmo_errors, port_forward


class _FakeCookie:
    """Minimal cookie object compatible with _cookie_to_header_string."""

    def __init__(self, name, value, path='/', secure=False, same_site=''):
        self.name = name
        self.value = value
        self.path = path
        self.secure = secure
        self._rest = {'SameSite': same_site} if same_site else {}


class _FakeWebsocket:
    def __init__(self):
        self.closed = False

    async def wait_closed(self):
        await asyncio.Event().wait()

    async def close(self):
        self.closed = True


class _FakeServiceClient:
    def __init__(self, websocket: _FakeWebsocket):
        self.websocket = websocket

    async def create_websocket(self, *_args, **_kwargs):
        return self.websocket


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


if __name__ == '__main__':
    unittest.main()
