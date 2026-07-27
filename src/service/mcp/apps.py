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
import re

from mcp.server.fastmcp import Context

from src.service.mcp import tool_requests, tool_validation
from src.service.mcp.app_models import (
    APP_NAME_PATTERN as _APP_NAME_PATTERN,
    MAX_APP_FILTER_BYTES as _MAX_APP_FILTER_BYTES,
    MAX_USER_FILTER_BYTES as _MAX_USER_FILTER_BYTES,
    AppListLimit,
    AppListOffset,
    AppListResult,
    AppName,
    AppNameFilter,
    AppResult,
    AppSpecResult,
    AppVersionNumber,
    UserFilters,
    _UpstreamAppListResult,
    _UpstreamAppResult,
)
from src.service.mcp.tool_errors import PublicToolError


_APP_LIST_PATH = '/api/app'
_MAX_APP_RESPONSE_BYTES = 1024 * 1024
_MAX_APP_SPEC_BYTES = 32 * 1024
_DEFAULT_APP_LIST_LIMIT = 50
_APP_VERSION_RESOLUTION_LIMIT = 200


@dataclasses.dataclass(frozen=True, slots=True)
class ResolvedAppVersion:
    """Validated app identity and one concrete READY version."""

    encoded_name: str
    uuid: str
    version: int


async def osmo_list_apps(
    context: Context,
    name: AppNameFilter | None = None,
    users: UserFilters | None = None,
    all_users: bool = False,
    limit: AppListLimit = _DEFAULT_APP_LIST_LIMIT,
    offset: AppListOffset = 0,
) -> AppListResult:
    """List OSMO apps newest first, scoped to the active user by default."""
    if users is not None and all_users:
        raise PublicToolError('Specify either users or all_users, not both.')

    query: dict[str, str | int | bool | list[str]] = {
        'order': 'DESC',
        'limit': limit,
        'offset': offset,
    }
    if name is not None:
        query['name'] = tool_validation.validate_query_text(
            name,
            field='app name filter',
            max_bytes=_MAX_APP_FILTER_BYTES,
        )
    if users is not None:
        query['users'] = list(dict.fromkeys(
            tool_validation.validate_query_text(
                user,
                field='app user filter',
                max_bytes=_MAX_USER_FILTER_BYTES,
            )
            for user in users
        ))
    if all_users:
        query['all_users'] = True

    response = await tool_requests.request_json_object(
        context,
        path=_APP_LIST_PATH,
        operation='list OSMO apps',
        max_response_bytes=_MAX_APP_RESPONSE_BYTES,
        query=query,
    )
    upstream = tool_validation.validate_response(
        _UpstreamAppListResult,
        response,
        operation='list OSMO apps',
    )
    return AppListResult.model_validate(upstream.model_dump(), strict=True)


async def osmo_get_app(
    context: Context,
    name: AppName,
    version: AppVersionNumber | None = None,
    limit: AppListLimit = _DEFAULT_APP_LIST_LIMIT,
) -> AppResult:
    """Get OSMO app metadata and versions, newest version first."""
    encoded_name = validated_app_name(name)
    upstream = await _request_app(
        context,
        encoded_name=encoded_name,
        version=version,
        limit=limit + 1,
        operation='get an OSMO app',
    )
    return AppResult.model_validate({
        **upstream.model_dump(),
        'versions': [
            app_version.model_dump()
            for app_version in upstream.versions[:limit]
        ],
        'more_versions': len(upstream.versions) > limit,
    }, strict=True)


