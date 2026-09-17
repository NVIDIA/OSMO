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
import hashlib
import tempfile
import time
from typing import Any
import unittest
from unittest import mock

from fastmcp.server.auth.jwt_issuer import derive_jwt_key
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
from fastmcp.server.auth.providers.jwt import JWTVerifier, RSAKeyPair
from fastmcp.server.auth.oauth_proxy.models import (
    JTIMapping, RefreshTokenMetadata, UpstreamTokenSet,
)
import httpx
from key_value.aio.stores.memory import MemoryStore
import pydantic

from src.service.mcp import auth, server

# Long enough to satisfy the client-secret entropy check; identity
# providers issue secrets of this order.
_TEST_CLIENT_SECRET = 'client-secret-0123456789abcdef0123456789'


class MCPAuthConfigTest(unittest.TestCase):
    def test_authentication_is_not_optional(self) -> None:
        """There is one authentication mode, so its configuration is required."""
        with self.assertRaises(pydantic.ValidationError) as caught:
            auth.MCPAuthConfig()  # type: ignore[call-arg]

        required = {error['loc'][0] for error in caught.exception.errors()}
        self.assertEqual(
            required,
            {
                'resource_url',
                'redis_url',
                'oidc_config_url',
                'oidc_client_id',
                'oidc_client_secret_file',
            },
        )
        self.assertNotIn('auth_enabled', auth.MCPAuthConfig.model_fields)

    def test_dependent_urls_derive_from_the_resource_url(self) -> None:
        """Only the resource URL is supplied; the rest follow from it."""
        self.assertEqual(
            _config().auth_scope, 'https://osmo.example/mcp/access_as_user')

    def test_enabled_auth_normalizes_and_validates_scope_contract(self) -> None:
        config = _config()
        self.assertEqual(
            auth.LOOPBACK_REDIRECT_URIS,
            ('http://localhost:*', 'http://127.0.0.1:*', 'http://[::1]:*'),
        )
        with self.assertRaisesRegex(
            pydantic.ValidationError,
            'resource_url must end with /mcp',
        ):
            _config(resource_url='https://osmo.example/not-mcp')

        service_config = server.MCPServiceConfig(
            gateway_url='https://gateway.example',
            **config.model_dump(),
        )
        self.assertEqual(service_config.auth_scope, config.auth_scope)

    def test_auth_field_renames_preserve_environment_contract(self) -> None:
        self.assertEqual(
            auth.MCPAuthConfig.model_fields['resource_url'].json_schema_extra,
            {'env': 'OSMO_MCP_AUTH_RESOURCE_URL'},
        )
        # The derived values are no longer configuration inputs.
        for derived in (
            'issuer_url', 'auth_scope', 'oidc_access_token_audience',
        ):
            self.assertNotIn(derived, auth.MCPAuthConfig.model_fields)

    def test_embedded_dex_allows_only_loopback_public_http(self) -> None:
        for origin in ('http://127.0.0.1:30080', 'http://localhost', 'http://[::1]'):
            with self.subTest(origin=origin):
                config = _dex_config(resource_url=f'{origin}/mcp')
                self.assertEqual(config.auth_scope, 'openid')
        for resource_url in (
            'http://osmo.example/mcp',
            'http://127.0.0.1.example/mcp',
            'http://127.0.0.1@osmo.example/mcp',
            'http://127.0.0.1/mcp?next=example',
        ):
            with self.subTest(resource_url=resource_url):
                with self.assertRaises(pydantic.ValidationError):
                    _dex_config(resource_url=resource_url)

    def test_external_oidc_keeps_https_transport_requirement(self) -> None:
        for field, value in (
            ('resource_url', 'http://127.0.0.1/mcp'),
            ('oidc_config_url', 'http://osmo-dex:5556/dex/.well-known/openid-configuration'),
        ):
            with self.subTest(field=field):
                with self.assertRaises(pydantic.ValidationError):
                    _config(**{field: value})


