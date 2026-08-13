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

import base64
import json
import tempfile
import unittest
from unittest import mock

import httpx
import jwt  # type: ignore
from key_value.aio.stores.memory import MemoryStore
from mcp.server.auth.provider import AccessToken, TokenError
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from src.service.mcp_auth import config, server


class FastMCPAzureProviderTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.signing_key = b's' * 32
        self.config = config.OAuthBrokerConfig(
            issuer_url='https://osmo.example',
            resource_url='https://osmo.example/mcp',
            redis_url='redis://redis.example:6379/7',
            entra_tenant_id='tenant-id',
            entra_client_id='entra-client',
            entra_client_secret_file='/not-read-in-unit-test',
            entra_identifier_uri='https://osmo.example/mcp',
            entra_token_issuer='https://sts.example/tenant/',
            signing_jwks_file='/not-read-in-unit-test',
        )
        self.assertEqual(
            self.config.entra_token_issuer,
            'https://sts.example/tenant/',
        )
        self.provider = server.OSMOAzureProvider(
            client_id=self.config.entra_client_id,
            client_secret='test-secret-that-is-not-used',
            tenant_id=self.config.entra_tenant_id,
            required_scopes=[self.config.scope],
            base_url=self.config.issuer_url,
            resource_base_url=self.config.issuer_url,
            identifier_uri=self.config.entra_identifier_uri,
            issuer_url=self.config.issuer_url,
            redirect_path='/oauth/callback/entra',
            additional_authorize_scopes=['openid', 'profile', 'email'],
            allowed_client_redirect_uris=self.config.allowed_client_redirect_uris,
            client_storage=MemoryStore(),
            jwt_signing_key=self.signing_key,
            token_issuer=self.config.entra_token_issuer,
        )
        self.application = server.create_application(
            auth_provider=self.provider,
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=self.application),
            base_url=self.config.issuer_url,
            follow_redirects=False,
        )

    async def asyncTearDown(self) -> None:
        await self.client.aclose()

    async def test_metadata_and_routes_are_endpoint_only(self) -> None:
        metadata = await self.client.get('/.well-known/oauth-authorization-server')
        self.assertEqual(metadata.status_code, 200, metadata.text)
        self.assertEqual(metadata.json()['issuer'], 'https://osmo.example/')
        self.assertEqual(
            metadata.json()['authorization_endpoint'],
            'https://osmo.example/authorize',
        )
        self.assertEqual(metadata.json()['token_endpoint'], 'https://osmo.example/token')
        self.assertEqual(metadata.json()['registration_endpoint'], 'https://osmo.example/register')
        self.assertEqual(metadata.json()['scopes_supported'], ['access_as_user'])

        protected_resource = await self.client.get(
            '/.well-known/oauth-protected-resource/mcp'
        )
        self.assertEqual(protected_resource.status_code, 200, protected_resource.text)
        self.assertEqual(
            protected_resource.json(),
            {
                'resource': 'https://osmo.example/mcp',
                'authorization_servers': ['https://osmo.example/'],
                'scopes_supported': ['access_as_user'],
                'bearer_methods_supported': ['header'],
            },
        )
        route_methods = {
            (route.path, tuple(sorted(route.methods or ())))
            for route in self.application.routes
            if isinstance(route, Route)
        }
        self.assertIn(('/authorize', ('GET', 'HEAD', 'POST')), route_methods)
        self.assertIn(('/token', ('OPTIONS', 'POST')), route_methods)
        self.assertIn(('/register', ('OPTIONS', 'POST')), route_methods)
        self.assertIn(('/oauth/callback/entra', ('GET', 'HEAD')), route_methods)
        self.assertIn(('/consent', ('GET', 'HEAD', 'POST')), route_methods)
        self.assertNotIn(('/oauth/jwks.json', ('GET',)), route_methods)

    async def test_dcr_allows_loopback_and_rejects_untrusted_https(self) -> None:
        payload = {
            'client_name': 'Codex',
            'grant_types': ['authorization_code', 'refresh_token'],
            'response_types': ['code'],
            'token_endpoint_auth_method': 'none',
        }
        allowed = await self.client.post(
            '/register',
            json={**payload, 'redirect_uris': ['http://localhost:53682/callback']},
        )
        self.assertEqual(allowed.status_code, 201, allowed.text)
        self.assertEqual(allowed.json()['scope'], 'access_as_user')

        rejected = await self.client.post(
            '/register',
            json={**payload, 'redirect_uris': ['https://evil.example/callback']},
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertEqual(rejected.json()['error'], 'invalid_redirect_uri')

    async def test_token_preflight_allows_public_client_auth_headers(self) -> None:
        response = await self.client.options(
            '/token',
            headers={
                'Origin': 'http://localhost:6274',
                'Access-Control-Request-Method': 'POST',
                'Access-Control-Request-Headers': 'authorization,content-type',
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers['access-control-allow-origin'], '*')
        allowed_headers = response.headers['access-control-allow-headers'].lower()
        self.assertIn('authorization', allowed_headers)
        self.assertIn('content-type', allowed_headers)

    def test_proxy_token_preserves_verified_entra_identity_for_gateway(self) -> None:
        token = self.provider.jwt_issuer.issue_access_token(
            client_id='dynamic-client',
            scopes=['access_as_user'],
            jti='reference-id',
            upstream_claims={
                'preferred_username': 'user@example.com',
                'roles': ['osmo-user', 'pool-team'],
            },
        )
        claims = jwt.decode(
            token,
            self.signing_key,
            algorithms=['HS256'],
            audience=self.config.resource_url,
            issuer=f'{self.config.issuer_url}/',
        )
        self.assertEqual(claims['scope'], 'access_as_user')
        self.assertEqual(
            claims['upstream_claims'],
            {
                'preferred_username': 'user@example.com',
                'roles': ['osmo-user', 'pool-team'],
            },
        )

    async def test_upstream_claims_are_verified_before_embedding(self) -> None:
        verifier = mock.AsyncMock()
        verifier.verify_token.return_value = AccessToken(
            token='signed-entra-token',
            client_id='entra-client',
            scopes=['access_as_user'],
            claims={
                'unique_name': 'user@example.com',
                'roles': ['pool-team', 'osmo-user', 'osmo-user'],
                'groups': ['not-forwarded'],
            },
        )
        self.provider._token_validator = verifier  # pylint: disable=protected-access

        claims = await self.provider._extract_upstream_claims(  # pylint: disable=protected-access
            {'access_token': 'signed-entra-token'}
        )

        verifier.verify_token.assert_awaited_once_with('signed-entra-token')
        self.assertEqual(
            claims,
            {
                'unique_name': 'user@example.com',
                'roles': ['osmo-user', 'pool-team'],
            },
        )

    async def test_invalid_upstream_roles_are_rejected(self) -> None:
        verifier = mock.AsyncMock()
        verifier.verify_token.return_value = AccessToken(
            token='signed-entra-token',
            client_id='entra-client',
            scopes=['access_as_user'],
            claims={'roles': ['osmo-user,osmo-admin']},
        )
        self.provider._token_validator = verifier  # pylint: disable=protected-access

        with self.assertRaises(TokenError) as raised:
            await self.provider._extract_upstream_claims(  # pylint: disable=protected-access
                {'access_token': 'signed-entra-token'}
            )
        self.assertEqual(raised.exception.error, 'invalid_grant')

    def test_private_signing_jwks_requires_one_256_bit_oct_key(self) -> None:
        encoded_key = base64.urlsafe_b64encode(self.signing_key).rstrip(b'=').decode()
        with tempfile.NamedTemporaryFile(mode='w+', encoding='utf-8') as key_file:
            json.dump(
                {
                    'keys': [
                        {
                            'kty': 'oct',
                            'alg': 'HS256',
                            'use': 'sig',
                            'k': encoded_key,
                        }
                    ]
                },
                key_file,
            )
            key_file.flush()
            self.assertEqual(server._read_signing_jwks(key_file.name), self.signing_key)  # pylint: disable=protected-access

        with tempfile.NamedTemporaryFile(mode='w+', encoding='utf-8') as key_file:
            json.dump({'keys': [{'kty': 'RSA', 'k': encoded_key}]}, key_file)
            key_file.flush()
            with self.assertRaisesRegex(ValueError, 'kty=oct'):
                server._read_signing_jwks(key_file.name)  # pylint: disable=protected-access


class OAuthBrokerConfigTest(unittest.TestCase):
    def test_redirects_are_loopback_only_by_default(self) -> None:
        broker_config = config.OAuthBrokerConfig(
            issuer_url='https://osmo.example',
            resource_url='https://osmo.example/mcp',
            redis_url='rediss://redis.example:6379/7',
            entra_tenant_id='tenant-id',
            entra_client_id='entra-client',
            entra_client_secret_file='/secret',
            entra_identifier_uri='https://osmo.example/mcp',
            entra_token_issuer='https://sts.example/tenant/',
            signing_jwks_file='/signing-key',
        )
        self.assertEqual(
            broker_config.allowed_client_redirect_uris,
            ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'],
        )
        self.assertEqual(
            broker_config.entra_token_issuer,
            'https://sts.example/tenant/',
        )

    def test_resource_and_identifier_uri_must_match(self) -> None:
        with self.assertRaisesRegex(ValueError, 'entra_identifier_uri'):
            config.OAuthBrokerConfig(
                issuer_url='https://osmo.example',
                resource_url='https://osmo.example/mcp',
                redis_url='rediss://redis.example:6379/7',
                entra_tenant_id='tenant-id',
                entra_client_id='entra-client',
                entra_client_secret_file='/secret',
                entra_identifier_uri='https://api.example/mcp',
                entra_token_issuer='https://sts.example/tenant/',
                signing_jwks_file='/signing-key',
            )


class OAuthFailureBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def test_unexpected_token_failure_is_oauth_json_without_secret(self) -> None:
        secret_message = 'must-not-appear-in-response-or-log'

        async def fail_token(_: Request) -> Response:
            raise RuntimeError(secret_message)

        class FailingProvider:
            @staticmethod
            def get_routes(_: str) -> list[Route]:
                return [Route('/token', fail_token, methods=['POST'])]

        broker_config = config.OAuthBrokerConfig(
            issuer_url='https://osmo.example',
            resource_url='https://osmo.example/mcp',
            redis_url='rediss://redis.example:6379/7',
            entra_tenant_id='tenant-id',
            entra_client_id='entra-client',
            entra_client_secret_file='/secret',
            entra_identifier_uri='https://osmo.example/mcp',
            entra_token_issuer='https://sts.example/tenant/',
            signing_jwks_file='/signing-key',
        )
        application = server.create_application(
            auth_provider=FailingProvider(),  # type: ignore[arg-type]
        )
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(
                app=application,
                raise_app_exceptions=False,
            ),
            base_url=broker_config.issuer_url,
        ) as client:
            with self.assertLogs(server.LOGGER, level='ERROR') as captured:
                response = await client.post(
                    '/token',
                    data={
                        'grant_type': 'refresh_token',
                        'refresh_token': 'sensitive-refresh-token',
                    },
                )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.headers['content-type'], 'application/json')
        self.assertEqual(response.headers['cache-control'], 'no-store')
        self.assertEqual(response.headers['pragma'], 'no-cache')
        self.assertEqual(
            response.json(),
            {
                'error': 'server_error',
                'error_description': 'OAuth service temporarily unavailable',
            },
        )
        combined_logs = '\n'.join(captured.output)
        self.assertNotIn(secret_message, combined_logs)
        self.assertNotIn('sensitive-refresh-token', combined_logs)
