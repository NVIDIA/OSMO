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

from typing import Annotated, Literal, TypeAlias

import pydantic

from src.service.mcp.app_models import AppName, AppVersionNumber
from src.service.mcp.tool_models import ClosedToolModel, ExtensibleUpstreamModel
from src.service.mcp.workflow_action_models import PoolName
from src.service.mcp.workflow_models import WorkflowId, WorkflowPriority


MAX_APP_DESCRIPTION_BYTES = 2048
MAX_APP_SPEC_BYTES = 128 * 1024
MAX_PROJECTED_DELETE_VERSIONS = 200

AppDescription: TypeAlias = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_APP_DESCRIPTION_BYTES,
        description=(
            'Non-secret app description, bounded to 2 KiB UTF-8. This value '
            'is sent as an OSMO query parameter and may appear in Gateway '
            'access logs.'
        ),
    ),
]
AppSpecText: TypeAlias = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_APP_SPEC_BYTES,
        description=(
            'Inline OSMO app workflow YAML, bounded to 128 KiB UTF-8. Do not '
            'inline secrets; reference OSMO credentials instead. MCP does not '
            'return or log this value, but the calling client may retain its '
            'submitted arguments.'
        ),
        json_schema_extra={'writeOnly': True},
    ),
]
DeleteAppVersion: TypeAlias = Annotated[
    int,
    pydantic.Field(
        strict=True,
        ge=1,
        description=(
            'App version to delete. Specify exactly one of version or '
            'all_versions=true.'
        ),
    ),
]
DeleteAllVersions: TypeAlias = Annotated[
    pydantic.StrictBool,
    pydantic.Field(
        description=(
            'Delete every non-deleted version. Specify exactly one of version '
            'or all_versions=true.'
        ),
    ),
]


class CreateAppResult(ClosedToolModel):
    """Confirmation that Core created an app and scheduled its upload."""

    name: AppName
    version: Literal[1]
    created: Literal[True]
    upload_scheduled: Literal[True]


class UpstreamUpdateAppResult(ExtensibleUpstreamModel):
    """Allowlisted fields from Core's app update response."""

    uuid: Annotated[str, pydantic.Field(min_length=1, max_length=512)]
    version: AppVersionNumber
    name: AppName
    created_by: Annotated[str, pydantic.Field(min_length=1, max_length=512)]
    created_date: Annotated[str, pydantic.Field(min_length=1, max_length=128)]


class UpdateAppResult(ClosedToolModel):
    """Confirmation that Core scheduled upload of one new app version."""

    name: AppName
    version: AppVersionNumber
    upload_scheduled: Literal[True]


class UpstreamDeleteAppResult(ExtensibleUpstreamModel):
    """Allowlisted fields from Core's app deletion response."""

    versions: list[AppVersionNumber]


class DeleteAppResult(ClosedToolModel):
    """Versions Core accepted for asynchronous deletion."""

    name: AppName
    scheduled_versions: Annotated[
        list[AppVersionNumber],
        pydantic.Field(max_length=MAX_PROJECTED_DELETE_VERSIONS),
    ]
    scheduled_version_count: Annotated[
        int,
        pydantic.Field(strict=True, ge=0),
    ]
    more_versions: bool
    deletion_scheduled: bool


class RenameAppResult(ClosedToolModel):
    """Confirmation that Core synchronously renamed one app."""

    original_name: AppName
    new_name: AppName
    renamed: Literal[True]


class SubmitAppResult(ClosedToolModel):
    """Compact confirmation that Core accepted one app submission."""

    workflow_id: WorkflowId
    app_name: AppName
    app_version: AppVersionNumber
    pool: PoolName
    priority: WorkflowPriority
    submitted: Literal[True]
