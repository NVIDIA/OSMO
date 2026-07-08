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

import httpx
from mcp import types as mcp_types
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
import pydantic

from src.service.mcp import identity, tokens


_PROFILE_PATH = '/api/profile/settings'
_MAX_PROFILE_RESPONSE_BYTES = 128 * 1024
_PROFILE_ERROR = 'Unable to retrieve the current OSMO profile.'


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
    """Strict profile fields expected from Core."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    username: str
    email_notification: bool | None
    slack_notification: bool | None
    pool: str | None


class _ProfileResponse(pydantic.BaseModel):
    """Strict Core response; token identity metadata is never returned."""

    model_config = pydantic.ConfigDict(extra='forbid', strict=True)

    profile: _ProfileSettings
    roles: list[str]
    pools: list[str]
    token: dict[str, object] | None = None


class _ProfileRequestError(RuntimeError):
    """Sanitized internal profile request failure."""


class _ProfileUnauthorizedError(_ProfileRequestError):
    """The delegated token was rejected by Gateway."""


def register_tools(server: FastMCP[tokens.AppContext]) -> None:
    """Register the production OSMO MCP tool catalog."""

    @server.tool(
        name='get_current_profile',
        title='Get Current OSMO Profile',
        description=(
            'Return the authenticated user\'s OSMO profile, roles, and accessible '
            'pools. The user identity is supplied by the trusted OSMO Gateway.'),
        annotations=mcp_types.ToolAnnotations(
            readOnlyHint=True,
            destructiveHint=False,
            idempotentHint=True,
            openWorldHint=False,
        ),
    )
    async def get_current_profile(context: Context) -> CurrentProfile:
        """Return the trusted caller's profile through a delegated Gateway call."""
        request_identity = identity.get_request_identity()
        app_context = context.request_context.lifespan_context
        if not isinstance(app_context, tokens.AppContext):
            raise ToolError(_PROFILE_ERROR) from None

        try:
            delegated_token = await app_context.delegated_tokens.get_token()
            try:
                profile_response = await _request_profile(
                    app_context, delegated_token, request_identity.request_id)
            except _ProfileUnauthorizedError:
                # Compare-and-delete prevents a stale 401 from removing a newer
                # token installed by another request. Retry the API call only once.
                await app_context.delegated_tokens.invalidate(delegated_token)
                delegated_token = await app_context.delegated_tokens.get_token()
                try:
                    profile_response = await _request_profile(
                        app_context, delegated_token, request_identity.request_id)
                except _ProfileUnauthorizedError:
                    # Never leave a token cached after Gateway has rejected it.
                    await app_context.delegated_tokens.invalidate(delegated_token)
                    raise

            if profile_response.profile.username != request_identity.user_name:
                raise _ProfileRequestError(
                    'Gateway profile identity does not match the MCP caller.')
        except (tokens.TokenProviderError, _ProfileRequestError):
            raise ToolError(_PROFILE_ERROR) from None

        return CurrentProfile(
            username=profile_response.profile.username,
            email_notification=profile_response.profile.email_notification,
            slack_notification=profile_response.profile.slack_notification,
            pool=profile_response.profile.pool,
            roles=profile_response.roles,
            pools=profile_response.pools,
        )


async def _request_profile(
    app_context: tokens.AppContext,
    delegated_token: str,
    request_id: str | None,
) -> _ProfileResponse:
    headers = {'Authorization': f'Bearer {delegated_token}'}
    if request_id is not None:
        headers['x-request-id'] = request_id

    try:
        # Bound the complete exchange in addition to HTTPX's per-phase timeouts.
        async with asyncio.timeout(app_context.request_timeout_seconds):
            async with app_context.http_client.stream(
                'GET', _PROFILE_PATH, headers=headers,
            ) as response:
                if response.status_code == 401:
                    raise _ProfileUnauthorizedError(
                        'Gateway rejected the delegated token.')
                if response.status_code != 200:
                    raise _ProfileRequestError(
                        f'Gateway profile request failed with status '
                        f'{response.status_code}.')

                response_body = bytearray()
                async for chunk in response.aiter_bytes():
                    if len(response_body) + len(chunk) > _MAX_PROFILE_RESPONSE_BYTES:
                        raise _ProfileRequestError(
                            'Gateway profile response exceeds the size limit.')
                    response_body.extend(chunk)
    except (TimeoutError, httpx.RequestError):
        raise _ProfileRequestError(
            'Gateway profile request is unavailable.') from None

    try:
        return _ProfileResponse.model_validate_json(response_body)
    except (ValueError, pydantic.ValidationError):
        raise _ProfileRequestError(
            'Gateway profile response is invalid.') from None
