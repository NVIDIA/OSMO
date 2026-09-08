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
import datetime
import importlib
import os
import unittest
from unittest import mock

with (
    mock.patch.dict(os.environ, {'OSMO_POSTGRES_PASSWORD': 'test-password'}),
    mock.patch('fastapi.applications.FastAPI.add_middleware'),
):
    router = importlib.import_module('src.service.router.router')


class _FakeRequest:
    cookies = {
        '_osmo_router_affinity': 'sticky-session',
        'ignored': 'cookie',
    }

    async def body(self):
        return b''


class _FakeControlWebSocket:
    def __init__(self):
        self.messages = []

    async def send_json(self, payload):
        self.messages.append(payload)


async def _raise_timeout(awaitable, timeout):
    _ = timeout
    awaitable.close()
    raise asyncio.TimeoutError


class WebserverHttpRequestTestCase(unittest.TestCase):
    """Tests for proxied webserver HTTP requests."""

    def setUp(self):
        router.connections.clear()
        router.webservers.clear()

    def tearDown(self):
        router.connections.clear()
        router.webservers.clear()

    def test_removes_pending_connection_on_backend_timeout(self):
        async def run_test():
            control_websocket = _FakeControlWebSocket()
            router.webservers['session-key'] = router.WebserverConnection.model_construct(
                wait_close=asyncio.Event(),
                last_active_time=datetime.datetime.now(),
                websocket=control_websocket,
            )
            config = mock.Mock(timeout=60, sticky_cookies=['_osmo_router_affinity'])

            with (
                mock.patch.object(router.common, 'generate_unique_id', return_value='timeout'),
                mock.patch.object(
                    router.helper,
                    'http2raw',
                    new=mock.AsyncMock(return_value=b'GET / HTTP/1.1\r\n\r\n'),
                ),
                mock.patch.object(router.RouterServiceConfig, 'load', return_value=config),
                mock.patch.object(router.asyncio, 'wait_for', side_effect=_raise_timeout),
            ):
                response = await router.webserver_http_request(_FakeRequest(), 'session-key')

            conn_key = 'PORTFORWARD-timeout'
            self.assertEqual(response.status_code, 504)
            self.assertNotIn(conn_key, router.connections)
            self.assertEqual(
                control_websocket.messages,
                [{
                    'key': conn_key,
                    'cookie': '_osmo_router_affinity=sticky-session',
                    'type': 'tcp',
                }],
            )

        asyncio.run(run_test())


if __name__ == '__main__':
    unittest.main()
