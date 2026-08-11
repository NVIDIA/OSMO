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

# OSMO MCP service

The self-hosted MCP service is a stateless, thin adapter over predefined OSMO
REST APIs. It does not authenticate users itself. The deployment contract
requires every MCP request and every resulting API request to pass through the
same deployment's Gateway.

## Request flow and trust boundary

```text
MCP client
  -> Gateway (token validation + mcp:Access)
  -> MCP (request-local token reference + fixed tool mapping)
  -> same Gateway (second token validation + API-specific action)
  -> OSMO API
```

The Gateway supplies one `Authorization: Bearer ...` header and trusted
`x-osmo-user` identity to the MCP request. The MCP middleware validates the
forwarded context, removes those headers from the downstream ASGI scope, and
holds the exact authorization value only in request-local context. A tool must
pass those credentials explicitly to `GatewayClient`; the shared HTTP client
contains no caller credentials.

The relay boundary has these invariants:

- The outbound origin is deployment configuration, never tool input. The Helm
  chart derives it from the public `services.mcp.resourceUrl` by removing the
  exact `/mcp` suffix.
- Tools select a fixed HTTP method and `/api/...` path. Query names are fixed
  by each tool and values are encoded from bounded typed inputs. Unknown tool
  arguments, alternate URLs, embedded queries or fragments, redirects, and
  path traversal fail closed.
- The unchanged authorization value and optional request ID are the only
  caller-derived headers forwarded on the second Gateway pass. MCP does not
  copy `x-osmo-*`, cookies, proxy headers, or other inbound request headers.
  Request IDs that reuse a meaningful bearer-token substring are rejected
  before forwarding or telemetry.
- MCP does not exchange, refresh, modify, cache, persist, log, or return the
  bearer token. It clears request context and upstream cookies on completion,
  failure, timeout, or cancellation.
- Tool arguments are rejected before execution if they contain the active
  authorization value or bearer token, preventing credential reflection into
  dynamic path or query values.
- The `/mcp` request body is counted while streaming and rejected above 1 MiB,
  whether its size is declared or sent with chunked transfer encoding. Body
  collection has a 10-second deadline, and each process admits at most 16
  in-flight MCP requests so aggregate request memory remains bounded. This
  stateless JSON deployment accepts `POST /mcp` only; other methods return 405
  rather than opening long-lived streams outside that admission boundary.
- Resource tools read the active profile and short-circuit an empty pool scope.
  Lists send a non-empty explicit pool list to `/api/resources`; detail reads
  only `/api/resources/{node_name}` and filters the returned assignments before
  projection. They never use Core's unrestricted `all_pools` behavior. This
  retains the existing CLI/API contract without a Core change, but profile
  scope and resource data are still two requests rather than one atomic
  authorization decision; a future Core endpoint should intersect resource
  assignments with the current allowed-pools header. Workflow detail tools
  accept canonical workflow IDs, not UUIDs, so Gateway can resolve the owning
  pool before authorizing the API request.
- Outbound calls have a total timeout, bounded response size, identity content
  encoding, no redirects, and no automatic retries. JSON responses remain
  whole-response validated; long text may return a marked bounded prefix.
- Receiving APIs remain authoritative for API-specific authorization,
  validation, and side effects. MCP reads upstream error bodies under a
  separate small ceiling and preserves only error codes from a static Core
  contract for correctable client errors. Free-form messages, workflow IDs,
  validation locations, and unknown fields are discarded. Other upstream
  failures remain generic.
- Every upstream call emits tool, method, static route template, status,
  outcome, duration, and request-ID telemetry without dynamic resource names
  or bearer values. A separate final tool outcome is emitted only after MCP
  result validation, so a malformed HTTP 200 is never classified as a
  successful tool result.
- Only explicitly classified, bounded public errors can reach a client.
  Validation failures use fixed messages and unexpected exceptions fail closed
  to a generic error without reflecting exception text.

The Gateway, MCP process, receiving OSMO APIs, and applicable middleware are
inside the bearer-token handling boundary. None of them may log or persist the
authorization value.

## Available tools

