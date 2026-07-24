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

from collections.abc import AsyncIterator, Callable, Collection, Coroutine, Mapping
import contextlib
from typing import Any, TypeAlias
import unittest

import httpx
from starlette.applications import Starlette

from src.lib.utils import login
from src.service.mcp import (
    gateway,
    protocol,
    request_context,
    tool_registry,
)


SyncUpstreamHandler: TypeAlias = Callable[[httpx.Request], httpx.Response]
AsyncUpstreamHandler: TypeAlias = Callable[
    [httpx.Request], Coroutine[None, None, httpx.Response]
]
UpstreamHandler: TypeAlias = SyncUpstreamHandler | AsyncUpstreamHandler
UpstreamTransport: TypeAlias = httpx.AsyncBaseTransport | UpstreamHandler

READ_ONLY_ANNOTATIONS = {
    'readOnlyHint': True,
    'destructiveHint': False,
    'idempotentHint': True,
    'openWorldHint': False,
}
WRITE_ANNOTATIONS = {
    'readOnlyHint': False,
    'destructiveHint': False,
    'idempotentHint': False,
    'openWorldHint': False,
}
DESTRUCTIVE_WRITE_ANNOTATIONS = {
    'readOnlyHint': False,
    'destructiveHint': True,
    'idempotentHint': False,
    'openWorldHint': False,
}


class ProtocolHarness:
    """Run selected external tools through their real Streamable HTTP path."""

    def __init__(
        self,
        *,
        tool_names: Collection[str],
        bearer_secret: str,
        request_id: str,
        user_name: str = 'alice@example.com',
        request_timeout_seconds: float = 10,
    ) -> None:
        self.tool_names = tuple(tool_names)
        self.bearer_secret = bearer_secret
        self.request_id = request_id
        self.user_name = user_name
        self.request_timeout_seconds = request_timeout_seconds

    def create_application(self) -> Starlette:
        """Build one isolated selected-tool protocol application."""
        mcp_server = protocol.OSMOFastMCP(
            name='OSMO MCP protocol test',
            host='0.0.0.0',
            port=8000,
            streamable_http_path='/mcp',
            stateless_http=True,
            json_response=True,
        )
        tool_registry.register_tools(mcp_server, names=self.tool_names)
        application = mcp_server.streamable_http_app()
        application.add_middleware(
            request_context.RequestContextMiddleware,
            path='/mcp',
        )
        return application

    def headers(self) -> dict[str, str]:
        """Return the trusted Gateway headers for one MCP test request."""
        return {
            'Accept': 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            login.OSMO_AUTH_HEADER: f'Bearer {self.bearer_secret}',
            login.OSMO_USER_HEADER: self.user_name,
            request_context.REQUEST_ID_HEADER: self.request_id,
        }

    @staticmethod
    def tool_call(
        name: str,
        arguments: dict[str, object] | None = None,
        *,
        request_id: int = 1,
    ) -> dict[str, object]:
        """Build one tools/call JSON-RPC request."""
        return {
            'jsonrpc': '2.0',
            'id': request_id,
            'method': 'tools/call',
            'params': {
                'name': name,
                'arguments': arguments or {},
            },
        }

    @staticmethod
    def tool_list(*, request_id: int = 1) -> dict[str, object]:
        """Build one tools/list JSON-RPC request."""
        return {
            'jsonrpc': '2.0',
            'id': request_id,
            'method': 'tools/list',
            'params': {},
        }

    @contextlib.asynccontextmanager
    async def client(
        self,
        upstream: UpstreamTransport,
    ) -> AsyncIterator[httpx.AsyncClient]:
        """Open an MCP client backed by one bounded mock Gateway transport."""
        application = self.create_application()
        transport = (
            upstream
            if isinstance(upstream, httpx.AsyncBaseTransport)
            else httpx.MockTransport(upstream)
        )
        async with gateway.create_app_context(
            gateway_url='https://gateway.test',
            request_timeout_seconds=self.request_timeout_seconds,
            transport=transport,
        ) as app_context:
            application.state.mcp_app_context = app_context
            async with application.router.lifespan_context(application):
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=application),
                    base_url='http://mcp.test',
                ) as client:
                    yield client

    async def post_with_client(
        self,
        client: httpx.AsyncClient,
        payload: dict[str, object],
    ) -> httpx.Response:
        """Post one JSON-RPC payload through an already-open test client."""
        return await client.post(
            '/mcp',
            headers=self.headers(),
            json=payload,
        )

    async def post(
        self,
        upstream: UpstreamTransport,
        payload: dict[str, object],
    ) -> httpx.Response:
        """Open an isolated client and post one JSON-RPC payload."""
        async with self.client(upstream) as client:
            return await self.post_with_client(client, payload)

    async def call_tool_with_client(
        self,
        client: httpx.AsyncClient,
        name: str,
        arguments: dict[str, object] | None = None,
        *,
        request_id: int = 1,
    ) -> httpx.Response:
        """Invoke one selected tool through an already-open client."""
        return await self.post_with_client(
            client,
            self.tool_call(name, arguments, request_id=request_id),
        )

    async def call_tool(
        self,
        upstream: UpstreamTransport,
        name: str,
        arguments: dict[str, object] | None = None,
        *,
        request_id: int = 1,
    ) -> httpx.Response:
        """Invoke one selected tool through an isolated client."""
        return await self.post(
            upstream,
            self.tool_call(name, arguments, request_id=request_id),
        )

    async def list_tools(
        self,
        upstream: UpstreamTransport | None = None,
        *,
        request_id: int = 1,
    ) -> httpx.Response:
        """List the selected registry tools through the protocol."""
        return await self.post(
            (
                upstream
                if upstream is not None
                else _unexpected_upstream_request
            ),
            self.tool_list(request_id=request_id),
        )

    def assert_read_only_closed_catalog(
        self,
        test_case: unittest.TestCase,
        response: httpx.Response,
    ) -> dict[str, dict[str, Any]]:
        """Assert common external read-tool annotations and schema closure."""
        return self.assert_closed_catalog(
            test_case,
            response,
            expected_annotations={
                name: READ_ONLY_ANNOTATIONS
                for name in self.tool_names
            },
        )

    def assert_closed_catalog(
        self,
        test_case: unittest.TestCase,
        response: httpx.Response,
        *,
        expected_annotations: Mapping[str, dict[str, bool]],
    ) -> dict[str, dict[str, Any]]:
        """Assert exact annotations and recursively closed tool schemas."""
        test_case.assertEqual(response.status_code, 200)
        tools = {
            tool['name']: tool
            for tool in response.json()['result']['tools']
        }
        test_case.assertEqual(set(tools), set(self.tool_names))
        test_case.assertEqual(set(expected_annotations), set(self.tool_names))
        for name, tool in tools.items():
            test_case.assertEqual(
                tool['annotations'],
                expected_annotations[name],
            )
            input_schema = tool['inputSchema']
            test_case.assertFalse(input_schema['additionalProperties'])
            output_schema = tool['outputSchema']
            test_case.assertEqual(output_schema['type'], 'object')
            test_case.assertFalse(output_schema['additionalProperties'])
            for definition in output_schema.get('$defs', {}).values():
                if (
                    definition.get('type') == 'object'
                    and 'properties' in definition
                ):
                    test_case.assertFalse(
                        definition['additionalProperties']
                    )
        return tools


async def _unexpected_upstream_request(
    request: httpx.Request,
) -> httpx.Response:
    raise AssertionError(f'unexpected Gateway request: {request.url}')
