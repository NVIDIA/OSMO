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
import base64
from collections.abc import AsyncIterator
import contextlib
import json
import logging
import re
from typing import Any
from typing import cast

from cryptography.fernet import Fernet
from fastmcp.server.auth.providers.azure import AzureProvider
import httpx
from key_value.aio.protocols import AsyncKeyValue
from key_value.aio.stores.redis import RedisStore
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper
from key_value.aio.wrappers.prefix_collections import PrefixCollectionsWrapper
from mcp.server.auth.provider import TokenError
from redis import asyncio as redis_asyncio
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
import uvicorn  # type: ignore

from src.lib.utils import logging as logging_utils
from src.service.mcp_auth import config


LOGGER = logging.getLogger(__name__)
_SAFE_ROLE = re.compile(r'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$')


class OSMOAzureProvider(AzureProvider):
    """Validate Entra before embedding identity consumed by Gateway RBAC."""

    async def _extract_upstream_claims(
        self,
        idp_tokens: dict[str, Any],
    ) -> dict[str, Any] | None:
        access_token = idp_tokens.get('access_token')
        if not isinstance(access_token, str) or not access_token:
            raise TokenError('invalid_grant', 'Upstream access token is missing')

        validated = await self._token_validator.verify_token(access_token)
        if validated is None or not isinstance(validated.claims, dict):
            raise TokenError(
                'invalid_grant',
                'Upstream access token validation failed',
            )

        claims: dict[str, Any] = {}
        for name in ('preferred_username', 'unique_name', 'upn', 'email'):
            value = validated.claims.get(name)
            if isinstance(value, str) and value and not _contains_control(value):
                claims[name] = value

        roles = validated.claims.get('roles')
        if roles is not None:
            if not isinstance(roles, list) or len(roles) > 256:
                raise TokenError('invalid_grant', 'Upstream roles claim is invalid')
            if not all(isinstance(role, str) and _SAFE_ROLE.fullmatch(role) for role in roles):
                raise TokenError('invalid_grant', 'Upstream roles claim is invalid')
            claims['roles'] = sorted(set(roles))

        return claims or None


def create_application(
    *,
    auth_provider: AzureProvider,
    readiness_check: Any | None = None,
) -> Starlette:
    """Create the public FastMCP OAuth proxy application."""
    routes = list(auth_provider.get_routes('/mcp'))

    async def health_live(_: Request) -> JSONResponse:
        return JSONResponse({'status': 'ok'})

    async def health_ready(_: Request) -> JSONResponse:
        if readiness_check is not None:
            await readiness_check()
        return JSONResponse({'status': 'ok'})

    routes.extend(
        [
            Route('/health/live', health_live, methods=['GET']),
            Route('/health/ready', health_ready, methods=['GET']),
        ]
    )
    application = Starlette(debug=False, routes=routes)

    async def unexpected_oauth_error(
        request: Request,
        error: Exception,
    ) -> JSONResponse:
        # FastMCP already returns protocol-shaped responses for OAuth errors.
        # This boundary handles infrastructure/programming failures that would
        # otherwise become Starlette's plaintext 500, which OAuth clients
        # cannot parse. Never log the exception message or request body.
        LOGGER.error(
            'Unexpected FastMCP OAuth failure',
            extra={
                'path': request.url.path,
                'method': request.method,
                'exception_type': type(error).__name__,
            },
        )
        return JSONResponse(
            {
                'error': 'server_error',
                'error_description': 'OAuth service temporarily unavailable',
            },
            status_code=500,
            headers={
                'Cache-Control': 'no-store',
                'Pragma': 'no-cache',
            },
        )

    application.add_exception_handler(Exception, unexpected_oauth_error)
    # OAuth public clients use no cookies or client secrets. Wildcard CORS is
    # intentional so browser-hosted Inspector clients can perform discovery,
    # DCR, and token exchange while redirect trust is enforced separately.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['GET', 'POST', 'OPTIONS'],
        allow_headers=['Accept', 'Authorization', 'Content-Type'],
        allow_credentials=False,
        max_age=600,
    )
    return application