class MCPAuthRuntimeTest(unittest.IsolatedAsyncioTestCase):
    async def test_readiness_failure_and_recovery(self) -> None:
        client = mock.AsyncMock()
        runtime = auth.MCPAuthRuntime(provider=mock.Mock(), redis_client=client)
        for failure in (
            auth.RedisError('sensitive connection details'),
            OSError('certificate failure'),
            TimeoutError(),
        ):
            with self.subTest(failure=type(failure).__name__):
                client.ping.side_effect = failure
                self.assertFalse(await runtime.is_ready())
                client.ping.side_effect = None
                client.ping.return_value = True
                self.assertTrue(await runtime.is_ready())
        client.ping.return_value = False
        self.assertFalse(await runtime.is_ready())

    async def test_readiness_deadline_cancels_stalled_ping(self) -> None:
        cancelled = asyncio.Event()

        async def stalled_ping() -> bool:
            try:
                await asyncio.Future()
            finally:
                cancelled.set()
            return True

        client = mock.AsyncMock()
        client.ping.side_effect = stalled_ping
        runtime = auth.MCPAuthRuntime(provider=mock.Mock(), redis_client=client)
        self.assertFalse(await asyncio.wait_for(runtime.is_ready(), timeout=3))
        self.assertTrue(cancelled.is_set())

    async def test_readiness_preserves_caller_cancellation(self) -> None:
        entered = asyncio.Event()

        async def stalled_ping() -> bool:
            entered.set()
            await asyncio.Future()
            return True

        client = mock.AsyncMock()
        client.ping.side_effect = stalled_ping
        runtime = auth.MCPAuthRuntime(provider=mock.Mock(), redis_client=client)
        task = asyncio.create_task(runtime.is_ready())
        await asyncio.wait_for(entered.wait(), timeout=1)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_issuer_falls_back_to_the_discovery_document(self) -> None:
        """An unset access-token issuer uses the issuer discovery advertises.

        Only an Entra v1 resource application needs it configured, so a
        deployment whose discovery issuer is the real one supplies nothing.
        """
        with _secret_file(_TEST_CLIENT_SECRET) as client_secret_file:
            config = _config(
                oidc_client_secret_file=client_secret_file,
                oidc_access_token_issuer=None,
            )
            redis_client = mock.AsyncMock()
            oidc_configuration = OIDCConfiguration(
                issuer='https://login.example/tenant/v2.0',
                authorization_endpoint=(
                    'https://login.example/tenant/oauth2/v2.0/authorize'
                ),
                token_endpoint='https://login.example/tenant/oauth2/v2.0/token',
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
                ),
                mock.patch.object(
                    OIDCProxy,
                    'get_oidc_configuration',
                    return_value=oidc_configuration,
                ),
            ):
                runtime = auth.create_auth_runtime(config)
                verifier = runtime.provider._token_validator  # pylint: disable=protected-access
                assert isinstance(verifier, JWTVerifier)
                self.assertEqual(
                    verifier.issuer,
                    'https://login.example/tenant/v2.0',
                )

    async def test_factory_uses_plain_oidc_proxy_and_split_scope_contract(self) -> None:
        with _secret_file(_TEST_CLIENT_SECRET) as client_secret_file:
            config = _config(
                oidc_client_secret_file=client_secret_file,
            )
            redis_client = mock.AsyncMock()
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
                provider = runtime.provider
                # The subclass exists only to keep the configured access-token
                # issuer; everything else is stock OIDCProxy behaviour.
                self.assertIsInstance(provider, OIDCProxy)
                self.assertEqual(
                    provider._jwt_signing_key,  # pylint: disable=protected-access
                    derive_jwt_key(
                        high_entropy_material=_TEST_CLIENT_SECRET,
                        salt='fastmcp-jwt-signing-key',
                    ),
                )
                # The JWKS URI comes from the discovery document; only the
                # access-token issuer, which no discovery document can supply
                # for an Entra v1 resource app, stays configured.
                verifier = provider._token_validator  # pylint: disable=protected-access
                assert isinstance(verifier, JWTVerifier)
                self.assertEqual(
                    verifier.jwks_uri,
                    'https://login.example/tenant/discovery/v2.0/keys',
                )
                self.assertEqual(verifier.issuer, 'https://sts.example/tenant/')
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
                # The MCP SDK registers OAuth handlers at fixed root paths
                # (mcp/server/auth/routes.py) regardless of base_url, so the
                # in-process paths stay at the root. The gateway publishes them
                # under /mcp and rewrites the prefix back off; the advertised
                # metadata below is the contract clients actually follow.
                self.assertIn('/authorize', route_paths)
                self.assertIn('/token', route_paths)
                self.assertIn('/register', route_paths)
                self.assertIn('/auth/callback', route_paths)
                self.assertIn(
                    '/.well-known/oauth-authorization-server',
                    route_paths,
                )
                expected_methods = {
                    '/authorize': {'GET', 'HEAD', 'POST'},
                    '/consent': {'GET', 'HEAD', 'POST'},
                    '/auth/callback': {'GET', 'HEAD'},
                    '/token': {'POST', 'OPTIONS'},
                    '/register': {'POST', 'OPTIONS'},
                    '/.well-known/oauth-authorization-server': {'GET', 'HEAD', 'OPTIONS'},
                    '/.well-known/oauth-protected-resource/mcp': {'GET', 'HEAD', 'OPTIONS'},
                }
                actual_methods = {
                    route.path: set(route.methods)
                    for route in application.routes
                    if hasattr(route, 'path') and hasattr(route, 'methods')
                    and route.path in expected_methods
                }
                self.assertEqual(actual_methods, expected_methods)
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
                    metadata_body['issuer'],
                    'https://osmo.example/mcp',
                )
                self.assertEqual(
                    metadata_body['authorization_endpoint'],
                    'https://osmo.example/mcp/authorize',
                )
                self.assertEqual(
                    metadata_body['token_endpoint'],
                    'https://osmo.example/mcp/token',
                )
                self.assertEqual(
                    metadata_body['registration_endpoint'],
                    'https://osmo.example/mcp/register',
                )
                self.assertTrue(
                    metadata_body['client_id_metadata_document_supported']
                )
                self.assertEqual(protected.status_code, 200, protected.text)
                self.assertEqual(
                    protected.json()['scopes_supported'],
                    ['https://osmo.example/mcp/access_as_user'],
                )
                # resource_base_url keeps the RFC 9728 identity at /mcp even
                # though base_url moved there too; without it the advertised
                # resource would become /mcp/mcp.
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

    async def test_embedded_dex_uses_internal_endpoints_and_public_identity(self) -> None:
        async with _dex_runtime() as runtime:
            provider = runtime.provider
            verifier = provider._token_validator  # pylint: disable=protected-access
            assert isinstance(verifier, JWTVerifier)
            self.assertEqual(verifier.issuer, 'http://127.0.0.1:30080/dex')
            self.assertEqual(verifier.audience, 'osmo-mcp')
            self.assertEqual(verifier.jwks_uri, 'http://osmo-dex:5556/dex/keys')
            self.assertEqual(verifier.required_scopes, [])
            self.assertEqual(
                provider._upstream_authorization_endpoint,  # pylint: disable=protected-access
                'http://127.0.0.1:30080/dex/auth',
            )
            self.assertEqual(
                provider._upstream_token_endpoint,  # pylint: disable=protected-access
                'http://osmo-dex:5556/dex/token',
            )
            self.assertEqual(
                provider._extra_authorize_params,  # pylint: disable=protected-access
                {'scope': 'openid profile email offline_access'},
            )
            application = server.create_application(server.create_mcp_server(provider))
            async with (
                application.router.lifespan_context(application),
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://127.0.0.1:30080',
                ) as client,
            ):
                metadata = (await client.get(
                    '/.well-known/oauth-authorization-server',
                )).json()
                resource = (await client.get(
                    '/.well-known/oauth-protected-resource/mcp',
                )).json()
            self.assertEqual(metadata['issuer'], 'http://127.0.0.1:30080/mcp')
            self.assertEqual(metadata['scopes_supported'], ['openid'])
            self.assertEqual(
                metadata['authorization_endpoint'], 'http://127.0.0.1:30080/mcp/authorize',
            )
            self.assertEqual(resource['resource'], 'http://127.0.0.1:30080/mcp')

    async def test_embedded_dex_rejects_discovery_for_another_issuer(self) -> None:
        configuration = _dex_discovery()
        configuration.issuer = 'https://another.example/dex'
        with self.assertRaisesRegex(ValueError, 'does not match its public issuer'):
            async with _dex_runtime(configuration=configuration):
                self.fail('incorrect issuer must fail startup')

    async def test_embedded_dex_relays_only_valid_signed_id_tokens(self) -> None:
        keys = RSAKeyPair.generate()
        async with _dex_runtime() as runtime:
            provider = runtime.provider
            verifier = provider._token_validator  # pylint: disable=protected-access
            with mock.patch.object(
                verifier, '_get_verification_key',
                new=mock.AsyncMock(return_value=keys.public_key),
            ):
                for name, options, expected in (
                    ('valid', {}, True),
                    ('wrong issuer', {'issuer': 'https://another.example/dex'}, False),
                    ('wrong audience', {'audience': 'osmo-browser'}, False),
                    ('expired', {'expires_in_seconds': -10}, False),
                ):
                    with self.subTest(name=name):
                        claims: dict[str, Any] = {
                            'issuer': 'http://127.0.0.1:30080/dex',
                            'audience': 'osmo-mcp',
                            'additional_claims': {'name': 'admin'},
                            **options,
                        }
                        identity_token = keys.create_token(**claims)
                        token_set = _dex_token_set(identity_token)
                        bearer = await _store_dex_session(provider, token_set)
                        access = await provider.load_access_token(bearer)
                        if expected:
                            self.assertIsNotNone(access)
                            assert access is not None
                            self.assertEqual(access.token, identity_token)
                            assert access.claims is not None
                            self.assertEqual(access.claims['name'], 'admin')
                            self.assertEqual(access.scopes, [])
                        else:
                            self.assertIsNone(access)
                # A valid Dex token is insufficient without the MCP resource
                # token and its server-side session mapping.
                valid_identity_token = keys.create_token(
                    issuer='http://127.0.0.1:30080/dex', audience='osmo-mcp',
                )
                self.assertIsNone(await provider.load_access_token(valid_identity_token))
                wrong_signature = RSAKeyPair.generate().create_token(
                    issuer='http://127.0.0.1:30080/dex', audience='osmo-mcp',
                )
                bearer = await _store_dex_session(provider, _dex_token_set(wrong_signature))
                self.assertIsNone(await provider.load_access_token(bearer))
                missing_identity = _dex_token_set(None)
                bearer = await _store_dex_session(provider, missing_identity)
                self.assertIsNone(await provider.load_access_token(bearer))

    async def test_embedded_dex_authenticates_mcp_initialization(self) -> None:
        keys = RSAKeyPair.generate()
        identity_token = keys.create_token(
            issuer='http://127.0.0.1:30080/dex', audience='osmo-mcp',
        )
        async with _dex_runtime() as runtime:
            provider = runtime.provider
            bearer = await _store_dex_session(provider, _dex_token_set(identity_token))
            application = server.create_application(server.create_mcp_server(provider))
            with mock.patch.object(
                provider._token_validator,  # pylint: disable=protected-access
                '_get_verification_key',
                new=mock.AsyncMock(return_value=keys.public_key),
            ):
                async with (
                    application.router.lifespan_context(application),
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=application),
                        base_url='http://127.0.0.1:30080',
                    ) as client,
                ):
                    for token, expected_status in ((bearer, 200), (identity_token, 401)):
                        response = await client.post(
                            '/mcp',
                            headers={
                                'Authorization': f'Bearer {token}',
                                'Accept': 'application/json, text/event-stream',
                            },
                            json={
                                'jsonrpc': '2.0',
                                'id': 1,
                                'method': 'initialize',
                                'params': {
                                    'protocolVersion': '2025-11-25',
                                    'capabilities': {},
                                    'clientInfo': {'name': 'dex-test', 'version': '1'},
                                },
                            },
                        )
                        self.assertEqual(response.status_code, expected_status, response.text)

    async def test_embedded_dex_refresh_relays_the_new_id_token(self) -> None:
        keys = RSAKeyPair.generate()
        async with _dex_runtime() as runtime:
            provider = runtime.provider
            refreshed_identity = keys.create_token(
                issuer='http://127.0.0.1:30080/dex',
                audience='osmo-mcp',
                additional_claims={'name': 'admin'},
            )
            expired_identity = keys.create_token(
                issuer='http://127.0.0.1:30080/dex',
                audience='osmo-mcp',
                expires_in_seconds=-10,
            )
            token_set = _dex_token_set(expired_identity)
            token_set.scope = 'openid'
            token_set.expires_at = time.time() - 1
            token_set.refresh_token = 'dex-refresh-token'
            token_set.refresh_token_expires_at = time.time() + 3600
            bearer = await _store_dex_session(provider, token_set)
            oauth_client = mock.AsyncMock()
            oauth_client.refresh_token.return_value = {
                'access_token': 'refreshed-opaque-dex-access-token',
                'id_token': refreshed_identity,
                'expires_in': 3600,
                'scope': 'openid profile email offline_access',
            }
            oauth_context = mock.MagicMock()
            oauth_context.__aenter__.return_value = oauth_client
            with (
                mock.patch.object(
                    provider._token_validator,  # pylint: disable=protected-access
                    '_get_verification_key',
                    new=mock.AsyncMock(return_value=keys.public_key),
                ),
                mock.patch.object(
                    provider, '_upstream_oauth_client', return_value=oauth_context,
                ),
            ):
                access = await provider.load_access_token(bearer)
            self.assertIsNotNone(access)
            assert access is not None
            self.assertEqual(access.token, refreshed_identity)
            self.assertEqual(
                oauth_client.refresh_token.call_args.kwargs['url'],
                'http://osmo-dex:5556/dex/token',
            )
            self.assertEqual(
                oauth_client.refresh_token.call_args.kwargs['scope'],
                'openid profile email offline_access',
            )

    async def test_embedded_dex_explicit_refresh_preserves_identity_claims(self) -> None:
        keys = RSAKeyPair.generate()
        async with _dex_runtime() as runtime:
            provider = runtime.provider
            application = server.create_application(server.create_mcp_server(provider))

            async def dex_refresh(**parameters: object) -> dict[str, object]:
                granted_scopes = str(parameters.get('scope', '')).split()
                # Dex includes identity claims only when their OIDC scopes
                # remain in the refresh request, and omits scope in the response.
                claims = {}
                if 'profile' in granted_scopes:
                    claims['name'] = 'admin'
                if 'email' in granted_scopes:
                    claims['email'] = 'admin@osmo.local'
                return {
                    'access_token': 'opaque-refreshed-dex-token',
                    'id_token': keys.create_token(
                        issuer='http://127.0.0.1:30080/dex',
                        audience='osmo-mcp', additional_claims=claims,
                    ),
                    'expires_in': 3600,
                }

            oauth_client = mock.AsyncMock()
            oauth_client.refresh_token.side_effect = dex_refresh
            oauth_context = mock.MagicMock()
            oauth_context.__aenter__.return_value = oauth_client
            with (
                mock.patch.object(
                    provider._token_validator,  # pylint: disable=protected-access
                    '_get_verification_key',
                    new=mock.AsyncMock(return_value=keys.public_key),
                ),
                mock.patch.object(
                    provider, '_upstream_oauth_client', return_value=oauth_context,
                ),
            ):
                async with (
                    application.router.lifespan_context(application),
                    httpx.AsyncClient(
                        transport=httpx.ASGITransport(app=application),
                        base_url='http://127.0.0.1:30080',
                    ) as client,
                ):
                    registered = await client.post('/register', json={
                        'redirect_uris': ['http://127.0.0.1:33749/callback'],
                        'grant_types': ['authorization_code', 'refresh_token'],
                        'response_types': ['code'],
                        'token_endpoint_auth_method': 'none',
                    })
                    self.assertEqual(registered.status_code, 201, registered.text)
                    client_id = registered.json()['client_id']
                    refresh_token = await _store_dex_refresh_session(provider, client_id)
                    response = await client.post('/token', data={
                        'grant_type': 'refresh_token',
                        'refresh_token': refresh_token,
                        'client_id': client_id,
                    })
                    self.assertEqual(response.status_code, 200, response.text)
                    self.assertEqual(response.json()['scope'], 'openid')
                    access = await provider.load_access_token(response.json()['access_token'])
            self.assertIsNotNone(access)
            assert access is not None and access.claims is not None
            self.assertEqual(access.claims.get('name'), 'admin')
            self.assertEqual(access.claims.get('email'), 'admin@osmo.local')
            self.assertNotEqual(access.token, 'opaque-refreshed-dex-token')
            self.assertEqual(
                oauth_client.refresh_token.call_args.kwargs['scope'],
                'openid profile email offline_access',
            )

    def test_short_client_secret_fails_at_startup(self) -> None:
        """The derived keys are only as strong as the secret behind them."""
        with _secret_file('too-short') as client_secret_file:
            config = _config(oidc_client_secret_file=client_secret_file)
            with self.assertRaises(ValueError) as caught:
                auth.create_auth_runtime(config)
        self.assertIn('at least 32 characters', str(caught.exception))

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
        signing_key = derive_jwt_key(
            high_entropy_material='client-secret',
            salt='fastmcp-jwt-signing-key',
        )
        expected = derive_jwt_key(
            high_entropy_material=signing_key.decode('ascii'),
            salt='fastmcp-storage-encryption-key',
        )

        self.assertEqual(first, expected)
        self.assertEqual(first, second)
        self.assertNotEqual(first, different)


