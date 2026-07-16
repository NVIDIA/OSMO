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

from typing import Annotated, TypeAlias

import pydantic

from src.service.mcp.tool_models import (
    ClosedToolModel,
    ExtensibleUpstreamModel,
    PageLimit,
    PageOffset,
)


APP_NAME_PATTERN = r'^[A-Za-z0-9_-]+$'
MAX_APP_FILTER_BYTES = 512
MAX_USER_FILTER_BYTES = 256

AppName: TypeAlias = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_APP_FILTER_BYTES,
        pattern=APP_NAME_PATTERN,
        description='OSMO app name.',
    ),
]
AppNameFilter: TypeAlias = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_APP_FILTER_BYTES,
        description='Substring to match in app names.',
    ),
]
UserFilter: TypeAlias = Annotated[
    str,
    pydantic.Field(
        min_length=1,
        max_length=MAX_USER_FILTER_BYTES,
        description='OSMO user name whose owned apps should be listed.',
    ),
]
UserFilters: TypeAlias = Annotated[
    list[UserFilter],
    pydantic.Field(min_length=1, max_length=50),
]
AppListLimit: TypeAlias = PageLimit
AppListOffset: TypeAlias = PageOffset
AppVersionNumber: TypeAlias = Annotated[
    int,
    pydantic.Field(strict=True, ge=1),
]


class AppSummary(ClosedToolModel):
    """Stable, non-secret metadata for one OSMO app."""

    uuid: Annotated[str, pydantic.Field(min_length=1)]
    name: Annotated[str, pydantic.Field(min_length=1)]
    description: str
    created_date: Annotated[str, pydantic.Field(min_length=1)]
    owner: Annotated[str, pydantic.Field(min_length=1)]
    latest_version: AppVersionNumber


class AppListResult(ClosedToolModel):
    """One bounded page of OSMO apps."""

    apps: list[AppSummary]
    more_entries: bool


class AppVersion(ClosedToolModel):
    """Metadata for one version of an OSMO app."""

    version: AppVersionNumber
    created_by: Annotated[str, pydantic.Field(min_length=1)]
    created_date: Annotated[str, pydantic.Field(min_length=1)]
    status: Annotated[str, pydantic.Field(min_length=1)]


class AppResult(ClosedToolModel):
    """Stable metadata and versions for one OSMO app."""

    uuid: Annotated[str, pydantic.Field(min_length=1)]
    name: Annotated[str, pydantic.Field(min_length=1)]
    description: str
    created_date: Annotated[str, pydantic.Field(min_length=1)]
    owner: Annotated[str, pydantic.Field(min_length=1)]
    versions: list[AppVersion]
    more_versions: bool


class AppSpecResult(ClosedToolModel):
    """The requested OSMO app spec and its selection metadata."""

    name: AppName
    version: AppVersionNumber
    spec: str
    truncated: bool
    truncation_reason: str | None


class _UpstreamAppSummary(AppSummary):
    """Core app summary with additive response fields ignored."""

    model_config = pydantic.ConfigDict(extra='ignore')


class _UpstreamAppListResult(ExtensibleUpstreamModel):
    apps: list[_UpstreamAppSummary]
    more_entries: bool


class _UpstreamAppVersion(AppVersion):
    """Core app version with additive response fields ignored."""

    model_config = pydantic.ConfigDict(extra='ignore')


class _UpstreamAppResult(ExtensibleUpstreamModel):
    uuid: Annotated[str, pydantic.Field(min_length=1)]
    name: Annotated[str, pydantic.Field(min_length=1)]
    description: str
    created_date: Annotated[str, pydantic.Field(min_length=1)]
    owner: Annotated[str, pydantic.Field(min_length=1)]
    versions: list[_UpstreamAppVersion]