async def osmo_get_app_spec(
    context: Context,
    name: AppName,
    version: AppVersionNumber | None = None,
) -> AppSpecResult:
    """Get an app spec, resolving READY metadata from bounded history."""
    encoded_name = validated_app_name(name)
    resolved_version = version
    if resolved_version is None:
        resolved = await resolve_ready_app_version(
            context,
            name=name,
            version=None,
            operation='resolve the newest READY OSMO app version',
        )
        encoded_name = resolved.encoded_name
        resolved_version = resolved.version

    spec_result = await tool_requests.request_truncated_text(
        context,
        path=f'/api/app/user/{encoded_name}/spec',
        operation='get an OSMO app spec',
        max_response_bytes=_MAX_APP_SPEC_BYTES,
        query={'version': resolved_version},
    )
    return AppSpecResult(
        name=name,
        version=resolved_version,
        spec=spec_result.text,
        truncated=spec_result.truncated,
        truncation_reason=spec_result.truncation_reason,
    )


def validated_app_name(
    name: object,
    *,
    field: str = 'app name',
) -> str:
    """Validate and encode one app name for a fixed Core route."""
    if (
        not isinstance(name, str)
        or re.fullmatch(_APP_NAME_PATTERN, name) is None
    ):
        raise PublicToolError(f'Invalid {field}.')
    return tool_validation.safe_path_segment(name, field=field)


async def resolve_ready_app_version(
    context: Context,
    *,
    name: AppName,
    version: AppVersionNumber | None,
    operation: str,
) -> ResolvedAppVersion:
    """Resolve and validate one concrete READY app version for reuse."""
    encoded_name = validated_app_name(name)
    validated_version = tool_validation.validate_optional_integer(
        version,
        field='app version',
        minimum=1,
    )
    upstream = await _request_app(
        context,
        encoded_name=encoded_name,
        version=validated_version,
        limit=(
            1
            if validated_version is not None
            else _APP_VERSION_RESOLUTION_LIMIT + 1
        ),
        operation=operation,
    )
    if upstream.name != name:
        raise PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        )
    try:
        uuid = tool_validation.validate_query_text(
            upstream.uuid,
            field='app UUID',
            max_bytes=512,
        )
    except PublicToolError:
        raise PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        ) from None
    if len(upstream.versions) != len({
        app_version.version for app_version in upstream.versions
    }):
        raise PublicToolError(
            f'OSMO returned an invalid response while attempting to {operation}.'
        )

    resolved_version: int | None
    if validated_version is not None:
        if not upstream.versions:
            raise PublicToolError(
                'The requested OSMO app version is not READY.'
            )
        app_version = upstream.versions[0]
        if (
            len(upstream.versions) != 1
            or app_version.version != validated_version
        ):
            raise PublicToolError(
                f'OSMO returned an invalid response while attempting to {operation}.'
            )
        if app_version.status != 'READY':
            raise PublicToolError(
                'The requested OSMO app version is not READY.'
            )
        resolved_version = validated_version
    else:
        resolved_version = max(
            (
                app_version.version
                for app_version in upstream.versions[
                    :_APP_VERSION_RESOLUTION_LIMIT
                ]
                if app_version.status == 'READY'
            ),
            default=None,
        )
        if resolved_version is None:
            if len(upstream.versions) > _APP_VERSION_RESOLUTION_LIMIT:
                raise PublicToolError(
                    'Unable to resolve the newest READY OSMO app version '
                    'within the bounded version history; specify version '
                    'explicitly.'
                )
            raise PublicToolError(
                'The requested OSMO app has no READY versions.'
            )

    return ResolvedAppVersion(
        encoded_name=encoded_name,
        uuid=uuid,
        version=resolved_version,
    )


async def _request_app(
    context: Context,
    *,
    encoded_name: str,
    version: int | None,
    limit: int,
    operation: str,
) -> _UpstreamAppResult:
    query: dict[str, str | int] = {
        'order': 'DESC',
        'limit': limit,
    }
    if version is not None:
        query['version'] = version

    response = await tool_requests.request_json_object(
        context,
        path=f'/api/app/user/{encoded_name}',
        operation=operation,
        max_response_bytes=_MAX_APP_RESPONSE_BYTES,
        query=query,
    )
    return tool_validation.validate_response(
        _UpstreamAppResult,
        response,
        operation=operation,
    )
