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

The self-hosted MCP service is a thin adapter over predefined OSMO REST APIs.
Every MCP request and every resulting API request enters through the same
deployment's Gateway. Authentication runs inside the MCP process through
FastMCP's built-in `OIDCProxy`.

Authentication is mandatory. FastMCP serves OAuth discovery and browser login
alongside the MCP endpoint in the same process.

- [Client setup](../../../docs/user_guide/getting_started/mcp.rst)
- [Deployment and operations](../../../docs/deployment_guide/advanced_config/mcp.rst)
- [Capabilities and permissions](../../../docs/user_guide/appendix/mcp/index.rst)
- [Tool contracts and API mappings](TOOLS.md)
- [Generated tool reference](docs/TOOL_REFERENCE.md)

## Request flow and trust boundary

```text
  MCP client -> Gateway routing -> FastMCP OIDCProxy -> MCP
             -> same Gateway with verified upstream token + API action
             -> OSMO API
```

FastMCP validates its resource token and `get_access_token()` exposes the
verified upstream identity-provider bearer to the active tool request. A tool
passes the selected credential explicitly to `GatewayClient`; the shared HTTP
client contains no caller credentials.

The relay boundary has these invariants:

- The outbound origin is deployment configuration, never tool input. The Helm
  chart derives it from the public `services.mcp.resourceUrl` by removing the
  exact `/mcp` suffix.
- Tools select a fixed HTTP method and `/api/...` path. Query names are fixed
  by each tool and values are encoded from bounded typed inputs. Unknown tool
  arguments, alternate URLs, embedded queries or fragments, redirects, and
  path traversal fail closed.
- The OIDC proxy's verified upstream bearer, plus an optional request ID, are
  the only caller-derived values forwarded on the second Gateway pass. MCP
  does not copy `x-osmo-*`, cookies, proxy headers, or other inbound request
  headers.
  Request IDs that reuse a meaningful bearer-token substring are rejected
  before forwarding or telemetry.
- The tool adapter does not independently exchange, refresh, modify, cache,
  persist, log, or return bearer tokens. FastMCP alone owns
  upstream exchange, refresh, and encrypted Redis state. Tool request context
  and upstream cookies are cleared on completion, failure, timeout, or
  cancellation.
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
- Tool and upstream telemetry is best-effort: a failed service logging handler
  cannot replace the API response or change the tool's outcome. Framework
  logging keeps its default behavior.
- Only explicitly classified, bounded public errors can reach a client.
  Validation failures use fixed messages and unexpected exceptions fail closed
  to a generic error without reflecting exception text.

The Gateway, MCP process, receiving OSMO APIs, and applicable middleware are
inside the bearer-token handling boundary. None may log the authorization
value. The only intentional persistence is FastMCP's encrypted upstream-token
state in Redis.

The Kubernetes `/health` and `/health/live` endpoints report process health.
The `/health/ready` endpoint also checks Redis connectivity with a two-second
timeout. The separate `osmo_health` tool probes caller-bound Gateway
authentication and OSMO profile access.

## Code organization

Runtime security boundaries live in `request_context.py`, `request_body.py`,
`gateway.py`, `protocol.py`, and `telemetry.py`. Shared, dependency-light tool
support lives in `tool_errors.py`, `tool_requests.py`, `tool_validation.py`,
and `access_scope.py`. Each larger domain keeps its public and upstream
contracts in `*_models.py` and its fixed routes, authorization decisions,
projection, and handlers in the matching domain module. `tool_registry.py` is
the single source of registration metadata used by both the server and
catalog.

Authentication lives in `auth.py`. It constructs FastMCP's built-in
`OIDCProxy`, upstream `JWTVerifier`, and encrypted Redis store, then passes the
provider as the `auth` argument to the same `OSMOFastMCP` instance. FastMCP
derives its signing key from the existing upstream OIDC client secret.
OSMO does not implement OAuth endpoints or run a second auth service.

Do not import the CLI runtime. Extract only pure public helpers when behavior
needs to match another OSMO surface.

## Dispatch boundary decision

The pinned FastMCP middleware chain re-enters `call_tool` with
`run_middleware=False`. OSMO keeps one guard on that inner invocation: it binds
verified credentials, rejects credential-bearing arguments, classifies public
errors, validates the tool-execution result, and emits one final outcome. Actual tool
execution stays delegated to FastMCP; `get_tool(name, version)` supplies its
visibility and authorization rules without rebuilding the catalog.

A middleware-only replacement would not guard explicit
`call_tool(..., run_middleware=False)` calls. Preserving that behavior would
still require an equivalent inner guard, so this simplification does not add
another middleware layer. This flag is a trusted Python API, not a wire-level
client option. Protocol regressions cover that direct path as well
as the normal transport path. Reevaluate the choice when the pinned framework
changes, retaining credential cleanup and non-reflective error/result handling.

## Adding a tool

Keep each new tool a narrow adapter:

1. Confirm the external OSMO API method, path, request model, response model,
   RBAC action, pagination, and side effects in the current codebase.
2. Do not accept a token, identity, origin, route, method, or headers as tool
   input. Validate every legitimate argument and encode path segments safely.
3. Reuse or extract a lightweight external API contract. Do not pull Core,
   database, Kubernetes, or CLI client dependencies into the MCP image.
4. Use `tool_requests` to resolve application state and verified credentials
   from the active HTTP request. Handler and helper signatures need no FastMCP
   `Context` unless they actually use its functionality. The shared relay passes
   request-local credentials explicitly to `GatewayClient`.
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
bazel test --test_output=errors \
  //src/service/mcp/...
bazel build \
  //src/service/mcp:mcp_binary \
  //test/smoke:mcp-checks
bazel build \
  --platforms=//bzl/platforms:linux_x86_64 \
  //src/service/mcp:mcp_image_x86_64
bazel test //test/smoke:mcp-checks-pylint
bash deployments/charts/service/tests/render-tests.sh
bash deployments/charts/osmo/tests/test_osmo_charts.sh
```

The chart validation covers MCP-disabled and MCP-enabled renders; the derived
Gateway origin; OAuth routing; the `/mcp` filter boundary; secret
mounts; ingress isolation; and expected configuration failures.
Each chart suite checks its own routing policy and configuration conventions.

When upgrading FastMCP or the MCP SDK, rerun the MCP suite, including
`test_protocol` for validation and public-error boundaries, and `test_gateway`
and `test_telemetry` for best-effort service logging. Framework logging is
not intercepted or sanitized by this service.

## Deployment validation

See [the tool verification contract](TOOLS.md#deployment-verification) for the
smoke command, its permissions, and the mutation checks that still require
disposable state. OAuth rollout checks belong to the
[deployment guide](../../../docs/deployment_guide/advanced_config/mcp.rst).
