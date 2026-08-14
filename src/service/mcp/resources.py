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

from fastmcp import Context
import pydantic

from src.lib.utils import resource_quantities
from src.service.mcp import (
    access_scope,
    tool_errors,
    tool_requests,
    tool_validation,
)
from src.service.mcp.resource_models import (
    MAX_SELECTORS as _MAX_SELECTORS,
    MAX_SELECTOR_CHARACTERS as _MAX_SELECTOR_CHARACTERS,
    PageLimit,
    PageOffset,
    ResourceConfiguration,
    ResourceDetail,
    ResourceListResult,
    ResourceQuantity,
    ResourceQuantities,
    ResourceSelection,
    ResourceSummary,
    Selector,
    SelectorList,
    _UpstreamResource,
    _UpstreamResourcesResponse,
)


__all__ = (
    'PageLimit',
    'PageOffset',
    'ResourceConfiguration',
    'ResourceDetail',
    'ResourceListResult',
    'ResourceQuantities',
    'ResourceQuantity',
    'ResourceSelection',
    'ResourceSummary',
    'Selector',
    'SelectorList',
    'osmo_get_resource',
    'osmo_list_resources',
)


_RESOURCES_PATH = '/api/resources'
_MAX_RESOURCES_RESPONSE_BYTES = 2 * 1024 * 1024
_DEFAULT_LIMIT = 50
_MAX_LIMIT = 200
_RESOURCE_NOT_FOUND_MESSAGE = 'The requested node is not available.'


async def osmo_list_resources(
    context: Context,
    pool: SelectorList | None = None,
    platform: SelectorList | None = None,
    all_pools: bool = False,
    limit: PageLimit = _DEFAULT_LIMIT,
    offset: PageOffset = 0,
) -> ResourceListResult:
    """List node capacity, usage, and availability by pool/platform assignment."""
    tool_validation.validate_page(
        limit,
        offset,
        maximum_limit=_MAX_LIMIT,
        error_message='Invalid resource pagination arguments.',
    )
    pools = _validated_selectors(pool, field='pool')
    platforms = _validated_selectors(platform, field='platform')
    if all_pools and pools:
        raise tool_errors.PublicToolError(
            'pool and all_pools=true cannot be used together.'
        )

    scope = await access_scope.request_access_scope(context)
    if scope.empty:
        return ResourceListResult(
            resources=[],
            count=0,
            total_entries=0,
            offset=offset,
            limit=limit,
            more_entries=False,
        )
    if all_pools:
        pools = list(scope.pools)
    elif pools:
        if any(pool_name not in scope.pool_names for pool_name in pools):
            raise tool_errors.PublicToolError(
                'One or more requested pools are not accessible.'
            )
    else:
        if scope.default_pool is not None:
            pools = [scope.default_pool]
        elif len(scope.pools) == 1:
            pools = [scope.pools[0]]
        else:
            raise tool_errors.PublicToolError(
                'No accessible default pool is configured; provide pool or '
                'set all_pools=true.'
            )

    query: dict[str, bool | list[str]] = {
        'all_pools': False,
        'pools': pools,
    }
    if platforms:
        query['platforms'] = platforms

    payload = await tool_requests.request_json_object(
        context,
        path=_RESOURCES_PATH,
        operation='list node resources',
        max_response_bytes=_MAX_RESOURCES_RESPONSE_BYTES,
        query=query,
    )
    upstream = _validate_resources_response(payload)

    requested_pools = set(pools)
    requested_platforms = set(platforms)
    entries: list[ResourceSummary] = []
    for resource in sorted(
        upstream.resources,
        key=lambda item: (item.hostname, item.backend, item.resource_type),
    ):
        for pool_name in sorted(resource.pool_platform_labels):
            if requested_pools and pool_name not in requested_pools:
                continue
            for platform_name in sorted(set(
                resource.pool_platform_labels[pool_name]
            )):
                if requested_platforms and platform_name not in requested_platforms:
                    continue
                entries.append(_resource_summary(resource, pool_name, platform_name))

    total_entries = len(entries)
    page = entries[offset:offset + limit]
    return ResourceListResult(
        resources=page,
        count=len(page),
        total_entries=total_entries,
        offset=offset,
        limit=limit,
        more_entries=offset + len(page) < total_entries,
    )


