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

import dataclasses

from mcp.server.fastmcp import Context

from src.service.mcp import tool_requests, tool_validation


_MAX_POOL_NAME_BYTES = 512


@dataclasses.dataclass(frozen=True, slots=True)
class AccessScope:
    """Validated profile plus stable ordered and membership pool views."""

    profile: tool_requests.ActiveProfile
    pools: tuple[str, ...]
    pool_names: frozenset[str]

    @property
    def default_pool(self) -> str | None:
        """Return the configured default only when it remains accessible."""
        default_pool = self.profile.profile.pool
        if default_pool and default_pool in self.pool_names:
            return default_pool
        return None

    @property
    def empty(self) -> bool:
        """Whether the caller has no accessible pools."""
        return not self.pools


def from_profile(profile: tool_requests.ActiveProfile) -> AccessScope:
    """Build an ordered, de-duplicated pool scope from a validated profile."""
    pools = tuple(dict.fromkeys(
        tool_validation.validate_query_text(
            pool,
            field='accessible pool',
            max_bytes=_MAX_POOL_NAME_BYTES,
        )
        for pool in profile.pools
    ))
    return AccessScope(
        profile=profile,
        pools=pools,
        pool_names=frozenset(pools),
    )


async def request_access_scope(context: Context) -> AccessScope:
    """Read the active profile once and derive its ordered pool scope."""
    return from_profile(await tool_requests.request_active_profile(context))
