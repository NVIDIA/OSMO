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
from typing import Any, cast
import unittest
from unittest import mock

from src.lib.utils import port_forward


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


if __name__ == '__main__':
    unittest.main()
