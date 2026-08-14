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

from src.service.mcp import apps, tool_errors, tool_requests, tool_validation
from src.service.mcp.app_action_models import (
    MAX_APP_DESCRIPTION_BYTES,
    MAX_APP_SPEC_BYTES,
    MAX_PROJECTED_DELETE_VERSIONS,
    AppDescription,
    AppSpecText,
    CreateAppResult,
    DeleteAllVersions,
    DeleteAppVersion,
    DeleteAppResult,
    RenameAppResult,
    UpdateAppResult,
    UpstreamDeleteAppResult,
    UpstreamUpdateAppResult,
)
from src.service.mcp.app_models import AppName


_MAX_NULL_RESPONSE_BYTES = 1024
_MAX_MUTATION_RESPONSE_BYTES = 64 * 1024
_APP_NAME_ADAPTER = pydantic.TypeAdapter(AppName)
_DELETE_SELECTOR_ERROR = (
    'Specify exactly one of version or all_versions=true.'
)


async def osmo_create_app(
    context: Context,
    name: AppName,
    description: AppDescription,
    spec_content: AppSpecText,
) -> CreateAppResult:
    """Create an OSMO app and schedule upload of its first version."""
    encoded_name = apps.validated_app_name(name)
    validated_description = tool_validation.validate_query_text(
        description,
        field='app description',
        max_bytes=MAX_APP_DESCRIPTION_BYTES,
    )
    validated_spec = _validate_app_spec(spec_content)
    response = await tool_requests.request_json_mutation(
        context,
        method='POST',
        path=f'/api/app/user/{encoded_name}',
        operation='create an OSMO app',
        max_response_bytes=_MAX_NULL_RESPONSE_BYTES,
        query={'description': validated_description},
        payload=validated_spec,
    )
    _require_null_response(response, operation='create an OSMO app')
    return CreateAppResult(
        name=name,
        version=1,
        created=True,
        upload_scheduled=True,
    )


async def osmo_update_app(
    context: Context,
    name: AppName,
    spec_content: AppSpecText,
) -> UpdateAppResult:
    """Create and schedule upload of one new OSMO app version."""
    encoded_name = apps.validated_app_name(name)
    validated_spec = _validate_app_spec(spec_content)
    response = await tool_requests.request_json_mutation(
        context,
        method='PATCH',
        path=f'/api/app/user/{encoded_name}',
        operation='update an OSMO app',
        max_response_bytes=_MAX_MUTATION_RESPONSE_BYTES,
        payload=validated_spec,
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamUpdateAppResult,
        response,
        operation='update an OSMO app',
    )
    if upstream.name != name:
        raise tool_errors.uncertain_write_error('update an OSMO app')
    return UpdateAppResult(
        name=upstream.name,
        version=upstream.version,
        upload_scheduled=True,
    )


async def osmo_delete_app(
    context: Context,
    name: AppName,
    version: DeleteAppVersion | None = None,
    all_versions: DeleteAllVersions = False,
) -> DeleteAppResult:
    """Schedule deletion of one app version or every non-deleted version."""
    encoded_name = apps.validated_app_name(name)
    validated_version = tool_validation.validate_optional_integer(
        version,
        field='app version',
        minimum=1,
    )
    if (
        not isinstance(all_versions, bool)
        or (validated_version is None) == (not all_versions)
    ):
        raise tool_errors.PublicToolError(_DELETE_SELECTOR_ERROR)

    query: dict[str, int | bool]
    if all_versions:
        query = {'all_versions': True}
    elif validated_version is not None:
        query = {'version': validated_version}
    else:
        raise tool_errors.PublicToolError(_DELETE_SELECTOR_ERROR)
    response = await tool_requests.request_json_mutation(
        context,
        method='DELETE',
        path=f'/api/app/user/{encoded_name}',
        operation='delete an OSMO app',
        max_response_bytes=_MAX_MUTATION_RESPONSE_BYTES,
        query=query,
    )
    upstream = tool_validation.validate_mutation_response(
        UpstreamDeleteAppResult,
        response,
        operation='delete an OSMO app',
    )
    if (
        len(upstream.versions) != len(set(upstream.versions))
        or (
            validated_version is not None
            and upstream.versions not in ([], [validated_version])
        )
    ):
        raise tool_errors.uncertain_write_error('delete an OSMO app')
    scheduled_version_count = len(upstream.versions)
    return DeleteAppResult(
        name=name,
        scheduled_versions=(
            upstream.versions[:MAX_PROJECTED_DELETE_VERSIONS]
        ),
        scheduled_version_count=scheduled_version_count,
        more_versions=(
            scheduled_version_count > MAX_PROJECTED_DELETE_VERSIONS
        ),
        deletion_scheduled=scheduled_version_count > 0,
    )


async def osmo_rename_app(
    context: Context,
    original_name: AppName,
    new_name: AppName,
) -> RenameAppResult:
    """Synchronously rename one OSMO app owned by the active user."""
    encoded_original_name = apps.validated_app_name(
        original_name,
        field='original app name',
    )
    apps.validated_app_name(new_name, field='new app name')
    if original_name == new_name:
        raise tool_errors.PublicToolError(
            'Original and new app names must differ.'
        )

    response = await tool_requests.request_json_mutation(
        context,
        method='POST',
        path=f'/api/app/user/{encoded_original_name}/rename',
        operation='rename an OSMO app',
        max_response_bytes=_MAX_MUTATION_RESPONSE_BYTES,
        payload=new_name,
    )
    try:
        renamed_to = _APP_NAME_ADAPTER.validate_python(
            response,
            strict=True,
        )
    except pydantic.ValidationError:
        raise tool_errors.uncertain_write_error(
            'rename an OSMO app'
        ) from None
    if renamed_to != new_name:
        raise tool_errors.uncertain_write_error('rename an OSMO app')
    return RenameAppResult(
        original_name=original_name,
        new_name=renamed_to,
        renamed=True,
    )


def _validate_app_spec(spec_content: str) -> str:
    return tool_validation.validate_inline_text(
        spec_content,
        field='spec_content',
        max_bytes=MAX_APP_SPEC_BYTES,
    )


def _require_null_response(
    response: pydantic.JsonValue,
    *,
    operation: str,
) -> None:
    if response is not None:
        raise tool_errors.uncertain_write_error(operation)
