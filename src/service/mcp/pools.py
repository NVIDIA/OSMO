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

from mcp.server.fastmcp import Context

from src.service.mcp import access_scope, tool_requests, tool_validation
from src.service.mcp.pool_models import (
    MAX_QUERY_CHARACTERS as _MAX_QUERY_CHARACTERS,
    PageLimit,
    PageOffset,
    PoolNodeSet,
    PoolResourceUsage,
    PoolSearchResult,
    PoolSummary,
    SearchQuery,
    SharedCapacity,
    _UpstreamPool,
    _UpstreamPoolResponse,
)
from src.service.mcp.tool_errors import PublicToolError


_POOL_QUOTA_PATH = '/api/pool_quota'
_MAX_POOL_RESPONSE_BYTES = 1024 * 1024
_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200


async def osmo_search_pools(
    context: Context,
    query: SearchQuery | None = None,
    limit: PageLimit = _DEFAULT_LIMIT,
    offset: PageOffset = 0,
) -> PoolSearchResult:
    """Search pools accessible to the active user without double-counting shared capacity."""
    normalized_query = _normalize_query(query)
    tool_validation.validate_page(
        limit,
        offset,
        maximum_limit=_MAX_LIMIT,
        error_message='Invalid pool pagination arguments.',
    )

    scope = await access_scope.request_access_scope(context)
    if scope.empty:
        return PoolSearchResult(
            node_sets=[],
            accessible_resource_sum=_zero_resource_usage(),
            count=0,
            total_matches=0,
            offset=offset,
            limit=limit,
            more_entries=False,
        )

    accessible_pools = list(scope.pools)
    pool_payload = await tool_requests.request_json_object(
        context,
        path=_POOL_QUOTA_PATH,
        operation='search accessible pools',
        max_response_bytes=_MAX_POOL_RESPONSE_BYTES,
        query={
            'all_pools': False,
            'pools': accessible_pools,
        },
    )
    upstream = tool_validation.validate_response(
        _UpstreamPoolResponse,
        pool_payload,
        error_message='OSMO returned an invalid pool response.',
    )

    accessible_names = scope.pool_names
    records: list[tuple[int, _UpstreamPool, list[str], SharedCapacity]] = []
    for index, node_set in enumerate(upstream.node_sets):
        node_set_names = [pool.name for pool in node_set.pools]
        if any(name not in accessible_names for name in node_set_names):
            raise PublicToolError('OSMO returned an invalid pool response.')
        if not node_set.pools:
            continue
        capacity = SharedCapacity(
            total_capacity=node_set.pools[0].resource_usage.total_capacity,
            total_free=node_set.pools[0].resource_usage.total_free,
        )
        for pool in node_set.pools:
            if _matches_query(pool, normalized_query):
                records.append((index, pool, node_set_names, capacity))

    total_matches = len(records)
    page = records[offset:offset + limit]
    grouped_pools: dict[int, list[PoolSummary]] = {}
    node_set_metadata: dict[int, tuple[list[str], SharedCapacity]] = {}
    for index, pool, node_set_names, capacity in page:
        grouped_pools.setdefault(index, []).append(_pool_summary(pool))
        node_set_metadata[index] = (node_set_names, capacity)

    node_sets = []
    for index, page_pools in grouped_pools.items():
        node_set_names, capacity = node_set_metadata[index]
        node_sets.append(PoolNodeSet(
            index=index,
            shared_capacity=len(node_set_names) > 1,
            pool_names=node_set_names,
            capacity=capacity,
            pools=page_pools,
        ))

    return PoolSearchResult(
        node_sets=node_sets,
        # Core computes this over the complete accessible response and counts
        # each shared node set once. Local search and pagination must not turn
        # it into a misleading sum of repeated per-pool capacity.
        accessible_resource_sum=upstream.resource_sum,
        count=len(page),
        total_matches=total_matches,
        offset=offset,
        limit=limit,
        more_entries=offset + len(page) < total_matches,
    )


def _normalize_query(query: str | None) -> str:
    if query is None:
        return ''
    if (
        not isinstance(query, str)
        or len(query) > _MAX_QUERY_CHARACTERS
        or any(ord(character) < 0x20 or ord(character) == 0x7F for character in query)
    ):
        raise PublicToolError('Invalid pool search query.')
    return query.strip().casefold()


def _zero_resource_usage() -> PoolResourceUsage:
    return PoolResourceUsage(
        quota_used='0',
        quota_free='0',
        quota_limit='0',
        total_usage='0',
        total_capacity='0',
        total_free='0',
    )


def _matches_query(pool: _UpstreamPool, query: str) -> bool:
    if not query:
        return True
    values = (
        pool.name,
        pool.description,
        pool.status or '',
        pool.backend,
        pool.default_platform or '',
    )
    return any(query in value.casefold() for value in values)


def _pool_summary(pool: _UpstreamPool) -> PoolSummary:
    return PoolSummary(
        name=pool.name,
        description=pool.description,
        status=pool.status,
        backend=pool.backend,
        default_platform=pool.default_platform,
        resource_usage=pool.resource_usage,
    )
