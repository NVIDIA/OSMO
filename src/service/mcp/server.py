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

from mcp.server.fastmcp import FastMCP
import pydantic
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
import uvicorn  # type: ignore

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


def create_mcp_server() -> FastMCP:
    """Create the authentication-agnostic Phase A MCP server."""
    server = FastMCP(
        name='OSMO MCP',
        host='0.0.0.0',
        port=8000,
        streamable_http_path='/mcp',
        stateless_http=True,
        json_response=True,
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


mcp_server = create_mcp_server()
app: Starlette = mcp_server.streamable_http_app()


def main() -> None:
    """Run the MCP ASGI application with the repository's Uvicorn/TLS pattern."""
    config = MCPServiceConfig.load()

    async def run_server() -> None:
        uvicorn_config = uvicorn.Config(
            app,
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


if __name__ == '__main__':
    main()