def _config(**overrides: object) -> auth.MCPAuthConfig:
    values: dict[str, object] = {
        'resource_url': 'https://osmo.example/mcp',
        'redis_url': 'rediss://redis.example:6379/7',
        'oidc_config_url': (
            'https://login.example/tenant/.well-known/openid-configuration'
        ),
        'oidc_client_id': 'oidc-client',
        'oidc_client_secret_file': '/secret',
        'oidc_access_token_issuer': 'https://sts.example/tenant/',
    }
    values.update(overrides)
    return auth.MCPAuthConfig(**values)


def _dex_config(**overrides: object) -> auth.MCPAuthConfig:
    return _config(**{
        'oidc_provider': 'embeddedDex',
        'resource_url': 'http://127.0.0.1:30080/mcp',
        'oidc_config_url': 'http://osmo-dex:5556/dex/.well-known/openid-configuration',
        'oidc_client_id': 'osmo-mcp',
        'oidc_access_token_issuer': None,
        **overrides,
    })


def _dex_discovery() -> OIDCConfiguration:
    issuer = 'http://127.0.0.1:30080/dex'
    return OIDCConfiguration(
        issuer=issuer,
        authorization_endpoint=f'{issuer}/auth',
        token_endpoint=f'{issuer}/token',
        jwks_uri=f'{issuer}/keys',
        response_types_supported=['code'],
        subject_types_supported=['public'],
        id_token_signing_alg_values_supported=['RS256'],
    )


