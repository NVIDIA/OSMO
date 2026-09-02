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
from typing import Any
import unittest
from unittest import mock

from fastmcp.server.auth.jwt_issuer import derive_jwt_key
from fastmcp.server.auth.oidc_proxy import OIDCConfiguration, OIDCProxy
from fastmcp.server.auth.providers.jwt import JWTVerifier
from fastmcp.server.auth.oauth_proxy.models import UpstreamTokenSet
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


class MCPAuthRuntimeTest(unittest.IsolatedAsyncioTestCase):
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
