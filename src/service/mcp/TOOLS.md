<!--
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
-->

# MCP tool contracts

The external MCP exposes a deliberately smaller surface than the OSMO CLI. A
tool is included only when it can be implemented as a bounded, fixed mapping to
an existing external REST API while preserving the caller's OSMO identity and
RBAC.

`tool_registry.py` owns the client-facing titles, descriptions, and annotations;
the [generated tool reference](docs/TOOL_REFERENCE.md) renders that metadata.
This document owns the API mappings, CLI relationships, and operational caveats;
catalog tests independently lock public names, function bindings, schemas, and
annotations.

After changing registry metadata, regenerate and check the reference from the
public checkout:

```bash
bazel run //src/service/mcp/docs:generate_tool_reference -- \
  --output "$PWD/src/service/mcp/docs/TOOL_REFERENCE.md"
bazel test //src/service/mcp/docs:test_tool_reference
```

The generator's `--check` option verifies an output without writing. This tooling
does not enter the MCP image dependency closure.

## Read-only operations

| Capability | Tools | Contract | OSMO APIs |
| --- | --- | --- | --- |
| Health | `osmo_health` | Caller-bound Gateway authentication and OSMO API access; distinct from Kubernetes probes | `GET /api/profile/settings` |
| Profile | `osmo_get_profile` | Active identity, settings, roles, accessible pools, and non-secret token name/expiry metadata | `GET /api/profile/settings` |
| Pools | `osmo_search_pools` | Accessible pools only; local text search and bounded output preserve shared node-set capacity | `GET /api/profile/settings`, `GET /api/pool_quota` |
| Resources | `osmo_list_resources`, `osmo_get_resource` | Profile-selected accessible pools; normalized CLI-compatible capacity/used/free quantities; local bounded output and uniform node not-found behavior | `GET /api/profile/settings`, `GET /api/resources`, `GET /api/resources/{node_name}` |
| Workflows | `osmo_list_workflows`, `osmo_get_workflow`, `osmo_get_workflow_logs`, `osmo_get_workflow_events`, `osmo_get_workflow_spec` | Active user's workflows in token-accessible pools; label filters, projected labels, and bounded/redacted policy warnings; canonical workflow IDs; compact status and marked bounded text | `GET /api/workflow...` |
| Tasks | `osmo_list_tasks` | Current-user tasks by default; `all_users=true` includes other users' tasks. Optional status filters and bounded output | `GET /api/task` |
| Applications | `osmo_list_apps`, `osmo_get_app`, `osmo_get_app_spec` | Active user's apps by default; app specs resolve a concrete newest READY version from bounded history when omitted, and return marked bounded text | `GET /api/app...` |
| Credential metadata | `osmo_list_credentials` | Names and types only; never profiles or credential payloads | `GET /api/credentials` |

These tools are read-only, idempotent, closed-world operations. Workflow and
application list APIs paginate upstream. Workflow pages are capped at 50
entries per page so maximum-size label maps remain within the upstream and MCP
result budgets. Pool and resource tools bound their
MCP output but may read a complete accessible upstream response because the
existing APIs do not offer agent-facing pagination. Logs apply Core's tail
control only when the caller explicitly requests it; all long-text tools return
a marked bounded prefix. JSON remains whole-response validated. Workflow UUID
lookup remains excluded until Gateway authorization resolves UUIDs to their
owning pool.

The existing resource APIs do not atomically intersect resource assignments
with the current allowed-pools header. MCP
uses the active profile snapshot and fails closed for callers with no pools.
Resource lists send a non-empty pool filter. Resource detail fetches only the
encoded node route, then filters its assignments against that same profile
scope before projecting any result. A future Core contract should perform the
intersection on the resource request itself. Large accessible-pool sets can
also reach the shared 16-KiB query ceiling for list requests even when MCP
output is small; this is bounded output, not end-to-end pagination.
Compact MCP quantities omit resource kinds without positive allocatable
capacity; the CLI detail view may render those kinds as an explicit zero.

Returning token name/expiry from `osmo_get_profile` is intentional. The tool
never returns bearer values.

Credential profiles are intentionally omitted even though the CLI may display
them. Legacy profile values can contain secret-bearing userinfo, queries, or
fragments; the external projection therefore returns only `cred_name` and
`cred_type`.

## CLI semantic parity

MCP results are compared with the CLI by meaning, not by serialized output.
The MCP deliberately returns compact, closed, bounded, and redacted DTOs, so
byte-for-byte equality with the CLI's presentation or raw API JSON is not a
valid compatibility contract. Overlapping fields and Core request semantics
must still agree.

The table below owns the CLI command mapping. "Projection" means a bounded
view of the same state, "Difference" identifies an intentional behavior change,
and "Shared request" means the final Core mutation agrees, not that auxiliary
reads or presentation are identical. Command names are references, not proof of
executed coverage; consult the CLI reference for complete arguments.