@contextlib.asynccontextmanager
async def _dex_runtime(
    *,
    configuration: OIDCConfiguration | None = None,
) -> AsyncIterator[auth.MCPAuthRuntime]:
    with (
        _secret_file(_TEST_CLIENT_SECRET) as secret_file,
        mock.patch.object(auth.redis_asyncio.Redis, 'from_url', return_value=mock.AsyncMock()),
        mock.patch.object(auth, 'RedisStore', return_value=MemoryStore()),
        mock.patch.object(
            auth, 'PrefixCollectionsWrapper', side_effect=lambda key_value, prefix: key_value,
        ),
        mock.patch.object(
            auth, 'FernetEncryptionWrapper',
            side_effect=lambda key_value, **kwargs: key_value,
        ),
        mock.patch.object(
            OIDCProxy, 'get_oidc_configuration',
            return_value=configuration or _dex_discovery(),
        ),
    ):
        runtime = auth.create_auth_runtime(_dex_config(oidc_client_secret_file=secret_file))
        runtime.provider.get_routes('/mcp')
        try:
            yield runtime
        finally:
            await runtime.aclose()


def _dex_token_set(identity_token: str | None) -> UpstreamTokenSet:
    return UpstreamTokenSet(
        upstream_token_id='dex-session',
        access_token='opaque-dex-access-token',
        refresh_token=None,
        refresh_token_expires_at=None,
        expires_at=time.time() + 3600,
        token_type='Bearer',
        scope='openid profile email offline_access',
        client_id='mcp-client',
        created_at=time.time(),
        raw_token_data={'id_token': identity_token} if identity_token else {},
    )