The external catalog contains 25 tools: 14 read-only tools for caller-bound
health, profile, pool, resource, workflow, application, and
credential-metadata inspection, plus four workflow actions, one
profile-setting action, one credential action, four app lifecycle actions,
and app submission. Each tool maps to a fixed external API, returns a
structured allowlisted result, and applies a domain-specific response limit.
Credential inspection returns names and types only. Profile inspection
intentionally includes non-secret access-token identity metadata (name and
expiry). Bearer values are never returned.

Workflow lists accept CLI-compatible label selectors and absent-label keys,
return each workflow's labels, and are capped at 50 entries per page so valid
maximum-size label maps remain within both upstream and MCP result budgets.
Workflow detail returns stored labels and current bounded, redacted policy
warnings.

`osmo_set_profile` updates only the default pool or email/Slack notification
state supported by the external CLI and Core contract. Other profile settings
are outside this tool's public contract. Core returns no updated profile
object, so the tool reports only the validated setting that was accepted.
Profile writes are one-shot and are not automatically retried.

`osmo_delete_credential` omits Core's legacy profile value from its result.
Credential deletion is a destructive, one-shot operation.

App create and update accept bounded inline workflow YAML. Callers should
reference OSMO credentials rather than inline secrets; MCP does not return or
log the submitted spec, but the calling client may retain its original tool
arguments. Create synchronously creates version 1 and schedules its upload.
Update always creates and schedules a new version, even when the submitted
content matches the current spec; it intentionally omits the CLI's local
editor/read-before-write behavior.

App deletion schedules either one requested version or every non-deleted
version. Its compact result returns at most 200 version numbers plus the total
scheduled count and a `more_versions` marker. An already-deleted requested
version is a successful no-op. Rename is synchronous and one-shot. App
descriptions are non-secret query values and may appear in Gateway/authz
access logs. Core currently authorizes rename's POST route as `app:Create`;
the external MCP preserves that existing API/RBAC contract.

`osmo_submit_app` resolves and pins one concrete READY version, reads its
complete spec under a 128-KiB ceiling, and submits it through the same shared
workflow-submission path as raw YAML. This avoids the CLI's independent
metadata/spec resolution while preserving its template overrides and priority
semantics. It also preserves CLI-compatible non-secret workflow label
overrides and returns bounded, redacted label-policy warnings. Labels are query
parameters and may appear in Gateway/authz access logs. Template overrides may
contain sensitive values, so callers should prefer OSMO credentials for
secrets; MCP does not return or log overrides, but the
calling client may retain its arguments. Explicit pools rely on the
authoritative `workflow:Create` check; an omitted pool additionally reads the
profile to select its accessible default or sole pool. The preflight app reads
require `app:Read`. Local paths, environment injection, dry-run, rsync, and
local-file expansion remain excluded. Submission consumes compute, can create
a `FAILED_SUBMISSION` record when Core rejects the workflow during validation,
and is never automatically retried.

Workflow validation calls Core's submission endpoint with
`validation_only=true`. It is intentionally annotated as a non-idempotent
write because a failed validation can create a `FAILED_SUBMISSION` record.
Workflow submission accepts bounded raw YAML, template overrides, a target
pool, scheduling priority, and repeatable non-secret `key=value` label
overrides. Validation accepts the same label overrides. Later duplicate keys
win in Core, matching the CLI, and successful validation, submission, restart,
and app-submission results return bounded, redacted label-policy warnings.
Labels are query parameters and may appear in Gateway/authz access logs.
Submission intentionally does not accept local paths, environment injection,
dry-run rendering, or source workflow IDs. The latter would let Core read a
source spec without a source-pool authorization check. Core-generated URLs are
not returned.

Restart accepts only a failed source workflow and always performs a compact
workflow read before its POST, including when the target pool is explicit.
This requires source-workflow read access in addition to create access on the
target pool before Core reads the source spec. Cancellation accepts one
canonical workflow ID per call. It intentionally omits the CLI's cancellation
message because that value is persisted and appears in Gateway/authz URL logs.
Both actions are destructive, one-shot operations whose ambiguous outcomes
must be inspected before retrying.

JSON tools require one complete bounded response. Bounded text tools may
instead return a safe UTF-8 prefix with `truncated=true` and a machine-readable
reason when the response reaches its size limit or its live stream does not
complete before the request timeout.

