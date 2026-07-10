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

from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
import pydantic
from starlette.requests import Request

from src.lib.api import profile as profile_contract
from src.service.mcp import gateway, request_context


_PROFILE_PATH = '/api/profile/settings'
_MAX_PROFILE_RESPONSE_BYTES = 64 * 1024


async def osmo_get_profile(context: Context) -> profile_contract.ProfileResponse:
    """Get the active user's OSMO profile, roles, and accessible pools."""
    app_context = _get_app_context(context)
    try:
        credentials = request_context.get_request_credentials()
    except RuntimeError:
        raise ToolError(
            'MCP request authentication context is unavailable.') from None

    try:
        response = await app_context.gateway.request(
            'GET',
            _PROFILE_PATH,
            credentials=credentials,
            max_response_bytes=_MAX_PROFILE_RESPONSE_BYTES,
        )
    except gateway.GatewayClientError as error:
        raise ToolError(str(error)) from None

    if response.status_code != 200:
        raise ToolError(_profile_error(response.status_code))

    try:
        return profile_contract.ProfileResponse.model_validate_json(
            response.body,
            strict=True,
        )
    except pydantic.ValidationError:
        raise ToolError('OSMO returned an invalid profile response.') from None


def register_tools(server: FastMCP) -> None:
    """Register profile tools on one FastMCP server instance."""
    server.add_tool(
        osmo_get_profile,
        name='osmo_get_profile',
        title='Get OSMO profile',
        description=(
            'Get the active user\'s OSMO profile settings, roles, accessible '
            'pools, and non-secret token identity metadata.'
        ),
        annotations=ToolAnnotations(
            readOnlyHint=True,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
        structured_output=True,
    )


def _get_app_context(context: Context) -> gateway.AppContext:
    try:
        request = context.request_context.request
    except ValueError:
        raise ToolError('MCP runtime context is unavailable.') from None
    if not isinstance(request, Request):
        raise ToolError('MCP runtime context is unavailable.')

    try:
        app_context = request.app.state.mcp_app_context
    except (AttributeError, KeyError):
        raise ToolError('MCP runtime context is unavailable.') from None
    if not isinstance(app_context, gateway.AppContext):
        raise ToolError('MCP runtime context is unavailable.')
    return app_context


def _profile_error(status_code: int) -> str:
    if status_code == 401:
        message = 'OSMO rejected the active authentication'
    elif status_code == 403:
        message = 'OSMO authorization denied profile access'
    elif status_code == 429:
        message = 'OSMO profile access is rate limited'
    elif 500 <= status_code < 600:
        message = 'OSMO profile service is unavailable'
    else:
        message = 'OSMO profile request failed'
    return f'{message} (HTTP {status_code}).'