async def osmo_get_resource(
    context: Context,
    node_name: Selector,
    pool: Selector | None = None,
    platform: Selector | None = None,
) -> ResourceDetail:
    """Get one node's resources and task configuration for a pool/platform."""
    if (pool is None) != (platform is None):
        raise tool_errors.PublicToolError(
            'pool and platform must be provided together.'
        )

    encoded_node_name = tool_validation.safe_path_segment(
        node_name,
        field='node_name',
    )
    selected_pool = _validated_selector(pool, field='pool') if pool is not None else None
    selected_platform = (
        _validated_selector(platform, field='platform')
        if platform is not None
        else None
    )

    scope = await access_scope.request_access_scope(context)
    if (
        scope.empty
        or (
            selected_pool is not None
            and selected_pool not in scope.pool_names
        )
    ):
        raise _resource_not_found()

    payload = await tool_requests.request_json_object(
        context,
        path=f'{_RESOURCES_PATH}/{encoded_node_name}',
        operation='get a node resource',
        max_response_bytes=_MAX_RESOURCES_RESPONSE_BYTES,
        not_found_message=_RESOURCE_NOT_FOUND_MESSAGE,
    )
    upstream = _validate_resources_response(payload)
    node_resources = [
        resource
        for resource in upstream.resources
        if resource.hostname == node_name
    ]
    if not node_resources:
        raise _resource_not_found()

    if selected_pool is None or selected_platform is None:
        available_assignments = [
            (resource, pool_name, platform_name)
            for resource in node_resources
            for pool_name in sorted(resource.pool_platform_labels)
            if pool_name in scope.pool_names
            for platform_name in sorted(set(
                resource.pool_platform_labels[pool_name]
            ))
        ]
        if not available_assignments:
            raise _resource_not_found()
        if len(available_assignments) != 1:
            raise tool_errors.PublicToolError(
                'The node has multiple accessible pool/platform assignments; '
                'provide pool and platform.'
            )
        resource, selected_pool, selected_platform = available_assignments[0]
    else:
        candidates = [
            resource
            for resource in node_resources
            if selected_platform in resource.pool_platform_labels.get(
                selected_pool,
                [],
            )
        ]
        if not candidates:
            raise _resource_not_found()
        if len(candidates) > 1:
            raise tool_errors.PublicToolError(
                'OSMO returned an ambiguous node resource response.'
            )
        resource = candidates[0]

    assignments = {
        pool_name: sorted(set(resource.pool_platform_labels[pool_name]))
        for pool_name in sorted(resource.pool_platform_labels)
        if (
            pool_name in scope.pool_names
            and resource.pool_platform_labels[pool_name]
        )
    }
    if not assignments:
        raise _resource_not_found()
    if (
        selected_pool not in assignments
        or selected_platform not in assignments[selected_pool]
    ):
        raise _resource_not_found()

    config_payload = _nested_object(
        resource.config_fields,
        selected_pool,
        selected_platform,
    )
    configuration = tool_validation.validate_response(
        ResourceConfiguration,
        {
            key: config_payload[key]
            for key in ResourceConfiguration.model_fields
            if key in config_payload
        },
        error_message='OSMO returned an invalid node resource response.',
    )

    summary = _resource_summary(resource, selected_pool, selected_platform)
    return ResourceDetail(
        node=resource.hostname,
        backend=resource.backend,
        resource_type=resource.resource_type,
        assignments=assignments,
        selected=ResourceSelection(
            pool=selected_pool,
            platform=selected_platform,
        ),
        resources=summary.resources,
        configuration=configuration,
    )


def _validate_resources_response(
    payload: tool_requests.JsonObject,
) -> _UpstreamResourcesResponse:
    return tool_validation.validate_response(
        _UpstreamResourcesResponse,
        payload,
        error_message='OSMO returned an invalid resource response.',
    )


def _resource_summary(
    resource: _UpstreamResource,
    pool: str,
    platform: str,
) -> ResourceSummary:
    return ResourceSummary(
        node=resource.hostname,
        backend=resource.backend,
        resource_type=resource.resource_type,
        pool=pool,
        platform=platform,
        resources=_normalized_quantities(resource, pool, platform),
    )


def _nested_object(
    root: dict[str, pydantic.JsonValue] | None,
    first_key: str,
    second_key: str,
) -> dict[str, pydantic.JsonValue]:
    if root is None:
        return {}
    first_value = root.get(first_key)
    if not isinstance(first_value, dict):
        return {}
    second_value = first_value.get(second_key)
    if not isinstance(second_value, dict):
        return {}
    return second_value


def _normalized_quantities(
    resource: _UpstreamResource,
    pool: str,
    platform: str,
) -> ResourceQuantities:
    try:
        quantities = resource_quantities.normalize_resource_quantities(
            resource.model_dump(),
            pool,
            platform,
        )
        return ResourceQuantities.model_validate(quantities, strict=True)
    except (ValueError, TypeError, OverflowError, pydantic.ValidationError):
        raise tool_errors.PublicToolError(
            'OSMO returned an invalid resource response.'
        ) from None


def _resource_not_found() -> tool_errors.PublicToolError:
    return tool_errors.PublicToolError(_RESOURCE_NOT_FOUND_MESSAGE)


def _validated_selectors(values: list[str] | None, *, field: str) -> list[str]:
    if values is None:
        return []
    if (
        not isinstance(values, list)
        or not values
        or len(values) > _MAX_SELECTORS
    ):
        raise tool_errors.PublicToolError(f'Invalid {field} filters.')
    return list(dict.fromkeys(
        _validated_selector(value, field=field)
        for value in values
    ))


def _validated_selector(value: str, *, field: str) -> str:
    if not isinstance(value, str) or len(value) > _MAX_SELECTOR_CHARACTERS:
        raise tool_errors.PublicToolError(f'Invalid {field}.')
    # Query values are encoded by GatewayClient; call the shared segment helper
    # here for the same empty/control/slash/traversal validation without using
    # its percent-encoded return value as a query value.
    tool_validation.safe_path_segment(value, field=field)
    return value
