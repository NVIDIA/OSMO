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
from collections.abc import Callable, Coroutine
import json
import logging
import pathlib
import shutil
import tempfile
import unittest

import httpx

from src.service.mcp import server


GatewayHandler = (
    Callable[[httpx.Request], httpx.Response] |
    Callable[[httpx.Request], Coroutine[None, None, httpx.Response]]
)


class _LogCapture(logging.Handler):
    """Capture formatted messages, including chained exceptions."""

    def __init__(self) -> None:
        super().__init__()
        self.setFormatter(logging.Formatter(
            '%(levelname)s:%(name)s:%(message)s'))
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(self.format(record))


class MCPToolsTest(unittest.IsolatedAsyncioTestCase):

    def setUp(self) -> None:
        temporary_directory = pathlib.Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, temporary_directory)
        self.credential_path = temporary_directory / 'service-token'
        self.credential_path.write_text('service-pat', encoding='utf-8')
        self.config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            service_token_file=self.credential_path,
            request_timeout_seconds=1,
        )

    async def test_profile_401_refreshes_delegated_token_and_retries_once(self) -> None:
        requests: list[httpx.Request] = []
        delegated_mints = 0

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            nonlocal delegated_mints
            requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                delegated_mints += 1
                return self._token_response(f'delegated-{delegated_mints}')
            if request.headers['authorization'] == 'Bearer delegated-1':
                return httpx.Response(401, text='expired-secret')
            return self._profile_response('alice')

        response = await self._call_tool(gateway_handler)

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(
            response.json()['result']['structuredContent']['username'], 'alice')
        self.assertEqual(delegated_mints, 2)
        profile_requests = self._requests_for(requests, '/api/profile/settings')
        self.assertEqual(
            [request.headers['authorization'] for request in profile_requests],
            ['Bearer delegated-1', 'Bearer delegated-2'],
        )
        self.assertNotIn('expired-secret', response.text)
        self.assertNotIn('delegated-1', response.text)
        self.assertNotIn('delegated-2', response.text)

    async def test_second_profile_401_stops_after_one_retry(self) -> None:
        requests: list[httpx.Request] = []
        delegated_mints = 0

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            nonlocal delegated_mints
            requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                delegated_mints += 1
                return self._token_response(f'delegated-{delegated_mints}')
            if request.headers['authorization'] in (
                'Bearer delegated-1', 'Bearer delegated-2',
            ):
                return httpx.Response(401, text='persistent-401-secret')
            return self._profile_response('alice')

        first_response, second_response = await self._call_tools(
            gateway_handler, argument_sets=[{}, {}])

        self._assert_sanitized_error(
            first_response, 'persistent-401-secret')
        self.assertFalse(second_response.json()['result']['isError'])
        self.assertEqual(delegated_mints, 3)
        self.assertEqual(
            [
                request.headers['authorization']
                for request in self._requests_for(
                    requests, '/api/profile/settings')
            ],
            [
                'Bearer delegated-1',
                'Bearer delegated-2',
                'Bearer delegated-3',
            ],
        )

    async def test_profile_403_is_not_retried_and_logs_are_sanitized(self) -> None:
        requests: list[httpx.Request] = []
        upstream_secret = 'forbidden-upstream-secret'

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return self._token_response('delegated-jwt')
            return httpx.Response(403, text=upstream_secret)

        log_capture = _LogCapture()
        root_logger = logging.getLogger()
        previous_level = root_logger.level
        root_logger.addHandler(log_capture)
        root_logger.setLevel(logging.DEBUG)
        try:
            response = await self._call_tool(gateway_handler)
        finally:
            root_logger.removeHandler(log_capture)
            root_logger.setLevel(previous_level)

        self._assert_sanitized_error(response, upstream_secret)
        self.assertEqual(
            len(self._requests_for(
                requests, '/api/auth/jwt/delegated_access_token')), 1)
        self.assertEqual(
            len(self._requests_for(requests, '/api/profile/settings')), 1)
        serialized_logs = repr(log_capture.messages)
        for secret in (upstream_secret, 'service-pat', 'service-jwt', 'delegated-jwt'):
            self.assertNotIn(secret, serialized_logs)

    async def test_profile_rejects_mismatched_or_malformed_gateway_data(self) -> None:
        invalid_responses = (
            self._profile_response('bob'),
            httpx.Response(200, json={
                'profile': {
                    'email_notification': False,
                    'slack_notification': False,
                    'pool': None,
                },
                'roles': ['osmo-user'],
                'pools': [],
                'token': None,
            }),
            httpx.Response(200, json={
                'profile': {
                    'username': 'alice',
                    'email_notification': 'false',
                    'slack_notification': False,
                    'pool': None,
                },
                'roles': ['osmo-user'],
                'pools': [],
                'token': None,
            }),
            httpx.Response(200, text='not-json'),
        )

        for invalid_response in invalid_responses:
            with self.subTest(body=invalid_response.text[:80]):
                def gateway_handler(
                    request: httpx.Request,
                    response: httpx.Response = invalid_response,
                ) -> httpx.Response:
                    if request.url.path == '/api/auth/jwt/access_token':
                        return self._token_response('service-jwt')
                    if request.url.path == '/api/auth/jwt/delegated_access_token':
                        return self._token_response('delegated-jwt')
                    return response

                response = await self._call_tool(gateway_handler)
                self._assert_sanitized_error(response, invalid_response.text)

    async def test_profile_response_has_a_size_limit(self) -> None:
        oversized_secret = 'oversized-profile-secret'

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return self._token_response('delegated-jwt')
            return httpx.Response(
                200,
                content=(oversized_secret.encode() + b'x' * (128 * 1024)),
            )

        response = await self._call_tool(gateway_handler)
        self._assert_sanitized_error(response, oversized_secret)

    async def test_profile_request_has_a_total_deadline(self) -> None:
        async def gateway_handler(request: httpx.Request) -> httpx.Response:
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return self._token_response('delegated-jwt')
            await asyncio.sleep(1)
            return self._profile_response('alice')

        short_timeout_config = server.MCPServiceConfig(
            api_url='https://gateway.test',
            service_token_file=self.credential_path,
            request_timeout_seconds=0.01,
        )
        response = await self._call_tool(
            gateway_handler, config=short_timeout_config)
        self._assert_sanitized_error(response)

    async def test_missing_request_id_is_omitted_from_every_gateway_call(self) -> None:
        requests: list[httpx.Request] = []

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return self._token_response('delegated-jwt')
            return self._profile_response('alice')

        response = await self._call_tool(gateway_handler, request_id=None)

        self.assertFalse(response.json()['result']['isError'])
        self.assertTrue(all('x-request-id' not in request.headers for request in requests))

    async def test_caller_identity_argument_cannot_override_trusted_user(self) -> None:
        requests: list[httpx.Request] = []

        def gateway_handler(request: httpx.Request) -> httpx.Response:
            requests.append(request)
            if request.url.path == '/api/auth/jwt/access_token':
                return self._token_response('service-jwt')
            if request.url.path == '/api/auth/jwt/delegated_access_token':
                return self._token_response('delegated-jwt')
            return self._profile_response('alice')

        response = await self._call_tool(
            gateway_handler, arguments={'username': 'bob'})

        self.assertFalse(response.json()['result']['isError'])
        self.assertEqual(
            response.json()['result']['structuredContent']['username'], 'alice')
        delegated_request = self._requests_for(
            requests, '/api/auth/jwt/delegated_access_token')[0]
        self.assertEqual(
            json.loads(delegated_request.content), {'subject_user': 'alice'})

    async def _call_tool(
        self,
        gateway_handler: GatewayHandler,
        *,
        user_name: str = 'alice',
        request_id: str | None = 'request-123',
        arguments: dict[str, object] | None = None,
        config: server.MCPServiceConfig | None = None,
    ) -> httpx.Response:
        return (await self._call_tools(
            gateway_handler,
            user_name=user_name,
            request_id=request_id,
            argument_sets=[arguments or {}],
            config=config,
        ))[0]

    async def _call_tools(
        self,
        gateway_handler: GatewayHandler,
        *,
        argument_sets: list[dict[str, object]],
        user_name: str = 'alice',
        request_id: str | None = 'request-123',
        config: server.MCPServiceConfig | None = None,
    ) -> list[httpx.Response]:
        application = server.create_application(
            config or self.config,
            http_transport=httpx.MockTransport(gateway_handler),
        )
        headers = {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'x-osmo-user': user_name,
        }
        if request_id is not None:
            headers['x-request-id'] = request_id
        async with application.router.lifespan_context(application):
            async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test') as client:
                responses = []
                for request_number, arguments in enumerate(argument_sets, start=1):
                    request = {
                        'jsonrpc': '2.0',
                        'id': request_number,
                        'method': 'tools/call',
                        'params': {
                            'name': 'get_current_profile',
                            'arguments': arguments,
                        },
                    }
                    responses.append(await client.post(
                        '/mcp', headers=headers, json=request))
                return responses

    @staticmethod
    def _token_response(token: str) -> httpx.Response:
        return httpx.Response(
            200, json={'token': token, 'expires_at': 4102444800})

    @staticmethod
    def _profile_response(user_name: str) -> httpx.Response:
        return httpx.Response(200, json={
            'profile': {
                'username': user_name,
                'email_notification': False,
                'slack_notification': False,
                'pool': None,
            },
            'roles': ['osmo-user'],
            'pools': ['pool-a'],
            'token': {
                'name': 'delegated-svc-mcp',
                'expires_at': None,
            },
        })

    @staticmethod
    def _requests_for(
        requests: list[httpx.Request],
        path: str,
    ) -> list[httpx.Request]:
        return [request for request in requests if request.url.path == path]

    def _assert_sanitized_error(
        self,
        response: httpx.Response,
        secret: str | None = None,
    ) -> None:
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['result']['isError'])
        self.assertIn(
            'Unable to retrieve the current OSMO profile.', response.text)
        if secret:
            self.assertNotIn(secret, response.text)
        for token in ('service-pat', 'service-jwt', 'delegated-jwt'):
            self.assertNotIn(token, response.text)


if __name__ == '__main__':
    unittest.main()
