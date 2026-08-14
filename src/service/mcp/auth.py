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

import dataclasses
from typing import cast
from urllib import parse

from cryptography.fernet import Fernet
from fastmcp.server.auth.jwt_issuer import derive_jwt_key
from fastmcp.server.auth.oidc_proxy import OIDCProxy
from fastmcp.server.auth.providers.jwt import JWTVerifier
import httpx
from key_value.aio.protocols import AsyncKeyValue
from key_value.aio.stores.redis import RedisStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from key_value.aio.wrappers.prefix_collections import PrefixCollectionsWrapper
import pydantic
from redis import asyncio as redis_asyncio

_UPSTREAM_OIDC_SCOPES = ('openid', 'profile', 'email', 'offline_access')


class MCPAuthConfig(pydantic.BaseModel):
    """Optional OIDC settings loaded by the existing MCP process."""

    model_config = pydantic.ConfigDict(hide_input_in_errors=True)

    auth_enabled: bool = pydantic.Field(
        default=False,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ENABLED'},
    )
    issuer_url: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ISSUER_URL'},
    )
    resource_url: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_RESOURCE_URL'},
    )
    auth_scope: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_SCOPE'},
    )
    redis_url: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_URL'},
    )
    redis_password_file: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_PASSWORD_FILE'},
    )
    redis_key_prefix: str = pydantic.Field(
        default='osmo:mcp-fastmcp',
        pattern=r'^[A-Za-z0-9:._~-]{1,128}$',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_KEY_PREFIX'},
    )
    oidc_config_url: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_CONFIG_URL'},
    )
    oidc_client_id: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_CLIENT_ID'},
    )
    oidc_client_secret_file: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_CLIENT_SECRET_FILE'},
    )
    oidc_access_token_jwks_url: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_JWKS_URL'},
    )
    oidc_access_token_issuer: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_ISSUER'},
    )
    oidc_access_token_audience: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_AUDIENCE'},
    )
    oidc_access_token_required_scope: str = pydantic.Field(
        default='access_as_user',
        pattern=r'^[A-Za-z0-9:._~-]{1,128}$',
        json_schema_extra={
            'env': 'OSMO_MCP_AUTH_OIDC_ACCESS_TOKEN_REQUIRED_SCOPE',
        },
    )
    trusted_https_redirect_origins: str = pydantic.Field(
        default='',
        json_schema_extra={
            'env': 'OSMO_MCP_AUTH_TRUSTED_HTTPS_REDIRECT_ORIGINS',
        },
    )
    access_token_ttl_seconds: int = pydantic.Field(
        default=600,
        ge=60,
        le=3600,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ACCESS_TOKEN_TTL_SECONDS'},
    )
    refresh_token_ttl_seconds: int = pydantic.Field(
        default=28800,
        ge=300,
        le=604800,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REFRESH_TOKEN_TTL_SECONDS'},
    )
    upstream_timeout_seconds: int = pydantic.Field(
        default=10,
        ge=1,
        le=60,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_UPSTREAM_TIMEOUT_SECONDS'},
    )
    redis_connect_timeout_seconds: int = pydantic.Field(
        default=3,
        ge=1,
        le=30,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_CONNECT_TIMEOUT_SECONDS'},
    )
    redis_operation_timeout_seconds: int = pydantic.Field(
        default=5,
        ge=1,
        le=30,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_OPERATION_TIMEOUT_SECONDS'},
    )

    @pydantic.model_validator(mode='after')
    def _validate_auth_config(self) -> 'MCPAuthConfig':
        if not self.auth_enabled:
            return self
        required = {
            name: getattr(self, name)
            for name in (
                'issuer_url',
                'resource_url',
                'auth_scope',
                'redis_url',
                'oidc_config_url',
                'oidc_client_id',
                'oidc_client_secret_file',
                'oidc_access_token_jwks_url',
                'oidc_access_token_issuer',
                'oidc_access_token_audience',
            )
        }
        missing = sorted(name for name, value in required.items() if not value)
        if missing:
            raise ValueError(
                'Enabled MCP auth is missing: ' + ', '.join(missing)
            )

        issuer = _https_url(cast(str, self.issuer_url), root_only=True)
        resource = _https_url(cast(str, self.resource_url))
        scope = _https_url(cast(str, self.auth_scope))
        if resource != f'{issuer}/mcp':
            raise ValueError('resource_url must be issuer_url followed by /mcp')
        if scope != f'{resource}/{self.oidc_access_token_required_scope}':
            raise ValueError(
                'auth_scope must be resource_url followed by the token scope'
            )
        if self.oidc_access_token_audience != resource:
            raise ValueError('oidc_access_token_audience must match resource_url')
        self.issuer_url = issuer
        self.resource_url = resource
        self.auth_scope = scope
        self.oidc_config_url = _https_url(cast(str, self.oidc_config_url))
        self.oidc_access_token_jwks_url = _https_url(
            cast(str, self.oidc_access_token_jwks_url)
        )
        self.oidc_access_token_issuer = _https_url(
            cast(str, self.oidc_access_token_issuer),
            preserve_trailing_slash=True,
        )
        redis_url = parse.urlsplit(cast(str, self.redis_url))
        if redis_url.scheme not in {'redis', 'rediss'} or not redis_url.hostname:
            raise ValueError('redis_url must be an absolute Redis URL')
        if redis_url.password is not None:
            raise ValueError('Redis password must be provided through its file')
        for origin in self.trusted_redirect_origins:
            if _https_url(origin, root_only=True) != origin:
                raise ValueError('trusted redirect origins must be normalized')
        return self

    @property
    def trusted_redirect_origins(self) -> tuple[str, ...]:
        return tuple(
            item.strip().rstrip('/')
            for item in self.trusted_https_redirect_origins.split(',')
            if item.strip()
        )

    @property
    def allowed_client_redirect_uris(self) -> list[str]:
        return [
            'http://localhost:*',
            'http://127.0.0.1:*',
            'http://[::1]:*',
            *self.trusted_redirect_origins,
        ]


