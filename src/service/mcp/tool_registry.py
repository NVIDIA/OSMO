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

from fastmcp import FastMCP
from mcp.types import ToolAnnotations

from src.service.mcp import (
    app_actions,
    app_submission,
    apps,
    credential_actions,
    credentials,
    health,
    pools,
    profile,
    resources,
    workflow_actions,
    workflows,
)


def _read_only_annotations() -> ToolAnnotations:
    return ToolAnnotations(
        readOnlyHint=True,
        destructiveHint=False,
        idempotentHint=True,
        openWorldHint=False,
    )


def _write_annotations(
    *,
    destructive: bool,
    idempotent: bool = False,
    open_world: bool = False,
) -> ToolAnnotations:
    return ToolAnnotations(
        readOnlyHint=False,
        destructiveHint=destructive,
        idempotentHint=idempotent,
        openWorldHint=open_world,
    )


@dataclasses.dataclass(frozen=True, slots=True)
class ToolSpec:
    """Registration metadata for one external OSMO MCP tool."""

    function: Callable[..., object]
    name: str
    title: str
    description: str
    annotations: ToolAnnotations = dataclasses.field(
        default_factory=_read_only_annotations
    )


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
        function=profile.osmo_set_profile,
        name='osmo_set_profile',
        title='Update OSMO profile',
        description=(
            'Update the active user\'s default pool or notification settings. '
            'This overwrites saved profile state and is not automatically retried.'
        ),
        annotations=_write_annotations(
            destructive=True,
            idempotent=True,
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
    ToolSpec(
        function=workflows.osmo_list_workflows,
        name='osmo_list_workflows',
        title='List OSMO workflows',
        description=(
            'List the active user\'s workflows across accessible pools, newest '
            'first, with optional label selectors and absent-label keys.'
        ),
    ),
    ToolSpec(
        function=workflows.osmo_list_tasks,
        name='osmo_list_tasks',
        title='List OSMO tasks',
        description=(
            'List tasks on explicitly named nodes across the caller\'s '
            'accessible pools, including task status, workflow, and owner. '
            'Defaults to the active user\'s tasks; set all_users=true to '
            'include tasks owned by other users.'
        ),
    ),
    ToolSpec(
        function=workflows.osmo_get_workflow,
        name='osmo_get_workflow',
        title='Get OSMO workflow',
        description=(
            'Get one workflow\'s status, labels, policy warnings, and optional '
            'task-group metadata; set skip_groups=true for a compact result.'
        ),
    ),
    ToolSpec(
        function=workflows.osmo_get_workflow_logs,
        name='osmo_get_workflow_logs',
        title='Get OSMO workflow logs',
        description=(
            'Get bounded workflow or task logs; set last_n_lines for an explicit '
            'tail and select error logs explicitly.'
        ),
    ),
    ToolSpec(
        function=workflows.osmo_get_workflow_events,
        name='osmo_get_workflow_events',
        title='Get OSMO workflow events',
        description=(
            'Get bounded scheduling and lifecycle events; use the logs tool for output.'
        ),
    ),
    ToolSpec(
        function=workflows.osmo_get_workflow_spec,
        name='osmo_get_workflow_spec',
        title='Get OSMO workflow spec',
        description=(
            'Get the bounded, server-redacted resolved or template workflow YAML.'
        ),
    ),
    ToolSpec(
        function=workflow_actions.osmo_submit_workflow,
        name='osmo_submit_workflow',
        title='Submit an OSMO workflow',
        description=(
            'Submit raw workflow YAML with optional non-secret label overrides. '
            'This consumes real compute and is not automatically retried.'
        ),
        annotations=_write_annotations(destructive=False),
    ),
    ToolSpec(
        function=workflow_actions.osmo_validate_workflow,
        name='osmo_validate_workflow',
        title='Validate an OSMO workflow',
        description=(
            'Validate workflow YAML and optional non-secret label overrides '
            'with OSMO Core. A failed validation may create a '
            'FAILED_SUBMISSION record.'
        ),
        annotations=_write_annotations(destructive=False),
    ),
    ToolSpec(
        function=workflow_actions.osmo_restart_workflow,
        name='osmo_restart_workflow',
        title='Restart an OSMO workflow',
        description=(
            'Restart one failed workflow as a new run. This consumes real '
            'compute and requires source-workflow read access.'
        ),
        annotations=_write_annotations(destructive=True),
    ),
    ToolSpec(
        function=workflow_actions.osmo_cancel_workflow,
        name='osmo_cancel_workflow',
        title='Cancel an OSMO workflow',
        description=(
            'Request cancellation of one workflow; force cancellation is '
            'destructive and not reversible.'
        ),
        annotations=_write_annotations(destructive=True),
    ),
    ToolSpec(
        function=apps.osmo_list_apps,
        name='osmo_list_apps',
        title='List OSMO apps',
        description=(
            'List a bounded page of OSMO apps newest first. By default, '
            'results are scoped to apps associated with the active user.'
        ),
    ),
    ToolSpec(
        function=apps.osmo_get_app,
        name='osmo_get_app',
        title='Get OSMO app',
        description=(
            'Get stable metadata and newest-first version information for '
            'one OSMO app.'
        ),
    ),
    ToolSpec(
        function=apps.osmo_get_app_spec,
        name='osmo_get_app_spec',
        title='Get OSMO app spec',
        description=(
            'Get the bounded plain-text workflow spec for one OSMO app. '
            'When version is omitted, resolve the newest READY version from '
            'bounded version history.'
        ),
    ),
    ToolSpec(
        function=app_actions.osmo_create_app,
        name='osmo_create_app',
        title='Create OSMO app',
        description=(
            'Create an app from bounded inline workflow YAML and schedule '
            'version 1 for upload. The non-secret description is sent as a '
            'query parameter and may appear in Gateway logs.'
        ),
        annotations=_write_annotations(destructive=False),
    ),
    ToolSpec(
        function=app_actions.osmo_update_app,
        name='osmo_update_app',
        title='Update OSMO app',
        description=(
            'Always create and schedule upload of a new app version from '
            'bounded inline workflow YAML; unlike the CLI editor flow, this '
            'tool does not skip unchanged content.'
        ),
        annotations=_write_annotations(destructive=False),
    ),
    ToolSpec(
        function=app_actions.osmo_delete_app,
        name='osmo_delete_app',
        title='Delete OSMO app',
        description=(
            'Schedule deletion of one version or all non-deleted versions. '
            'Specify exactly one of version or all_versions=true.'
        ),
        annotations=_write_annotations(destructive=True),
    ),
    ToolSpec(
        function=app_actions.osmo_rename_app,
        name='osmo_rename_app',
        title='Rename OSMO app',
        description=(
            'Synchronously rename one active-user-owned app. This changes '
            'the app identifier and is not automatically retried.'
        ),
        annotations=_write_annotations(destructive=True),
    ),
    ToolSpec(
        function=app_submission.osmo_submit_app,
        name='osmo_submit_app',
        title='Submit OSMO app',
        description=(
            'Resolve and pin a READY app version, then submit it with optional '
            'non-secret label overrides. This consumes real compute and is not '
            'automatically retried.'
        ),
        annotations=_write_annotations(destructive=False),
    ),
    ToolSpec(
        function=credentials.osmo_list_credentials,
        name='osmo_list_credentials',
        title='List OSMO credentials',
        description=(
            'List only the active user\'s credential names and types. '
            'Profiles and credential payloads are never returned.'
        ),
    ),
    ToolSpec(
        function=credential_actions.osmo_delete_credential,
        name='osmo_delete_credential',
        title='Delete OSMO credential',
        description=(
            'Delete one active-user credential without returning its payload '
            'or legacy profile value.'
        ),
        annotations=_write_annotations(
            destructive=True,
            idempotent=True,
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
        server.tool(
            spec.function,
            name=spec.name,
            title=spec.title,
            description=spec.description,
            annotations=spec.annotations,
        )
