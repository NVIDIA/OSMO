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
from collections.abc import AsyncIterator, Callable
import contextlib
import dataclasses
import pathlib

import httpx
from mcp.server.fastmcp import FastMCP
import pydantic
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
import uvicorn  # type: ignore

from src.service.mcp import identity, tokens
from src.utils import ssl_config, static_config


class MCPServiceConfig(static_config.StaticConfig, ssl_config.SSLConfig):
    """Runtime configuration for the MCP service."""

    host: str = pydantic.Field(
        default='0.0.0.0',
        description='The network interface to bind to when serving the MCP service.',
        json_schema_extra={'command_line': 'host', 'env': 'OSMO_MCP_HOST'})
    port: int = pydantic.Field(
        default=8000,
        ge=1,
        le=65535,
        description='The TCP port to bind to when serving the MCP service.',
        json_schema_extra={'command_line': 'port', 'env': 'OSMO_MCP_PORT'})
    api_url: pydantic.AnyHttpUrl = pydantic.Field(
        description='HTTPS base URL of the OSMO API Gateway.',
        json_schema_extra={'env': 'OSMO_API_URL'})
    service_token_file: pathlib.Path = pydantic.Field(
        description='Absolute path to the mounted MCP service-account access token.',
        json_schema_extra={'env': 'OSMO_MCP_SERVICE_TOKEN_FILE'})
    gateway_ca_file: pathlib.Path | None = pydantic.Field(
        default=None,
        description='Optional CA file used to verify the private API Gateway.',
        json_schema_extra={'env': 'OSMO_MCP_GATEWAY_CA_FILE'})
    request_timeout_seconds: float = pydantic.Field(
        default=10,
        gt=0,
        le=60,
        description='Timeout for each Gateway token request.',
        json_schema_extra={'env': 'OSMO_MCP_REQUEST_TIMEOUT_SECONDS'})
    token_cache_max_size: int = pydantic.Field(
        default=512,
        ge=1,
        le=10000,
        description='Maximum number of delegated user tokens cached per process.',
        json_schema_extra={'env': 'OSMO_MCP_TOKEN_CACHE_MAX_SIZE'})
    token_cache_skew_seconds: float = pydantic.Field(
        default=30,
        ge=0,
        le=120,
        description='Time before token expiry when a cache entry becomes stale.',
        json_schema_extra={'env': 'OSMO_MCP_TOKEN_CACHE_SKEW_SECONDS'})

    @pydantic.model_validator(mode='after')
    def _validate_gateway_configuration(self) -> 'MCPServiceConfig':
        if self.api_url.scheme != 'https':
            raise ValueError('api_url must use HTTPS.')
        if (self.api_url.username is not None or self.api_url.password is not None or
                self.api_url.query is not None or self.api_url.fragment is not None or
                self.api_url.path not in ('', '/')):
            raise ValueError(
                'api_url must be an HTTPS origin without credentials, path, query, or fragment.')
        if not self.service_token_file.is_absolute():
            raise ValueError('service_token_file must be an absolute path.')
        if self.gateway_ca_file is not None and not self.gateway_ca_file.is_absolute():
            raise ValueError('gateway_ca_file must be an absolute path.')
        return self


@dataclasses.dataclass
class _AppContextHolder:
    context: tokens.AppContext | None = None


ServerConfigurer = Callable[[FastMCP[tokens.AppContext]], None]


def _create_mcp_server(
    lifespan: Callable[
        [FastMCP[tokens.AppContext]],
        contextlib.AbstractAsyncContextManager[tokens.AppContext],
    ],
    configure_server: ServerConfigurer | None = None,
) -> FastMCP[tokens.AppContext]:
    """Create the MCP protocol server without registering production tools."""
    server: FastMCP[tokens.AppContext] = FastMCP(
        name='OSMO MCP',
        host='0.0.0.0',
        port=8000,
        streamable_http_path='/mcp',
        stateless_http=True,
        json_response=True,
        lifespan=lifespan,
    )

    @server.custom_route('/health/live', methods=['GET'], include_in_schema=False)
    async def health_live(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    @server.custom_route('/health', methods=['GET'], include_in_schema=False)
    async def health(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    @server.custom_route('/health/ready', methods=['GET'], include_in_schema=False)
    async def health_ready(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    if configure_server is not None:
        configure_server(server)

    return server


def create_application(
    config: MCPServiceConfig,
    *,
    configure_server: ServerConfigurer | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> Starlette:
    """Create the secured ASGI application and its process-lifetime runtime."""
    context_holder = _AppContextHolder()

    @contextlib.asynccontextmanager
    async def mcp_lifespan(
        unused_server: FastMCP[tokens.AppContext],
    ) -> AsyncIterator[tokens.AppContext]:
        del unused_server
        if context_holder.context is None:
            raise RuntimeError('MCP application lifespan is not running.')
        yield context_holder.context

    mcp_server = _create_mcp_server(mcp_lifespan, configure_server)
    application = mcp_server.streamable_http_app()

    @contextlib.asynccontextmanager
    async def application_lifespan(
        unused_application: Starlette,
    ) -> AsyncIterator[None]:
        del unused_application
        async with tokens.create_app_context(
            api_url=str(config.api_url),
            service_token_file=config.service_token_file,
            request_timeout_seconds=config.request_timeout_seconds,
            token_cache_max_size=config.token_cache_max_size,
            token_cache_skew_seconds=config.token_cache_skew_seconds,
            gateway_ca_file=config.gateway_ca_file,
            transport=http_transport,
        ) as app_context:
            context_holder.context = app_context
            try:
                async with mcp_server.session_manager.run():
                    yield
            finally:
                context_holder.context = None

    # FastMCP owns the session manager; this outer lifespan adds one shared runtime.
    application.router.lifespan_context = application_lifespan
    application.add_middleware(identity.TrustedIdentityMiddleware, path='/mcp')
    application.state.mcp_server = mcp_server
    return application


def main() -> None:
    """Run the MCP ASGI application with the repository's Uvicorn/TLS pattern."""
    config = MCPServiceConfig.load()
    application = create_application(config)

    async def run_server() -> None:
        uvicorn_config = uvicorn.Config(
            application,
            host=config.host,
            port=config.port,
            log_config=None,
            **config.uvicorn_ssl_kwargs(),
        )
        await uvicorn.Server(config=uvicorn_config).serve()

    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':  # pragma: no cover - exercised by the container entrypoint
    main()
