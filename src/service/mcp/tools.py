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

import datetime

from mcp import types as mcp_types
from mcp.server.fastmcp import Context
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.fastmcp.tools import Tool
import pydantic

from src.service.mcp import gateway, request_context


_PROFILE_PATH = '/api/profile/settings'
_MAX_PROFILE_RESPONSE_BYTES = 128 * 1024
_PROFILE_ERROR = 'Unable to retrieve the current OSMO profile.'
_PROFILE_AUTH_ERROR = 'OSMO authentication was rejected. Reauthenticate and try again.'
_PROFILE_PERMISSION_ERROR = 'OSMO denied access to the current profile.'


class CurrentProfile(pydantic.BaseModel):
    """Safe subset of the signed-in user's OSMO profile."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    username: str
    email_notification: bool | None
    slack_notification: bool | None
    pool: str | None
    roles: list[str]
    pools: list[str]


class _ProfileSettings(pydantic.BaseModel):
    """Strict profile fields expected from the existing OSMO API."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    username: str
    email_notification: bool | None
    slack_notification: bool | None
    pool: str | None


class _TokenIdentity(pydantic.BaseModel):
    """Identity metadata returned by Core but never exposed by the MCP tool."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    name: str
    expires_at: datetime.datetime | None


class _ProfileResponse(pydantic.BaseModel):
    """Strict response contract for the existing profile endpoint."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    profile: _ProfileSettings
    roles: list[str]
    pools: list[str]
    token: _TokenIdentity | None = None


def create_tools() -> list[Tool]:
    """Create the Phase B OSMO MCP tool catalog."""
    profile_tool = Tool.from_function(
        get_current_profile,
        name='get_current_profile',
        title='Get Current OSMO Profile',
        description=(
            'Return the authenticated user\'s OSMO profile, roles, and accessible '
            'pools. Identity and permissions come from the OSMO Gateway.'),
        annotations=mcp_types.ToolAnnotations(
            # The existing GET endpoint may initialize a missing default profile.
            readOnlyHint=False,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
    )

    # FastMCP has no public strict-arguments switch and ignores extras by
    # default. Tighten its generated model so schema and runtime both reject
    # caller-supplied identity fields.
    argument_model = profile_tool.fn_metadata.arg_model
    argument_model.model_config['extra'] = 'forbid'
    argument_model.model_rebuild(force=True)
    profile_tool.parameters = argument_model.model_json_schema(by_alias=True)
    return [profile_tool]


async def get_current_profile(context: Context) -> CurrentProfile:
    """Return the signed-in caller's profile through the OSMO Gateway."""
    app_context = context.request_context.lifespan_context
    if not isinstance(app_context, gateway.AppContext):
        raise ToolError(_PROFILE_ERROR) from None

    credentials = request_context.get_request_credentials()
    try:
        response = await app_context.gateway.request(
            'GET',
            _PROFILE_PATH,
            max_response_bytes=_MAX_PROFILE_RESPONSE_BYTES,
        )
    except (gateway.GatewayClientError, ValueError):
        raise ToolError(_PROFILE_ERROR) from None

    if response.status_code == 401:
        raise ToolError(_PROFILE_AUTH_ERROR) from None
    if response.status_code == 403:
        raise ToolError(_PROFILE_PERMISSION_ERROR) from None
    if response.status_code != 200:
        raise ToolError(_PROFILE_ERROR) from None

    try:
        profile_response = _ProfileResponse.model_validate_json(response.body)
    except (ValueError, pydantic.ValidationError):
        raise ToolError(_PROFILE_ERROR) from None

    if profile_response.profile.username != credentials.user_name:
        raise ToolError(_PROFILE_ERROR) from None

    return CurrentProfile(
        username=profile_response.profile.username,
        email_notification=profile_response.profile.email_notification,
        slack_notification=profile_response.profile.slack_notification,
        pool=profile_response.profile.pool,
        roles=profile_response.roles,
        pools=profile_response.pools,
    )
