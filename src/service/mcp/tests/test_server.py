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

import types
import unittest
from unittest import mock

import httpx
from mcp.types import LATEST_PROTOCOL_VERSION

from src.service.mcp import server


class MCPServerTest(unittest.IsolatedAsyncioTestCase):

    async def test_health_endpoints(self) -> None:
        application = server.create_mcp_server().streamable_http_app()
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                live_response = await client.get('/health/live')
                health_response = await client.get('/health')
                ready_response = await client.get('/health/ready')

        self.assertEqual(live_response.status_code, 200)
        self.assertEqual(live_response.json(), {'status': 'ok'})
        self.assertEqual(health_response.status_code, 200)
        self.assertEqual(health_response.json(), {'status': 'ok'})
        self.assertEqual(ready_response.status_code, 200)
        self.assertEqual(ready_response.json(), {'status': 'ok'})

    async def test_initialize_and_empty_tool_catalog(self) -> None:
        mcp_server = server.create_mcp_server()
        self.assertTrue(mcp_server.settings.stateless_http)
        self.assertTrue(mcp_server.settings.json_response)
        self.assertEqual(mcp_server.settings.streamable_http_path, '/mcp')

        application = mcp_server.streamable_http_app()
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
        }
        initialize_request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'initialize',
            'params': {
                'protocolVersion': LATEST_PROTOCOL_VERSION,
                'capabilities': {},
                'clientInfo': {'name': 'osmo-test', 'version': '1.0'},
            },
        }
        list_tools_request = {
            'jsonrpc': '2.0',
            'id': 2,
            'method': 'tools/list',
            'params': {},
        }
        initialized_notification = {
            'jsonrpc': '2.0',
            'method': 'notifications/initialized',
            'params': {},
        }

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                initialize_response = await client.post(
                    '/mcp', headers=headers, json=initialize_request)
                initialized_response = await client.post(
                    '/mcp', headers=headers, json=initialized_notification)
                list_tools_response = await client.post(
                    '/mcp', headers=headers, json=list_tools_request)

        self.assertEqual(initialize_response.status_code, 200)
        self.assertEqual(
            initialize_response.json()['result']['protocolVersion'],
            LATEST_PROTOCOL_VERSION)
        self.assertEqual(
            initialize_response.json()['result']['serverInfo']['name'],
            'OSMO MCP')
        self.assertNotIn('mcp-session-id', initialize_response.headers)
        self.assertEqual(initialized_response.status_code, 202)
        self.assertEqual(list_tools_response.status_code, 200)
        self.assertEqual(list_tools_response.json()['result']['tools'], [])


class MCPMainTest(unittest.TestCase):

    def test_main_starts_uvicorn_with_runtime_config(self) -> None:
        config = types.SimpleNamespace(
            host='127.0.0.1',
            port=9000,
            uvicorn_ssl_kwargs=mock.Mock(
                return_value={'ssl_certfile': '/tmp/mcp-cert.pem'}),
        )
        uvicorn_config = object()
        uvicorn_server = mock.Mock()
        uvicorn_server.serve = mock.AsyncMock()

        with (
            mock.patch.object(
                server.MCPServiceConfig, 'load', return_value=config),
            mock.patch.object(
                server.uvicorn,
                'Config',
                return_value=uvicorn_config,
            ) as config_factory,
            mock.patch.object(
                server.uvicorn,
                'Server',
                return_value=uvicorn_server,
            ) as server_factory,
        ):
            server.main()

        config_factory.assert_called_once_with(
            server.app,
            host='127.0.0.1',
            port=9000,
            log_config=None,
            ssl_certfile='/tmp/mcp-cert.pem',
        )
        server_factory.assert_called_once_with(config=uvicorn_config)
        uvicorn_server.serve.assert_awaited_once_with()
        config.uvicorn_ssl_kwargs.assert_called_once_with()

    def test_main_handles_keyboard_interrupt(self) -> None:
        config = types.SimpleNamespace(
            host='127.0.0.1',
            port=9000,
            uvicorn_ssl_kwargs=mock.Mock(return_value={}),
        )
        uvicorn_server = mock.Mock()
        uvicorn_server.serve = mock.AsyncMock(side_effect=KeyboardInterrupt)

        with (
            mock.patch.object(
                server.MCPServiceConfig, 'load', return_value=config),
            mock.patch.object(server.uvicorn, 'Config', return_value=object()),
            mock.patch.object(
                server.uvicorn,
                'Server',
                return_value=uvicorn_server,
            ),
        ):
            server.main()

        uvicorn_server.serve.assert_awaited_once_with()


if __name__ == '__main__':
    unittest.main()
