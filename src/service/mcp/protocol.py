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

from collections.abc import Mapping, Sequence
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ContentBlock
from mcp.types import Tool as MCPTool
import pydantic

from src.service.mcp import request_context


class OSMOFastMCP(FastMCP):
    """FastMCP server with fail-closed, non-reflective tool validation."""

    async def list_tools(self) -> list[MCPTool]:
        tools = await super().list_tools()
        for tool in tools:
            tool.inputSchema['additionalProperties'] = False
        return tools

    async def call_tool(
        self,
        name: str,
        arguments: dict[str, Any],
    ) -> Sequence[ContentBlock] | dict[str, Any]:
        tools_by_name = {
            tool.name: tool
            for tool in await super().list_tools()
        }
        tool = tools_by_name.get(name)
        if tool is None:
            raise ToolError('Unknown MCP tool.')

        allowed_arguments = set(tool.inputSchema.get('properties', {}))
        if not arguments.keys() <= allowed_arguments:
            raise ToolError('Invalid MCP tool arguments.')

        try:
            with request_context.track_request_task() as credentials:
                try:
                    result = await super().call_tool(name, arguments)
                except ToolError as error:
                    if isinstance(error.__cause__, pydantic.ValidationError):
                        raise ToolError('MCP tool validation failed.') from None
                    if _contains_relayed_credentials(str(error), credentials):
                        raise ToolError('MCP tool failed.') from None
                    raise

                if _contains_relayed_credentials(result, credentials):
                    raise ToolError('MCP tool returned an invalid response.')
                return result
        except request_context.RequestContextUnavailable:
            raise ToolError(
                'MCP request authentication context is unavailable.') from None


def _contains_relayed_credentials(
    value: object,
    credentials: request_context.RequestCredentials,
) -> bool:
    authorization_header = credentials.authorization_header
    _, _, bearer_token = authorization_header.partition(' ')
    sensitive_values = (authorization_header, bearer_token)
    return _contains_sensitive_value(value, sensitive_values)


def _contains_sensitive_value(
    value: object,
    sensitive_values: tuple[str, str],
) -> bool:
    if isinstance(value, str):
        authorization_header, bearer_token = sensitive_values
        return (
            authorization_header in value
            or (
                bearer_token in value
                if len(bearer_token)
                >= request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES
                else value == bearer_token
            )
        )
    if isinstance(value, bytes):
        authorization_header_bytes, bearer_token_bytes = (
            sensitive_value.encode('ascii')
            for sensitive_value in sensitive_values
        )
        return (
            authorization_header_bytes in value
            or (
                bearer_token_bytes in value
                if len(bearer_token_bytes)
                >= request_context.MIN_BEARER_TOKEN_SUBSTRING_BYTES
                else value == bearer_token_bytes
            )
        )
    if isinstance(value, pydantic.BaseModel):
        return _contains_sensitive_value(
            value.model_dump(mode='json', by_alias=True),
            sensitive_values,
        )
    if isinstance(value, Mapping):
        return any(
            _contains_sensitive_value(item, sensitive_values)
            for pair in value.items()
            for item in pair
        )
    if isinstance(value, Sequence):
        return any(
            _contains_sensitive_value(item, sensitive_values)
            for item in value
        )
    return False
