<!--
SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

# Resource-Action Permission Model with Casbin

**Author**: @RyaliNvidia<br>
**Related**: [PROJ-148-resource-action-model.md](./PROJ-148-resource-action-model.md)

## Overview

This document describes how to implement the resource-action permission model using [Casbin](https://casbin.org/), an open-source access control library that provides:

- **Flexible model definition** — Define custom access control models (ACL, RBAC, ABAC)
- **Policy storage adapters** — Store policies in PostgreSQL using the pgx adapter
- **Custom functions** — Extend matchers for wildcard patterns and DB lookups
- **Multi-language support** — Available in Go, Python, Java, Node.js, etc.

### Why Casbin?

| Benefit | Description |
|---------|-------------|
| Battle-tested | Used by thousands of production systems |
| RBAC + ABAC | Supports role-based AND attribute-based access control |
| pgx adapter | PostgreSQL policy storage via connection string |
| Custom functions | Can call external functions (DB lookups, body parsing) during policy evaluation |
| Wildcard matching | Built-in support for glob patterns |
| Deny precedence | Configurable policy effects including deny-override |

---

## Core Concepts

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CASBIN ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MODEL (model.conf)                                                         │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Defines the access control model structure:                                │
│  • [request_definition] — What info comes with each request                 │
│  • [policy_definition] — How policies are structured                        │
│  • [role_definition] — Role inheritance (RBAC)                              │
│  • [policy_effect] — How to combine multiple policy results                 │
│  • [matchers] — Logic to match requests against policies                    │
│                                                                             │
│  POLICY (PostgreSQL)                                                        │
│  ─────────────────────────────────────────────────────────────────────────  │
│  The actual access control rules stored in casbin_rule table:               │
│  • p, osmo-admin, workflow:*, *, allow                                      │
│  • p, osmo-user, workflow:Create, pool/*, allow                             │
│  • g, alice, osmo-admin (role assignment)                                   │
│                                                                             │
│  ENFORCER                                                                   │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Makes access control decisions:                                            │
│  • enforcer.Enforce(sub, act, obj) → true/false                             │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Model Definition

The Casbin model is defined inline in `authz_server_casbin.go` as an RBAC model with deny support:

```ini
[request_definition]
r = sub, act, obj

[policy_definition]
p = sub, act, obj, eft

[role_definition]
g = _, _

[policy_effect]
# deny-override: if ANY policy denies, result is deny (matches AWS IAM behavior)
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
m = g(r.sub, p.sub) && actionMatch(r.act, p.act) && resourceMatch(r.obj, p.obj)
```

**Key elements:**
- `sub` = subject (role being checked)
- `act` = action (e.g., `workflow:Create`)
- `obj` = scoped resource (e.g., `pool/*`, `bucket/my-bucket`)
- `eft` = effect (`allow` or `deny`)
- `actionMatch` and `resourceMatch` are custom functions for wildcard matching

---

## Resource Scoping Model

Resources are returned with scope-based prefixes based on the Resource-Action Model. The scope determines the authorization boundary for each resource type.

### Scope Definitions

| Resource Type | Scope | Return Format | Description |
|---------------|-------|---------------|-------------|
| `workflow`, `task` | pool | `pool/*` | Pool cannot be determined from path alone |
| `bucket` | bucket (self) | `bucket/{id}` | Bucket ID is the scope |
| `config` | config (self) | `config/{id}` | Config ID is the scope |
| `profile` | user | `user/{id}` | Profile is scoped to user |
| `pool`, `credentials`, `user`, `app` | global | `*` | No specific scope |
| `system`, `auth`, `router` | public/global | `*` | No specific scope |
| `internal` | backend | `backend/{id}` | Scoped to backend service |

### Scope Resolution

The `extractResourceFromPath` function converts API paths to scoped resources:

```
/api/workflow/abc123  →  pool/*      (workflow is pool-scoped, pool unknown from path)
/api/bucket/my-data   →  bucket/my-data   (bucket is self-scoped)
/api/profile/alice    →  user/alice       (profile is user-scoped)
/api/credentials      →  *                (credentials is global)
/api/agent/listener   →  backend/listener (internal is backend-scoped)
```

### Policy Examples with Scopes

```
# User can access all workflows (pool-scoped)
p, osmo-user, workflow:*, pool/*, allow

# User can only access specific bucket
p, data-user, bucket:Read, bucket/shared-data, allow

# User can only update their own profile
p, osmo-user, profile:Update, user/*, allow

# Backend can access internal endpoints
p, osmo-backend, internal:Operator, backend/*, allow
```

---

## Custom Matching Functions

### Action Matching

The `actionMatch` function supports wildcard patterns:

- **Exact match**: `workflow:Create` matches `workflow:Create`
- **Full wildcard**: `*:*` or `*` matches any action
- **Resource wildcard**: `workflow:*` matches `workflow:Create`, `workflow:Read`, etc.
- **Action wildcard**: `*:Read` matches `workflow:Read`, `bucket:Read`, etc.

### Resource Matching

The `resourceMatch` function supports scope-based patterns:

- **Full wildcard**: `*` matches any resource
- **Prefix wildcard**: `pool/*` matches `pool/*`, `pool/default`, etc.
- **Exact match**: `bucket/my-data` matches only that specific bucket
- **Nested patterns**: `pool/production/*` for pool-specific access

---

## PostgreSQL Policy Storage

The pgx adapter (`github.com/pckhoi/casbin-pgx-adapter/v2`) stores policies in a `casbin_rule` table:

```sql
CREATE TABLE IF NOT EXISTS casbin_rule (
    id SERIAL PRIMARY KEY,
    ptype VARCHAR NOT NULL,  -- "p" for policy, "g" for role assignment
    v0 VARCHAR,              -- subject
    v1 VARCHAR,              -- action
    v2 VARCHAR,              -- resource (scoped)
    v3 VARCHAR,              -- effect (allow/deny)
    v4 VARCHAR,              -- condition (optional)
    v5 VARCHAR               -- reserved
);

CREATE INDEX idx_casbin_ptype ON casbin_rule(ptype);
CREATE INDEX idx_casbin_v0 ON casbin_rule(v0);
CREATE INDEX idx_casbin_v0_v1 ON casbin_rule(v0, v1);
```

**Note:** The pgx adapter uses a connection string (not an existing `pgxpool.Pool`), as it internally uses pgx/v4. The connection string is built from the same PostgreSQL configuration parameters used by the main application.

---

## Default Role Policies

```go
// LoadDefaultPolicies loads the default OSMO roles
policies := [][]string{
    // osmo-admin: Full access except internal
    {"osmo-admin", "*:*", "*", "allow"},
    {"osmo-admin", "internal:*", "*", "deny"},

    // osmo-user: Standard user access
    {"osmo-user", "workflow:*", "pool/*", "allow"},
    {"osmo-user", "bucket:*", "bucket/*", "allow"},
    {"osmo-user", "credentials:*", "*", "allow"},
    {"osmo-user", "profile:Read", "user/*", "allow"},
    {"osmo-user", "profile:Update", "user/*", "allow"},
    {"osmo-user", "pool:Read", "*", "allow"},
    {"osmo-user", "user:List", "*", "allow"},
    {"osmo-user", "app:*", "*", "allow"},
    {"osmo-user", "config:Read", "config/*", "allow"},
    {"osmo-user", "system:*", "*", "allow"},

    // osmo-viewer: Read-only access
    {"osmo-viewer", "workflow:Read", "pool/*", "allow"},
    {"osmo-viewer", "bucket:Read", "bucket/*", "allow"},
    {"osmo-viewer", "system:*", "*", "allow"},

    // osmo-backend: For backend agents
    {"osmo-backend", "internal:Operator", "backend/*", "allow"},
    {"osmo-backend", "pool:Read", "*", "allow"},
    {"osmo-backend", "config:Read", "config/*", "allow"},

    // osmo-ctrl: For workflow pods
    {"osmo-ctrl", "internal:Logger", "backend/*", "allow"},
    {"osmo-ctrl", "internal:Router", "backend/*", "allow"},

    // osmo-default: Minimal access (unauthenticated)
    {"osmo-default", "system:Health", "*", "allow"},
    {"osmo-default", "system:Version", "*", "allow"},
    {"osmo-default", "auth:Login", "*", "allow"},
    {"osmo-default", "auth:Refresh", "*", "allow"},
    {"osmo-default", "auth:Token", "*", "allow"},
}
```

---

## Authorization Flow

1. **Resolve Path to Action**: Convert API path and method to semantic action using the Action Registry
2. **Extract Scoped Resource**: Determine the scope-based resource identifier from the path
3. **Build Request Context**: Gather user info, roles, body, params, headers
4. **Evaluate Policies**: Casbin checks each role against policies using custom matchers
5. **Return Decision**: Allow if any role permits and none deny

The authorization middleware performs these steps for every incoming request, with caching for performance.

---

## Database Lookups for Fine-Grained Access

For endpoints requiring ownership or pool-based access control, custom functions can query PostgreSQL:

**Workflow Ownership**: Check if user owns the workflow before allowing access to sensitive endpoints like `/api/workflow/spec`

**Pool-Based Access**: Query the workflow's pool and verify user has access to that pool

These lookups are cached (5-minute TTL) to meet the <5ms p99 latency requirement.

---

## Performance Considerations

| Operation | Target | Notes |
|-----------|--------|-------|
| Policy evaluation (cached) | <1ms p99 | In-memory policy lookup |
| Policy evaluation (uncached) | <5ms p99 | Includes DB adapter query |
| DB condition check (cached) | <2ms p99 | Workflow owner lookup |
| DB condition check (uncached) | <10ms p99 | Fresh database query |

**Caching strategies:**
- Cache authorization decisions by role + method + path + resource ID
- Cache resource metadata (ownership, pool) with TTL
- Use in-memory cache (go-cache) for fast lookups

---

## Implementation Checklist

- [ ] Define Casbin model (inline in `authz_server_casbin.go`)
- [ ] Set up pgx adapter with connection string
- [ ] Register custom functions (action matching, resource matching)
- [ ] Create action registry (path → action mapping)
- [ ] Implement scope-based resource extraction
- [ ] Implement Envoy ext-authz integration (`CasbinAuthzServer`)
- [ ] Add policy reload loop for live updates
- [ ] Load default role policies to database
- [ ] Add caching layer for authorization decisions
- [ ] Write migration scripts for existing policies
- [ ] Test all existing access patterns

---

## References

- [Casbin Documentation](https://casbin.org/docs/en/overview)
- [Casbin Go](https://github.com/casbin/casbin)
- [Casbin pgx Adapter](https://github.com/pckhoi/casbin-pgx-adapter)
- [pgx - PostgreSQL Driver](https://github.com/jackc/pgx)
- [AWS IAM Policy Reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html)
