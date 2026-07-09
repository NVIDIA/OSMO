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
import json
import logging
import pathlib
import shutil
import tempfile
import types
from typing import cast
import unittest
from unittest import mock

import httpx
from mcp.server.fastmcp import Context, FastMCP
from mcp.types import LATEST_PROTOCOL_VERSION
import pydantic
from starlette.types import Message, Receive, Scope, Send

from src.service.mcp import identity, server, tokens


class _LogCapture(logging.Handler):
    """Collect formatted log messages without changing production logging."""

    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(logging.Formatter(
            '%(levelname)s:%(name)s:%(message)s'))
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        # Handler formatting includes any attached exception and traceback.
        self.messages.append(self.format(record))


class MCPServerTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        temporary_directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temporary_directory)
        self.credential_path = temporary_directory / 'service-token'
        self.credential_path.write_text('service-pat', encoding='utf-8')
        self.config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            service_token_file=self.credential_path,
        )

    async def test_health_endpoints(self) -> None:
        application = server.create_application(self.config)
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                live_response = await client.get(
                    '/health/live',
                    headers={
                        'Authorization': 'Bearer probe-token',
                        'Cookie': 'probe=cookie',
                    },
                )
                health_response = await client.get('/health')
                ready_response = await client.get('/health/ready')

        self.assertEqual(live_response.status_code, 200)
        self.assertEqual(live_response.json(), {'status': 'ok'})
        self.assertEqual(health_response.status_code, 200)
        self.assertEqual(health_response.json(), {'status': 'ok'})
        self.assertEqual(ready_response.status_code, 200)
        self.assertEqual(ready_response.json(), {'status': 'ok'})

    async def test_initialize_and_empty_tool_catalog(self) -> None:
        application = server.create_application(self.config)
        mcp_server = application.state.mcp_server
        self.assertTrue(mcp_server.settings.stateless_http)
        self.assertTrue(mcp_server.settings.json_response)
        self.assertEqual(mcp_server.settings.streamable_http_path, '/mcp')

        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'x-osmo-user': 'alice',
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

    async def test_mcp_rejects_missing_empty_and_duplicate_identity(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()
        base_headers = self._mcp_headers()

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                missing = await client.post('/mcp', headers=base_headers, json=request)
                empty = await client.post(
                    '/mcp', headers=[*base_headers, ('x-osmo-user', ' ')], json=request)
                duplicate = await client.post(
                    '/mcp',
                    headers=[
                        *base_headers,
                        ('x-osmo-user', 'alice'),
                        ('x-osmo-user', 'bob'),
                    ],
                    json=request,
                )
                duplicate_same_value = await client.post(
                    '/mcp',
                    headers=[
                        *base_headers,
                        ('x-osmo-user', 'alice'),
                        ('X-Osmo-User', 'alice'),
                    ],
                    json=request,
                )
                query_without_identity = await client.post(
                    '/mcp?trace=1', headers=base_headers, json=request)

        self.assertEqual(missing.status_code, 400)
        self.assertEqual(empty.status_code, 400)
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(duplicate_same_value.status_code, 400)
        self.assertEqual(query_without_identity.status_code, 400)

    async def test_mcp_rejects_client_authentication_headers(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()
        base_headers = [*self._mcp_headers(), ('x-osmo-user', 'alice')]

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                authorization = await client.post(
                    '/mcp',
                    headers=[*base_headers, ('Authorization', 'Bearer client-secret')],
                    json=request,
                )
                osmo_auth = await client.post(
                    '/mcp',
                    headers=[*base_headers, ('x-osmo-auth', 'client-secret')],
                    json=request,
                )
                cookie = await client.post(
                    '/mcp',
                    headers=[*base_headers, ('Cookie', 'session=cookie-secret')],
                    json=request,
                )
                proxy_authorization = await client.post(
                    '/mcp',
                    headers=[
                        *base_headers,
                        ('Proxy-Authorization', 'Basic proxy-secret'),
                    ],
                    json=request,
                )

        self.assertEqual(authorization.status_code, 400)
        self.assertEqual(osmo_auth.status_code, 400)
        self.assertEqual(cookie.status_code, 400)
        self.assertEqual(proxy_authorization.status_code, 400)
        self.assertNotIn('client-secret', authorization.text)
        self.assertNotIn('client-secret', osmo_auth.text)
        self.assertNotIn('cookie-secret', cookie.text)
        self.assertNotIn('proxy-secret', proxy_authorization.text)

    async def test_neighboring_paths_do_not_reach_mcp(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()
        headers = [*self._mcp_headers(), ('x-osmo-user', 'alice')]
        neighboring_paths = ('/mcp/', '/mcp/child', '/MCP', '/mcp%2Fchild')

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test',
                    follow_redirects=False) as client:
                responses = {
                    path: await client.post(path, headers=headers, json=request)
                    for path in neighboring_paths
                }

        for path, response in responses.items():
            with self.subTest(path=path):
                self.assertNotEqual(response.status_code, 200)

    async def test_mcp_rejects_unsafe_or_duplicate_request_id(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()
        base_headers = [*self._mcp_headers(), ('x-osmo-user', 'alice')]

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                unsafe = await client.post(
                    '/mcp',
                    headers=[*base_headers, ('x-request-id', 'contains space')],
                    json=request,
                )
                duplicate = await client.post(
                    '/mcp',
                    headers=[
                        *base_headers,
                        ('x-request-id', 'request-1'),
                        ('x-request-id', 'request-2'),
                    ],
                    json=request,
                )

        self.assertEqual(unsafe.status_code, 400)
        self.assertEqual(duplicate.status_code, 400)

    async def test_mcp_rejects_unsafe_user_name(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                control = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('alice\x7f'),
                    json=request,
                )
                overlong = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('a' * 257),
                    json=request,
                )

        self.assertEqual(control.status_code, 400)
        self.assertEqual(overlong.status_code, 400)

    async def test_mcp_accepts_jit_identity_formats(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                responses = [
                    await client.post(
                        '/mcp', headers=self._mcp_headers(user_name), json=request)
                    for user_name in (
                        'alice+tag@example.com',
                        'guest#EXT#@tenant',
                    )
                ]

        self.assertTrue(all(response.status_code == 200 for response in responses))

    async def test_identity_and_request_id_length_boundaries(self) -> None:
        application = server.create_application(self.config)
        request = self._list_tools_request()

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                accepted = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('a' * 256, 'r' * 128),
                    json=request,
                )
                overlong_request_id = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('alice', 'r' * 129),
                    json=request,
                )

        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(overlong_request_id.status_code, 400)

    async def test_identity_context_resets_after_downstream_exception(self) -> None:
        async def failing_application(
            unused_scope: Scope,
            unused_receive: Receive,
            unused_send: Send,
        ) -> None:
            del unused_scope, unused_receive, unused_send
            self.assertEqual(identity.get_request_identity().user_name, 'alice')
            raise RuntimeError('downstream failure')

        middleware = identity.TrustedIdentityMiddleware(failing_application)
        scope = cast(Scope, {
            'type': 'http',
            'path': '/mcp',
            'headers': [(b'x-osmo-user', b'alice')],
        })

        with self.assertRaisesRegex(RuntimeError, 'downstream failure'):
            await middleware(scope, mock.AsyncMock(), mock.AsyncMock())
        with self.assertRaisesRegex(RuntimeError, 'identity is unavailable'):
            identity.get_request_identity()

    async def test_identity_middleware_rejects_invalid_utf8_header(self) -> None:
        downstream_called = False
        sent_messages: list[Message] = []

        async def downstream_application(
            unused_scope: Scope,
            unused_receive: Receive,
            unused_send: Send,
        ) -> None:
            nonlocal downstream_called
            del unused_scope, unused_receive, unused_send
            downstream_called = True

        async def receive() -> Message:
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        async def send(message: Message) -> None:
            sent_messages.append(message)

        middleware = identity.TrustedIdentityMiddleware(downstream_application)
        scope = cast(Scope, {
            'type': 'http',
            'path': '/mcp',
            'headers': [(b'x-osmo-user', b'\xff')],
        })

        await middleware(scope, receive, send)

        self.assertFalse(downstream_called)
        self.assertEqual(sent_messages[0]['type'], 'http.response.start')
        self.assertEqual(sent_messages[0]['status'], 400)

    async def test_identity_context_resets_after_downstream_cancellation(self) -> None:
        application_started = asyncio.Event()

        async def blocking_application(
            unused_scope: Scope,
            unused_receive: Receive,
            unused_send: Send,
        ) -> None:
            del unused_scope, unused_receive, unused_send
            self.assertEqual(identity.get_request_identity().user_name, 'alice')
            application_started.set()
            await asyncio.Event().wait()

        middleware = identity.TrustedIdentityMiddleware(blocking_application)
        scope = cast(Scope, {
            'type': 'http',
            'path': '/mcp',
            'headers': [(b'x-osmo-user', b'alice')],
        })

        async def run_request_and_check_cleanup() -> None:
            try:
                await middleware(scope, mock.AsyncMock(), mock.AsyncMock())
            except asyncio.CancelledError:
                # Check from the same task in which middleware set the context.
                with self.assertRaisesRegex(
                        RuntimeError, 'identity is unavailable'):
                    identity.get_request_identity()
                raise

        request_task = asyncio.create_task(
            run_request_and_check_cleanup())
        await asyncio.wait_for(application_started.wait(), timeout=5)
        request_task.cancel()

        with self.assertRaises(asyncio.CancelledError):
            await request_task
        with self.assertRaisesRegex(RuntimeError, 'identity is unavailable'):
            identity.get_request_identity()

    async def test_concurrent_requests_keep_identity_isolated(self) -> None:
        requests_entered = 0
        both_requests_entered = asyncio.Event()

        def configure(mcp_server: FastMCP[tokens.AppContext]) -> None:
            @mcp_server.tool()
            async def identity_probe(context: Context) -> str:
                nonlocal requests_entered
                before = identity.get_request_identity()
                requests_entered += 1
                if requests_entered == 2:
                    both_requests_entered.set()
                await asyncio.wait_for(both_requests_entered.wait(), timeout=5)
                after = identity.get_request_identity()
                app_context = context.request_context.lifespan_context
                if not isinstance(app_context, tokens.AppContext):
                    raise RuntimeError('Unexpected lifespan context.')
                return (
                    f'{before.user_name}:{before.request_id}|'
                    f'{after.user_name}:{after.request_id}')

        application = server.create_application(
            self.config, configure_server=configure)
        tool_request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {'name': 'identity_probe', 'arguments': {}},
        }

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                alice_response, bob_response = await asyncio.gather(
                    client.post(
                        '/mcp',
                        headers=self._mcp_headers('alice', 'request-alice'),
                        json=tool_request,
                    ),
                    client.post(
                        '/mcp',
                        headers=self._mcp_headers('bob', 'request-bob'),
                        json=tool_request,
                    ),
                )

        self.assertEqual(alice_response.status_code, 200)
        self.assertEqual(bob_response.status_code, 200)
        self.assertEqual(
            alice_response.json()['result']['content'][0]['text'],
            'alice:request-alice|alice:request-alice',
        )
        self.assertEqual(
            bob_response.json()['result']['content'][0]['text'],
            'bob:request-bob|bob:request-bob',
        )

    async def test_mcp_component_bridges_identity_to_delegated_api_call(self) -> None:
        gateway_requests: list[httpx.Request] = []

        async def gateway_handler(request: httpx.Request) -> httpx.Response:
            gateway_requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return httpx.Response(
                    200,
                    json={'token': 'service-jwt', 'expires_at': 4102444800},
                )

            if request.url.path == '/api/auth/jwt/delegated_access_token':
                subject_user = json.loads(request.content)['subject_user']
                return httpx.Response(
                    200,
                    json={
                        'token': f'delegated-{subject_user}',
                        'expires_at': 4102444800,
                    },
                )

            if request.url.path == '/api/profile/settings':
                delegated_token = request.headers['authorization'].removeprefix(
                    'Bearer delegated-')
                return httpx.Response(200, json={
                    'profile': {
                        'username': delegated_token,
                        'email_notification': False,
                        'slack_notification': False,
                        'pool': None,
                    },
                    'roles': ['osmo-user'],
                    'pools': [],
                    'token': {'name': 'delegated-svc-mcp', 'expires_at': None},
                })

            return httpx.Response(404)

        def configure(mcp_server: FastMCP[tokens.AppContext]) -> None:
            @mcp_server.tool()
            async def delegated_profile_probe(context: Context) -> str:
                """Test-only bridge from the trusted MCP identity to an OSMO API."""
                request_identity = identity.get_request_identity()
                app_context = context.request_context.lifespan_context
                if not isinstance(app_context, tokens.AppContext):
                    raise RuntimeError('Unexpected lifespan context.')

                delegated_token = await app_context.delegated_tokens.get_token()
                response = await app_context.http_client.get(
                    '/api/profile/settings',
                    headers={
                        'Authorization': f'Bearer {delegated_token}',
                        'x-request-id': request_identity.request_id or '',
                    },
                )
                response.raise_for_status()
                verified_user = response.json().get('profile', {}).get('username')
                if verified_user != request_identity.user_name:
                    raise RuntimeError('Gateway response identity does not match request.')
                return request_identity.user_name

        application = server.create_application(
            self.config,
            configure_server=configure,
            http_transport=httpx.MockTransport(gateway_handler),
        )
        def tool_request(request_id: int) -> dict[str, object]:
            return {
                'jsonrpc': '2.0',
                'id': request_id,
                'method': 'tools/call',
                'params': {
                    'name': 'delegated_profile_probe',
                    'arguments': {},
                },
            }

        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                alice_response = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('alice', 'request-alice'),
                    json=tool_request(1),
                )
                bob_response = await client.post(
                    '/mcp',
                    headers=self._mcp_headers('bob', 'request-bob'),
                    json=tool_request(2),
                )
                cached_alice_response = await client.post(
                    '/mcp',
                    headers=self._mcp_headers(
                        'alice', 'request-alice-cached'),
                    json=tool_request(3),
                )

        responses = (alice_response, bob_response, cached_alice_response)
        self.assertTrue(all(response.status_code == 200 for response in responses))
        self.assertEqual(
            [response.json()['result']['content'][0]['text'] for response in responses],
            ['alice', 'bob', 'alice'],
        )
        self.assertEqual(
            [request.url.path for request in gateway_requests],
            [
                '/api/auth/jwt/access_token',
                '/api/auth/jwt/delegated_access_token',
                '/api/profile/settings',
                '/api/auth/jwt/delegated_access_token',
                '/api/profile/settings',
                '/api/profile/settings',
            ],
        )
        service_requests = [
            request for request in gateway_requests
            if request.url.path == '/api/auth/jwt/access_token'
        ]
        delegated_requests = [
            request for request in gateway_requests
            if request.url.path == '/api/auth/jwt/delegated_access_token'
        ]
        profile_requests = [
            request for request in gateway_requests
            if request.url.path == '/api/profile/settings'
        ]
        self.assertEqual(len(service_requests), 1)
        self.assertEqual(service_requests[0].method, 'POST')
        self.assertEqual(json.loads(service_requests[0].content), {
            'token': 'service-pat',
        })
        self.assertNotIn('authorization', service_requests[0].headers)
        self.assertTrue(all(
            request.method == 'POST' for request in delegated_requests
        ))
        self.assertEqual(
            [json.loads(request.content) for request in delegated_requests],
            [{'subject_user': 'alice'}, {'subject_user': 'bob'}],
        )
        self.assertTrue(all(
            request.headers['authorization'] == 'Bearer service-jwt'
            for request in delegated_requests
        ))
        self.assertEqual(
            [request.headers['x-request-id'] for request in delegated_requests],
            ['request-alice', 'request-bob'],
        )
        self.assertTrue(all(
            request.method == 'GET' for request in profile_requests
        ))
        self.assertEqual(
            [request.headers['authorization'] for request in profile_requests],
            [
                'Bearer delegated-alice',
                'Bearer delegated-bob',
                'Bearer delegated-alice',
            ],
        )
        self.assertEqual(
            [request.headers['x-request-id'] for request in profile_requests],
            ['request-alice', 'request-bob', 'request-alice-cached'],
        )

        serialized_responses = repr([
            {'headers': dict(response.headers), 'body': response.text}
            for response in responses
        ])
        for secret in ('service-pat', 'service-jwt', 'delegated-alice', 'delegated-bob'):
            self.assertNotIn(secret, serialized_responses)

    async def test_mcp_component_redacts_gateway_error_body(self) -> None:
        gateway_secret = 'sensitive-gateway-error-body'

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return httpx.Response(
                    200,
                    json={'token': 'service-jwt', 'expires_at': 4102444800},
                )
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return httpx.Response(503, text=gateway_secret)
            return httpx.Response(404)

        def configure(mcp_server: FastMCP[tokens.AppContext]) -> None:
            @mcp_server.tool()
            async def failing_delegation_probe(context: Context) -> str:
                app_context = context.request_context.lifespan_context
                if not isinstance(app_context, tokens.AppContext):
                    raise RuntimeError('Unexpected lifespan context.')
                await app_context.delegated_tokens.get_token()
                return 'unexpected success'

        application = server.create_application(
            self.config,
            configure_server=configure,
            http_transport=httpx.MockTransport(gateway_handler),
        )
        tool_request = {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/call',
            'params': {'name': 'failing_delegation_probe', 'arguments': {}},
        }
        log_capture = _LogCapture()
        root_logger = logging.getLogger()
        previous_log_level = root_logger.level
        root_logger.addHandler(log_capture)
        root_logger.setLevel(logging.DEBUG)
        try:
            async with application.router.lifespan_context(application):
                async with httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=application),
                        base_url='http://mcp.test') as client:
                    response = await client.post(
                        '/mcp',
                        headers=self._mcp_headers('alice', 'request-error'),
                        json=tool_request,
                    )
        finally:
            root_logger.removeHandler(log_capture)
            root_logger.setLevel(previous_log_level)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['result']['isError'])
        serialized_output = repr({
            'headers': dict(response.headers),
            'body': response.text,
            'logs': log_capture.messages,
        })
        self.assertNotIn(gateway_secret, serialized_output)

    def test_config_requires_https_gateway_origin_and_absolute_secret_path(self) -> None:
        invalid_configurations = (
            {'api_url': 'http://gateway.test', 'service_token_file': '/token'},
            {'api_url': 'https://user@gateway.test', 'service_token_file': '/token'},
            {'api_url': 'https://gateway.test/api', 'service_token_file': '/token'},
            {'api_url': 'https://gateway.test', 'service_token_file': 'token'},
        )
        for configuration in invalid_configurations:
            with self.subTest(configuration=configuration):
                with self.assertRaises(pydantic.ValidationError):
                    server.MCPServiceConfig(**configuration)

        valid_config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            service_token_file='/token',
        )
        self.assertEqual(
            valid_config.service_token_file,
            pathlib.Path('/token'),
        )

    def test_runtime_config_numeric_boundaries(self) -> None:
        valid_values = (
            {'token_cache_max_size': 1},
            {'token_cache_max_size': 10000},
            {'token_cache_skew_seconds': 0},
            {'token_cache_skew_seconds': 120},
            {'request_timeout_seconds': 0.5},
            {'request_timeout_seconds': 60},
        )
        for overrides in valid_values:
            with self.subTest(overrides=overrides):
                config = server.MCPServiceConfig(
                    api_url='https://gateway.test',
                    service_token_file='/token',
                    **overrides,
                )
                self.assertIsNotNone(config)

        invalid_values = (
            {'token_cache_max_size': 0},
            {'token_cache_max_size': 10001},
            {'token_cache_max_size': 1.5},
            {'token_cache_skew_seconds': -0.1},
            {'token_cache_skew_seconds': 120.1},
            {'request_timeout_seconds': 0},
            {'request_timeout_seconds': 60.1},
        )
        for overrides in invalid_values:
            with self.subTest(overrides=overrides):
                with self.assertRaises(pydantic.ValidationError):
                    server.MCPServiceConfig(
                        api_url='https://gateway.test',
                        service_token_file='/token',
                        **overrides,
                    )

    @staticmethod
    def _mcp_headers(
        user_name: str | None = None,
        request_id: str | None = None,
    ) -> list[tuple[str, str]]:
        headers = [
            ('Accept', 'application/json, text/event-stream'),
            ('Content-Type', 'application/json'),
        ]
        if user_name is not None:
            headers.append(('x-osmo-user', user_name))
        if request_id is not None:
            headers.append(('x-request-id', request_id))
        return headers

    @staticmethod
    def _list_tools_request() -> dict[str, object]:
        return {
            'jsonrpc': '2.0',
            'id': 1,
            'method': 'tools/list',
            'params': {},
        }


class MCPMainTest(unittest.TestCase):

    def test_main_starts_uvicorn_with_runtime_config(self) -> None:
        config = types.SimpleNamespace(
            host='127.0.0.1',
            port=9000,
            uvicorn_ssl_kwargs=mock.Mock(
                return_value={'ssl_certfile': '/tmp/mcp-cert.pem'}),
        )
        uvicorn_config = object()
        application = object()
        uvicorn_server = mock.Mock()
        uvicorn_server.serve = mock.AsyncMock()

        with (
            mock.patch.object(
                server.MCPServiceConfig, 'load', return_value=config),
            mock.patch.object(
                server, 'create_application', return_value=application,
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
        config.uvicorn_ssl_kwargs.assert_called_once_with()
        application_factory.assert_called_once_with(config)

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
            mock.patch.object(
                server, 'create_application', return_value=object()),
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
