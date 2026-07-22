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
- Tools select a fixed HTTP method and `/api/...` path. Unknown tool arguments,
  alternate URLs, queries, fragments, redirects, and path traversal fail
  closed.
- The unchanged authorization value and optional request ID are the only
  caller-derived headers forwarded on the second Gateway pass. MCP does not
  copy `x-osmo-*`, cookies, proxy headers, or other inbound request headers.
- MCP does not exchange, refresh, modify, cache, persist, log, or return the
  bearer token. It clears request context and upstream cookies on completion,
  failure, timeout, or cancellation.
- The `/mcp` request body is counted while streaming and rejected above 1 MiB,
  whether its size is declared or sent with chunked transfer encoding. Body
  collection has a 10-second deadline, and each process admits at most 16
  in-flight MCP requests so aggregate request memory remains bounded. This
  stateless JSON deployment accepts `POST /mcp` only; other methods return 405
  rather than opening long-lived streams outside that admission boundary.
- Outbound calls have a total timeout, bounded response size, identity content
  encoding, no redirects, and no automatic retries.
- Receiving APIs remain authoritative for API-specific authorization,
  validation, and side effects. MCP reads upstream error bodies under a
  separate small ceiling and preserves only error codes from a static Core
  contract for correctable client errors. Free-form messages, workflow IDs,
  validation locations, and unknown fields are discarded. Other upstream
  failures remain generic.

The Gateway, MCP process, receiving OSMO APIs, and applicable middleware are
inside the bearer-token handling boundary. None of them may log or persist the
authorization value.

## Current tool

`osmo_get_profile` maps to `GET /api/profile/settings`, requires the existing
`profile:Read` action on the second Gateway pass, accepts no tool arguments,
and limits the response to 64 KiB. Its structured result uses the same
lightweight profile API contract as Core.

The Kubernetes `/health`, `/health/live`, and `/health/ready` endpoints only
report MCP process health. They do not relay a token or test Gateway/API
authorization. A failed `osmo_get_profile` call therefore does not necessarily
mean the MCP pod is unhealthy.

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
5. Set a tool-specific response ceiling and validate the complete success
   response before returning it. Never return an upstream error body.
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
bazel build //src/service/mcp:mcp_binary
bash deployments/charts/service/ci/validate-mcp-chart.sh
```

The chart validation covers MCP-disabled and MCP-enabled renders, the derived
Gateway origin, OAuth metadata, probes, ingress isolation, absence of MCP
credential material, and expected configuration failures.
