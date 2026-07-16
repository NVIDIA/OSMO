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

from collections.abc import Callable, Collection
import dataclasses

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from src.service.mcp import (
    health,
    pools,
    profile,
    resources,
)


@dataclasses.dataclass(frozen=True, slots=True)
class ToolSpec:
    """Registration metadata for one external OSMO MCP tool."""

    function: Callable[..., object]
    name: str
    title: str
    description: str


TOOL_SPECS: tuple[ToolSpec, ...] = (
    ToolSpec(
        function=health.osmo_health,
        name='osmo_health',
        title='Check OSMO health',
        description=(
            'Verify caller-bound Gateway authentication and OSMO API access. '
            'This is separate from the MCP process health endpoints.'
        ),
    ),
    ToolSpec(
        function=profile.osmo_get_profile,
        name='osmo_get_profile',
        title='Get OSMO profile',
        description=(
            'Get the active user\'s OSMO profile settings, roles, accessible '
            'pools, and non-secret token identity metadata.'
        ),
    ),
    ToolSpec(
        function=pools.osmo_search_pools,
        name='osmo_search_pools',
        title='Search OSMO pools',
        description=(
            'Search compute pools accessible to the active user. Results retain '
            'node-set sharing information, GPU quota usage, and bounded output.'
        ),
    ),
    ToolSpec(
        function=resources.osmo_list_resources,
        name='osmo_list_resources',
        title='List OSMO resources',
        description=(
            'List node capacity, usage, and available resources for selected '
            'pools and platforms with bounded output.'
        ),
    ),
    ToolSpec(
        function=resources.osmo_get_resource,
        name='osmo_get_resource',
        title='Get OSMO resource',
        description=(
            'Get one node\'s resource quantities and task configuration for a '
            'selected pool/platform assignment.'
        ),
    ),
)


def select_tool_specs(
    names: Collection[str] | None = None,
) -> tuple[ToolSpec, ...]:
    """Select tools by name while retaining the canonical registration order."""
    if names is None:
        return TOOL_SPECS

    requested_names = frozenset(names)
    known_names = frozenset(spec.name for spec in TOOL_SPECS)
    unknown_names = requested_names - known_names
    if unknown_names:
        formatted_names = ', '.join(sorted(unknown_names))
        raise ValueError(f'Unknown OSMO MCP tool name(s): {formatted_names}.')
    return tuple(
        spec for spec in TOOL_SPECS if spec.name in requested_names
    )


def register_tools(
    server: FastMCP,
    *,
    names: Collection[str] | None = None,
) -> None:
    """Register the selected external tools without wrapping their functions."""
    for spec in select_tool_specs(names):
        server.add_tool(
            spec.function,
            name=spec.name,
            title=spec.title,
            description=spec.description,
            annotations=ToolAnnotations(
                readOnlyHint=True,
                destructiveHint=False,
                idempotentHint=True,
                openWorldHint=False,
            ),
            structured_output=True,
        )