async def _store_dex_session(provider: OIDCProxy, token_set: UpstreamTokenSet) -> str:
    await provider._upstream_token_store.put(  # pylint: disable=protected-access
        key=token_set.upstream_token_id, value=token_set,
    )
    await provider._jti_mapping_store.put(  # pylint: disable=protected-access
        key='dex-jti',
        value=JTIMapping(
            jti='dex-jti',
            upstream_token_id=token_set.upstream_token_id,
            created_at=time.time(),
        ),
    )
    return provider.jwt_issuer.issue_access_token(
        client_id=token_set.client_id, scopes=['openid'], jti='dex-jti',
    )


async def _store_dex_refresh_session(provider: OIDCProxy, client_id: str) -> str:
    token_set = _dex_token_set(None)
    token_set.client_id = client_id
    token_set.scope = 'openid'
    token_set.refresh_token = 'dex-refresh-token'
    token_set.refresh_token_expires_at = time.time() + 3600
    await _store_dex_session(provider, token_set)
    refresh_token = provider.jwt_issuer.issue_refresh_token(
        client_id=client_id, scopes=['openid'], jti='dex-jti', expires_in=3600,
    )
    await provider._refresh_token_store.put(  # pylint: disable=protected-access
        key=hashlib.sha256(refresh_token.encode()).hexdigest(),
        value=RefreshTokenMetadata(
            client_id=client_id, scopes=['openid'],
            expires_at=int(time.time()) + 3600, created_at=time.time(),
        ),
    )
    return refresh_token


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
