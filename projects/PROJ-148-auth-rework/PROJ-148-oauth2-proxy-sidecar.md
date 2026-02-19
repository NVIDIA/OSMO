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

# OAuth2 Proxy Sidecar for Authentication

**Author**: @vvnpn-nv<br>
**PIC**: @vvnpn-nv<br>
**Proposal Issue**: [#148](https://github.com/NVIDIA/OSMO/issues/148)

## Overview

This document proposes replacing Envoy's built-in OAuth2 filter with [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/) as a dedicated authentication sidecar. OAuth2 Proxy runs as a session validator consulted via
Envoy's [`ext_authz` filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter) — it validates browser session cookies and returns auth headers, but never sits in the data path for API or service traffic. Envoy retains full control of routing, rate limiting, and traffic flow. This addresses limitations in Envoy's OAuth2 filter — particularly around token refresh with OIDC providers — while maintaining compatibility with the planned authz_sidecar (PROJ-148-auth-sidecar) for authorization.

### Motivation

- **Fix OAuth2 token refresh** — Envoy's OAuth2 filter doesn't send `scope=openid` on refresh requests, causing IDPs that require it (e.g., Microsoft Entra ID) to not return `id_token`. The current Lua workaround only detects the failure and forces a full re-login rather than actually fixing refresh.
- **Simplify authentication code** — Remove ~420 lines of Lua workarounds for cookie management and token validation across three Helm chart templates
- **Single-purpose components** — Separate authentication (OAuth2 Proxy) from routing/authorization (Envoy)
- **Better IDP support** — OAuth2 Proxy has native support for Microsoft, Google, GitHub, OIDC, and many more
- **Active community** — OAuth2 Proxy is actively maintained with regular security updates

### Problem

The current Envoy OAuth2 filter implementation has several limitations:

1. **Missing scope on refresh** — Envoy's OAuth2 filter doesn't include `scope=openid` in token refresh requests. IDPs that require this parameter (e.g., Microsoft Entra ID) will not return `id_token` on refresh, breaking session continuity.

2. **Complex Lua workarounds** — To handle the refresh issue, we've added ~220-250 lines of Lua filters duplicated across service, router, and web-ui chart templates:
   - `validate_idtoken` — detects missing/malformed IdToken on requests, clears cookies to force re-auth
   - `is_missing_idtoken_on_refresh` — detects failed refresh responses
   - `increase_refresh_age` / `update_cookie_age` — manipulates cookie Max-Age values
   - `pre_oauth2` — orchestrates all of the above on the response side
   - `forceReauthOnMissingIdToken` flag gating IDP-specific behavior

3. **Workaround doesn't fix the problem** — The Lua workarounds detect the failure and force a full re-login. Users experience periodic re-authentication when tokens expire, which is a UX problem.

4. **IDP-specific code paths** — Different behavior needed per IDP (e.g., Keycloak vs Microsoft vs Google), making the codebase harder to maintain

## Use Cases

| Use Case | Description |
|---|---|
| Browser authentication | User authenticates via any supported IDP (Microsoft, Google, OIDC, etc.). OAuth2 Proxy handles the full OAuth2 flow including proper token refresh with `scope=openid` |
| Token refresh without re-login | User's session is refreshed seamlessly without requiring re-authentication |
| Service API authentication | API requests with JWT tokens are validated by Envoy's JWT filter (unchanged) |
| CLI/Device flow authentication | Device flow continues to work through OSMO service (unchanged) |
| Logout | User initiates logout, OAuth2 Proxy clears session and redirects to IDP logout |

## Requirements

| Title | Description | Type |
|---|---|---|
| OAuth2/OIDC authentication | OAuth2 Proxy shall handle the complete OAuth2/OIDC authentication flow for browser-based access | Functional |
| OIDC-compliant token refresh | OAuth2 Proxy shall properly refresh tokens with all supported IDPs, including `id_token` | Functional |
| Multi-IDP support | OAuth2 Proxy shall support Microsoft Entra ID, Google, Keycloak, and any OIDC-compliant identity provider | Functional |
| Session management | OAuth2 Proxy shall manage user sessions via secure cookies | Functional |
| Header propagation | OAuth2 Proxy shall propagate user identity to Envoy via response headers (`X-Auth-Request-User`, `X-Auth-Request-Email`, `Authorization`) | Functional |
| Backward compatibility | Existing CLI, device flow, and API authentication shall continue to work unchanged | Functional |
| Authentication latency | OAuth2 Proxy shall add <10ms latency to authenticated requests (session validation subrequest) | KPI |
| Secure cookie handling | Session cookies shall use Secure, HttpOnly, and SameSite attributes | Security |
| No secrets in environment | OAuth2 client secrets shall be loaded from Kubernetes secrets or files | Security |

## Architectural Details

### Current Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              POD                                           │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Browser ──► Envoy Proxy (Port 80) ─────────────────────► OSMO Service    │
│                      │                                      (Port 8000)    │
│                      │                                                     │
│                      ├── Lua: validate_idtoken (request-side)              │
│                      ├── Lua: pre_oauth2 (response-side cookie fix)        │
│                      ├── OAuth2 Filter ◄────► IDP                          │
│                      ├── JWT Filter (validate tokens)                      │
│                      ├── Lua: strip-unauthorized-headers                   │
│                      └── Rate Limiting                                     │
│                                                                            │
│   Problems:                                                                │
│   - Some IDPs don't return id_token on refresh without scope               │
│   - Workaround forces re-login instead of fixing refresh                   │
│   - ~220 lines of Lua duplicated across 3 chart templates                  │
│   - IDP-specific flags (forceReauthOnMissingIdToken)                       │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

### Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              POD                                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   Browser ──► Envoy (Port 80) ──────────────────────────► OSMO Service      │
│                   │                                        (Port 8000)      │
│                   │                                                         │
│                   ├── ext_authz (HTTP) ──► OAuth2 Proxy (Port 4180)         │
│                   │    (browser only,       │    validates session cookie,  │
│                   │     SKIPPED for         │    returns auth headers,      │
│                   │     API/CLI requests)   │    never touches request body │
│                   │                         └──► IDP (MS/Google/OIDC)       │
│                   │                                                         │
│                   ├── JWT Filter (validates id_token or API JWT)            │
│                   ├── ext_authz (gRPC) ──► authz_sidecar (future RBAC)      │
│                   └── Rate Limiting                                         │
│                                                                             │
│   /oauth2/* routes ──► OAuth2 Proxy (login, callback, logout only)          │
│                                                                             │
│   Removed:                                                                  │
│   ✗ OAuth2 Filter          ✗ Lua: validate_idtoken                          │
│   ✗ Lua: pre_oauth2        ✗ Lua: cookie-management                         │
│   ✗ token/hmac secrets     ✗ forceReauthOnMissingIdToken flag               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key design principle**: Envoy stays in control of all traffic routing. OAuth2 Proxy is **never in the data path** for normal requests — it is only consulted as a session validator and serves the login/callback/logout endpoints directly.

### How the Sidecars Interact

Each OSMO pod runs three containers that work together:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ POD                                                                        │
│                                                                            │
│  ┌─────────────────┐    ┌──────────────────┐    ┌──────────────────────┐   │
│  │   Envoy Proxy   │    │  OAuth2 Proxy    │    │    OSMO Service      │   │
│  │   (Port 8080)   │    │  (Port 4180)     │    │    (Port 8000)       │   │
│  │                 │    │                  │    │                      │   │
│  │  • Routes all   │◄──►│  • Validates     │    │  • Business logic    │   │
│  │    traffic      │    │    session       │    │  • Reads x-osmo-user │   │
│  │  • Runs filters │    │    cookies       │    │    header for user   │   │
│  │    (ext_authz,  │    │  • Handles login/│    │    identity          │   │
│  │    JWT, rate    │    │    callback/     │    │                      │   │
│  │    limiting)    │    │    logout flows  │    │                      │   │
│  │  • Sets         │    │  • Refreshes     │    │                      │   │
│  │    x-osmo-user  │    │    tokens with   │    │                      │   │
│  │    header       │    │    IDP           │    │                      │   │
│  └────────┬────────┘    └──────────────────┘    └──────────────────────┘   │
│           │                                                                │
│           │  Envoy talks to OAuth2 Proxy ONLY via localhost ext_authz      │
│           │  Envoy talks to Service via localhost routing                  │
│           │  OAuth2 Proxy NEVER talks to Service directly                  │
│           │                                                                │
└───────────┼────────────────────────────────────────────────────────────────┘
            │
            ▼
    External traffic (browser, CLI, other services)
```

**Envoy** is the only container that receives external traffic. It decides what to do based on the
request:

- **Browser request with session cookie** → asks OAuth2 Proxy "is this session valid?" → if yes,
  extracts the JWT from OAuth2 Proxy's response → validates it → sets `x-osmo-user` → forwards to
  Service
- **API/CLI request with JWT in `x-osmo-auth`** → skips OAuth2 Proxy entirely → validates the JWT
  directly → sets `x-osmo-user` → forwards to Service
- **Unauthenticated request** → asks OAuth2 Proxy → OAuth2 Proxy says "not authenticated" →
  Envoy redirects the browser to the IDP login page (via OAuth2 Proxy's `/oauth2/start` endpoint)
- **Login/callback/logout paths** → routes directly to OAuth2 Proxy (these are the only paths where
  OAuth2 Proxy acts as an HTTP server, not just a validator)

**OAuth2 Proxy** never talks to the OSMO Service directly. It only:
1. Answers Envoy's "is this session valid?" questions (ext_authz check)
2. Handles the OAuth2 login flow (`/oauth2/start` → IDP → `/oauth2/callback`)
3. Handles logout (`/oauth2/sign_out`)

**OSMO Service** never knows OAuth2 Proxy exists. It receives requests from Envoy with `x-osmo-user`
already set and uses that header for user identity. The same header is set whether the request came
from a browser (via OAuth2 Proxy session) or from the CLI (via direct JWT).

### Session Lifecycle: What Happens At Each Stage

**Stage 1: First visit (no session)**

```
Browser visits dev.osmo.nvidia.com/workflows
    │
    ▼
Envoy receives request (no _osmo_session cookie, no x-osmo-auth header)
    │
    ├── Lua: strips dangerous headers (x-osmo-user, x-osmo-auth-skip)
    │
    ├── ext_authz: sends request to OAuth2 Proxy
    │       │
    │       └── OAuth2 Proxy: no valid cookie → returns redirect response
    │
    ├── Envoy returns the redirect to the browser
    │
    ▼
Browser follows redirect to /oauth2/start
    │
    ▼
OAuth2 Proxy redirects to IDP (e.g., login.microsoftonline.com)
with --skip-provider-button=true, user goes directly to IDP login
    │
    ▼
User enters credentials at IDP
    │
    ▼
IDP redirects to /oauth2/callback?code=<authorization_code>
    │
    ▼
OAuth2 Proxy exchanges code for tokens:
  - Sends scope=openid email profile (ensures id_token is returned)
  - Receives: access_token, id_token, refresh_token
  - Creates encrypted session cookie (_osmo_session)
  - Redirects browser back to /workflows with Set-Cookie header
```

**Stage 2: Normal browsing (valid session)**

```
Browser visits dev.osmo.nvidia.com/workflows
with _osmo_session cookie attached
    │
    ▼
Envoy receives request
    │
    ├── Lua: strips dangerous headers
    │
    ├── ext_authz: sends request to OAuth2 Proxy (forwards cookie header)
    │       │
    │       └── OAuth2 Proxy:
    │           1. Decrypts _osmo_session cookie
    │           2. Checks session expiry → still valid
    │           3. Returns 200 with headers:
    │              Authorization: Bearer <id_token>
    │              X-Auth-Request-User: vivianp@nvidia.com
    │              X-Auth-Request-Email: vivianp@nvidia.com
    │
    ├── Envoy adds Authorization header to the request
    │
    ├── JWT Filter:
    │   1. Extracts JWT from Authorization: Bearer <id_token>
    │   2. Fetches IDP's public keys (JWKS) from idp cluster
    │   3. Validates JWT signature, expiry, issuer, audience
    │   4. Extracts preferred_username claim → sets x-osmo-user header
    │
    ├── Lua roles: extracts roles from JWT claims → sets x-osmo-roles
    │
    ├── Rate limiting: checks per-user rate limits
    │
    ▼
Request reaches OSMO Service with:
  x-osmo-user: vivianp@nvidia.com
  x-osmo-roles: osmo-user,osmo-admin
```

**Stage 3: Token refresh (session expiring)**

```
Browser makes a request, _osmo_session cookie is near expiry
(controlled by --cookie-refresh=1h)
    │
    ▼
Envoy ext_authz → OAuth2 Proxy
    │
    └── OAuth2 Proxy:
        1. Decrypts cookie → session needs refresh
        2. Calls IDP token endpoint with refresh_token
           POST https://login.microsoftonline.com/.../token
           grant_type=refresh_token
           scope=openid email profile    ← this was not available via envoy's oauth2 filter
           refresh_token=<stored_token>
        3. IDP returns NEW tokens:
           - access_token (new)
           - id_token (new) ← returned because scope includes openid
           - refresh_token (new)
        4. Updates session with new tokens
        5. Returns 200 + new Authorization header
        6. Includes Set-Cookie with updated session
    │
    ▼
Browser receives updated _osmo_session cookie (transparent)
User sees no interruption — the page loads normally
```

**Stage 4: Session expired (refresh token also expired)**

```
Browser makes a request after a long idle period
(e.g., --cookie-expire=168h / 7 days)
    │
    ▼
Envoy ext_authz → OAuth2 Proxy
    │
    └── OAuth2 Proxy:
        1. Decrypts cookie → session expired
        2. Attempts refresh → IDP rejects (refresh token expired)
        3. Clears session cookie
        4. Returns redirect to /oauth2/start
    │
    ▼
Browser redirected to IDP login (same as Stage 1)
User must re-authenticate — this is expected behavior for expired sessions
```

**Stage 5: CLI/API request (no session involved)**

```
osmo workflow list
    │
    ▼
CLI sends request with header: x-osmo-auth: <JWT from device flow>
    │
    ▼
Envoy receives request
    │
    ├── Lua: strips dangerous headers (x-osmo-user, etc.)
    │
    ├── ext_authz: ExtensionWithMatcher sees x-osmo-auth header → SKIP
    │   OAuth2 Proxy is NOT contacted at all
    │
    ├── JWT Filter:
    │   1. Checks Authorization header → not present
    │   2. Checks x-osmo-auth header → found JWT
    │   3. Validates JWT signature against IDP's JWKS keys
    │   4. Sets x-osmo-user from JWT claims
    │
    ├── Lua roles: extracts roles → sets x-osmo-roles
    │
    ▼
Request reaches OSMO Service with x-osmo-user set
(identical outcome to browser path, but OAuth2 Proxy was never involved)
```

### Integration Pattern: Proxy Mode with Static Upstream

Envoy's `ext_authz` HTTP filter consults OAuth2 Proxy before allowing browser requests to proceed.
OAuth2 Proxy runs with `--upstream=static://200`, meaning it validates the session cookie and immediately returns a 200 response with auth headers — it never processes request or response bodies.
Envoy then uses the auth headers (specifically `Authorization: Bearer <id_token>`) for JWT validation and routes the request to the service.

For API/CLI requests, Envoy's [`ExtensionWithMatcher`](https://www.envoyproxy.io/docs/envoy/latest/api-v3/extensions/common/matching/v3/extension_matcher.proto) detects the `x-osmo-auth` header and **skips the OAuth2 Proxy check entirely**. The JWT filter validates the token directly from the header.
This means the majority of programmatic API traffic — workflow submissions, status polling, agent heartbeats, router connections — has zero OAuth2 Proxy involvement.

**Version requirement**: OAuth2 Proxy **v7.14.2 or later** is required. Earlier versions (including v7.6.0) have a bug where `--set-authorization-header` sets the `Authorization` header on the proxied request instead of the response back to Envoy, making the JWT invisible to the JWT filter.

### Data Path: What Goes Through OAuth2 Proxy vs Envoy

```
API/CLI requests (majority of traffic):
  Client ──► Envoy ──► [ext_authz SKIPPED] ──► JWT Filter ──► Service
  OAuth2 Proxy: NOT INVOLVED — zero overhead

Browser requests (interactive users):
  Browser ──► Envoy ──► ext_authz ──► OAuth2 Proxy ──► Envoy ──► JWT Filter ──► Service
                                       │
                                       └── cookie validation only (~1ms)
                                           no request/response body processing
                                           returns Authorization header with id_token

Internal service-to-service:
  Service ──► Envoy in-cluster listener ──► [ext_authz SKIPPED] ──► Service
  OAuth2 Proxy: NOT INVOLVED

Login/logout flow only:
  Browser ──► Envoy ──► /oauth2/* route ──► OAuth2 Proxy ──► IDP
  These are the ONLY requests where OAuth2 Proxy acts as an HTTP endpoint
```

**Scaling characteristics:**
- OAuth2 Proxy handles only browser session checks (small fraction of total API traffic)
- Each check is a localhost HTTP round-trip with no external calls (unless token refresh is needed)
- One OAuth2 Proxy per pod (sidecar pattern) — scales horizontally with the service
- If OAuth2 Proxy restarts, only new browser auth checks pause; in-flight API/CLI requests are unaffected

### Security Model

Authentication is enforced by two layers working together:

| Layer | What it does | Can it be bypassed? |
|-------|-------------|---------------------|
| **Lua: strip-unauthorized-headers** | Strips `x-osmo-auth-skip`, `x-osmo-user`, `x-osmo-roles` from ALL incoming requests | No — runs first in the filter chain, external clients cannot inject trusted headers |
| **ext_authz (OAuth2 Proxy)** | Validates browser session cookies. Skipped when `x-osmo-auth` header is present | Skipping is safe — the JWT filter still validates the token cryptographically |
| **JWT filter** | Validates JWT signature against IDP's public JWKS keys. Sets `x-osmo-user` from claims | No — forged/expired/invalid tokens are rejected with 401 |
| **`failure_mode_allow: false`** | If OAuth2 Proxy is unreachable, Envoy denies the request | No — fail-closed by default |

A malicious client sending `x-osmo-auth: fake-token` would skip OAuth2 Proxy but still fail JWT
cryptographic validation. The only way to authenticate is with a valid JWT signed by the configured
IDP — the same security boundary as any JWT-based system.

### JWT Filter Header Configuration

The JWT filter's `from_headers` configuration differs per chart to handle the interaction between
browser auth (via `Authorization` header from OAuth2 Proxy) and CLI/API auth (via `x-osmo-auth`):

| Chart | `from_headers` order | Reason |
|-------|---------------------|--------|
| **Web-UI** | `[authorization]` only | Web-UI only serves browser requests. Prevents the UI's empty `x-osmo-auth: ""` header from breaking JWT validation. |
| **Service** | `[authorization, x-osmo-auth]` | `authorization` checked first (from OAuth2 Proxy for browser). Falls back to `x-osmo-auth` for CLI/API. |
| **Router** | `[authorization, x-osmo-auth]` | Same as service. |

### Secret Management

OAuth2 Proxy secrets are provided via `--config=<path>` with inline values:

```
client_secret = "<value>"
cookie_secret = "<value>"
```

> **Important**: `--client-secret-file` and `--cookie-secret-file` CLI flags do NOT exist.
> `client_secret_file` and `cookie_secret_file` config file options also do NOT exist.
> The `cookie_secret` must be exactly 16, 24, or 32 bytes — base64-encoded values are NOT
> auto-decoded. For Vault-agent deployments, add oauth2_proxy templates to `config-init.hcl`
> (not just `config.hcl`) to ensure secrets are rendered before the container starts.

### UI Integration

The web-UI requires code changes to work with OAuth2 Proxy:

1. **Session detection via response headers** — The AuthProvider reads `x-auth-request-email` and `x-auth-request-preferred-username` from the `/auth/login_info` response headers. These are forwarded by Envoy's ext_authz `allowed_client_headers_on_success`. No separate session endpoint is needed.
2. **Display name via `x-osmo-name`** — The user's display name is extracted from JWT metadata by a Lua `envoy_on_response` filter in the web-UI chart and added as the `x-osmo-name` response header. This avoids exposing the full JWT to the browser.
3. **Server-to-service auth forwarding** — Envoy's `copy-auth-header` Lua filter copies `Authorization: Bearer <id_token>` (set by ext_authz) to `x-osmo-auth` on the request to Next.js. The tRPC handler in `OsmoApiFetch` reads `x-osmo-auth` from the incoming request and forwards it to the OSMO service API. **Important**: The `||` operator (not `??`) must be used when falling back from the `IdToken` cookie to the `x-osmo-auth` header, because `cookies.get()` returns `""` (not `null`) for missing cookies, and `??` doesn't trigger on empty strings.
4. **Logout** — `isOAuth2ProxySession` flag is set during login. On logout, redirects to `/oauth2/sign_out` when this flag is true.
5. **Skip provider button** — `--skip-provider-button=true` redirects directly to IDP, no intermediate sign-in page

### Future: CLI Migration to `Authorization: Bearer`

The CLI (`login.py`) and Go agent (`ctrl_args.go`) currently use `x-osmo-auth` for JWT transport.
There is an existing TODO to migrate to `Authorization: Bearer`. Once complete:

1. Remove `x-osmo-auth` from JWT filter `from_headers` in all charts
2. Update ext_authz skip condition to match `Authorization` header with Bearer prefix
3. Remove `x-osmo-auth` header stripping from Lua filters
4. Update UI server-to-service calls to forward `Authorization` directly
5. Simplify to a single auth header (`Authorization`) for all paths

### Why Session Validator (ext_authz) Over Inline Proxy

OAuth2 Proxy can be deployed as an inline proxy (all traffic flows through it) or as a session
validator consulted via Envoy's ext_authz with `--upstream=static://200` (our approach). The
ext_authz pattern is the right choice for OSMO:

| Concern | ext_authz with static upstream (our approach) | Inline proxy mode |
|---|---|---|
| **Routing** | Envoy keeps its existing 11+ regex route patterns, per-route rate limits, and WebSocket support unchanged | OAuth2 Proxy would sit in the data path; Envoy loses visibility into request paths for rate limiting |
| **Streaming** | WebSocket/streaming connections (`exec`, `portforward`, `rsync`) flow directly from Envoy to service | Every byte of streaming data passes through OAuth2 Proxy unnecessarily |
| **API/CLI tokens** | Requests with JWT tokens in `x-osmo-auth` skip the OAuth2 Proxy check entirely via matcher | All requests flow through OAuth2 Proxy even when it has nothing to do |
| **Consistency** | Same ext_authz pattern as authz_sidecar — both are "check" sidecars that Envoy consults | OAuth2 Proxy has a different role (inline proxy) than authz_sidecar (ext_authz) |
| **Chart reuse** | OAuth2 Proxy config is identical across service, router, and web-ui charts — it only answers "is this session valid?" | Each chart's OAuth2 Proxy would need to know about upstream routing |
| **Blast radius** | If OAuth2 Proxy restarts, only new browser auth checks pause; in-flight data connections are unaffected | If OAuth2 Proxy restarts, all in-flight connections drop |
| **Scale** | OAuth2 Proxy handles only small session validation checks (<1ms each, no body processing) | OAuth2 Proxy processes every request/response body |

### Request Flow

**1. Unauthenticated Browser Request**

```
Browser ──► Envoy
               │
               ├── ext_authz ──► OAuth2 Proxy (session check)
               │                                  │
               │                                  └── No session cookie → redirect
               │
               └── Envoy returns redirect to /oauth2/start
                        │
                        ▼
               OAuth2 Proxy redirects to IDP
                        │
                        ▼
               User authenticates with IDP
                        │
                        ▼
               IDP redirects to /oauth2/callback
                        │
                        ▼
               OAuth2 Proxy exchanges code for tokens
               (includes scope=openid → gets id_token) ✓
                        │
                        ▼
               Sets session cookie, redirects to original URL
```

**2. Authenticated Browser Request**

```
Browser ──► Envoy
               │
               ├── ext_authz ──► OAuth2 Proxy (session check)
               │                                  │
               │                                  └── Valid session cookie → 200
               │                                       + X-Auth-Request-User header
               │                                       + Authorization: Bearer <id_token>
               │
               ├── JWT Filter validates id_token, sets x-osmo-user
               │
               ├── ext_authz (gRPC) ──► authz_sidecar checks RBAC (future)
               │
               └──► OSMO Service (Port 8000)
```

**3. API/CLI Request (JWT Token)**

```
Client ──► Envoy
              │
              ├── ext_authz skipped (x-osmo-auth header present, matcher bypasses)
              │
              ├── JWT Filter validates token from x-osmo-auth header, sets x-osmo-user
              │
              ├── ext_authz (gRPC) ──► authz_sidecar checks RBAC (future)
              │
              └──► OSMO Service (Port 8000)
```

**4. Token Refresh (Seamless)**

Token refresh is transparent. When OAuth2 Proxy detects an expiring session during
the ext_authz check, it refreshes tokens with the IDP (sending the full scope
including `openid`, so the IDP returns a new `id_token`), updates the session cookie,
and returns 200 with fresh headers. The browser receives a `Set-Cookie` header with
the refreshed session.

## Detailed Design

### 1. Envoy ext_authz Configuration (OAuth2 Proxy)

This is the core integration point. Envoy's ext_authz filter consults OAuth2 Proxy for every
browser request. OAuth2 Proxy validates the session cookie and returns user identity headers
on success. Note: the `server_uri` path is used for cluster routing only — Envoy sends the
original request path to OAuth2 Proxy, which validates the session via its proxy handler with
`--upstream=static://200`.

```yaml
- name: envoy.filters.http.ext_authz
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
    http_service:
      server_uri:
        uri: http://127.0.0.1:4180/oauth2/auth
        cluster: oauth2-proxy
        timeout: 3s
      authorization_request:
        allowed_headers:
          patterns:
            - exact: cookie
      authorization_response:
        allowed_upstream_headers:
          patterns:
            - exact: authorization
            - exact: x-auth-request-user
            - exact: x-auth-request-email
            - exact: x-auth-request-preferred-username
        allowed_client_headers_on_success:
          patterns:
            - exact: set-cookie
            - exact: x-auth-request-user
            - exact: x-auth-request-email
            - exact: x-auth-request-preferred-username
    failure_mode_allow: false
```

**Skipping for API/CLI requests**: The ext_authz filter uses `ExtensionWithMatcher` to skip
when the `x-osmo-auth` header is present (same pattern as the current OAuth2 filter). API and
CLI requests carry JWT tokens directly and are validated by the JWT filter instead.

**Routing for login/callback/logout**: OAuth2 Proxy serves these paths directly:

```yaml
routes:
  - match:
      prefix: /oauth2/
    route:
      cluster: oauth2-proxy
  # ... existing routes unchanged ...
```

**OAuth2 Proxy cluster**:

```yaml
- name: oauth2-proxy
  connect_timeout: 0.25s
  type: STRICT_DNS
  lb_policy: ROUND_ROBIN
  load_assignment:
    cluster_name: oauth2-proxy
    endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 127.0.0.1
                port_value: 4180
```

### 2. Envoy Filter Chain Changes

**Before (current — 10 filters)**:

```yaml
http_filters:
  - name: envoy.filters.http.lua.block-spam-ips          # KEEP (service only)
  - name: envoy.filters.http.lua.strip-unauthorized       # KEEP
  - name: envoy.filters.http.lua.add-auth-skip            # KEEP (sets x-osmo-auth-skip for skip-auth paths)
  - name: envoy.filters.http.lua.add-forwarded-host       # KEEP
  - name: envoy.filters.http.lua.validate_idtoken         # REMOVE
  - name: envoy.filters.http.lua.pre_oauth2               # REMOVE
  - name: oauth2-with-matcher                              # REMOVE
  - name: envoy.filters.http.jwt_authn                     # KEEP (simplified)
  - name: envoy.filters.http.lua.roles                     # KEEP
  - name: envoy.filters.http.ratelimit                     # KEEP
  - name: envoy.filters.http.router                        # KEEP
```

**After (with OAuth2 Proxy — 11 filters)**:

```yaml
http_filters:
  - name: envoy.filters.http.lua.block-spam-ips          # KEEP (service only)
  - name: envoy.filters.http.lua.strip-unauthorized       # KEEP
  - name: envoy.filters.http.lua.add-auth-skip            # KEEP (skip-auth paths)
  - name: envoy.filters.http.lua.add-forwarded-host       # KEEP
  - name: envoy.filters.http.ext_authz                    # NEW - OAuth2 Proxy (authn, skipped via ExtensionWithMatcher)
  - name: envoy.filters.http.lua.copy-auth-header         # NEW - copies Authorization → x-osmo-auth for server-to-service calls
  - name: envoy.filters.http.jwt_authn                    # KEEP (simplified)
  - name: envoy.filters.http.lua.roles                    # KEEP (web-UI adds envoy_on_response for x-osmo-name)
  - name: envoy.filters.http.ext_authz                    # FUTURE - authz_sidecar (authz)
  - name: envoy.filters.http.ratelimit                    # KEEP
  - name: envoy.filters.http.router                       # KEEP
```

**What gets removed from Envoy**:

| Component | Location | Why Removable |
|-----------|----------|---------------|
| `validate_idtoken` Lua filter | All 3 `_envoy-config*.tpl` files | OAuth2 Proxy validates sessions natively |
| `pre_oauth2` Lua filter | All 3 `_envoy-config*.tpl` files | No more cookie manipulation needed |
| `envoy.cookie-management-lua` template | `web-ui/_envoy-config-helpers.tpl` | OAuth2 Proxy manages its own cookies |
| `oauth2-with-matcher` filter | All 3 `_envoy-config*.tpl` files | Replaced by ext_authz to OAuth2 Proxy |
| `token` + `hmac` secrets | Envoy secret config | OAuth2 Proxy has its own secrets |
| `forceReauthOnMissingIdToken` flag | All `values.yaml` + staging overrides | Not needed |
| `oauth2Filter.*` values block | All 3 `values.yaml` files | Replaced by `oauth2Proxy.*` |
| `IdToken` cookie extraction in JWT filter | JWT filter config | JWT filter only validates from `Authorization` header now |

**Estimated removal**: ~420-500 lines across the three charts.

**New filters added**:

| Component | Location | Purpose |
|-----------|----------|---------|
| `copy-auth-header` Lua | All 3 charts (after ext_authz) | Copies `Authorization: Bearer <token>` → `x-osmo-auth: <token>` so Next.js server-to-service calls can forward auth to the OSMO service without going through ext_authz again |
| `envoy_on_response` in roles Lua | Web-UI chart only | Extracts `name` claim from JWT metadata and adds `x-osmo-name` response header for the browser AuthProvider |

**Note**: The `add-auth-skip` Lua filter is kept. It sets `x-osmo-auth-skip: true` for
skip-auth paths (e.g., `/health`, `/api/version`). The ext_authz filter for OAuth2 Proxy
uses `ExtensionWithMatcher` to skip when this header is present — same pattern as the current
OAuth2 filter. OAuth2 Proxy's `--skip-auth-route` flag does not apply here because Envoy
controls which requests trigger the ext_authz check, not OAuth2 Proxy.

**Note**: The `oauth` cluster is **renamed to `idp`**, not removed. The OAuth2 filter used this
cluster for token exchange (that use goes away), but the JWT filter also uses it to fetch JWKS
keys from the IDP. The cluster definition stays, with its address sourced from a new
`sidecars.envoy.idp.host` value instead of the removed `oauth2Filter.authProvider`. JWT provider
entries in `values.yaml` update from `cluster: oauth` to `cluster: idp`.

**What stays in Envoy**:

| Component | Purpose |
|-----------|---------|
| `strip-unauthorized-headers` Lua | Prevents clients from injecting `x-osmo-user`, `x-osmo-roles` |
| `add-auth-skip` Lua | Sets `x-osmo-auth-skip` for skip-auth paths; ext_authz and JWT filters skip via `ExtensionWithMatcher` |
| `add-forwarded-host` Lua | Downstream services need `x-forwarded-host` |
| `block-spam-ips` Lua (service only) | IP blocking |
| `copy-auth-header` Lua filter (new) | After ext_authz sets `Authorization: Bearer <id_token>`, copies the token to `x-osmo-auth` so Next.js server-to-service calls can forward it. Runs only when `x-osmo-auth` is not already present. |
| `idp` cluster (renamed from `oauth`) | JWT filter uses this cluster to fetch JWKS keys from the IDP. Address sourced from new `sidecars.envoy.idp.host` value instead of removed `oauth2Filter.authProvider`. |
| JWT Filter (simplified) | Validates tokens from `Authorization` header for both browser (via OAuth2 Proxy) and API/CLI requests |
| `roles` Lua filter | Extracts roles from JWT claims to `x-osmo-roles` header. In the web-UI chart, also includes `envoy_on_response` to extract `name` from JWT metadata and add `x-osmo-name` response header for the browser. |
| Rate Limiting | Per-route rate limits |
| Routing rules | 11+ regex patterns in service chart, catch-all in router/web-ui |
| Access logging | Observability |

### 3. OAuth2 Proxy Sidecar Configuration

**Deployment**: Sidecar container in the same pod as Envoy, listening on `127.0.0.1:4180`.

**Helm values structure**:

```yaml
sidecars:
  oauth2Proxy:
    enabled: true
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.14.2
    imagePullPolicy: IfNotPresent

    # Port configuration
    httpPort: 4180
    metricsPort: 44180

    # Provider: oidc, azure, google, keycloak-oidc
    provider: oidc

    # OIDC issuer URL (required for all providers)
    oidcIssuerUrl: https://<idp-issuer-url>

    # Client credentials (reference to secret)
    clientId: <client-id>
    existingSecret: oauth2-proxy-secret
    clientSecretKey: client-secret
    cookieSecretKey: cookie-secret

    # Cookie settings
    cookieName: _osmo_session  # renamed from _oauth2_proxy to avoid collisions
    cookieSecure: true
    cookieDomain: ""  # Auto-detect from hostname
    cookieExpire: 168h  # 7 days
    cookieRefresh: 1h   # Refresh session every hour

    # Scope - must include openid for proper id_token refresh across all IDPs
    scope: "openid email profile"

    # Session storage — cookie by default. NOTE: Microsoft Entra ID tokens are large
    # (~1.5-2KB each for id_token + access_token), causing the session cookie to exceed
    # the 4KB browser cookie limit. OAuth2 Proxy splits across multiple cookies
    # (_osmo_session_0, _osmo_session_1). Use Redis for production to avoid this.
    sessionStoreType: cookie  # or redis for HA

    # Header configuration
    setXAuthRequest: true
    setAuthorizationHeader: true
    passAccessToken: false  # reduces cookie size; access token not needed by OSMO

    # Resources
    resources:
      requests:
        cpu: 50m
        memory: 64Mi
      limits:
        cpu: 200m
        memory: 128Mi
```

**Kubernetes secret**:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: oauth2-proxy-secret
type: Opaque
data:
  client-secret: <base64-encoded-client-secret>
  cookie-secret: <base64-encoded-32-byte-random>
```

### 4. Envoy Values Changes

The existing `oauth2Filter` block in each chart's `values.yaml` is replaced:

```yaml
sidecars:
  envoy:
    enabled: true
    # REMOVED: oauth2Filter block entirely
    # REMOVED: forceReauthOnMissingIdToken

    # IDP cluster (renamed from "oauth") — needed by JWT filter for JWKS fetching
    idp:
      host: <idp-hostname>  # e.g., login.microsoftonline.com (replaces oauth2Filter.authProvider)

    # JWT filter still needed (simplified — no cookie extraction)
    jwt:
      enabled: true
      user_header: x-osmo-user
      providers:
        - issuer: <idp-issuer-url>
          audience: <client-id>
          jwks_uri: <idp-jwks-uri>
          user_claim: <email|preferred_username|sub>  # varies by IDP
          cluster: idp  # renamed from "oauth" — points to IDP for JWKS key fetching
```

## Alternatives Considered

### Alternative 1: Continue with Envoy OAuth2 Filter + Lua Workarounds (Status Quo)

The current approach uses Envoy's built-in OAuth2 filter with ~220 lines of Lua per chart template
to work around the missing `scope=openid` on refresh. The Lua `pre_oauth2` filter detects when a
refresh response contains `BearerToken` but no valid `IdToken` (>50 chars), clears all auth cookies,
and forces the user to re-login.

- **Pros**: Already deployed, no new dependencies, no migration needed
- **Cons**: The workaround detects the failure and forces re-login — it doesn't fix refresh.
  Users experience periodic re-authentication when tokens expire. Each new IDP may need different
  workarounds. ~660 lines of duplicated Lua across 3 templates. The `forceReauthOnMissingIdToken`
  flag is currently only enabled in staging (Microsoft Entra ID).
- **Not chosen**: Doesn't solve the UX problem, high maintenance burden, doesn't scale to new IDPs.

### Alternative 2: Patch Envoy's OAuth2 Filter Upstream

Contribute a fix to the Envoy OAuth2 filter to include configurable scopes in token refresh requests.
This would fix the root cause in Envoy itself.

- **Pros**: No new dependencies, benefits the broader Envoy community, cleanest solution
- **Cons**: Envoy's OAuth2 filter has slow development velocity — the filter is marked "alpha" and
  has had limited contributions. The review/merge cycle is unpredictable (months to years). Even
  after merge, we'd need to wait for an Envoy release and update our proxy version. In the meantime,
  the Lua workarounds remain in place.
- **Not chosen**: Timeline uncertainty is too high. Could be pursued in parallel as a long-term
  contribution, but we need a working solution now.

### Alternative 3: Fix Token Refresh in Lua (Implement Refresh, Not Just Detect Failure)

Instead of detecting refresh failure and forcing re-login, implement the actual token refresh in Lua.
The Lua filter would intercept the OAuth2 filter's refresh request, add `scope=openid`, and handle
the token response.

- **Pros**: No new dependencies, no sidecar, stays within the existing architecture
- **Cons**: Implementing OAuth2 token refresh correctly in Lua is complex and error-prone — requires
  HTTP client calls to the IDP token endpoint, JSON parsing, error handling, and secure token storage.
  Envoy's Lua filter has limited HTTP client capabilities (`httpCall` is synchronous and blocking).
  This would add even more complexity to an already fragile workaround layer. Security-sensitive
  code in a templating language without proper testing infrastructure.
- **Not chosen**: Too complex and risky for Lua. OAuth2/OIDC implementation belongs in a dedicated
  component, not in Envoy filter scripts.

### Alternative 4: Custom Authentication Sidecar (Go)

Build a purpose-built Go sidecar that handles OAuth2/OIDC authentication, integrated via Envoy
ext_authz (same pattern as the proposed OAuth2 Proxy approach).

- **Pros**: Full control, optimized for OSMO, no external dependency, can combine authn + authz
  in one sidecar
- **Cons**: Implementing OAuth2/OIDC correctly is significant effort — token exchange, refresh,
  session management, CSRF protection, cookie encryption, multi-IDP support. Security-sensitive
  code requires thorough review and ongoing maintenance. OAuth2 Proxy already handles all of this
  with years of production hardening.
- **Not chosen**: High effort and security risk. OAuth2 Proxy is a better starting point. If OSMO
  needs custom authn logic in the future, it can be added alongside or replace OAuth2 Proxy.

### Summary Comparison

| Alternative | Fixes Refresh? | New Dependency? | Effort | Risk | PROJ-148 Aligned? |
|---|---|---|---|---|---|
| **OAuth2 Proxy (proposed)** | Yes | Sidecar (~64Mi) | Medium | Low | Yes |
| Status quo (Lua workarounds) | No (detects, re-logins) | None | None | Low | Partially |
| Patch Envoy upstream | Yes (eventually) | None | High | Medium | Yes |
| Lua-based refresh | Partially | None | High | High | Partially |
| Custom Go sidecar | Yes | Custom sidecar | Very High | High | Yes |

### Tradeoffs of OAuth2 Proxy

| Drawback | Mitigation |
|----------|------------|
| Additional sidecar container per pod | Lightweight: ~64Mi memory, ~5m CPU idle |
| New external dependency | Well-maintained, CNCF adjacent, used widely in production |
| Team learning curve | Good documentation, standard OAuth2/OIDC concepts |
| Configuration migration | One-time effort during rollout |

## Backwards Compatibility

| Component | Impact |
|-----------|--------|
| Browser authentication | Users re-login once after migration (new session cookie format) |
| CLI authentication | Unchanged — device flow goes through OSMO service |
| API authentication with JWT | Unchanged — JWT filter still validates tokens |
| Service-to-service auth | Unchanged — internal OSMO tokens still work |

## Performance

**Expected latency impact**:

| Scenario | Current | With OAuth2 Proxy | Delta |
|----------|---------|-------------------|-------|
| Authenticated request (session valid) | ~2ms | ~3ms | +1ms (localhost subrequest) |
| Token refresh | ~500ms | ~500ms | ~0ms |
| Initial login | ~1s | ~1s | ~0ms |
| API request with JWT | ~2ms | ~2ms | ~0ms (OAuth2 Proxy skipped) |

**Resource usage per sidecar**:

| Resource | Value |
|----------|-------|
| CPU (idle) | ~5m |
| CPU (active) | ~50m |
| Memory | 64-128Mi |

## Operations

**Monitoring**:
- Prometheus metrics at `:44180/metrics`
- Key metrics: `oauth2_proxy_requests_total`, `oauth2_proxy_upstream_response_time`

**Health checks**:
- Liveness: `GET /ping`
- Readiness: `GET /ready`

**Troubleshooting**:
- Debug logging: `--logging-level=debug`
- Session inspection: `GET /oauth2/userinfo` (available on the OAuth2 Proxy port, not exposed externally)
- Config validation: `oauth2-proxy --validate`
- Check browser response headers: `/auth/login_info` should include `x-auth-request-email`, `x-auth-request-preferred-username`, and `x-osmo-name`

**Security**:
- Session cookies: `Secure`, `HttpOnly`, `SameSite=Lax`, encrypted
- Secrets loaded from files, not environment variables
- CSRF protection via state parameter in OAuth2 flow
- `failure_mode_allow: false` — if OAuth2 Proxy is down, requests are denied

## Test Plan

**Browser authentication (service, router, web-ui)**:

| Test | What the user does | Expected |
|------|--------------------|----------|
| First visit | Open OSMO in browser | Redirected to IDP login page, authenticate, redirected back. Page loads. |
| Navigate the UI | Click through workflows, pools, tasks, resources, UI dashboard | All pages and static assets load. No unexpected login prompts. |
| Session stays alive | Keep using the UI for 30 minutes plus | No re-login. Session refreshes transparently in the background. |
| Idle and return | Leave browser open, come back after 10 mins | Page loads on next click without re-login. |
| Logout | Click logout | Session cleared, redirected to IDP logout. Visiting OSMO again requires login. |

**Token refresh (core thesis)**:

| Test | What the user does | Expected |
|------|--------------------|----------|
| Seamless refresh | Use the app continuously past token expiry | Zero re-login prompts. `id_token` present after every refresh. |
| Idle refresh | Leave browser idle, return after token expiry | Next request triggers silent refresh. No login page pr redirect to login page. |

**CLI and API access**:

| Test | What the user does | Expected |
|------|--------------------|----------|
| Device flow login | `osmo login` | Opens browser for device code auth, completes, CLI receives JWT. Unchanged. |
| API calls with JWT | `osmo workflow list`, `osmo pool list`, etc. | Requests carry `x-osmo-auth` JWT. OAuth2 Proxy is skipped entirely. Unchanged. |
| CLI token refresh | `osmo auth refresh-token` | Refreshes JWT via `/api/auth/jwt/refresh_token` (skip-auth path). Unchanged. |
| Client download | `osmo` auto-update via `/client/*` | Downloads work. Unchanged. |

**Service-to-service (internal)**:

| Test | What happens | Expected |
|------|--------------|----------|
| In-cluster API calls | Other services call APIs via in-cluster listener | Bypass auth entirely. Unchanged. |
| Internal OSMO JWT | Services authenticate with internal OSMO JWT | JWT filter validates via internal cluster. Unchanged. |

**Unauthenticated paths**:

| Test | What the user does | Expected |
|------|--------------------|----------|
| Health check | `GET /health` | Returns 200, no auth required |
| Version check | `GET /api/version` | Returns version JSON, no auth required |
| Auth endpoints | `GET /api/auth/login`, `/api/auth/keys` | Accessible without auth |

**Streaming and long-lived connections**:

| Test | What the user does | Expected |
|------|--------------------|----------|
| Workflow logs | `osmo workflow logs <id>` (streaming) | Streams continuously. Not interrupted by OAuth2 Proxy. |
| Agent backend | Agent connects via WebSocket | WebSocket upgrade succeeds. Long-lived connection stays open. |
| Port forwarding | User port-forwards through UI | Connection established and stays open. |


## Relation to Other PROJ-148 Components

| Component | Relationship |
|-----------|--------------|
| **authz_sidecar** | Fully compatible. Both use Envoy ext_authz pattern. OAuth2 Proxy handles authn, authz_sidecar handles authz. |
| **Direct IDP Integration** | Aligned on goals (remove Keycloak, connect to IDPs directly). The Direct IDP Integration doc currently assumes Envoy's OAuth2 filter — it needs updating to reference OAuth2 Proxy as the authn mechanism. IDP registration steps (app registration, redirect URIs, secrets) remain the same. |
| **Resource-Action Model** | No impact — authorization layer is unchanged. |

## Open Questions

- [ ] Should we use Redis for session storage in production?
  - **Cookie storage**: Simpler, no additional infrastructure. However, Microsoft Entra ID tokens are large enough that the encrypted session exceeds the 4KB browser cookie limit. OAuth2 Proxy splits the session across multiple cookies (`_osmo_session_0`, `_osmo_session_1`), which works but adds overhead to every request. `--pass-access-token=false` does NOT reduce cookie size — the access token is always stored in the session for refresh purposes.
  - **Redis storage**: Cookies only store a session ID (~50 bytes). Token data lives server-side. Better for horizontal scaling and eliminates the multi-cookie split. Since OSMO already integrates with redis should we have an option for users to connect to redis for their cookie storage?

- [x] How do we handle the transition period where users have old Envoy OAuth2 cookies?
  - **Resolved**: Cookie name changed from `_oauth2_proxy` to `_osmo_session`. Old cookies are ignored by OAuth2 Proxy (different name) and expire naturally. Users authenticate fresh with the new cookie name. Old cookies can be manually cleared from the browser.

## Appendix

### OAuth2 Proxy Container Definition

```yaml
- name: oauth2-proxy
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.14.2
  args:
    - --http-address=0.0.0.0:4180
    - --metrics-address=0.0.0.0:44180
    - --reverse-proxy=true
    - --provider=$(OAUTH2_PROVIDER)          # oidc, azure, google, keycloak-oidc
    - --oidc-issuer-url=$(OIDC_ISSUER_URL)
    - --client-id=$(CLIENT_ID)
    - --config=/etc/oauth2-proxy/config.cfg  # contains client_secret and cookie_secret inline
    - --cookie-secure=true
    - --skip-provider-button=true
    - --cookie-name=_osmo_session   # renamed from default to avoid collisions
    - --cookie-domain=.osmo.nvidia.com
    - --cookie-expire=168h
    - --cookie-refresh=1h
    - --scope=openid email profile
    - --email-domain=*
    - --set-xauthrequest=true
    - --set-authorization-header=true
    - --pass-access-token=false     # access token not needed, reduces cookie size
    - --upstream=static://200
  env:
    - name: OAUTH2_PROVIDER
      value: "oidc"
    - name: OIDC_ISSUER_URL
      value: "<idp-issuer-url>"
    - name: CLIENT_ID
      value: "<client-id>"
  ports:
    - name: http
      containerPort: 4180
    - name: metrics
      containerPort: 44180
  livenessProbe:
    httpGet:
      path: /ping
      port: http
    initialDelaySeconds: 5
    periodSeconds: 10
  readinessProbe:
    httpGet:
      path: /ready
      port: http
    initialDelaySeconds: 5
    periodSeconds: 10
  resources:
    requests:
      cpu: 50m
      memory: 64Mi
    limits:
      cpu: 200m
      memory: 128Mi
  volumeMounts:
    - name: oauth2-proxy-secrets
      mountPath: /etc/oauth2-proxy
      readOnly: true
```

Note: `--upstream=static://200` means OAuth2 Proxy validates sessions and returns a 200 response
with auth headers. It never proxies actual traffic — Envoy handles all routing.
`--config` points to a file with `client_secret = "..."` and `cookie_secret = "..."` inline
(NOT `_file` references, which don't exist in any OAuth2 Proxy version).