| MCP tool | CLI command | Relationship |
| --- | --- | --- |
| `osmo_health` | None | No equivalent |
| `osmo_get_profile` | `osmo profile list` | Projection |
| `osmo_set_profile` | `osmo profile set` | Projection |
| `osmo_search_pools` | `osmo pool list` | Projection |
| `osmo_list_resources` | `osmo resource list` | Projection |
| `osmo_get_resource` | `osmo resource info` | Projection |
| `osmo_list_workflows` | `osmo workflow list` | Difference |
| `osmo_list_tasks` | `osmo task list` | Projection |
| `osmo_get_workflow` | `osmo workflow query` | Projection |
| `osmo_get_workflow_logs` | `osmo workflow logs` | Projection |
| `osmo_get_workflow_events` | `osmo workflow events` | Projection |
| `osmo_get_workflow_spec` | `osmo workflow spec` | Projection |
| `osmo_submit_workflow` | `osmo workflow submit` | Difference |
| `osmo_validate_workflow` | `osmo workflow validate` | Difference |
| `osmo_restart_workflow` | `osmo workflow restart` | Shared request |
| `osmo_cancel_workflow` | `osmo workflow cancel` | Difference |
| `osmo_list_apps` | `osmo app list` | Projection |
| `osmo_get_app` | `osmo app info` | Projection |
| `osmo_get_app_spec` | `osmo app spec` | Projection |
| `osmo_create_app` | `osmo app create` | Difference |
| `osmo_update_app` | `osmo app update` | Difference |
| `osmo_delete_app` | `osmo app delete` | Projection |
| `osmo_rename_app` | `osmo app rename` | Projection |
| `osmo_submit_app` | `osmo app submit` | Difference |
| `osmo_list_credentials` | `osmo credential list` | Projection |
| `osmo_delete_credential` | `osmo credential delete` | Projection |

The CLI has no caller-bound health command. Resource detail requires explicit
pool/platform selection when a node has multiple accessible assignments; the
CLI selects the first assignment. Workflow lists retain the optional legacy
`tags` filter for MCP compatibility, while the 6.4 CLI removes it; both keep
label selectors. The workflow and app sections below explain inline YAML,
cancellation messages, version creation, and READY-version pinning differences.
Restart's shared final request is covered by
`test_workflow.WorkflowRestartTest.test_uses_source_workflow_pool_when_pool_is_omitted`
and `test_workflow_actions.test_restart_preflights_source_and_uses_its_pool`.

The CLI and MCP share dependency-light helpers for resource quantity
normalization, credential request envelopes, and workflow template detection.
`//src/service/mcp/tests:test_cli_parity` checks that every registered tool has
exactly one classification and locks selected shared behaviors with frozen
fixtures. CLI rationale lives here, not in a second test-owned prose inventory.
`//test/smoke:mcp-checks` additionally compares
stable profile and credential metadata through a deployed CLI and MCP using
the same caller. Mutable capacity counters and state-changing workflow, app,
and credential operations remain covered by deterministic route/payload tests
or explicit manual checks rather than sequential live comparisons.

## Workflow actions

`osmo_validate_workflow`, `osmo_submit_workflow`,
`osmo_restart_workflow`, and `osmo_cancel_workflow` are implemented.
Validation sets `validation_only=true` and is a non-idempotent write because a
failed validation can create a `FAILED_SUBMISSION` workflow record. Submission
accepts raw YAML and preserves the original template when it detects standard
Jinja and OSMO template markers. Submit and validation accept repeatable,
non-secret `key=value` label overrides matching the CLI; later duplicate keys
win in Core. Successful submission, validation, and restart results return
bounded, redacted label-policy warnings from Core. Label overrides are query
parameters and may appear in Gateway/authz access logs. Submission otherwise
returns only the new workflow ID, selected pool, and effective priority.
Restart and cancel are destructive one-shot operations.

Submit-by-workflow-ID is intentionally omitted. Core authorizes creation in the
target pool but does not enforce source-pool read access when retrieving the
source workflow. Dry-run rendering, environment injection, local-file
expansion, and rsync are also omitted from the agent-facing contract.

Restart accepts only a failed source workflow and always performs a compact
source-workflow GET before its POST. This requires `workflow:Read` on the
source before Core's restart route enforces `workflow:Create` on the target
pool. Cancel accepts one canonical ID per call and omits the CLI's persisted,
query-string cancellation message because Gateway and authz access logs record
it. The shared mutation relay never retries and reports an unknown outcome for
ambiguous transport, server, database, or malformed-success failures.

## User-owned mutations

