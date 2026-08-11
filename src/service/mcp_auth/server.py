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

import httpx
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.routing import Route
import uvicorn  # type: ignore

from src.lib.utils import logging as logging_utils
from src.service.mcp_auth import config, entra, provider, store, tokens


def create_application(
    broker_config: config.OAuthBrokerConfig,
    *,
    broker_store: store.BrokerStore,
    upstream_provider: entra.UpstreamOIDCProvider,
    access_token_issuer: tokens.AccessTokenIssuer,
) -> Starlette:
    """Create a dependency-injected OAuth authorization server."""
    authorization_server = provider.OAuthAuthorizationServer(
        broker_config=broker_config,
        broker_store=broker_store,
        upstream_provider=upstream_provider,
        access_token_issuer=access_token_issuer,
    )
    application = Starlette(
        debug=False,
        routes=[
            Route(
                '/.well-known/oauth-authorization-server',
                authorization_server.metadata,
                methods=['GET'],
            ),
            Route('/oauth/register', authorization_server.register, methods=['POST']),
            Route('/oauth/authorize', authorization_server.authorize, methods=['GET']),
            Route(
                '/oauth/callback/entra',
                authorization_server.callback,
                methods=['GET'],
            ),
            Route('/oauth/token', authorization_server.token, methods=['POST']),
            Route('/oauth/revoke', authorization_server.revoke, methods=['POST']),
            Route('/oauth/jwks.json', authorization_server.jwks, methods=['GET']),
            Route('/health/live', authorization_server.health_live, methods=['GET']),
            Route('/health/ready', authorization_server.health_ready, methods=['GET']),
        ],
        exception_handlers={provider.OAuthError: provider.oauth_error_response},
    )
    # OAuth public clients use no cookies or client secrets. Wildcard CORS is
    # intentional so browser-hosted Inspector clients can perform discovery,
    # DCR, and token exchange while redirect trust is enforced separately.
    application.add_middleware(
        CORSMiddleware,
        allow_origins=['*'],
        allow_methods=['GET', 'POST', 'OPTIONS'],
        allow_headers=['Accept', 'Content-Type'],
        allow_credentials=False,
        max_age=600,
    )
    return application


def create_runtime_application(
    broker_config: config.OAuthBrokerConfig,
    *,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> Starlette:
    """Create production Redis, Entra, and signing-key dependencies."""
    redis_password = _read_optional_secret(broker_config.redis_password_file)
    broker_store = store.RedisBrokerStore.from_url(
        broker_config.redis_url,
        password=redis_password,
        key_prefix=broker_config.redis_key_prefix,
        connect_timeout_seconds=broker_config.redis_connect_timeout_seconds,
        operation_timeout_seconds=broker_config.redis_operation_timeout_seconds,
    )
    http_client = httpx.AsyncClient(
        timeout=broker_config.upstream_timeout_seconds,
        transport=http_transport,
        follow_redirects=False,
    )
    upstream_provider = entra.EntraOIDCProvider(
        issuer=broker_config.entra_issuer_url,
        client_id=broker_config.entra_client_id,
        client_secret=_read_required_secret(
            broker_config.entra_client_secret_file,
            'Entra client secret',
        ),
        redirect_uri=broker_config.entra_redirect_url,
        allowed_roles=broker_config.allowed_roles,
        http_client=http_client,
    )
    access_token_issuer = tokens.AccessTokenIssuer.from_jwk_file(
        broker_config.signing_private_jwk_file,
        issuer=broker_config.issuer_url,
        audience=broker_config.resource_url,
        access_token_ttl_seconds=broker_config.access_token_ttl_seconds,
    )
    application = create_application(
        broker_config,
        broker_store=broker_store,
        upstream_provider=upstream_provider,
        access_token_issuer=access_token_issuer,
    )

    @contextlib.asynccontextmanager
    async def lifespan(lifespan_application: Starlette) -> AsyncIterator[None]:
        del lifespan_application
        try:
            yield
        finally:
            try:
                await upstream_provider.close()
            finally:
                await broker_store.close()

    application.router.lifespan_context = lifespan
    return application


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
    """Run the broker using OSMO's standard static config and TLS behavior."""
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
