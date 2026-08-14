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
from collections.abc import AsyncIterator
import contextlib
import io
import json
import os
import sys
import types
import unittest
from unittest import mock

import httpx
from fastmcp.exceptions import ToolError
from mcp.types import LATEST_PROTOCOL_VERSION
import pydantic
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.lib.utils import login
from src.service.mcp import (
    gateway,
    request_body,
    request_context,
    server,
    tool_registry,
)


class MCPServerTest(unittest.IsolatedAsyncioTestCase):

    def test_create_application_direct_mode_uses_header_middleware(self) -> None:
        application = mock.Mock()
        protocol_server = mock.Mock()
        protocol_server.auth = None
        protocol_server.http_app.return_value = application

        self.assertIs(server.create_application(protocol_server), application)
        protocol_server.http_app.assert_called_once_with(
            path='/mcp',
            transport='streamable-http',
            stateless_http=True,
            json_response=True,
        )
        self.assertEqual(application.add_middleware.call_args_list, [
            mock.call(
                request_body.RequestBodyLimitMiddleware,
                path='/mcp',
                max_body_bytes=request_body.MAX_MCP_REQUEST_BODY_BYTES,
                max_concurrent_requests=(
                    request_body.MAX_CONCURRENT_MCP_REQUESTS
                ),
                body_timeout_seconds=(
                    request_body.MCP_REQUEST_BODY_TIMEOUT_SECONDS
                ),
            ),
            mock.call(
                request_context.RequestContextMiddleware,
                path='/mcp',
            ),
        ])

    def test_create_application_oidc_mode_skips_header_middleware(self) -> None:
        application = mock.Mock()
        protocol_server = mock.Mock()
        protocol_server.auth = mock.sentinel.auth_provider
        protocol_server.http_app.return_value = application

        self.assertIs(server.create_application(protocol_server), application)
        self.assertEqual(application.add_middleware.call_args_list, [
            mock.call(
                request_body.RequestBodyLimitMiddleware,
                path='/mcp',
                max_body_bytes=request_body.MAX_MCP_REQUEST_BODY_BYTES,
                max_concurrent_requests=(
                    request_body.MAX_CONCURRENT_MCP_REQUESTS
                ),
                body_timeout_seconds=(
                    request_body.MCP_REQUEST_BODY_TIMEOUT_SECONDS
                ),
            ),
        ])

    @staticmethod
    def _sized_tool_request(size: int) -> bytes:
        def encode_request(padding: str) -> bytes:
            return json.dumps({
                'jsonrpc': '2.0',
                'id': 1,
                'method': 'tools/call',
                'params': {
                    'name': 'accept_request_body',
                    'arguments': {'padding': padding},
                },
            }, separators=(',', ':')).encode('utf-8')

        empty_body = encode_request('')
        padding_size = size - len(empty_body)
        if padding_size < 0:
            raise ValueError('Requested test body is too small.')
        body = encode_request('x' * padding_size)
        if len(body) != size:
            raise AssertionError('Failed to construct the requested body size.')
        return body

    @staticmethod
    def _body_limit_application() -> Starlette:
        mcp_server = server.create_mcp_server()

        @mcp_server.tool()
        async def accept_request_body(padding: str) -> dict[str, int]:
            return {'accepted_bytes': len(padding.encode('utf-8'))}

        return server.create_application(mcp_server)

    @staticmethod
    async def _invoke_asgi(
        application: ASGIApp,
        receive: Receive,
        *,
        method: str = 'POST',
        headers: list[tuple[bytes, bytes]] | None = None,
    ) -> list[Message]:
        scope: Scope = {
            'type': 'http',
            'asgi': {'version': '3.0', 'spec_version': '2.3'},
            'http_version': '1.1',
            'method': method,
            'scheme': 'http',
            'path': '/mcp',
            'raw_path': b'/mcp',
            'query_string': b'',
            'root_path': '',
            'headers': headers or [],
            'server': ('mcp.test', 80),
            'client': ('test-client', 1234),
            'state': {},
        }
        messages: list[Message] = []

        async def send(message: Message) -> None:
            messages.append(message)

        await application(scope, receive, send)
        return messages

    @staticmethod
    def _asgi_status(messages: list[Message]) -> int:
        response_starts = [
            message for message in messages
            if message['type'] == 'http.response.start'
        ]
        if len(response_starts) != 1:
            raise AssertionError(
                f'Expected one response start, got {response_starts!r}.'
            )
        return response_starts[0]['status']

    @staticmethod
    def _asgi_json(messages: list[Message]) -> object:
        body = b''.join(
            message.get('body', b'')
            for message in messages
            if message['type'] == 'http.response.body'
        )
        return json.loads(body)

    async def _post_sized_tool_request(
        self,
        size: int,
        *,
        chunked: bool,
        declared_size: int | None = None,
    ) -> httpx.Response:
        body = self._sized_tool_request(size)
        content: bytes | AsyncIterator[bytes]
        if chunked:
            async def body_chunks() -> AsyncIterator[bytes]:
                chunk_size = 64 * 1024
                for offset in range(0, len(body), chunk_size):
                    yield body[offset:offset + chunk_size]

            content = body_chunks()
        else:
            content = body

        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: 'Bearer body-limit-secret',
            login.OSMO_USER_HEADER: 'body-limit-user',
        }
        if declared_size is not None:
            headers['Content-Length'] = str(declared_size)

        application = self._body_limit_application()
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                return await client.post(
                    '/mcp',
                    headers=headers,
                    content=content,
                )

    async def test_content_length_request_at_limit_is_accepted(self) -> None:
        response = await self._post_sized_tool_request(
            request_body.MAX_MCP_REQUEST_BODY_BYTES,
            chunked=False,
            declared_size=request_body.MAX_MCP_REQUEST_BODY_BYTES,
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['result']['isError'])

    async def test_content_length_request_over_limit_is_rejected(self) -> None:
        response = await self._post_sized_tool_request(
            1024,
            chunked=False,
            declared_size=request_body.MAX_MCP_REQUEST_BODY_BYTES + 1,
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json(), {
            'error': 'MCP request body exceeds the 1 MiB limit.',
        })

    async def test_chunked_request_at_limit_is_accepted(self) -> None:
        response = await self._post_sized_tool_request(
            request_body.MAX_MCP_REQUEST_BODY_BYTES,
            chunked=True,
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()['result']['isError'])

    async def test_chunked_request_over_limit_is_rejected(self) -> None:
        response = await self._post_sized_tool_request(
            request_body.MAX_MCP_REQUEST_BODY_BYTES + 1,
            chunked=True,
        )

        self.assertEqual(response.status_code, 413)
        self.assertEqual(response.json(), {
            'error': 'MCP request body exceeds the 1 MiB limit.',
        })

    async def test_stalled_request_body_is_rejected_after_deadline(self) -> None:
        downstream_called = False

        async def downstream(
            scope: Scope,
            receive: Receive,
            send: Send,
        ) -> None:
            del scope, receive, send
            nonlocal downstream_called
            downstream_called = True

        never_received = asyncio.Event()

        async def receive() -> Message:
            await never_received.wait()
            raise AssertionError('Unreachable receive continuation.')

        application = request_body.RequestBodyLimitMiddleware(
            downstream,
            body_timeout_seconds=0.01,
        )
        messages = await self._invoke_asgi(application, receive)

        self.assertEqual(self._asgi_status(messages), 408)
        self.assertEqual(self._asgi_json(messages), {
            'error': 'MCP request body timed out.',
        })
        self.assertFalse(downstream_called)

    async def test_in_flight_request_limit_rejects_excess_work(self) -> None:
        downstream_entered = asyncio.Event()
        release_downstream = asyncio.Event()

        async def downstream(
            scope: Scope,
            receive: Receive,
            send: Send,
        ) -> None:
            await receive()
            downstream_entered.set()
            await release_downstream.wait()
            await JSONResponse({'status': 'ok'})(scope, receive, send)

        async def receive() -> Message:
            return {
                'type': 'http.request',
                'body': b'{}',
                'more_body': False,
            }

        rejected_body_reads = 0

        async def rejected_receive() -> Message:
            nonlocal rejected_body_reads
            rejected_body_reads += 1
            return await receive()

        application = request_body.RequestBodyLimitMiddleware(
            downstream,
            max_concurrent_requests=1,
        )
        first_request = asyncio.create_task(
            self._invoke_asgi(application, receive)
        )
        await downstream_entered.wait()
        try:
            rejected_messages = await self._invoke_asgi(
                application,
                rejected_receive,
            )
        finally:
            release_downstream.set()
        first_messages = await first_request
        reused_messages = await self._invoke_asgi(application, receive)

        self.assertEqual(self._asgi_status(first_messages), 200)
        self.assertEqual(self._asgi_status(rejected_messages), 503)
        self.assertEqual(self._asgi_status(reused_messages), 200)
        self.assertEqual(rejected_body_reads, 0)
        self.assertEqual(self._asgi_json(rejected_messages), {
            'error': 'MCP service is temporarily at capacity.',
        })
        response_start = next(
            message for message in rejected_messages
            if message['type'] == 'http.response.start'
        )
        self.assertIn((b'retry-after', b'1'), response_start['headers'])

    async def test_invalid_context_is_rejected_before_body_is_read(self) -> None:
        body_reads = 0

        async def receive() -> Message:
            nonlocal body_reads
            body_reads += 1
            return {
                'type': 'http.request',
                'body': b'opaque request body',
                'more_body': False,
            }

        application = server.create_application(server.create_mcp_server())
        messages = await self._invoke_asgi(application, receive)

        self.assertEqual(self._asgi_status(messages), 400)
        self.assertEqual(body_reads, 0)

    async def test_non_post_mcp_requests_do_not_open_streams(self) -> None:
        body_reads = 0

        async def receive() -> Message:
            nonlocal body_reads
            body_reads += 1
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        application = server.create_application(server.create_mcp_server())
        messages = await self._invoke_asgi(
            application,
            receive,
            method='GET',
            headers=[
                (b'authorization', b'Bearer get-request-secret'),
                (b'x-osmo-user', b'get-request-user'),
            ],
        )

        self.assertEqual(self._asgi_status(messages), 405)
        self.assertEqual(self._asgi_json(messages), {
            'error': 'MCP accepts POST requests only.',
        })
        self.assertEqual(body_reads, 0)
        response_start = next(
            message for message in messages
            if message['type'] == 'http.response.start'
        )
        self.assertIn((b'allow', b'POST'), response_start['headers'])

    async def test_health_endpoints(self) -> None:
        application = server.create_application(server.create_mcp_server())
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

    async def test_initialize_and_tool_catalog(self) -> None:
        mcp_server = server.create_mcp_server()
        self.assertFalse(mcp_server.strict_input_validation)
        self.assertIsNone(mcp_server.auth)

        application = server.create_application(mcp_server)
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: 'Bearer test-token-value',
            login.OSMO_USER_HEADER: 'test-user',
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
        self.assertEqual(
            [tool['name'] for tool in list_tools_response.json()['result']['tools']],
            [spec.name for spec in tool_registry.TOOL_SPECS],
        )
        self.assertEqual(
            len(tool_registry.TOOL_SPECS),
            len({spec.name for spec in tool_registry.TOOL_SPECS}),
        )

    async def test_request_context_reaches_fastmcp_tool(self) -> None:
        mcp_server = server.create_mcp_server()

        @mcp_server.tool()
        async def inspect_request_context() -> dict[str, str | bool | None]:
            credentials = request_context.get_request_credentials()
            return {
                'user_name': credentials.user_name,
                'request_id': credentials.request_id,
                'has_bearer': credentials.authorization_header.lower().startswith(
                    'bearer '
                ),
            }

        application = server.create_application(mcp_server)
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: 'Bearer tool-test-secret',
            login.OSMO_USER_HEADER: 'tool-user@example.com',
            'x-request-id': 'tool-request-123',
        }
        request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {
                'name': 'inspect_request_context',
                'arguments': {},
            },
        }

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                response = await client.post('/mcp', headers=headers, json=request)

        self.assertEqual(response.status_code, 200)
        response_text = response.text
        self.assertIn('tool-user@example.com', response_text)
        self.assertIn('tool-request-123', response_text)
        self.assertNotIn('tool-test-secret', response_text)
        self.assertFalse(response.json()['result']['isError'])

    async def test_tool_error_cannot_reflect_request_credentials(self) -> None:
        mcp_server = server.create_mcp_server()

        @mcp_server.tool()
        async def reflect_tool_error() -> None:
            credentials = request_context.get_request_credentials()
            raise ToolError(
                f'unsafe reflected error: {credentials.authorization_header}')

        application = server.create_application(mcp_server)
        bearer_secret = 'tool-error-bearer-secret'
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                response = await client.post(
                    '/mcp',
                    headers={
                        'Accept': 'application/json, text/event-stream',
                        'Content-Type': 'application/json',
                        login.OSMO_AUTH_HEADER: f'Bearer {bearer_secret}',
                        login.OSMO_USER_HEADER: 'tool-user@example.com',
                    },
                    json={
                        'jsonrpc': '2.0',
                        'id': 1,
                        'method': 'tools/call',
                        'params': {
                            'name': 'reflect_tool_error',
                            'arguments': {},
                        },
                    },
                )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('MCP tool failed', response.text)
        self.assertNotIn(bearer_secret, response.text)

    async def test_oversized_final_tool_result_is_rejected(self) -> None:
        mcp_server = server.create_mcp_server()

        @mcp_server.tool()
        async def oversized_result() -> dict[str, str]:
            return {'text': 'x' * (513 * 1024)}

        application = server.create_application(mcp_server)
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=application),
                base_url='http://mcp.test',
            ) as client:
                response = await client.post(
                    '/mcp',
                    headers={
                        'Accept': 'application/json, text/event-stream',
                        'Content-Type': 'application/json',
                        login.OSMO_AUTH_HEADER: 'Bearer result-size-secret',
                        login.OSMO_USER_HEADER: 'tool-user@example.com',
                    },
                    json={
                        'jsonrpc': '2.0',
                        'id': 1,
                        'method': 'tools/call',
                        'params': {
                            'name': 'oversized_result',
                            'arguments': {},
                        },
                    },
                )

        result = response.json()['result']
        self.assertTrue(result['isError'])
        self.assertIn('result exceeds the size limit', response.text)
        self.assertLess(len(response.content), 16 * 1024)
        self.assertNotIn('result-size-secret', response.text)

    def test_runtime_config_requires_https_gateway_origin(self) -> None:
        config = server.MCPServiceConfig(
            gateway_url='https://gateway.test:8443',
        )
        self.assertEqual(str(config.gateway_url), 'https://gateway.test:8443/')
        self.assertEqual(config.log_level.name, 'INFO')
        self.assertEqual(config.log_format.value, 'text')

        invalid_urls = (
            'http://gateway.test',
            'gateway.test',
            'https://user:password@gateway.test',
            'https://gateway.test/api',
            'https://gateway.test?query=value',
            'https://gateway.test#fragment',
        )
        for invalid_url in invalid_urls:
            with self.subTest(url=invalid_url):
                with self.assertRaises(pydantic.ValidationError):
                    server.MCPServiceConfig(gateway_url=invalid_url)

        for invalid_timeout in (0, -1, 61):
            with self.subTest(timeout=invalid_timeout):
                with self.assertRaises(pydantic.ValidationError):
                    server.MCPServiceConfig(
                        gateway_url='https://gateway.test',
                        request_timeout_seconds=invalid_timeout,
                    )

    def test_runtime_config_load_does_not_echo_invalid_url_credentials(self) -> None:
        secret = 'startup-url-password-secret'
        output = io.StringIO()
        try:
            server.MCPServiceConfig._instance = None  # pylint: disable=protected-access
            with (
                mock.patch.object(sys, 'argv', ['mcp']),
                mock.patch.dict(
                    os.environ,
                    {'OSMO_GATEWAY_URL': f'https://user:{secret}@gateway.test'},
                    clear=True,
                ),
                contextlib.redirect_stdout(output),
                self.assertRaises(SystemExit),
            ):
                server.MCPServiceConfig.load()
        finally:
            server.MCPServiceConfig._instance = None  # pylint: disable=protected-access

        self.assertNotIn(secret, output.getvalue())
        self.assertNotIn('user:', output.getvalue())

    async def test_runtime_application_owns_gateway_context(self) -> None:
        config = server.MCPServiceConfig(
            gateway_url='https://gateway.test',
            request_timeout_seconds=7,
        )
        app_context = gateway.AppContext(gateway=mock.Mock())
        lifecycle_events: list[str] = []

        @contextlib.asynccontextmanager
        async def create_app_context(
            **kwargs: object,
        ) -> AsyncIterator[gateway.AppContext]:
            self.assertEqual(kwargs, {
                'gateway_url': 'https://gateway.test/',
                'request_timeout_seconds': 7,
                'transport': None,
            })
            lifecycle_events.append('entered')
            try:
                yield app_context
            finally:
                lifecycle_events.append('exited')

        with mock.patch.object(
                gateway, 'create_app_context', new=create_app_context):
            application = server.create_runtime_application(config)
            async with application.router.lifespan_context(application):
                self.assertIs(application.state.mcp_app_context, app_context)
                self.assertEqual(lifecycle_events, ['entered'])

        self.assertFalse(hasattr(application.state, 'mcp_app_context'))
        self.assertEqual(lifecycle_events, ['entered', 'exited'])

    async def test_runtime_application_cleans_up_in_dependency_order(self) -> None:
        config = server.MCPServiceConfig(gateway_url='https://gateway.test')
        app_context = gateway.AppContext(gateway=mock.Mock())
        lifecycle_events: list[str] = []

        @contextlib.asynccontextmanager
        async def protocol_lifespan(
            application: Starlette,
        ) -> AsyncIterator[None]:
            self.assertIs(application.state.mcp_app_context, app_context)
            lifecycle_events.append('protocol-entered')
            try:
                yield
            finally:
                self.assertIs(application.state.mcp_app_context, app_context)
                lifecycle_events.append('protocol-exited')

        @contextlib.asynccontextmanager
        async def create_app_context(
            **kwargs: object,
        ) -> AsyncIterator[gateway.AppContext]:
            del kwargs
            lifecycle_events.append('gateway-entered')
            try:
                yield app_context
            finally:
                lifecycle_events.append('gateway-exited')

        protocol_application = Starlette(lifespan=protocol_lifespan)
        with (
            mock.patch.object(server, 'create_mcp_server'),
            mock.patch.object(
                server,
                'create_application',
                return_value=protocol_application,
            ),
            mock.patch.object(
                gateway,
                'create_app_context',
                new=create_app_context,
            ),
        ):
            application = server.create_runtime_application(config)
            with self.assertRaisesRegex(RuntimeError, 'lifespan failure'):
                async with application.router.lifespan_context(application):
                    raise RuntimeError('lifespan failure')

        self.assertFalse(hasattr(application.state, 'mcp_app_context'))
        self.assertEqual(lifecycle_events, [
            'gateway-entered',
            'protocol-entered',
            'protocol-exited',
            'gateway-exited',
        ])


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
        application = object()

        with (
            mock.patch.object(
                server.MCPServiceConfig, 'load', return_value=config),
            mock.patch.object(
                server.logging_utils,
                'init_logger',
            ) as init_logger,
            mock.patch.object(
                server,
                'create_runtime_application',
                return_value=application,
            ) as application_factory,
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
            application,
            host='127.0.0.1',
            port=9000,
            log_config=None,
            ssl_certfile='/tmp/mcp-cert.pem',
        )
        server_factory.assert_called_once_with(config=uvicorn_config)
        uvicorn_server.serve.assert_awaited_once_with()
        application_factory.assert_called_once_with(config)
        init_logger.assert_called_once_with('mcp', config)
        config.uvicorn_ssl_kwargs.assert_called_once_with()

    def test_main_handles_keyboard_interrupt(self) -> None:
        config = types.SimpleNamespace(
            host='127.0.0.1',
            port=9000,
            uvicorn_ssl_kwargs=mock.Mock(return_value={}),
        )
        uvicorn_server = mock.Mock()
        uvicorn_server.serve = mock.AsyncMock(side_effect=KeyboardInterrupt)
        application = object()

        with (
            mock.patch.object(
                server.MCPServiceConfig, 'load', return_value=config),
            mock.patch.object(server.logging_utils, 'init_logger'),
            mock.patch.object(
                server,
                'create_runtime_application',
                return_value=application,
            ) as application_factory,
            mock.patch.object(server.uvicorn, 'Config', return_value=object()),
            mock.patch.object(
                server.uvicorn,
                'Server',
                return_value=uvicorn_server,
            ),
        ):
            server.main()

        uvicorn_server.serve.assert_awaited_once_with()
        application_factory.assert_called_once_with(config)


if __name__ == '__main__':
    unittest.main()
