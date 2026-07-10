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

import pydantic


class UserProfile(pydantic.BaseModel):
    """ Provides all User Profile Information """

    username: str | None = None
    email_notification: bool | None = None
    slack_notification: bool | None = None
    pool: str | None = None


class TokenIdentity(pydantic.BaseModel):
    """ Identity when the request is authenticated with an access token. """

    model_config = pydantic.ConfigDict(extra='forbid')

    name: str
    expires_at: datetime.datetime | None = None


class ProfileResponse(pydantic.BaseModel):
    """
    Profile and identity info. When token header is set, roles/pools are the
    token's; otherwise they are the user's. JSON is self-explanatory for CLI.
    """

    model_config = pydantic.ConfigDict(extra='forbid')

    profile: UserProfile
    roles: list[str]
    pools: list[str]
    token: TokenIdentity | None = None