`osmo_set_profile`, `osmo_delete_credential`,
`osmo_create_app`, `osmo_update_app`, `osmo_delete_app`,
`osmo_rename_app`, and `osmo_submit_app` are implemented. Profile updates
change exactly one external CLI-supported setting per call: the default pool,
email notifications, or Slack notifications. Other profile settings are
outside this tool's public contract. Core returns JSON `null` after accepting
the write, so MCP returns a compact confirmation rather than implying it read
back authoritative state.

Credential deletion projects only the matching credential name and type,
omitting Core's legacy profile field.

App create synchronously creates version 1 and schedules its upload. Update
always creates and schedules a new version from the submitted inline YAML; it
does not reproduce the CLI editor's read-before-write unchanged-content check.
Delete schedules one version or all non-deleted versions and returns at most
200 version numbers, the total scheduled count, and a `more_versions` marker.
An already-deleted requested version is a successful no-op. Rename is
synchronous. App specs may contain
sensitive values, so callers should reference OSMO credentials instead; MCP
does not return or log submitted specs, but the calling client may retain its
arguments. Descriptions are non-secret query values that may appear in
Gateway/authz logs. Core currently authorizes rename's POST as `app:Create`;
MCP preserves that existing API/RBAC behavior.

App submission uses `GET /api/app/user/{name}` to pin an exact READY version,
then retrieves the complete spec with
`GET /api/app/user/{name}/spec?version=...` under a 128-KiB ceiling and sends
one `POST /api/pool/{pool}/workflow` with the matching `app_uuid` and
`app_version`. This intentionally avoids the CLI's independent metadata/spec
resolution, which can associate a newer PENDING version with a spec resolved
from a READY version. The result contains only the workflow ID, app name and
version, pool, priority, bounded/redacted policy warnings, and confirmation. It
accepts the same non-secret label overrides as workflow submission.

App metadata/spec reads require `app:Read`. An omitted pool additionally
requires `profile:Read`; an explicit pool skips that profile read and relies on
the final request's pool-scoped `workflow:Create` decision. Template overrides
and priority match the shared workflow-submission path. Overrides may be
sensitive; callers should prefer OSMO credentials for secrets because their
MCP client may retain submitted arguments. Local paths, environment injection,
dry-run, rsync, and local-file expansion are excluded. Submission consumes
compute, can leave a `FAILED_SUBMISSION` record when Core rejects the workflow
during validation, and is never automatically retried.

## Out of scope

The external MCP does not expose CLI login/logout or access-token management,
credential creation or replacement, local file and data transfer, workflow
exec/port-forward/rsync, or privileged user, backend, and service-configuration
administration. Kubernetes process
health remains available through `/health`, `/health/live`, and `/health/ready`;
`osmo_health` instead checks caller-bound OSMO access.

## Deployment verification

The implementations above still require verification against an MCP-enabled
deployment. Run the smoke suite with an OETF environment whose caller can read
profile and credential metadata and create workflows in `OETF_POOL`:

```bash
bazel run //test/oetf:run -- \
  --env <mcp-enabled-env> --tags mcp \
  --bazel-arg=--test_env=OSMO_MCP_ACCESS_TOKEN
```

Authenticated checks also require `OSMO_MCP_ACCESS_TOKEN`, obtained through the
deployment's MCP OAuth flow and passed through the test environment. The normal
OETF API token cannot authenticate to `/mcp`. Use the same identity for CLI and
MCP comparisons, and do not put token values in command arguments or logs. If
the MCP token is absent, those checks are skipped; a run containing skips does
not establish authenticated tool coverage.

The suite verifies discovery, the current catalog, caller-bound health, profile
and credential projections against the CLI, and successful workflow validation
through Gateway → MCP → Gateway → Core. The known-good validation case does not
enqueue compute or create a workflow row; failed validation can create a
`FAILED_SUBMISSION` row.

If the deployment cannot validate `ubuntu:22.04`, select an approved image:

```bash
bazel run //test/oetf:run -- \
  --env <mcp-enabled-env> --tags mcp \
  --bazel-arg=--test_env=OSMO_MCP_ACCESS_TOKEN \
  --bazel-arg=--test_env=OETF_DEFAULT_IMAGE=<registry/image:tag>
```

Profile updates, credential deletion, app lifecycle changes, workflow and app
submission, restart, and cancellation remain manual Inspector checks against
disposable user-owned state. They can change saved state or consume compute.
Inspect OSMO state after an ambiguous outcome before retrying a one-shot action.

## Contract for every tool

Each tool must use a fixed HTTP method and route, accept no origin, token,
identity, method, route, or header input, validate and encode dynamic values,
relay only request-local credentials through the same Gateway, validate
complete JSON responses, mark bounded text prefixes, expose only centrally
scrubbed allowlisted client-error details, declare accurate MCP annotations,
and have protocol-level mapping and failure tests.