@dataclasses.dataclass(slots=True)
class MCPAuthRuntime:
    """Resources owned by FastMCP's built-in OIDC proxy."""

    provider: OIDCProxy
    redis_client: redis_asyncio.Redis
    http_client: httpx.AsyncClient

    async def aclose(self) -> None:
        try:
            await self.http_client.aclose()
        finally:
            await self.redis_client.aclose()


def create_auth_runtime(config: MCPAuthConfig) -> MCPAuthRuntime:
    """Configure FastMCP's OIDCProxy; no OSMO OAuth endpoints are implemented."""
    if not config.auth_enabled:
        raise ValueError('MCP auth is disabled')

    client_secret = _read_required_secret(
        cast(str, config.oidc_client_secret_file),
        'OIDC client secret',
    )
    redis_client = redis_asyncio.Redis.from_url(
        cast(str, config.redis_url),
        password=_read_optional_secret(config.redis_password_file),
        socket_connect_timeout=config.redis_connect_timeout_seconds,
        socket_timeout=config.redis_operation_timeout_seconds,
        decode_responses=True,
    )
    namespaced_store = PrefixCollectionsWrapper(
        key_value=RedisStore(client=redis_client),
        prefix=config.redis_key_prefix,
    )
    encrypted_store: AsyncKeyValue = FernetEncryptionWrapper(
        key_value=namespaced_store,
        fernet=Fernet(_storage_encryption_key(client_secret)),
        raise_on_decryption_error=False,
    )
    http_client = httpx.AsyncClient(
        timeout=config.upstream_timeout_seconds,
        follow_redirects=False,
    )
    verifier = JWTVerifier(
        jwks_uri=cast(str, config.oidc_access_token_jwks_url),
        issuer=cast(str, config.oidc_access_token_issuer),
        audience=cast(str, config.oidc_access_token_audience),
        algorithm='RS256',
        required_scopes=[config.oidc_access_token_required_scope],
        http_client=http_client,
    )
    requested_scope = cast(str, config.auth_scope)
    upstream_scope = ' '.join((requested_scope, *_UPSTREAM_OIDC_SCOPES))
    provider = OIDCProxy(
        config_url=cast(str, config.oidc_config_url),
        client_id=cast(str, config.oidc_client_id),
        client_secret=client_secret,
        token_verifier=verifier,
        base_url=cast(str, config.issuer_url),
        resource_base_url=cast(str, config.issuer_url),
        issuer_url=cast(str, config.issuer_url),
        redirect_path='/auth/callback',
        allowed_client_redirect_uris=config.allowed_client_redirect_uris,
        client_storage=encrypted_store,
        token_endpoint_auth_method='client_secret_post',
        require_authorization_consent=True,
        forward_resource=False,
        extra_authorize_params={'scope': upstream_scope},
        fallback_refresh_token_expiry_seconds=config.refresh_token_ttl_seconds,
        fastmcp_access_token_expiry_seconds=config.access_token_ttl_seconds,
        token_expiry_threshold_seconds=30,
        timeout_seconds=config.upstream_timeout_seconds,
        enable_cimd=True,
    )
    # Entra returns the short `scp` claim that the verifier enforces, while MCP
    # clients must discover and request the full API scope URI.
    provider.update_default_scopes([requested_scope])
    return MCPAuthRuntime(provider, redis_client, http_client)


def _storage_encryption_key(client_secret: str) -> bytes:
    """Mirror FastMCP's default signing and storage key derivation."""
    signing_key = derive_jwt_key(
        high_entropy_material=client_secret,
        salt='fastmcp-jwt-signing-key',
    )
    return derive_jwt_key(
        high_entropy_material=signing_key.decode('ascii'),
        salt='fastmcp-storage-encryption-key',
    )


def _read_required_secret(path: str, name: str) -> str:
    with open(path, encoding='utf-8') as secret_file:
        value = secret_file.read().strip()
    if not value:
        raise ValueError(f'{name} file must not be empty')
    return value


def _read_optional_secret(path: str | None) -> str | None:
    return _read_required_secret(path, 'Redis password') if path else None


def _https_url(
    value: str,
    *,
    root_only: bool = False,
    preserve_trailing_slash: bool = False,
) -> str:
    parsed = parse.urlsplit(value)
    try:
        _ = parsed.port
    except ValueError as error:
        raise ValueError('OAuth URL contains an invalid port') from error
    if (
        parsed.scheme != 'https'
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError('OAuth URLs must be absolute HTTPS URLs')
    path = parsed.path if preserve_trailing_slash else parsed.path.rstrip('/')
    if root_only and path:
        raise ValueError('OAuth issuer and redirect origins must be origins')
    return parse.urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
