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

from fastmcp import FastMCP
from fastmcp.server.auth import AuthProvider
import httpx
import pydantic
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
import uvicorn  # type: ignore

from src.lib.utils import logging as logging_utils
from src.service.mcp import (
    auth,
    gateway,
    protocol,
    request_body,
    tool_registry,
)
from src.utils import ssl_config, static_config


class MCPServiceConfig(
    logging_utils.LoggingConfig,
    static_config.StaticConfig,
    ssl_config.SSLConfig,
    auth.MCPAuthConfig,
):
    """Runtime configuration for the MCP service."""

    model_config = pydantic.ConfigDict(hide_input_in_errors=True)

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
    gateway_url: pydantic.AnyHttpUrl = pydantic.Field(
        description='HTTPS origin of the same-deployment OSMO Gateway.',
        json_schema_extra={'env': 'OSMO_GATEWAY_URL'})
    request_timeout_seconds: int = pydantic.Field(
        default=10,
        ge=1,
        le=60,
        description='Total timeout for each OSMO Gateway request.',
        json_schema_extra={'env': 'OSMO_MCP_REQUEST_TIMEOUT_SECONDS'})
    allowed_origins: list[str] = pydantic.Field(
        default_factory=list,
        description=(
            'Browser Origins permitted to call the MCP endpoint. Native MCP '
            'clients send no Origin and stay allowed. An empty list rejects '
            'every browser Origin.'),
        json_schema_extra={'env': 'OSMO_MCP_ALLOWED_ORIGINS'})

    @pydantic.field_validator('allowed_origins', mode='after')
    @classmethod
    def _discard_blank_origins(cls, value: list[str]) -> list[str]:
        """Drop the empty entry an unset comma-separated variable produces."""
        return [origin.strip() for origin in value if origin.strip()]

    @pydantic.model_validator(mode='after')
    def _validate_gateway_url(self) -> 'MCPServiceConfig':
        gateway.validate_gateway_origin(str(self.gateway_url))
        return self


def create_mcp_server(
    auth_provider: AuthProvider | None = None,
) -> FastMCP:
    """Create the stateless OSMO MCP protocol server."""
    server = protocol.OSMOFastMCP(
        name='OSMO MCP',
        auth=auth_provider,
        mask_error_details=True,
    )
    tool_registry.register_tools(server)

    @server.custom_route('/health/live', methods=['GET'], include_in_schema=False)
    async def health_live(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    @server.custom_route('/health', methods=['GET'], include_in_schema=False)
    async def health(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    @server.custom_route('/health/ready', methods=['GET'], include_in_schema=False)
    async def health_ready(request: Request) -> JSONResponse:  # pylint: disable=unused-argument
        return JSONResponse({'status': 'ok'})

    return server


def create_application(
    protocol_server: FastMCP,
    allowed_origins: list[str] | None = None,
) -> Starlette:
    """Create the ASGI application for an MCP protocol server."""
    application = protocol_server.http_app(
        path='/mcp',
        transport='streamable-http',
        stateless_http=True,
        json_response=True,
        # FastMCP's own guard replaces the Origin allowlist the gateway used to
        # implement in templated Lua. Passing allowed_origins alone is inert:
        # the guard is only installed when host_origin_protection is not False.
        host_origin_protection='auto',
        allowed_origins=allowed_origins,
    )
    application.add_middleware(
        request_body.RequestBodyLimitMiddleware,
        path='/mcp',
        max_body_bytes=request_body.MAX_MCP_REQUEST_BODY_BYTES,
        max_concurrent_requests=request_body.MAX_CONCURRENT_MCP_REQUESTS,
        body_timeout_seconds=(
            request_body.MCP_REQUEST_BODY_TIMEOUT_SECONDS
        ),
    )
    return application


def create_runtime_application(
    config: MCPServiceConfig,
    *,
    http_transport: httpx.AsyncBaseTransport | None = None,
    auth_provider: AuthProvider | None = None,
) -> Starlette:
    """Create the production application and process-lifetime Gateway client.

    ``http_transport`` and ``auth_provider`` are test seams. Production passes
    neither: the Gateway client uses the network and the auth provider is built
    from configuration, which is the only way the service authenticates.
    """
    auth_runtime = (
        None if auth_provider is not None else auth.create_auth_runtime(config)
    )
    protocol_server = create_mcp_server(
        auth_provider if auth_runtime is None else auth_runtime.provider,
    )
    # FastMCP serves its browser consent page on this deployment's own origin,
    # and a same-origin form POST still carries an Origin header. Supplying any
    # explicit allowlist turns off FastMCP's same-origin fallback for non-
    # loopback hosts (fastmcp/server/http.py:297-306), so the deployment origin
    # has to be listed explicitly or consent is rejected.
    browser_origins = list(dict.fromkeys([
        str(config.gateway_url).rstrip('/'),
        *config.allowed_origins,
    ]))
    application = create_application(protocol_server, browser_origins)
    protocol_lifespan = application.router.lifespan_context

    @contextlib.asynccontextmanager
    async def application_lifespan(
        lifespan_application: Starlette,
    ) -> AsyncIterator[None]:
        async with gateway.create_app_context(
            gateway_url=str(config.gateway_url),
            request_timeout_seconds=config.request_timeout_seconds,
            transport=http_transport,
        ) as app_context:
            lifespan_application.state.mcp_app_context = app_context
            try:
                async with protocol_lifespan(lifespan_application):
                    yield
            finally:
                del lifespan_application.state.mcp_app_context
                if auth_runtime is not None:
                    await auth_runtime.aclose()

    application.router.lifespan_context = application_lifespan
    return application


def main() -> None:
    """Run the MCP ASGI application with the repository's Uvicorn/TLS pattern."""
    config = MCPServiceConfig.load()
    logging_utils.init_logger('mcp', config)
    application = create_runtime_application(config)

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
