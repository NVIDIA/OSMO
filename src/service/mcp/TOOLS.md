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

# External MCP tool plan

The external MCP exposes a deliberately smaller surface than the OSMO CLI. A
tool is included only when it can be implemented as a bounded, fixed mapping to
an existing external REST API while preserving the caller's OSMO identity and
RBAC.

## Phase 1: read-only operations (implemented)

| Capability | Tools | Contract | OSMO APIs |
| --- | --- | --- | --- |
| Health | `osmo_health` | Caller-bound Gateway authentication and OSMO API access; distinct from Kubernetes probes | `GET /api/profile/settings` |
| Profile | `osmo_get_profile` | Active identity, settings, roles, accessible pools, and non-secret token name/expiry metadata | `GET /api/profile/settings` |
| Pools | `osmo_search_pools` | Accessible pools only; local text search and bounded output preserve shared node-set capacity | `GET /api/profile/settings`, `GET /api/pool_quota` |
| Resources | `osmo_list_resources`, `osmo_get_resource` | Profile-selected accessible pools; normalized CLI-compatible capacity/used/free quantities; local bounded output and uniform node not-found behavior | `GET /api/profile/settings`, `GET /api/resources`, `GET /api/resources/{node_name}` |
| Workflows | `osmo_list_workflows`, `osmo_get_workflow`, `osmo_get_workflow_logs`, `osmo_get_workflow_events`, `osmo_get_workflow_spec` | Active user's workflows in token-accessible pools; canonical workflow IDs; compact status and marked bounded text | `GET /api/workflow...` |
| Applications | `osmo_list_apps`, `osmo_get_app`, `osmo_get_app_spec` | Active user's apps by default; app specs resolve a concrete newest READY version from bounded history when omitted, and return marked bounded text | `GET /api/app...` |
| Credential metadata | `osmo_list_credentials` | Names and types only; never profiles or credential payloads | `GET /api/credentials` |

These tools are read-only, idempotent, closed-world operations. Workflow and
application list APIs paginate upstream. Pool and resource tools bound their
MCP output but may read a complete accessible upstream response because the
existing APIs do not offer agent-facing pagination. Logs apply Core's tail
control only when the caller explicitly requests it; all long-text tools return
a marked bounded prefix. JSON remains whole-response validated. Workflow UUID
lookup remains excluded until Gateway authorization resolves UUIDs to their
owning pool.

The existing resource APIs do not atomically intersect resource assignments
with the current allowed-pools header. Under this no-Core-change phase, MCP
uses the active profile snapshot and fails closed for callers with no pools.
Resource lists send a non-empty pool filter. Resource detail fetches only the
encoded node route, then filters its assignments against that same profile
scope before projecting any result. A future Core contract should perform the
intersection on the resource request itself. Large accessible-pool sets can
also reach the shared 16-KiB query ceiling for list requests even when MCP
output is small; this is bounded output, not end-to-end pagination.

Returning token name/expiry from `osmo_get_profile` is an intentional external
product choice; the hosted internal MCP currently omits that metadata. Neither
surface returns bearer values.

Credential profiles are intentionally omitted from the external MCP even
though the CLI and hosted internal MCP may display them. Legacy profile values
can contain secret-bearing userinfo, queries, or fragments; the external
projection therefore returns only `cred_name` and `cred_type`.

## Phase 2: workflow actions (code complete)

`osmo_validate_workflow`, `osmo_submit_workflow`,
`osmo_restart_workflow`, and `osmo_cancel_workflow` are implemented.
Validation sets `validation_only=true` and is a non-idempotent write because a
failed validation can create a `FAILED_SUBMISSION` workflow record. Submission
accepts raw YAML and preserves the original template when it detects the same
template markers as the CLI. It returns only the new workflow ID, selected
pool, and effective priority. Restart and cancel are destructive one-shot
operations.

Submit-by-workflow-ID is intentionally omitted. Core authorizes creation in the
target pool but reads the source workflow internally without a source-pool
read check. Dry-run rendering, environment injection, local-file expansion,
and rsync are also omitted from the agent-facing contract.

Restart accepts only a failed source workflow and always performs a compact
source-workflow GET before its POST. This requires `workflow:Read` on the
source before Core's restart route enforces `workflow:Create` on the target
pool. Cancel accepts one canonical ID per call and omits the CLI's persisted,
query-string cancellation message because Gateway and authz access logs record
it. The shared mutation relay never retries and reports an unknown outcome for
ambiguous transport, server, database, or malformed-success failures.

Deployment smoke coverage remains before Phase 2 is considered released.

## Phase 3: user-owned mutations

Add `osmo_set_profile`, `osmo_set_credential`, `osmo_delete_credential`,
`osmo_create_app`, `osmo_update_app`, `osmo_delete_app`, `osmo_rename_app`, and
`osmo_submit_app`. Credential writes require dedicated secret-argument and
error-reflection tests. Application writes must preserve their asynchronous API
semantics.

## Out of scope

The external MCP does not expose CLI login/logout or access-token management,
local file and data transfer, workflow exec/port-forward/rsync, or privileged
user, backend, and service-configuration administration. Kubernetes process
health remains available through `/health`, `/health/live`, and `/health/ready`;
`osmo_health` instead checks caller-bound OSMO access.

## Contract for every tool

Each tool must use a fixed HTTP method and route, accept no origin, token,
identity, method, route, or header input, validate and encode dynamic values,
relay only request-local credentials through the same Gateway, validate
complete JSON responses, mark bounded text prefixes, expose only centrally
scrubbed allowlisted client-error details, declare accurate MCP annotations,
and have protocol-level mapping and failure tests.
