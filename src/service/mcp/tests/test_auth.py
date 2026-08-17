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

import tempfile
import time
from typing import Any, cast
import unittest
from unittest import mock

from fastmcp.server.auth import AccessToken
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
from fastmcp.server.auth.oauth_proxy.models import UpstreamTokenSet
import httpx
from key_value.aio.stores.memory import MemoryStore
import pydantic

from src.service.mcp import auth, server


class MCPAuthConfigTest(unittest.TestCase):
    def test_auth_is_disabled_without_any_oidc_configuration(self) -> None:
        self.assertFalse(auth.MCPAuthConfig().auth_enabled)

    def test_enabled_auth_requires_complete_configuration(self) -> None:
        with self.assertRaisesRegex(
            pydantic.ValidationError,
            'Enabled MCP auth is missing',
        ):
            auth.MCPAuthConfig(auth_enabled=True)

    def test_enabled_auth_normalizes_and_validates_scope_contract(self) -> None:
        config = _config()
        self.assertEqual(config.issuer_url, 'https://osmo.example')
        self.assertEqual(
            config.allowed_client_redirect_uris,
            ['http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'],
        )
        with self.assertRaisesRegex(
            pydantic.ValidationError,
            'auth_scope must be',
        ):
            _config(auth_scope='https://osmo.example/mcp/wrong')

        service_config = server.MCPServiceConfig(
            gateway_url='https://gateway.example',
            **config.model_dump(),
        )
        self.assertTrue(service_config.auth_enabled)
        self.assertEqual(service_config.auth_scope, config.auth_scope)

    def test_auth_field_renames_preserve_environment_contract(self) -> None:
        self.assertEqual(
            auth.MCPAuthConfig.model_fields['auth_enabled'].json_schema_extra,
            {'env': 'OSMO_MCP_AUTH_ENABLED'},
        )
        self.assertEqual(
            auth.MCPAuthConfig.model_fields['auth_scope'].json_schema_extra,
            {'env': 'OSMO_MCP_AUTH_SCOPE'},
        )
        self.assertEqual(
            auth.MCPAuthConfig.model_fields[
                'osmo_jwt_required_role'
            ].json_schema_extra,
            {'env': 'OSMO_MCP_AUTH_OSMO_JWT_REQUIRED_ROLE'},
        )

    def test_trusted_osmo_jwt_requires_auth_jwks_and_role(self) -> None:
        with self.assertRaisesRegex(
            pydantic.ValidationError,
            'requires MCP auth',
        ):
            auth.MCPAuthConfig(osmo_jwt_enabled=True)
        with self.assertRaisesRegex(
            pydantic.ValidationError,
            'requires a JWKS URL and dedicated OSMO role name',
        ):
            _config(osmo_jwt_enabled=True)

        config = _config(
            osmo_jwt_enabled=True,
            osmo_jwt_jwks_url=(
                'http://osmo-service.default.svc.cluster.local/api/auth/keys/'
            ),
            osmo_jwt_required_role='osmo-nvaf-staging-task-list',
        )
        self.assertEqual(
            config.osmo_jwt_jwks_url,
            'http://osmo-service.default.svc.cluster.local/api/auth/keys',
        )


class MCPAuthRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def test_factory_uses_plain_oidc_proxy_and_split_scope_contract(self) -> None:
        with _secret_file('client-secret') as client_secret_file:
            config = _config(
                oidc_client_secret_file=client_secret_file,
            )
            redis_client = mock.create_autospec(
                auth.redis_asyncio.Redis,
                instance=True,
            )
            oidc_configuration = OIDCConfiguration(
                issuer='https://login.example/tenant/v2.0',
                authorization_endpoint=(
                    'https://login.example/tenant/oauth2/v2.0/authorize'
                ),
                token_endpoint=(
                    'https://login.example/tenant/oauth2/v2.0/token'
                ),
                jwks_uri='https://login.example/tenant/discovery/v2.0/keys',
                response_types_supported=['code'],
                subject_types_supported=['public'],
                id_token_signing_alg_values_supported=['RS256'],
            )
            with (
                mock.patch.object(
                    auth.redis_asyncio.Redis,
                    'from_url',
                    return_value=redis_client,
                ),
                mock.patch.object(auth, 'RedisStore', return_value=MemoryStore()),
                mock.patch.object(
                    auth,
                    'PrefixCollectionsWrapper',
                    side_effect=lambda key_value, prefix: key_value,
                ),
                mock.patch.object(
                    auth,
                    'FernetEncryptionWrapper',
                    side_effect=(
                        lambda key_value, fernet, raise_on_decryption_error:
                        key_value
                    ),
                ) as encryption_wrapper,
                mock.patch.object(
                    OIDCProxy,
                    'get_oidc_configuration',
                    return_value=oidc_configuration,
                ),
            ):
                runtime = auth.create_auth_runtime(config)

            try:
                provider = cast(OIDCProxy, runtime.provider)
                self.assertIs(type(provider), OIDCProxy)
                self.assertEqual(
                    provider._jwt_signing_key,  # pylint: disable=protected-access
                    auth.derive_jwt_key(
                        high_entropy_material='client-secret',
                        salt='fastmcp-jwt-signing-key',
                    ),
                )
                self.assertEqual(provider.required_scopes, ['access_as_user'])
                self.assertEqual(
                    provider._token_validator.required_scopes,  # pylint: disable=protected-access
                    ['access_as_user'],
                )
                registration = provider.client_registration_options
                self.assertIsNotNone(registration)
                assert registration is not None
                self.assertEqual(
                    registration.default_scopes,
                    ['https://osmo.example/mcp/access_as_user'],
                )
                expected_upstream_scope = (
                    'https://osmo.example/mcp/access_as_user '
                    'openid profile email offline_access'
                )
                self.assertEqual(
                    provider._extra_authorize_params['scope'],  # pylint: disable=protected-access
                    expected_upstream_scope,
                )
                # FastMCP supplies the stored full client scope itself during
                # code exchange and refresh. Supplying another `scope` here
                # would pass the keyword twice on its refresh path.
                self.assertEqual(provider._extra_token_params, {})  # pylint: disable=protected-access
                self.assertFalse(provider._forward_resource)  # pylint: disable=protected-access
                self.assertFalse(
                    encryption_wrapper.call_args.kwargs[
                        'raise_on_decryption_error'
                    ]
                )

                application = server.create_application(
                    server.create_mcp_server(provider)
                )
                route_paths = {
                    route.path
                    for route in application.routes
                    if hasattr(route, 'path')
                }
                self.assertIn('/authorize', route_paths)
                self.assertIn('/token', route_paths)
                self.assertIn('/register', route_paths)
                self.assertIn('/auth/callback', route_paths)
                self.assertIn(
                    '/.well-known/oauth-authorization-server',
                    route_paths,
                )
                async with (
                    application.router.lifespan_context(application),
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=application),
                        base_url='https://osmo.example',
                    ) as client,
                ):
                    metadata = await client.get(
                        '/.well-known/oauth-authorization-server'
                    )
                    protected = await client.get(
                        '/.well-known/oauth-protected-resource/mcp'
                    )
                self.assertEqual(metadata.status_code, 200, metadata.text)
                metadata_body = metadata.json()
                self.assertEqual(
                    metadata_body['scopes_supported'],
                    ['https://osmo.example/mcp/access_as_user'],
                )
                self.assertEqual(
                    metadata_body['registration_endpoint'],
                    'https://osmo.example/register',
                )
                self.assertTrue(
                    metadata_body['client_id_metadata_document_supported']
                )
                self.assertEqual(protected.status_code, 200, protected.text)
                self.assertEqual(
                    protected.json()['scopes_supported'],
                    ['https://osmo.example/mcp/access_as_user'],
                )
                self.assertEqual(
                    protected.json()['resource'],
                    'https://osmo.example/mcp',
                )

                captured_refresh: dict[str, object] = {}

                class FakeOAuthClient:
                    async def refresh_token(
                        self,
                        **kwargs: object,
                    ) -> dict[str, object]:
                        captured_refresh.update(kwargs)
                        return {
                            'access_token': 'refreshed-entra-token',
                            'expires_in': 3600,
                            'scope': (
                                'https://osmo.example/mcp/access_as_user'
                            ),
                        }

                class FakeOAuthContext:
                    async def __aenter__(self) -> FakeOAuthClient:
                        return FakeOAuthClient()

                    async def __aexit__(self, *args: object) -> None:
                        del args

                token_set = UpstreamTokenSet(
                    upstream_token_id='upstream-token-id',
                    access_token='expired-entra-token',
                    refresh_token='entra-refresh-token',
                    refresh_token_expires_at=time.time() + 3600,
                    expires_at=time.time() - 1,
                    token_type='Bearer',
                    scope='https://osmo.example/mcp/access_as_user',
                    client_id='codex-client',
                    created_at=time.time(),
                )
                with mock.patch.object(
                    provider,
                    '_upstream_oauth_client',
                    new=lambda: FakeOAuthContext(),
                ):
                    refreshed = await provider._try_transparent_refresh(  # pylint: disable=protected-access
                        token_set
                    )
                self.assertEqual(
                    captured_refresh['scope'],
                    'https://osmo.example/mcp/access_as_user',
                )
                self.assertEqual(
                    captured_refresh['refresh_token'],
                    'entra-refresh-token',
                )
                self.assertEqual(
                    refreshed.access_token,
                    'refreshed-entra-token',
                )
            finally:
                await runtime.aclose()
            redis_client.aclose.assert_awaited_once()

    async def test_close_releases_redis_when_http_close_fails(self) -> None:
        provider = mock.create_autospec(OIDCProxy, instance=True)
        redis_client = mock.create_autospec(
            auth.redis_asyncio.Redis,
            instance=True,
        )
        http_client = mock.create_autospec(httpx.AsyncClient, instance=True)
        http_client.aclose.side_effect = RuntimeError('HTTP close failed')
        runtime = auth.MCPAuthRuntime(provider, redis_client, http_client)

        with self.assertRaisesRegex(RuntimeError, 'HTTP close failed'):
            await runtime.aclose()

        http_client.aclose.assert_awaited_once_with()
        redis_client.aclose.assert_awaited_once_with()

    async def test_factory_adds_dedicated_osmo_jwt_verifier(self) -> None:
        with _secret_file('client-secret') as client_secret_file:
            config = _config(
                oidc_client_secret_file=client_secret_file,
                osmo_jwt_enabled=True,
                osmo_jwt_jwks_url=(
                    'http://osmo-service.default.svc.cluster.local/'
                    'api/auth/keys'
                ),
                osmo_jwt_required_role='osmo-nvaf-staging-task-list',
            )
            redis_client = mock.create_autospec(
                auth.redis_asyncio.Redis,
                instance=True,
            )
            oidc_proxy = mock.create_autospec(OIDCProxy, instance=True)
            with (
                mock.patch.object(
                    auth.redis_asyncio.Redis,
                    'from_url',
                    return_value=redis_client,
                ),
                mock.patch.object(auth, 'RedisStore', return_value=MemoryStore()),
                mock.patch.object(
                    auth,
                    'PrefixCollectionsWrapper',
                    side_effect=lambda key_value, prefix: key_value,
                ),
                mock.patch.object(
                    auth,
                    'FernetEncryptionWrapper',
                    side_effect=(
                        lambda key_value, fernet, raise_on_decryption_error:
                        key_value
                    ),
                ),
                mock.patch.object(auth, 'OIDCProxy', return_value=oidc_proxy),
            ):
                runtime = auth.create_auth_runtime(config)

            try:
                provider = cast(
                    auth.OIDCProxyWithOSMOJWTVerifier,
                    runtime.provider,
                )
                self.assertIsInstance(
                    provider,
                    auth.OIDCProxyWithOSMOJWTVerifier,
                )
                osmo_verifier = cast(
                    auth.OSMOJWTVerifier,
                    provider._osmo_jwt_verifier,  # pylint: disable=protected-access
                )
                self.assertEqual(
                    osmo_verifier._jwks_uri,  # pylint: disable=protected-access
                    'http://osmo-service.default.svc.cluster.local/'
                    'api/auth/keys',
                )
                self.assertEqual(
                    provider._required_role,  # pylint: disable=protected-access
                    'osmo-nvaf-staging-task-list',
                )
            finally:
                await runtime.aclose()

    async def test_osmo_jwt_verifier_accepts_a_jwks_key_without_a_kid(self) -> None:
        class Claims(dict):
            def validate(self) -> None:
                return None

        claims = Claims({
            'iss': 'osmo-production',
            'aud': 'osmo-production',
            'roles': ['osmo-admin'],
            'unique_name': 'nvaf-osmo-mcp',
        })
        response = mock.Mock()
        response.json.return_value = {'keys': [{'kty': 'RSA', 'kid': 'current'}]}
        http_client = mock.create_autospec(httpx.AsyncClient, instance=True)
        http_client.get = mock.AsyncMock(return_value=response)
        jwt_codec = mock.Mock()
        jwt_codec.decode.return_value = claims
        with (
            mock.patch.object(auth, 'JsonWebToken', return_value=jwt_codec),
            mock.patch.object(auth.JsonWebKey, 'import_key', return_value=mock.sentinel.key),
        ):
            verifier = auth.OSMOJWTVerifier(
                'https://osmo.example/api/auth/keys',
                'osmo-production',
                'osmo-production',
                http_client,
            )
            verified = await verifier.verify_token('osmo.jwt.without.kid')

        self.assertIsNotNone(verified)
        assert verified is not None
        self.assertEqual(verified.client_id, 'nvaf-osmo-mcp')
        self.assertEqual(verified.claims['roles'], ['osmo-admin'])
        jwt_codec.decode.assert_called_once()

    async def test_osmo_jwt_requires_the_dedicated_role_name(self) -> None:
        oidc_proxy = mock.create_autospec(OIDCProxy, instance=True)
        oidc_proxy.verify_token = mock.AsyncMock(return_value=None)
        osmo_jwt_verifier = mock.create_autospec(
            auth.JWTVerifier,
            instance=True,
        )
        provider = auth.OIDCProxyWithOSMOJWTVerifier(
            oidc_proxy,
            osmo_jwt_verifier,
            'osmo-nvaf-staging-task-list',
        )

        osmo_jwt_verifier.verify_token = mock.AsyncMock(
            return_value=AccessToken(
                token='osmo.jwt.admin',
                client_id='current-adapter-identity',
                scopes=[],
                claims={'roles': ['osmo-admin']},
            ),
        )
        self.assertIsNone(await provider.verify_token('osmo.jwt.admin'))

        allowed = AccessToken(
            token='osmo.jwt.reader',
            client_id='dedicated-adapter-identity',
            scopes=[],
            claims={'roles': ['osmo-nvaf-staging-task-list']},
        )
        osmo_jwt_verifier.verify_token.return_value = allowed
        self.assertIs(
            await provider.verify_token('osmo.jwt.reader'),
            allowed,
        )

    async def test_oidc_proxy_token_does_not_use_osmo_fallback(self) -> None:
        oidc_proxy = mock.create_autospec(OIDCProxy, instance=True)
        oidc_token = AccessToken(
            token='fastmcp.oidc.token',
            client_id='native-client',
            scopes=[],
            claims={'upstream_claims': {'preferred_username': 'alice'}},
        )
        oidc_proxy.verify_token = mock.AsyncMock(return_value=oidc_token)
        osmo_jwt_verifier = mock.create_autospec(
            auth.JWTVerifier,
            instance=True,
        )
        provider = auth.OIDCProxyWithOSMOJWTVerifier(
            oidc_proxy,
            osmo_jwt_verifier,
            'osmo-nvaf-staging-task-list',
        )

        self.assertIs(await provider.verify_token('fastmcp.oidc.token'), oidc_token)
        osmo_jwt_verifier.verify_token.assert_not_awaited()

    def test_storage_key_matches_fastmcp_default_and_is_deterministic(self) -> None:
        first = auth._storage_encryption_key(  # pylint: disable=protected-access
            'client-secret',
        )
        second = auth._storage_encryption_key(  # pylint: disable=protected-access
            'client-secret',
        )
        different = auth._storage_encryption_key(  # pylint: disable=protected-access
            'rotated-client-secret',
        )
        signing_key = auth.derive_jwt_key(
            high_entropy_material='client-secret',
            salt='fastmcp-jwt-signing-key',
        )
        expected = auth.derive_jwt_key(
            high_entropy_material=signing_key.decode('ascii'),
            salt='fastmcp-storage-encryption-key',
        )

        self.assertEqual(first, expected)
        self.assertEqual(first, second)
        self.assertNotEqual(first, different)


