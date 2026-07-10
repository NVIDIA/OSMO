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

from collections.abc import Sequence
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ContentBlock
from mcp.types import Tool as MCPTool
import pydantic


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
            return await super().call_tool(name, arguments)
        except ToolError as error:
            if isinstance(error.__cause__, pydantic.ValidationError):
                raise ToolError('MCP tool validation failed.') from None
            raise
