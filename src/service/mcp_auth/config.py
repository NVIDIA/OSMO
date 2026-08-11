"""
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

from urllib import parse

import pydantic

from src.lib.utils import logging as logging_utils
from src.utils import ssl_config, static_config


class OAuthBrokerConfig(
    logging_utils.LoggingConfig,
    static_config.StaticConfig,
    ssl_config.SSLConfig,
):
    """Runtime and protocol configuration for the OSMO MCP OAuth broker."""

    model_config = pydantic.ConfigDict(hide_input_in_errors=True)

    host: str = pydantic.Field(
        default='0.0.0.0',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_HOST'},
    )
    port: int = pydantic.Field(
        default=8001,
        ge=1,
        le=65535,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_PORT'},
    )
    issuer_url: str = pydantic.Field(
        description='Public HTTPS OSMO origin used as the OAuth issuer.',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ISSUER_URL'},
    )
    resource_url: str = pydantic.Field(
        description='Exact public MCP resource URL.',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_RESOURCE_URL'},
    )
    scope: str = pydantic.Field(
        default='mcp:access',
        pattern=r'^[A-Za-z0-9:._~-]{1,128}$',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_SCOPE'},
    )
    redis_url: str = pydantic.Field(
        description='Redis or Redis TLS URL without a password.',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_URL'},
    )
    redis_password_file: str | None = pydantic.Field(
        default=None,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_PASSWORD_FILE'},
    )
    redis_key_prefix: str = pydantic.Field(
        default='osmo:mcp-auth',
        min_length=1,
        max_length=128,
        pattern=r'^[A-Za-z0-9:._~-]+$',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_REDIS_KEY_PREFIX'},
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
    entra_issuer_url: str = pydantic.Field(
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ENTRA_ISSUER_URL'},
    )
    entra_client_id: str = pydantic.Field(
        min_length=1,
        max_length=256,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ENTRA_CLIENT_ID'},
    )
    entra_client_secret_file: str = pydantic.Field(
        min_length=1,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ENTRA_CLIENT_SECRET_FILE'},
    )
    entra_redirect_url: str = pydantic.Field(
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ENTRA_REDIRECT_URL'},
    )
    signing_private_jwk_file: str = pydantic.Field(
        min_length=1,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_SIGNING_PRIVATE_JWK_FILE'},
    )
    allowed_upstream_roles: str = pydantic.Field(
        default='',
        json_schema_extra={'env': 'OSMO_MCP_AUTH_ALLOWED_UPSTREAM_ROLES'},
    )
    trusted_https_redirect_origins: str = pydantic.Field(
        default='',
        description='Comma-separated exact HTTPS origins allowed for DCR redirects.',
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
    client_registration_ttl_seconds: int = pydantic.Field(
        default=2592000,
        ge=3600,
        le=7776000,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_CLIENT_REGISTRATION_TTL_SECONDS'},
    )
    authorization_transaction_ttl_seconds: int = pydantic.Field(
        default=600,
        ge=60,
        le=900,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_TRANSACTION_TTL_SECONDS'},
    )
    authorization_code_ttl_seconds: int = pydantic.Field(
        default=90,
        ge=30,
        le=300,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_CODE_TTL_SECONDS'},
    )
    upstream_timeout_seconds: int = pydantic.Field(
        default=10,
        ge=1,
        le=60,
        json_schema_extra={'env': 'OSMO_MCP_AUTH_UPSTREAM_TIMEOUT_SECONDS'},
    )

    @pydantic.model_validator(mode='after')
    def _validate_urls_and_roles(self) -> 'OAuthBrokerConfig':
        issuer = _validate_https_url(self.issuer_url, root_only=True)
        resource = _validate_https_url(self.resource_url, root_only=False)
        entra_issuer = _validate_https_url(self.entra_issuer_url, root_only=False)
        redirect = _validate_https_url(self.entra_redirect_url, root_only=False)

        if resource != f'{issuer}/mcp':
            raise ValueError('resource_url must be the issuer origin followed by /mcp')
        if redirect != f'{issuer}/oauth/callback/entra':
            raise ValueError(
                'entra_redirect_url must be the issuer origin followed by '
                '/oauth/callback/entra'
            )
        parsed_redis = parse.urlsplit(self.redis_url)
        if parsed_redis.scheme not in {'redis', 'rediss'} or not parsed_redis.hostname:
            raise ValueError('redis_url must be an absolute redis:// or rediss:// URL')
        if parsed_redis.password is not None:
            raise ValueError('redis_url password must be provided through redis_password_file')
        roles = self.allowed_roles
        if any(len(role) > 256 for role in roles):
            raise ValueError('allowed upstream roles must contain 1 to 256 characters')
        for trusted_origin in self.trusted_redirect_origins:
            if _validate_https_url(trusted_origin, root_only=True) != trusted_origin:
                raise ValueError('trusted HTTPS redirect origins must be normalized origins')

        self.issuer_url = issuer
        self.resource_url = resource
        self.entra_issuer_url = entra_issuer
        self.entra_redirect_url = redirect
        return self

    @property
    def allowed_roles(self) -> frozenset[str]:
        """Return the normalized allowlist configured as comma-separated roles."""
        return frozenset(
            role.strip()
            for role in self.allowed_upstream_roles.split(',')
            if role.strip()
        )

    @property
    def trusted_redirect_origins(self) -> frozenset[str]:
        """Return explicit HTTPS origins that may register redirect callbacks."""
        return frozenset(
            origin.strip().rstrip('/')
            for origin in self.trusted_https_redirect_origins.split(',')
            if origin.strip()
        )


def _validate_https_url(value: str, *, root_only: bool) -> str:
    parsed = parse.urlsplit(value)
    if (
        parsed.scheme != 'https'
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError('OAuth URLs must be absolute HTTPS URLs without query or fragment')
    try:
        parsed.port
    except ValueError as error:
        raise ValueError('OAuth URL contains an invalid port') from error
    path = parsed.path.rstrip('/')
    if root_only and path:
        raise ValueError('issuer_url must be an HTTPS origin without a path')
    return parse.urlunsplit((parsed.scheme, parsed.netloc, path, '', ''))
