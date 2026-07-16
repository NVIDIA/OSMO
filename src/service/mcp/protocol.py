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
import json
import time
from typing import Any

from mcp.server.fastmcp import FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ContentBlock
from mcp.types import Tool as MCPTool
import pydantic

from src.service.mcp import request_context, telemetry, tool_errors


_MAX_SERIALIZED_TOOL_RESULT_BYTES = 512 * 1024


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
        start_time = time.monotonic()
        telemetry_tool_name = 'unknown'
        request_id: str | None = None
        outcome = 'unexpected_error'
        try:
            request_id = (
                request_context.get_request_credentials().request_id
            )
            tools_by_name = {
                tool.name: tool
                for tool in await super().list_tools()
            }
            tool = tools_by_name.get(name)
            if tool is None:
                outcome = 'public_error'
                raise tool_errors.PublicToolError('Unknown MCP tool.')
            telemetry_tool_name = tool.name

            allowed_arguments = set(tool.inputSchema.get('properties', {}))
            if not arguments.keys() <= allowed_arguments:
                outcome = 'validation_error'
                raise tool_errors.PublicToolError(
                    'Invalid MCP tool arguments.'
                )

            with (
                request_context.track_request_task() as credentials,
                request_context.track_tool(telemetry_tool_name),
            ):
                if _contains_relayed_credentials(arguments, credentials):
                    outcome = 'validation_error'
                    raise tool_errors.PublicToolError(
                        'MCP tool arguments are invalid.'
                    )
                try:
                    result = await super().call_tool(name, arguments)
                except ToolError as error:
                    if isinstance(error.__cause__, pydantic.ValidationError):
                        outcome = 'validation_error'
                        raise tool_errors.PublicToolError(
                            'MCP tool validation failed.'
                        ) from None
                    public_error = tool_errors.from_fastmcp_error(error)
                    if public_error is None:
                        outcome = 'unexpected_error'
                        raise tool_errors.PublicToolError(
                            tool_errors.GENERIC_TOOL_ERROR
                        ) from None
                    if _contains_relayed_credentials(
                        str(public_error),
                        credentials,
                    ):
                        outcome = 'unexpected_error'
                        raise tool_errors.PublicToolError(
                            tool_errors.GENERIC_TOOL_ERROR
                        ) from None
                    outcome = 'public_error'
                    raise public_error from None

                outcome = 'invalid_result'
                if _contains_relayed_credentials(result, credentials):
                    raise tool_errors.PublicToolError(
                        'MCP tool returned an invalid response.'
                    )
                if _serialized_size(result) > _MAX_SERIALIZED_TOOL_RESULT_BYTES:
                    raise tool_errors.PublicToolError(
                        'MCP tool result exceeds the size limit.'
                    )
                outcome = 'success'
                return result
        except tool_errors.PublicToolError:
            raise
        except request_context.RequestContextUnavailable:
            outcome = 'context_error'
            raise tool_errors.PublicToolError(
                'MCP request authentication context is unavailable.') from None
        except Exception:
            outcome = 'unexpected_error'
            raise tool_errors.PublicToolError(
                tool_errors.GENERIC_TOOL_ERROR
            ) from None
        finally:
            # Observability must never replace the sanitized MCP result.
            try:
                telemetry.log_tool_outcome(
                    tool_name=telemetry_tool_name,
                    outcome=outcome,
                    duration_ms=(time.monotonic() - start_time) * 1000,
                    request_id=request_id,
                )
            except Exception:  # pylint: disable=broad-exception-caught
                pass


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


def _serialized_size(value: object) -> int:
    """Measure the JSON form handed to MCP before transport-level duplication."""
    try:
        payload = json.dumps(
            _json_safe(value),
            ensure_ascii=False,
            separators=(',', ':'),
        ).encode('utf-8')
    except (TypeError, ValueError, UnicodeError):
        raise tool_errors.PublicToolError(
            'MCP tool returned an invalid response.'
        ) from None
    return len(payload)


def _json_safe(value: object) -> object:
    if isinstance(value, pydantic.BaseModel):
        return _json_safe(value.model_dump(mode='json', by_alias=True))
    if isinstance(value, Mapping):
        return {
            str(key): _json_safe(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [_json_safe(item) for item in value]
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='strict')
    if isinstance(value, bytearray):
        return bytes(value).decode('utf-8', errors='strict')
    return value
