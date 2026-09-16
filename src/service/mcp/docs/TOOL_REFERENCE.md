<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# MCP tool reference

Generated from [tool_registry.py](../tool_registry.py); do not edit by hand.
See [tool contracts](../TOOLS.md) for API mappings, CLI relationships, and
operational caveats. Annotations are client-facing hints, not authorization rules.

## `osmo_health`

Check OSMO health

Verify caller-bound Gateway authentication and OSMO API access. This is separate from the MCP process health endpoints.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_profile`

Get OSMO profile

Get the active user's OSMO profile settings, roles, accessible pools, and non-secret token identity metadata.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_set_profile`

Update OSMO profile

Update the active user's default pool or notification settings. This overwrites saved profile state and is not automatically retried.

Annotations: `{"destructiveHint": true, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_search_pools`

Search OSMO pools

Search compute pools accessible to the active user. Results retain node-set sharing information, GPU quota usage, and bounded output.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_list_resources`

List OSMO resources

List node capacity, usage, and available resources for selected pools and platforms with bounded output.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_resource`

Get OSMO resource

Get one node's resource quantities and task configuration for a selected pool/platform assignment.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_list_workflows`

List OSMO workflows

List the active user's workflows across accessible pools, newest first, with optional label selectors and absent-label keys.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_list_tasks`

List OSMO tasks

List tasks on explicitly named nodes across the caller's accessible pools, including task status, workflow, and owner. Defaults to the active user's tasks; set all_users=true to include tasks owned by other users.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_workflow`

Get OSMO workflow

Get one workflow's status, labels, policy warnings, and optional task-group metadata; set skip_groups=true for a compact result.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_workflow_logs`

Get OSMO workflow logs

Get bounded workflow or task logs; set last_n_lines for an explicit tail and select error logs explicitly.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_workflow_events`

Get OSMO workflow events

Get bounded scheduling and lifecycle events; use the logs tool for output.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_workflow_spec`

Get OSMO workflow spec

Get the bounded, server-redacted resolved or template workflow YAML.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_submit_workflow`

Submit an OSMO workflow

Submit raw workflow YAML with optional non-secret label overrides. This consumes real compute and is not automatically retried.

Annotations: `{"destructiveHint": false, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_validate_workflow`

Validate an OSMO workflow

Validate workflow YAML and optional non-secret label overrides with OSMO Core. A failed validation may create a FAILED_SUBMISSION record.

Annotations: `{"destructiveHint": false, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_restart_workflow`

Restart an OSMO workflow

Restart one failed workflow as a new run. This consumes real compute and requires source-workflow read access.

Annotations: `{"destructiveHint": true, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_cancel_workflow`

Cancel an OSMO workflow

Request cancellation of one workflow; force cancellation is destructive and not reversible.

Annotations: `{"destructiveHint": true, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_list_apps`

List OSMO apps

List a bounded page of OSMO apps newest first. By default, results are scoped to apps associated with the active user.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_app`

Get OSMO app

Get stable metadata and newest-first version information for one OSMO app.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_get_app_spec`

Get OSMO app spec

Get the bounded plain-text workflow spec for one OSMO app. When version is omitted, resolve the newest READY version from bounded version history.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_create_app`

Create OSMO app

Create an app from bounded inline workflow YAML and schedule version 1 for upload. The non-secret description is sent as a query parameter and may appear in Gateway logs.

Annotations: `{"destructiveHint": false, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_update_app`

Update OSMO app

Always create and schedule upload of a new app version from bounded inline workflow YAML; unlike the CLI editor flow, this tool does not skip unchanged content.

Annotations: `{"destructiveHint": false, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_delete_app`

Delete OSMO app

Schedule deletion of one version or all non-deleted versions. Specify exactly one of version or all_versions=true.

Annotations: `{"destructiveHint": true, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_rename_app`

Rename OSMO app

Synchronously rename one active-user-owned app. This changes the app identifier and is not automatically retried.

Annotations: `{"destructiveHint": true, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_submit_app`

Submit OSMO app

Resolve and pin a READY app version, then submit it with optional non-secret label overrides. This consumes real compute and is not automatically retried.

Annotations: `{"destructiveHint": false, "idempotentHint": false, "openWorldHint": false, "readOnlyHint": false}`

## `osmo_list_credentials`

List OSMO credentials

List only the active user's credential names and types. Profiles and credential payloads are never returned.

Annotations: `{"destructiveHint": false, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": true}`

## `osmo_delete_credential`

Delete OSMO credential

Delete one active-user credential without returning its payload or legacy profile value.

Annotations: `{"destructiveHint": true, "idempotentHint": true, "openWorldHint": false, "readOnlyHint": false}`
