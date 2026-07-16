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

from typing import Annotated

import pydantic

from src.service.mcp.tool_models import (
    ClosedToolModel,
    ExtensibleUpstreamModel,
    PageLimit,
    PageOffset,
)


MAX_QUERY_CHARACTERS = 256

SearchQuery = Annotated[
    str,
    pydantic.Field(max_length=MAX_QUERY_CHARACTERS),
]


class PoolResourceUsage(ClosedToolModel):
    """GPU quota and physical-capacity values returned by OSMO."""

    quota_used: str
    quota_free: str
    quota_limit: str
    total_usage: str
    total_capacity: str
    total_free: str


class PoolSummary(ClosedToolModel):
    """Agent-facing subset of one accessible pool."""

    name: str
    description: str
    status: str | None
    backend: str
    default_platform: str | None
    resource_usage: PoolResourceUsage


class SharedCapacity(ClosedToolModel):
    """Physical capacity counted once for one set of sharing pools."""

    total_capacity: str
    total_free: str


class PoolNodeSet(ClosedToolModel):
    """Pools sharing the same physical node capacity."""

    index: PageOffset
    shared_capacity: bool
    pool_names: list[str]
    capacity: SharedCapacity
    pools: list[PoolSummary]


class PoolSearchResult(ClosedToolModel):
    """Bounded pool output with complete accessible capacity kept explicit."""

    node_sets: list[PoolNodeSet]
    accessible_resource_sum: PoolResourceUsage
    count: PageOffset
    total_matches: PageOffset
    offset: PageOffset
    limit: PageLimit
    more_entries: bool


class _UpstreamPool(ExtensibleUpstreamModel):
    """Fields consumed from Core's larger pool response."""

    name: str
    description: str = ''
    status: str | None = None
    backend: str
    default_platform: str | None = None
    resource_usage: PoolResourceUsage


class _UpstreamNodeSet(ClosedToolModel):
    pools: list[_UpstreamPool]


class _UpstreamPoolResponse(ClosedToolModel):
    node_sets: list[_UpstreamNodeSet]
    resource_sum: PoolResourceUsage
