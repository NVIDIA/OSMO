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
import time
import unittest
from unittest import mock

import httpx
from fastmcp.server.auth.cimd import CIMDDocument
from fastmcp.server.auth.oauth_proxy.models import ClientCode, ProxyDCRClient
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
import jwt  # type: ignore
from key_value.aio.stores.memory import MemoryStore
from mcp.server.auth.provider import AccessToken, AuthorizationCode, TokenError
from pydantic import AnyUrl
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from src.service.mcp_auth import config, server


class FastMCPOIDCProxyTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.signing_key = b's' * 32
        self.requested_scope = 'https://osmo.example/mcp/access_as_user'
        self.config = config.OAuthBrokerConfig(
            issuer_url='https://osmo.example',
            resource_url='https://osmo.example/mcp',
            scope=self.requested_scope,
            redis_url='redis://redis.example:6379/7',
            oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
            oidc_client_id='oidc-client',
            oidc_client_secret_file='/not-read-in-unit-test',
            oidc_access_token_jwks_url='https://sts.example/tenant/keys',
            oidc_access_token_issuer='https://sts.example/tenant/',
            oidc_access_token_audience='https://osmo.example/mcp',
            signing_jwks_file='/not-read-in-unit-test',
        )
        self.assertEqual(
            self.config.oidc_access_token_issuer,
            'https://sts.example/tenant/',
        )
        oidc_configuration = OIDCConfiguration(
            issuer='https://login.example/tenant/v2.0',
            authorization_endpoint='https://login.example/tenant/oauth2/v2.0/authorize',
            token_endpoint='https://login.example/tenant/oauth2/v2.0/token',
            jwks_uri='https://login.example/tenant/discovery/v2.0/keys',
            response_types_supported=['code'],
            subject_types_supported=['public'],
            id_token_signing_alg_values_supported=['RS256'],
        )
        self.upstream_http_client = httpx.AsyncClient()
        with mock.patch.object(
            OIDCProxy,
            'get_oidc_configuration',
            return_value=oidc_configuration,
        ):
            self.provider = server.OSMOOIDCProxy(
                config_url=self.config.oidc_config_url,
                client_id=self.config.oidc_client_id,
                client_secret='test-secret-that-is-not-used',
                requested_scope=self.config.scope,
                access_token_jwks_url=self.config.oidc_access_token_jwks_url,
                access_token_issuer=self.config.oidc_access_token_issuer,
                access_token_audience=self.config.oidc_access_token_audience,
                access_token_required_scope=(
                    self.config.oidc_access_token_required_scope
                ),
                http_client=self.upstream_http_client,
                base_url=self.config.issuer_url,
                resource_base_url=self.config.issuer_url,
                issuer_url=self.config.issuer_url,
                redirect_path='/auth/callback',
                allowed_client_redirect_uris=(
                    self.config.allowed_client_redirect_uris
                ),
                client_storage=MemoryStore(),
                jwt_signing_key=self.signing_key,
                token_endpoint_auth_method='client_secret_post',
                forward_resource=False,
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
        await self.upstream_http_client.aclose()

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
        self.assertEqual(metadata.json()['scopes_supported'], [self.requested_scope])
        self.assertTrue(
            metadata.json()['client_id_metadata_document_supported']
        )

        protected_resource = await self.client.get(
            '/.well-known/oauth-protected-resource/mcp'
        )
        self.assertEqual(protected_resource.status_code, 200, protected_resource.text)
        self.assertEqual(
            protected_resource.json(),
            {
                'resource': 'https://osmo.example/mcp',
                'authorization_servers': ['https://osmo.example/'],
                'scopes_supported': [self.requested_scope],
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
        self.assertIn(('/auth/callback', ('GET', 'HEAD')), route_methods)
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
        self.assertEqual(allowed.json()['scope'], self.requested_scope)

        rejected = await self.client.post(
            '/register',
            json={**payload, 'redirect_uris': ['https://evil.example/callback']},
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertEqual(rejected.json()['error'], 'invalid_redirect_uri')

    async def test_https_client_id_resolves_through_cimd_without_dcr(self) -> None:
        client_id = 'https://client.example/codex.json'
        cimd_document = CIMDDocument(
            client_id=client_id,
            client_name='Codex CIMD client',
            redirect_uris=['http://localhost:53682/oauth/callback'],
        )
        cimd_manager = self.provider._cimd_manager  # pylint: disable=protected-access
        self.assertIsNotNone(cimd_manager)
        if cimd_manager is None:
            self.fail('CIMD manager was not enabled')
        self.assertIsNone(
            await self.provider._client_store.get(key=client_id)  # pylint: disable=protected-access
        )
        fetch_document = mock.AsyncMock(return_value=cimd_document)

        with (
            mock.patch.object(
                cimd_manager._fetcher,  # pylint: disable=protected-access
                'fetch',
                new=fetch_document,
            ),
            mock.patch.object(
                self.provider,
                'register_client',
                new_callable=mock.AsyncMock,
            ) as register_client,
        ):
            resolved = await self.provider.get_client(client_id)

        fetch_document.assert_awaited_once_with(client_id)
        register_client.assert_not_awaited()
        self.assertIsNotNone(resolved)
        if not isinstance(resolved, ProxyDCRClient):
            self.fail('CIMD did not resolve to a FastMCP proxy client')
        self.assertEqual(resolved.client_id, client_id)
        self.assertEqual(resolved.scope, self.requested_scope)
        self.assertEqual(resolved.cimd_document, cimd_document)
        cached = await self.provider._client_store.get(key=client_id)  # pylint: disable=protected-access
        self.assertEqual(cached, resolved)

    def test_scope_translation_is_consistent_for_authorize_token_and_refresh(self) -> None:
        expected = [
            self.requested_scope,
            'openid',
            'profile',
            'email',
            'offline_access',
        ]
        self.assertEqual(
            self.provider._prepare_scopes_for_token_exchange([]),  # pylint: disable=protected-access
            expected,
        )
        self.assertEqual(
            self.provider._prepare_scopes_for_upstream_refresh(  # pylint: disable=protected-access
                [self.requested_scope]
            ),
            expected,
        )
        self.assertEqual(
            self.provider._translate_scopes_from_idp(  # pylint: disable=protected-access
                ['openid', 'profile', 'email']
            ),
            [self.requested_scope],
        )

        authorization_url = self.provider._build_upstream_authorize_url(  # pylint: disable=protected-access
            'transaction-id',
            {
                'scopes': [self.requested_scope],
                'resource': self.config.resource_url,
            },
        )
        query = httpx.QueryParams(httpx.URL(authorization_url).query)
        self.assertEqual(query['scope'].split(), expected)
        self.assertNotIn('resource', query)

    def test_access_token_verifier_enforces_osmo_api_contract(self) -> None:
        verifier = self.provider._access_token_validator  # pylint: disable=protected-access
        self.assertEqual(verifier.jwks_uri, self.config.oidc_access_token_jwks_url)
        self.assertEqual(verifier.issuer, self.config.oidc_access_token_issuer)
        self.assertEqual(verifier.audience, self.config.resource_url)
        self.assertEqual(
            verifier.required_scopes,
            [self.config.oidc_access_token_required_scope],
        )

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
            scopes=[self.requested_scope],
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
        self.assertEqual(claims['scope'], self.requested_scope)
        self.assertEqual(
            claims['upstream_claims'],
            {
                'preferred_username': 'user@example.com',
                'roles': ['osmo-user', 'pool-team'],
            },
        )

    async def test_refreshed_access_token_claims_use_access_verifier(self) -> None:
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
        self.provider._access_token_validator = verifier  # pylint: disable=protected-access
        id_token_verifier = mock.AsyncMock()
        self.provider._id_token_validator = id_token_verifier  # pylint: disable=protected-access

        claims = await self.provider._extract_upstream_claims(  # pylint: disable=protected-access
            {'access_token': 'signed-entra-token'}
        )

        verifier.verify_token.assert_awaited_once_with('signed-entra-token')
        id_token_verifier.verify_token.assert_not_awaited()
        self.assertEqual(
            claims,
            {
                'unique_name': 'user@example.com',
                'roles': ['osmo-user', 'pool-team'],
            },
        )

    async def test_initial_id_token_is_verified_separately(self) -> None:
        verifier = mock.AsyncMock()
        verifier.verify_token.return_value = AccessToken(
            token='signed-id-token',
            client_id='oidc-client',
            scopes=[],
        )
        self.provider._id_token_validator = verifier  # pylint: disable=protected-access

        await self.provider._validate_initial_id_token(  # pylint: disable=protected-access
            {'id_token': 'signed-id-token'}
        )

        verifier.verify_token.assert_awaited_once_with('signed-id-token')

    async def test_invalid_id_token_blocks_local_token_exchange(self) -> None:
        code = 'client-authorization-code'
        await self.provider._code_store.put(  # pylint: disable=protected-access
            key=code,
            value=ClientCode(
                code=code,
                client_id='dynamic-client',
                redirect_uri='http://localhost:53682/oauth/callback',
                code_challenge='challenge',
                code_challenge_method='S256',
                scopes=[self.requested_scope],
                idp_tokens={
                    'access_token': 'signed-access-token',
                    'id_token': 'invalid-id-token',
                },
                expires_at=time.time() + 60,
                created_at=time.time(),
            ),
            ttl=60,
        )
        client = ProxyDCRClient(
            client_id='dynamic-client',
            client_secret=None,
            redirect_uris=[AnyUrl('http://localhost:53682/oauth/callback')],
            grant_types=['authorization_code', 'refresh_token'],
            scope=self.requested_scope,
            token_endpoint_auth_method='none',
        )
        authorization_code = AuthorizationCode(
            code=code,
            client_id='dynamic-client',
            redirect_uri=AnyUrl('http://localhost:53682/oauth/callback'),
            redirect_uri_provided_explicitly=True,
            scopes=[self.requested_scope],
            expires_at=time.time() + 60,
            code_challenge='challenge',
        )
        id_token_verifier = mock.AsyncMock()
        id_token_verifier.verify_token.return_value = None
        self.provider._id_token_validator = id_token_verifier  # pylint: disable=protected-access

        with mock.patch.object(
            OIDCProxy,
            'exchange_authorization_code',
            new_callable=mock.AsyncMock,
        ) as issue_local_token:
            with self.assertRaises(TokenError) as raised:
                await self.provider.exchange_authorization_code(
                    client,
                    authorization_code,
                )

        self.assertEqual(raised.exception.error, 'invalid_grant')
        id_token_verifier.verify_token.assert_awaited_once_with('invalid-id-token')
        issue_local_token.assert_not_awaited()

    async def test_invalid_upstream_roles_are_rejected(self) -> None:
        verifier = mock.AsyncMock()
        verifier.verify_token.return_value = AccessToken(
            token='signed-entra-token',
            client_id='entra-client',
            scopes=['access_as_user'],
            claims={'roles': ['osmo-user,osmo-admin']},
        )
        self.provider._access_token_validator = verifier  # pylint: disable=protected-access

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
            scope='https://osmo.example/mcp/access_as_user',
            redis_url='rediss://redis.example:6379/7',
            oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
            oidc_client_id='oidc-client',
            oidc_client_secret_file='/secret',
            oidc_access_token_jwks_url='https://sts.example/tenant/keys',
            oidc_access_token_issuer='https://sts.example/tenant/',
            oidc_access_token_audience='https://osmo.example/mcp',
            signing_jwks_file='/signing-key',
        )
        self.assertEqual(
            broker_config.allowed_client_redirect_uris,
            ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'],
        )
        self.assertEqual(
            broker_config.oidc_access_token_issuer,
            'https://sts.example/tenant/',
        )

    def test_full_scope_must_match_resource_and_required_scope(self) -> None:
        with self.assertRaisesRegex(ValueError, 'scope must be resource_url'):
            config.OAuthBrokerConfig(
                issuer_url='https://osmo.example',
                resource_url='https://osmo.example/mcp',
                scope='https://osmo.example/mcp/different_scope',
                redis_url='rediss://redis.example:6379/7',
                oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
                oidc_client_id='oidc-client',
                oidc_client_secret_file='/secret',
                oidc_access_token_jwks_url='https://sts.example/tenant/keys',
                oidc_access_token_issuer='https://sts.example/tenant/',
                oidc_access_token_audience='https://osmo.example/mcp',
                signing_jwks_file='/signing-key',
            )

    def test_access_token_audience_rejects_multiple_values(self) -> None:
        with self.assertRaisesRegex(ValueError, 'one exact value'):
            config.OAuthBrokerConfig(
                issuer_url='https://osmo.example',
                resource_url='https://osmo.example/mcp',
                scope='https://osmo.example/mcp/access_as_user',
                redis_url='rediss://redis.example:6379/7',
                oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
                oidc_client_id='oidc-client',
                oidc_client_secret_file='/secret',
                oidc_access_token_jwks_url='https://sts.example/tenant/keys',
                oidc_access_token_issuer='https://sts.example/tenant/',
                oidc_access_token_audience='audience-one audience-two',
                signing_jwks_file='/signing-key',
            )

    def test_access_token_audience_must_match_resource(self) -> None:
        with self.assertRaisesRegex(ValueError, 'must match resource_url'):
            config.OAuthBrokerConfig(
                issuer_url='https://osmo.example',
                resource_url='https://osmo.example/mcp',
                scope='https://osmo.example/mcp/access_as_user',
                redis_url='rediss://redis.example:6379/7',
                oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
                oidc_client_id='oidc-client',
                oidc_client_secret_file='/secret',
                oidc_access_token_jwks_url='https://sts.example/tenant/keys',
                oidc_access_token_issuer='https://sts.example/tenant/',
                oidc_access_token_audience='https://different.example/mcp',
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
            scope='https://osmo.example/mcp/access_as_user',
            redis_url='rediss://redis.example:6379/7',
            oidc_config_url='https://login.example/tenant/.well-known/openid-configuration',
            oidc_client_id='oidc-client',
            oidc_client_secret_file='/secret',
            oidc_access_token_jwks_url='https://sts.example/tenant/keys',
            oidc_access_token_issuer='https://sts.example/tenant/',
            oidc_access_token_audience='https://osmo.example/mcp',
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