def _config(**overrides: object) -> auth.MCPAuthConfig:
    values: dict[str, object] = {
        'auth_enabled': True,
        'issuer_url': 'https://osmo.example/',
        'resource_url': 'https://osmo.example/mcp',
        'auth_scope': 'https://osmo.example/mcp/access_as_user',
        'redis_url': 'rediss://redis.example:6379/7',
        'oidc_config_url': (
            'https://login.example/tenant/.well-known/openid-configuration'
        ),
        'oidc_client_id': 'oidc-client',
        'oidc_client_secret_file': '/secret',
        'oidc_access_token_jwks_url': 'https://sts.example/tenant/keys',
        'oidc_access_token_issuer': 'https://sts.example/tenant/',
        'oidc_access_token_audience': 'https://osmo.example/mcp',
    }
    values.update(overrides)
    return auth.MCPAuthConfig(**values)


class _TemporaryFile:
    """Keep a named temporary text file open for one test context."""

    def __init__(self, content: str) -> None:
        self._content = content
        self._file: Any = None

    def __enter__(self) -> str:
        self._file = tempfile.NamedTemporaryFile(
            mode='w+',
            encoding='utf-8',
        )
        self._file.write(self._content)
        self._file.flush()
        return self._file.name

    def __exit__(self, *args: object) -> None:
        assert self._file is not None
        self._file.close()


def _secret_file(content: str) -> _TemporaryFile:
    return _TemporaryFile(content)


if __name__ == '__main__':
    unittest.main()
