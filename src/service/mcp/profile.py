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
from typing import Annotated, Literal

from fastmcp import Context
import pydantic

from src.service.mcp import (
    access_scope,
    tool_errors,
    tool_requests,
    tool_validation,
)


ProfileSetting = Literal['pool', 'notifications']
ProfileValue = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=512),
]
ProfileEnabled = Annotated[
    pydantic.StrictBool,
    pydantic.Field(),
]

_MAX_PROFILE_UPDATE_RESPONSE_BYTES = 1024
_MAX_PROFILE_VALUE_BYTES = 512


class ProfileSettings(pydantic.BaseModel):
    """Allowlisted active-user settings."""

    model_config = pydantic.ConfigDict(extra='forbid')

    username: str | None = None
    email_notification: bool | None = None
    slack_notification: bool | None = None
    pool: str | None = None


class TokenIdentity(pydantic.BaseModel):
    """Non-secret identity metadata for the active access token."""

    model_config = pydantic.ConfigDict(extra='forbid')

    name: str
    expires_at: datetime.datetime | None = None


class ProfileResult(pydantic.BaseModel):
    """Closed, allowlisted projection of the active OSMO profile."""

    model_config = pydantic.ConfigDict(extra='forbid')

    profile: ProfileSettings
    roles: list[str]
    pools: list[str]
    token: TokenIdentity | None = None


class ProfileUpdateResult(pydantic.BaseModel):
    """Closed confirmation of one applied active-user profile setting."""

    model_config = pydantic.ConfigDict(extra='forbid')

    setting: ProfileSetting
    value: str
    enabled: bool | None
    updated: Literal[True]


async def osmo_get_profile(context: Context) -> ProfileResult:
    """Get the active user's OSMO profile, roles, and accessible pools."""
    active_profile = (
        await access_scope.request_access_scope(context)
    ).profile
    return ProfileResult.model_validate(
        active_profile.model_dump(),
        strict=True,
    )


async def osmo_set_profile(
    context: Context,
    setting: ProfileSetting,
    value: ProfileValue,
    enabled: ProfileEnabled | None = None,
) -> ProfileUpdateResult:
    """Update one allowlisted setting for the active OSMO user."""
    if setting not in ('pool', 'notifications'):
        raise tool_errors.PublicToolError('Invalid profile setting.')
    if enabled is not None and not isinstance(enabled, bool):
        raise tool_errors.PublicToolError('Invalid enabled.')

    payload: tool_requests.JsonObject
    applied_enabled: bool | None
    if setting == 'pool':
        if enabled is not None:
            raise tool_errors.PublicToolError(
                'Do not specify enabled when updating the default pool.'
            )
        validated_value = tool_validation.validate_query_text(
            value,
            field='profile value',
            max_bytes=_MAX_PROFILE_VALUE_BYTES,
        )
        payload = {'pool': validated_value}
        applied_enabled = None
    else:
        if value not in ('email', 'slack'):
            raise tool_errors.PublicToolError(
                'Notification value must be email or slack.'
            )
        validated_value = value
        applied_enabled = True if enabled is None else enabled
        payload = {
            (
                'email_notification'
                if value == 'email'
                else 'slack_notification'
            ): applied_enabled,
        }

    response = await tool_requests.request_json_mutation(
        context,
        method='POST',
        path='/api/profile/settings',
        operation='update the active user profile',
        max_response_bytes=_MAX_PROFILE_UPDATE_RESPONSE_BYTES,
        payload=payload,
    )
    if response is not None:
        raise tool_errors.uncertain_write_error(
            'update the active user profile'
        )
    return ProfileUpdateResult(
        setting=setting,
        value=validated_value,
        enabled=applied_enabled,
        updated=True,
    )
