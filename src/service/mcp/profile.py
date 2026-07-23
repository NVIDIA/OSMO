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

from mcp.server.fastmcp import Context
import pydantic

from src.service.mcp import access_scope


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


async def osmo_get_profile(context: Context) -> ProfileResult:
    """Get the active user's OSMO profile, roles, and accessible pools."""
    active_profile = (
        await access_scope.request_access_scope(context)
    ).profile
    return ProfileResult.model_validate(
        active_profile.model_dump(),
        strict=True,
    )
