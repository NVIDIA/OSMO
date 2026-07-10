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

import httpx
from mcp.server.fastmcp import FastMCP
import pydantic
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
import uvicorn  # type: ignore

from src.service.mcp import gateway, request_context, tools as mcp_tools
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
        description='HTTPS origin of the OSMO API Gateway.',
        json_schema_extra={'env': 'OSMO_API_URL'})
    request_timeout_seconds: float = pydantic.Field(
        default=10,
        gt=0,
        le=60,
        description='Total timeout for each OSMO Gateway request.',
        json_schema_extra={'env': 'OSMO_MCP_REQUEST_TIMEOUT_SECONDS'})

    @pydantic.model_validator(mode='after')
    def _validate_api_url(self) -> 'MCPServiceConfig':
        if self.api_url.scheme != 'https':
            raise ValueError('api_url must use HTTPS.')
        if (
            self.api_url.username is not None or
            self.api_url.password is not None or
            self.api_url.query is not None or
            self.api_url.fragment is not None or
            self.api_url.path not in ('', '/')
        ):
            raise ValueError(
                'api_url must be an HTTPS origin without credentials, path, '
                'query, or fragment.')
        return self


@dataclasses.dataclass
class _AppContextHolder:
    context: gateway.AppContext | None = None


ServerLifespan = Callable[
    [FastMCP[gateway.AppContext]],
    contextlib.AbstractAsyncContextManager[gateway.AppContext],
]


def create_mcp_server(
    lifespan: ServerLifespan | None = None,
) -> FastMCP[gateway.AppContext]:
    """Create the MCP protocol server and register its Phase B catalog."""
    server: FastMCP[gateway.AppContext] = FastMCP(
        name='OSMO MCP',
        tools=mcp_tools.create_tools(),
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

    return server


def create_application(
    config: MCPServiceConfig,
    *,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> Starlette:
    """Create the MCP ASGI application and process-lifetime Gateway client."""
    context_holder = _AppContextHolder()

    @contextlib.asynccontextmanager
    async def mcp_lifespan(
        unused_server: FastMCP[gateway.AppContext],
    ) -> AsyncIterator[gateway.AppContext]:
        del unused_server
        if context_holder.context is None:
            raise RuntimeError('MCP application lifespan is not running.')
        yield context_holder.context

    mcp_server = create_mcp_server(mcp_lifespan)
    application = mcp_server.streamable_http_app()

    @contextlib.asynccontextmanager
    async def application_lifespan(
        unused_application: Starlette,
    ) -> AsyncIterator[None]:
        del unused_application
        async with gateway.create_app_context(
            api_url=str(config.api_url),
            request_timeout_seconds=config.request_timeout_seconds,
            transport=http_transport,
        ) as app_context:
            context_holder.context = app_context
            try:
                # FastMCP owns the session manager. The outer lifespan keeps
                # the Gateway connection pool alive across stateless requests.
                async with mcp_server.session_manager.run():
                    yield
            finally:
                context_holder.context = None

    application.router.lifespan_context = application_lifespan
    application.add_middleware(request_context.RequestContextMiddleware, path='/mcp')
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
