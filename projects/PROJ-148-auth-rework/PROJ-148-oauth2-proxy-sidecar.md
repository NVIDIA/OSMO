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

**Author**: @vpan<br>
**PIC**: @vpan<br>
**Proposal Issue**: [#148](https://github.com/NVIDIA/OSMO/issues/148)

## Overview

This document proposes replacing Envoy's built-in OAuth2 filter with [OAuth2 Proxy](https://oauth2-proxy.github.io/oauth2-proxy/)
as a dedicated authentication sidecar running in **auth-request mode**. Envoy makes a subrequest to
OAuth2 Proxy for session validation while retaining full control of routing, rate limiting, and
traffic flow. This addresses limitations in Envoy's OAuth2 filter — particularly around token refresh
with OIDC providers — while maintaining compatibility with the planned authz_sidecar
(PROJ-148-auth-sidecar) for authorization.

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

### Proposed Architecture (Auth-Request Mode)

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              POD                                           │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Browser ──► Envoy (Port 80) ──────────────────────────► OSMO Service     │
│                   │                                        (Port 8000)     │
│                   │                                                        │
│                   ├── ext_authz (HTTP) ──► OAuth2 Proxy (Port 4180)        │
│                   │                              │                         │
│                   │                              └──► IDP (MS/Google/OIDC) │
│                   │                                                        │
│                   ├── JWT Filter (validate id_token / API tokens)          │
│                   ├── ext_authz (gRPC) ──► authz_sidecar (future)          │
│                   ├── Lua: strip-unauthorized-headers                      │
│                   ├── Lua: add-forwarded-host                              │
│                   └── Rate Limiting                                        │
│                                                                            │
│   /oauth2/* routes ──► OAuth2 Proxy (login, callback, logout only)         │
│                                                                            │
│   Removed:                                                                 │
│   ✗ OAuth2 Filter          ✗ Lua: validate_idtoken                         │
│   ✗ Lua: pre_oauth2        ✗ Lua: cookie-management                        │
│   ✗ token/hmac secrets      ✗ forceReauthOnMissingIdToken flag             │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

**Key design**: Envoy stays in control of all traffic routing. OAuth2 Proxy is only consulted
via subrequest for authentication decisions and serves the login/callback/logout endpoints directly.
It is never in the data path for normal requests.

### Why Auth-Request Mode Over Proxy Mode

OAuth2 Proxy supports two integration modes. **Auth-request mode** is the right choice for OSMO:

| Concern | Auth-Request Mode | Proxy Mode |
|---|---|---|
| **Routing** | Envoy keeps its existing 11+ regex route patterns, per-route rate limits, and WebSocket support unchanged | OAuth2 Proxy would sit in the data path; Envoy loses visibility into request paths for rate limiting |
| **Streaming** | WebSocket/streaming connections (`exec`, `portforward`, `rsync`) flow directly from Envoy to service | Every byte of streaming data passes through OAuth2 Proxy unnecessarily |
| **API/CLI tokens** | Requests with JWT tokens in `x-osmo-auth` skip the OAuth2 Proxy subrequest entirely via matcher | All requests flow through OAuth2 Proxy even when it has nothing to do |
| **Consistency** | Same ext_authz pattern as authz_sidecar — both are "check" sidecars that Envoy consults | OAuth2 Proxy has a different role (inline proxy) than authz_sidecar (ext_authz) |
| **Chart reuse** | OAuth2 Proxy config is identical across service, router, and web-ui charts — it only answers "is this session valid?" | Each chart's OAuth2 Proxy would need to know about upstream routing |
| **Blast radius** | If OAuth2 Proxy restarts, only new auth checks pause; in-flight data connections are unaffected | If OAuth2 Proxy restarts, all in-flight connections drop |
| **Scale** | OAuth2 Proxy handles only small auth-check subrequests (<1ms each) | OAuth2 Proxy processes every request/response body |

### Request Flow

**1. Unauthenticated Browser Request**

```
Browser ──► Envoy
               │
               ├── ext_authz subrequest ──► OAuth2 Proxy /oauth2/auth
               │                                  │
               │                                  └── No session cookie → 401
               │
               └── Envoy sees 401, returns 302 redirect to /oauth2/start
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
               ├── ext_authz subrequest ──► OAuth2 Proxy /oauth2/auth
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
the `/oauth2/auth` subrequest, it refreshes tokens with the IDP (sending the full scope
including `openid`, so the IDP returns a new `id_token`), updates the session cookie,
and returns 200 with fresh headers. The browser receives a `Set-Cookie` header with
the refreshed session.

## Detailed Design

### 1. Envoy ext_authz Configuration (OAuth2 Proxy)

This is the core integration point. Envoy sends a subrequest to OAuth2 Proxy's `/oauth2/auth`
endpoint for every browser request. OAuth2 Proxy validates the session cookie and returns
user identity headers on success.

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
            - exact: x-auth-request-user
            - exact: x-auth-request-email
            - exact: authorization
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

**After (with OAuth2 Proxy — 9 filters)**:

```yaml
http_filters:
  - name: envoy.filters.http.lua.block-spam-ips          # KEEP (service only)
  - name: envoy.filters.http.lua.strip-unauthorized       # KEEP
  - name: envoy.filters.http.lua.add-auth-skip            # KEEP (skip-auth paths)
  - name: envoy.filters.http.lua.add-forwarded-host       # KEEP
  - name: envoy.filters.http.ext_authz                    # NEW - OAuth2 Proxy (authn, skipped via ExtensionWithMatcher)
  - name: envoy.filters.http.jwt_authn                    # KEEP (simplified)
  - name: envoy.filters.http.lua.roles                    # KEEP
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

**Note**: The `add-auth-skip` Lua filter is kept. It sets `x-osmo-auth-skip: true` for
skip-auth paths (e.g., `/health`, `/api/version`). The ext_authz filter for OAuth2 Proxy
uses `ExtensionWithMatcher` to skip when this header is present — same pattern as the current
OAuth2 filter. OAuth2 Proxy's `--skip-auth-route` flag does not work in auth-request mode
because Envoy controls which requests trigger the subrequest, not OAuth2 Proxy.

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
| `idp` cluster (renamed from `oauth`) | JWT filter uses this cluster to fetch JWKS keys from the IDP. Address sourced from new `sidecars.envoy.idp.host` value instead of removed `oauth2Filter.authProvider`. |
| JWT Filter (simplified) | Validates tokens from `Authorization` header for both browser (via OAuth2 Proxy) and API/CLI requests |
| `roles` Lua filter | Extracts roles from JWT claims to `x-osmo-roles` header |
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
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
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
    cookieName: _oauth2_proxy
    cookieSecure: true
    cookieDomain: ""  # Auto-detect from hostname
    cookieExpire: 168h  # 7 days
    cookieRefresh: 1h   # Refresh session every hour

    # Scope - must include openid for proper id_token refresh across all IDPs
    scope: "openid email profile"

    # Session storage
    sessionStoreType: cookie  # or redis for HA

    # Header configuration (auth-request mode)
    setXAuthRequest: true
    setAuthorizationHeader: true
    passAccessToken: true

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
- Session inspection: `GET /oauth2/userinfo`
- Config validation: `oauth2-proxy --validate`

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

## Implementation Plan

### Phase 1: Proof of Concept
- [ ] Deploy OAuth2 Proxy in development environment
- [ ] Configure for a target IDP (e.g., Microsoft Entra ID, Google)
- [ ] Verify token refresh returns `id_token` (the core thesis)
- [ ] Test ext_authz integration with Envoy

### Phase 2: Helm Chart Development
- [ ] Add `oauth2Proxy` sidecar to `_sidecar-helpers.tpl` (shared template for all 3 charts)
- [ ] Add ext_authz filter config and `oauth2-proxy` cluster to Envoy templates
- [ ] Add `/oauth2/*` routes to Envoy route config
- [ ] Add `oauth2Proxy` values block to `values.yaml`
- [ ] Add Kubernetes secret template for OAuth2 Proxy

### Phase 3: Rollout
- [ ] Deploy to staging with feature flag (`oauth2Proxy.enabled`)
- [ ] Validate token refresh with each configured IDP
- [ ] Monitor metrics and logs
- [ ] Full production rollout

### Phase 4: Cleanup
- [ ] Remove Envoy OAuth2 filter configuration from all 3 templates
- [ ] Remove all Lua workaround code (`validate_idtoken`, `pre_oauth2`, `cookie-management-lua`)
- [ ] Rename `oauth` cluster to `idp` in all 3 templates; update address source from `oauth2Filter.authProvider` to new `sidecars.envoy.idp.host`
- [ ] Update JWT provider entries to use `cluster: idp` instead of `cluster: oauth`
- [ ] Remove `token`/`hmac` secret configuration
- [ ] Remove `forceReauthOnMissingIdToken` flag from all values files
- [ ] Remove `oauth2Filter.*` values block (except auth provider host, which moves to `sidecars.envoy.idp.host`)
- [ ] Remove `IdToken` cookie extraction from JWT filter config
- [ ] Update Direct IDP Integration doc (PROJ-148) to reference OAuth2 Proxy
- [ ] Update service deployment documentation

## Open Questions

- [ ] Should we use Redis for session storage in production for HA?
  - **Cookie storage**: Simpler, no additional infrastructure, works for single-pod deployments
  - **Redis storage**: Better for horizontal scaling, session sharing across pods
  - **Recommendation**: Start with cookie storage. Migrate to Redis if we need multi-pod session sharing.

- [ ] How do we handle the transition period where users have old Envoy OAuth2 cookies?
  - **Decision**: Invalidate all sessions on deployment. Users re-login once. This is simpler than
    supporting dual cookie formats and is a one-time event during the migration.

## Appendix

### OAuth2 Proxy Container Definition

```yaml
- name: oauth2-proxy
  image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
  args:
    - --http-address=0.0.0.0:4180
    - --metrics-address=0.0.0.0:44180
    - --reverse-proxy=true
    - --provider=$(OAUTH2_PROVIDER)          # oidc, azure, google, keycloak-oidc
    - --oidc-issuer-url=$(OIDC_ISSUER_URL)
    - --client-id=$(CLIENT_ID)
    - --client-secret-file=/etc/oauth2-proxy/client-secret
    - --cookie-secret-file=/etc/oauth2-proxy/cookie-secret
    - --cookie-secure=true
    - --cookie-name=_oauth2_proxy
    - --cookie-domain=.osmo.nvidia.com
    - --cookie-expire=168h
    - --cookie-refresh=1h
    - --scope=openid email profile
    - --email-domain=*
    - --set-xauthrequest=true
    - --set-authorization-header=true
    - --pass-access-token=true
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

Note: `--upstream=static://200` is used in auth-request mode. OAuth2 Proxy doesn't proxy traffic
to the upstream service — it only validates sessions and returns headers. Envoy handles all routing.

### Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `external/deployments/charts/service/templates/_sidecar-helpers.tpl` | Add | OAuth2 Proxy container template |
| `external/deployments/charts/service/templates/_envoy-config.tpl` | Modify | Remove OAuth2 filter + Lua, add ext_authz + oauth2-proxy cluster + /oauth2/ route, rename `oauth` cluster to `idp` |
| `external/deployments/charts/service/values.yaml` | Modify | Add `oauth2Proxy` config, add `idp.host`, remove `oauth2Filter`, update JWT `cluster: oauth` → `cluster: idp` |
| `external/deployments/charts/router/templates/_envoy-config-helpers.tpl` | Modify | Same as service |
| `external/deployments/charts/router/values.yaml` | Modify | Add `oauth2Proxy` config, remove `oauth2Filter` |
| `external/deployments/charts/web-ui/templates/_envoy-config-helpers.tpl` | Modify | Same as service |
| `external/deployments/charts/web-ui/values.yaml` | Modify | Add `oauth2Proxy` config, remove `oauth2Filter` |
| `charts_value/*/stg/*.yaml` | Modify | Update to use `oauth2Proxy`, remove `forceReauthOnMissingIdToken` |