def create_runtime_application(broker_config: config.OAuthBrokerConfig) -> Starlette:
    """Create FastMCP Azure, encrypted Redis, and signing dependencies."""
    redis_password = _read_optional_secret(broker_config.redis_password_file)
    redis_client = redis_asyncio.Redis.from_url(
        broker_config.redis_url,
        password=redis_password,
        socket_connect_timeout=broker_config.redis_connect_timeout_seconds,
        socket_timeout=broker_config.redis_operation_timeout_seconds,
        # py-key-value-aio only deserializes Redis values returned as text.
        # Binary responses are treated as missing OAuth state.
        decode_responses=True,
    )
    redis_store = RedisStore(client=redis_client)
    namespaced_store = PrefixCollectionsWrapper(
        key_value=redis_store,
        prefix=broker_config.redis_key_prefix,
    )
    signing_key = _read_signing_jwks(broker_config.signing_jwks_file)
    encrypted_store: AsyncKeyValue = FernetEncryptionWrapper(
        key_value=namespaced_store,
        fernet=Fernet(
            base64.urlsafe_b64encode(
                _derive_storage_key(signing_key),
            )
        ),
    )
    http_client = httpx.AsyncClient(
        timeout=broker_config.upstream_timeout_seconds,
        follow_redirects=False,
    )
    auth_provider = OSMOAzureProvider(
        client_id=broker_config.entra_client_id,
        client_secret=_read_required_secret(
            broker_config.entra_client_secret_file,
            'Entra client secret',
        ),
        tenant_id=broker_config.entra_tenant_id,
        required_scopes=[broker_config.scope],
        base_url=broker_config.issuer_url,
        resource_base_url=broker_config.issuer_url,
        identifier_uri=broker_config.entra_identifier_uri,
        issuer_url=broker_config.issuer_url,
        redirect_path='/oauth/callback/entra',
        additional_authorize_scopes=['openid', 'profile', 'email'],
        allowed_client_redirect_uris=broker_config.allowed_client_redirect_uris,
        client_storage=encrypted_store,
        jwt_signing_key=signing_key,
        require_authorization_consent=True,
        fallback_refresh_token_expiry_seconds=(
            broker_config.refresh_token_ttl_seconds
        ),
        fastmcp_access_token_expiry_seconds=(broker_config.access_token_ttl_seconds),
        token_expiry_threshold_seconds=30,
        token_issuer=broker_config.entra_token_issuer,
        http_client=http_client,
        enable_cimd=False,
    )
    application = create_application(
        auth_provider=auth_provider,
        readiness_check=redis_client.ping,
    )

    @contextlib.asynccontextmanager
    async def lifespan(_: Starlette) -> AsyncIterator[None]:
        try:
            yield
        finally:
            await http_client.aclose()
            await cast(Any, redis_client).aclose()

    application.router.lifespan_context = lifespan
    return application


def _read_signing_jwks(path: str) -> bytes:
    """Read one private HS256 JWK without exposing it through public routes."""
    with open(path, encoding='utf-8') as jwks_file:
        document = json.load(jwks_file)
    keys = document.get('keys') if isinstance(document, dict) else None
    if not isinstance(keys, list) or len(keys) != 1 or not isinstance(keys[0], dict):
        raise ValueError('FastMCP signing JWKS must contain exactly one key')
    key = keys[0]
    if key.get('kty') != 'oct':
        raise ValueError('FastMCP signing key must use kty=oct')
    if key.get('alg') not in {None, 'HS256'}:
        raise ValueError('FastMCP signing key alg must be HS256')
    if key.get('use') not in {None, 'sig'}:
        raise ValueError('FastMCP signing key use must be sig')
    encoded_key = key.get('k')
    if not isinstance(encoded_key, str) or not encoded_key:
        raise ValueError('FastMCP signing key must contain k')
    try:
        signing_key = base64.urlsafe_b64decode(
            encoded_key + '=' * (-len(encoded_key) % 4)
        )
    except (ValueError, TypeError) as error:
        raise ValueError('FastMCP signing key k must be base64url') from error
    if len(signing_key) != 32:
        raise ValueError('FastMCP signing key must contain exactly 256 bits')
    return signing_key


def _derive_storage_key(signing_key: bytes) -> bytes:
    """Derive a separate 256-bit Fernet key from the token signing key."""
    import hashlib  # pylint: disable=import-outside-toplevel

    return hashlib.sha256(b'osmo-fastmcp-storage-v1\0' + signing_key).digest()


def _contains_control(value: str) -> bool:
    return any(ord(character) < 32 or ord(character) == 127 for character in value)


def _read_required_secret(path: str, name: str) -> str:
    with open(path, encoding='utf-8') as secret_file:
        secret = secret_file.read().strip()
    if not secret:
        raise ValueError(f'{name} file must not be empty')
    return secret


def _read_optional_secret(path: str | None) -> str | None:
    if path is None:
        return None
    return _read_required_secret(path, 'Redis password')


def main() -> None:
    """Run FastMCP's Azure OAuth proxy with OSMO TLS and logging."""
    broker_config = config.OAuthBrokerConfig.load()
    logging_utils.init_logger('mcp-auth', broker_config)
    application = create_runtime_application(broker_config)

    async def run_server() -> None:
        uvicorn_config = uvicorn.Config(
            application,
            host=broker_config.host,
            port=broker_config.port,
            log_config=None,
            access_log=False,
            **broker_config.uvicorn_ssl_kwargs(),
        )
        await uvicorn.Server(config=uvicorn_config).serve()

    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':  # pragma: no cover - container entrypoint
    main()