See [TOOLS.md](TOOLS.md) for the exact catalog, REST mappings, staged mutation
plan, and intentionally excluded CLI/admin capabilities.

The Kubernetes `/health`, `/health/live`, and `/health/ready` endpoints only
report MCP process health. They do not relay a token or test Gateway/API
authorization. The `osmo_health` tool is deliberately separate: it probes
caller-bound Gateway authentication and OSMO profile access.

## Code organization

Runtime security boundaries live in `request_context.py`, `request_body.py`,
`gateway.py`, `protocol.py`, and `telemetry.py`. Shared, dependency-light tool
support lives in `tool_errors.py`, `tool_requests.py`, `tool_validation.py`,
and `access_scope.py`. Each larger domain keeps its public and upstream
contracts in `*_models.py` and its fixed routes, authorization decisions,
projection, and handlers in the matching domain module. `tool_registry.py` is
the single source of registration metadata used by both the server and
catalog.

Do not import the CLI runtime. Extract only pure public helpers when behavior
genuinely needs to match another OSMO surface.

## Adding a tool

Keep each new tool a narrow adapter:

1. Confirm the external OSMO API method, path, request model, response model,
   RBAC action, pagination, and side effects in the current codebase.
2. Do not accept a token, identity, origin, route, method, or headers as tool
   input. Validate every legitimate argument and encode path segments safely.
3. Reuse or extract a lightweight external API contract. Do not pull Core,
   database, Kubernetes, or CLI client dependencies into the MCP image.
4. Obtain `AppContext` from the injected FastMCP `Context`, obtain credentials
   from `request_context`, and pass both explicitly to `GatewayClient`.
5. Set a tool-specific response ceiling. Validate complete JSON responses;
   expose long text only through the shared truncation contract. Preserve only
   centrally scrubbed, allowlisted details from actionable client errors.
6. Set accurate MCP annotations. Only operations with no observable side
   effects are read-only. Do not retry a state-changing operation whose result
   is uncertain.
7. Add real Streamable HTTP protocol tests for the success path, fixed mapping,
   annotations/schema, authorization and request-ID relay, API errors,
   malformed/oversized responses, forbidden inputs, and sensitive-data
   absence.

## Local validation

```bash
bazel test --test_output=errors //src/service/mcp/...
bazel build \
  //src/service/mcp:mcp_binary \
  //test/smoke:mcp-checks
bazel test //test/smoke:mcp-checks-pylint
bash deployments/charts/service/ci/validate-mcp-chart.sh
```

The chart validation covers MCP-disabled and MCP-enabled renders, the derived
Gateway origin, OAuth metadata, probes, ingress isolation, absence of MCP
credential material, and expected configuration failures.

## Deployment validation

The MCP smoke target requires an MCP-enabled deployment with JWT
authentication. Its token needs `mcp:Access`, `profile:Read`, and
`workflow:Create` for `OETF_POOL`.

```bash
bazel run //test/oetf:run -- --env <mcp-enabled-env> --tags mcp
```

The smoke test rejects unauthenticated access, verifies the exact 25-tool
catalog, compares the profile projection with Core, checks caller-bound
health, and validates a small workflow through Gateway → MCP → Gateway → Core.
A successful validation does not enqueue compute or create a workflow row.
The smoke suite intentionally sends only this known-good case because a failed
Core validation can create a `FAILED_SUBMISSION` row.
Profile, credential, app lifecycle, and app-submission mutations remain manual
Inspector checks against disposable user-owned state.

When the deployment cannot validate the default public `ubuntu:22.04` image,
pass an approved image into the Bazel test environment:

```bash
bazel run //test/oetf:run -- \
  --env <mcp-enabled-env> \
  --tags mcp \
  --bazel-arg=--test_env=OETF_DEFAULT_IMAGE=<registry/image:tag>
```

Profile updates, workflow and app submission, restart, and cancellation remain
deliberate Inspector checks. They are not automated in the smoke target because
doing so would mutate saved user or workflow state or consume compute. For each
one-shot action, inspect OSMO state after an ambiguous error before retrying.
