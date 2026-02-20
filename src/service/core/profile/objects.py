"""
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.  # pylint: disable=line-too-long

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
from typing import List

import pydantic

from src.utils import connectors


class TokenIdentity(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """ Identity when the request is authenticated with an access token. """
    name: str
    expires_at: datetime.datetime | None = None  # YYYY-MM-DD when token is found in DB


class ProfileResponse(pydantic.BaseModel, extra=pydantic.Extra.forbid):
    """
    Profile and identity info. When token header is set, roles/pools are the
    token's; otherwise they are the user's. JSON is self-explanatory for CLI.
    """
    profile: connectors.UserProfile
    roles: List[str]
    pools: List[str]
    token: TokenIdentity | None = None
