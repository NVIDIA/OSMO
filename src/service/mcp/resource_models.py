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
)


MAX_SELECTORS = 100
MAX_SELECTOR_CHARACTERS = 512

Selector = Annotated[
    str,
    pydantic.Field(min_length=1, max_length=MAX_SELECTOR_CHARACTERS),
]
SelectorList = Annotated[
    list[Selector],
    pydantic.Field(min_length=1, max_length=MAX_SELECTORS),
]


class ResourceQuantity(ClosedToolModel):
    """One normalized OSMO resource quantity."""

    capacity: Annotated[int, pydantic.Field(ge=0)]
    used: Annotated[int, pydantic.Field(ge=0)]
    free: Annotated[int, pydantic.Field(ge=0)]
    unit: str | None = pydantic.Field(
        default=None,
        exclude_if=lambda value: value is None,
    )


class ResourceQuantities(ClosedToolModel):
    """Allowlisted quantities using the same units as the OSMO CLI."""

    storage: ResourceQuantity | None = pydantic.Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    cpu: ResourceQuantity | None = pydantic.Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    memory: ResourceQuantity | None = pydantic.Field(
        default=None,
        exclude_if=lambda value: value is None,
    )
    gpu: ResourceQuantity | None = pydantic.Field(
        default=None,
        exclude_if=lambda value: value is None,
    )


class ResourceSummary(ClosedToolModel):
    """One node assignment to a pool and platform."""

    node: str
    backend: str
    resource_type: str
    pool: str
    platform: str
    resources: ResourceQuantities


class ResourceListResult(ClosedToolModel):
    """Bounded, flattened node resource results."""

    resources: list[ResourceSummary]
    count: int
    total_entries: int
    offset: int
    limit: int
    more_entries: bool


class ResourceSelection(ClosedToolModel):
    pool: str
    platform: str


class ResourceConfiguration(ClosedToolModel):
    """Task-facing configuration for one node assignment."""

    host_network: bool
    privileged: bool
    default_mounts: list[str]
    allowed_mounts: list[str]


class ResourceDetail(ClosedToolModel):
    """Concise detail for one node and selected pool/platform assignment."""

    node: str
    backend: str
    resource_type: str
    assignments: dict[str, list[str]]
    selected: ResourceSelection
    resources: ResourceQuantities
    configuration: ResourceConfiguration


class _UpstreamResource(ExtensibleUpstreamModel):
    """Fields consumed from Core's larger node resource object."""

    hostname: str
    backend: str
    resource_type: str
    usage_fields: dict[str, pydantic.JsonValue]
    allocatable_fields: dict[str, pydantic.JsonValue]
    platform_allocatable_fields: dict[str, pydantic.JsonValue] | None = None
    platform_available_fields: dict[str, pydantic.JsonValue] | None = None
    config_fields: dict[str, pydantic.JsonValue] | None = None
    pool_platform_labels: dict[str, list[str]]


class _UpstreamResourcesResponse(ClosedToolModel):
    resources: list[_UpstreamResource]
