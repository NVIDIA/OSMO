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

# Resource-Action Permission Model Design

**Author**: @RyaliNvidia<br>
**PIC**: @RyaliNvidia<br>
**Proposal Issue**: [#148](https://github.com/NVIDIA/OSMO/issues/148)

## Overview

This document describes the design for a resource-action permission model for OSMO authorization.
The model decouples authorization policies from specific API paths by using semantic actions similar
to AWS IAM policies, improving maintainability, auditability, and developer experience.

### Motivation

- **Simplify policy management** — Define permissions in terms of what users can do (e.g., "create workflows") rather than which URLs they can access
- **Improve auditability** — Make it easy to understand what actions a role grants without tracing API paths
- **Future proofing** — The same action can have the underlying apis change without requiring the role actions to change

### Problem

Currently, role policies directly reference API paths:

```python
role.RoleAction(base='http', path='/api/workflow/*', method='*')
role.RoleAction(base='http', path='/api/bucket', method='*')
```

This approach has several limitations:

1. **Tight coupling** — Policies break when API paths change (e.g., `/api/workflow` → `/api/v2/workflow`)
2. **Redundancy** — Multiple paths often represent the same logical action (e.g., `GET /api/workflow` and `GET /api/workflow/*` both mean "read workflows")
3. **Complexity** — Path patterns become complex with wildcards and deny patterns (`!/api/agent/*`)
4. **Maintainability** — Hard to audit what actions a role can actually perform; requires tracing paths to understand permissions
5. **No semantic meaning** — `/api/workflow/*` doesn't convey whether it allows create, read, update, delete, or all operations

## Use Cases

| Use Case | Description |
|---|---|
| Define a read-only role | Admin creates a role that can view workflows and tasks but cannot create, modify, or delete them using `workflow:Read` action |
| Grant workflow management | User role includes `workflow:*` to allow all workflow operations (create, read, update, delete, cancel, clone) |
| Backend service access | Internal services use `internal:Operator` action to access agent APIs without exposing those endpoints to regular users |
| Audit role permissions | Admin reviews a role's policy and immediately understands what it allows (e.g., `dataset:Read`, `dataset:Create`) without tracing API paths |
| Add new API endpoint | Developer adds `POST /api/workflow/{id}/archive` and corresponding `workflow:Archive` action in the same PR |

## Requirements

| Title | Description | Type |
|---|---|---|
| Semantic action model | Policies shall reference semantic actions (e.g., `workflow:Create`) instead of API paths | Functional |
| AWS IAM-style policies | Policies shall support Allow/Deny effects with action and resource matching | Functional |
| Wildcard support | Policies shall support wildcards for actions (`workflow:*`, `*:Read`, `*:*`) and resources (`*`) | Functional |
| Deny precedence | If any policy statement denies an action, access shall be denied regardless of Allow statements | Functional |
| Code-defined action registry | Action-to-path mappings shall be defined in code (not database) for compile-time safety | Functional |
| Dynamic policy updates | Role policies shall be updatable at runtime via API without requiring deployment | Functional |
| Backward compatibility | The new model shall support running alongside the existing path-based model during migration | Functional |
| Authorization latency | Authorization checks shall complete in <5ms at p99 (cached) | KPI |
| Policy validation | When creating/updating a role, the system shall validate that referenced actions exist in the registry | Security |
| Immutable default roles | Default system roles (osmo-admin, osmo-user, etc.) shall be protected from modification | Security |

---

## Architectural Details

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     RESOURCE-ACTION PERMISSION MODEL                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  LAYER 1: Action Registry (Static, Code-defined)                            │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Immutable mapping of actions → API paths                                   │
│  Changes require code update + deployment                                   │
│  Example: workflow:Create → POST /api/workflow                              │
│                                                                             │
│  LAYER 2: Policy Engine (Dynamic, DB-stored)                                │
│  ─────────────────────────────────────────────────────────────────────────  │
│  AWS-style policies granting actions on resources                           │
│  Can be updated at runtime via API                                          │
│  Format: { "effect": "Allow", "actions": [...], "resources": [...] }        │
│                                                                             │
│  LAYER 3: Role Assignments (Dynamic, DB-stored)                             │
│  ─────────────────────────────────────────────────────────────────────────  │
│  Maps users to roles                                                        │
│  Can be updated at runtime via API                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Code-Defined Action Registry?

The action registry is defined in code (not database) for several reasons:

1. **Actions are tied to API code** — When you add a new API endpoint, you add the action in the same PR
2. **Prevents accidental/malicious action creation** — Only developers with code access can define new actions
3. **Compile-time safety** — Go constants for actions provide autocomplete, type-checking, and catch typos
4. **Audit trail via Git** — All changes tracked in git history with commit messages
5. **Simpler implementation** — No need for a separate `action_registry` table

---

## Resource-Action Model

### Resources and Actions

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RESOURCE-ACTION MODEL                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  RESOURCES           ACTIONS                    SCOPED TO                   │
│  ─────────           ───────                    ─────────                   │
│  pool                List                       (global)                    │
│                                                                             │
│  workflow            Create, Read, Update,      pool / user                 │
│                      Delete, Cancel, Clone,                                 │
│                      List, Execute                                          │
│                                                                             │
│  task                Read, Update, Cancel,      pool / user                 │
│                      Exec, PortForward, Rsync                               │
│                                                                             │
│  dataset             Create, Read, Write,       bucket                      │
│                      Delete, List                                           │
│                                                                             │
│  credentials         Create, Read, Update,      (global)                    │
│                      Delete, List                                           │
│                                                                             │
│  profile             Read, Update               user                        │
│                                                                             │
│  user                List                       (global)                    │
│                                                                             │
│  app                 Create, Read, Update,      (global)                    │
│                      Delete, List                                           │
│                                                                             │
│  config              Read, Update               config                      │
│                                                                             │
│  system              Health, Version            (public)                    │
│                                                                             │
│  internal            Operator, Logger, Router   backend / workflow          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Action Constants

Actions are defined as Go constants for compile-time safety:

```go
const (
    // Workflow actions
    ActionWorkflowCreate  = "workflow:Create"
    ActionWorkflowRead    = "workflow:Read"
    ActionWorkflowUpdate  = "workflow:Update"
    ActionWorkflowDelete  = "workflow:Delete"
    ActionWorkflowCancel  = "workflow:Cancel"
    ActionWorkflowList    = "workflow:List"
    ActionWorkflowExecute = "workflow:Execute"
    ActionWorkflowExec        = "workflow:Exec"
    ActionWorkflowPortForward = "workflow:PortForward"
    ActionWorkflowRsync       = "workflow:Rsync"

    // Dataset actions
    ActionDatasetCreate = "dataset:Create"
    ActionDatasetRead   = "dataset:Read"
    ActionDatasetDelete = "dataset:Delete"
    ActionDatasetList   = "dataset:List"

    // Pool actions
    ActionPoolRead   = "pool:Read"

    // Internal/Backend actions (restricted)
    ActionInternalOperator = "internal:Operator"
    ActionInternalLogger   = "internal:Logger"
    ActionInternalRouter   = "internal:Router"

    // Config actions
    ActionConfigRead = "config:Read"
    ActionConfigUpdate = "config:Update"

    // System actions (public)
    ActionSystemHealth  = "system:Health"
    ActionSystemVersion = "system:Version"
)
```

### Resource Naming Convention

```
<resource-type>/<identifier>

Examples:
  workflow/*             - All workflows
  workflow/abc123        - Specific workflow
  pool/default           - Default pool
  pool/production/*      - Production pool and children
  bucket/data-generation - Bucket for storing data generation datasets
  backend/gb200-testing  - Backend called gb200-testing
  config/service         - Service Config
  *                      - All resources
```

---

## Policy Format

Policies use AWS IAM-style JSON format with Allow/Deny statements:

```json
{
  "statements": [
    {
      "effect": "Allow",
      "actions": [
        "workflow:Create",
        "workflow:Read",
        "workflow:Update",
        "workflow:Delete",
        "workflow:Cancel"
      ],
      "resources": ["*"]
    },
    {
      "effect": "Allow",
      "actions": ["dataset:*"],
      "resources": ["dataset/*"]
    },
    {
      "effect": "Deny",
      "actions": ["dataset:Delete"],
      "resources": ["bucket/production"]
    }
  ]
}
```

### Wildcard Support

- `workflow:*` — All workflow actions
- `*:Read` — Read action on all resources
- `*:*` — All actions on all resources
- `*` in resources — All resources

### Effect Precedence

**Deny always wins.** If any statement denies an action, access is denied regardless of Allow statements.

---

## Default Roles

### osmo-admin

Full access except internal backend endpoints:

```json
{
  "name": "osmo-admin",
  "description": "Administrator with full access except internal endpoints",
  "policy": {
    "statements": [
      {"effect": "Allow", "actions": ["*:*"], "resources": ["*"]},
      {"effect": "Deny", "actions": ["internal:*"], "resources": ["*"]}
    ]
  },
  "immutable": true
}
```

### osmo-user

Standard user role:

```json
{
  "name": "osmo-user",
  "description": "Standard user role",
  "policy": {
    "statements": [
      {
        "effect": "Allow",
        "actions": [
          "workflow:*",
          "dataset:*",
          "credentials:*",
          "profile:Read", "profile:Update",
          "pool:Read",
          "user:List",
          "app:*",
          "resources:Read",
          "config:Read",
          "auth:Token",
          "router:Client",
          "system:*"
        ],
        "resources": ["*"]
      }
    ]
  },
  "immutable": false
}
```

### osmo-viewer (example new role)

Read-only access:

```json
{
  "name": "osmo-viewer",
  "description": "Read-only access to workflows",
  "policy": {
    "statements": [
      {
        "effect": "Allow",
        "actions": [
          "workflow:Read", "workflow:List",
          "dataset:Read", "dataset:List",
          "system:*"
        ],
        "resources": ["*"]
      }
    ]
  },
  "immutable": false
}
```

### osmo-backend

For backend agents:

```json
{
  "name": "osmo-backend",
  "description": "For backend agents",
  "policy": {
    "statements": [
      {
        "effect": "Allow",
        "actions": ["internal:Operator", "pool:Read", "config:Read"],
        "resources": ["backend/*", "pool/*", "config/backend"]
      }
    ]
  },
  "immutable": true
}
```

### osmo-ctrl

For workflow pods:

```json
{
  "name": "osmo-ctrl",
  "description": "For workflow pods",
  "policy": {
    "statements": [
      {
        "effect": "Allow",
        "actions": ["internal:Logger", "internal:Router"],
        "resources": ["*"]
      }
    ]
  },
  "immutable": true
}
```

### osmo-default

Minimal access for unauthenticated users:

```json
{
  "name": "osmo-default",
  "description": "Default role for unauthenticated access",
  "policy": {
    "statements": [
      {
        "effect": "Allow",
        "actions": ["system:Health", "system:Version", "auth:Login", "auth:Refresh", "auth:Token"],
        "resources": ["*"]
      }
    ]
  },
  "immutable": true
}
```

---

## Authorization Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHORIZATION FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

  1. Request arrives: POST /api/workflow/abc123/cancel

  2. Path Resolution:
     ┌───────────────────────────────────────────────────────────────────┐
     │  Request: POST /api/workflow/abc123/cancel                        │
     │                    ↓                                              │
     │  Match against ActionRegistry patterns                            │
     │                    ↓                                              │
     │  Resolved: workflow:Cancel on resource workflow/abc123            │
     └───────────────────────────────────────────────────────────────────┘

  3. Policy Evaluation:
     ┌───────────────────────────────────────────────────────────────────┐
     │  User roles: [osmo-user, custom-role]                             │
     │                    ↓                                              │
     │  Collect all policy statements from roles                         │
     │                    ↓                                              │
     │  Evaluate workflow:Cancel against statements                      │
     │                    ↓                                              │
     │  Check: Does any Deny statement match? (if yes → DENY)            │
     │  Check: Does any Allow statement match? (if yes → ALLOW)          │
     │                    ↓                                              │
     │  No match → DENY (implicit deny)                                  │
     └───────────────────────────────────────────────────────────────────┘
```

### Authorization Algorithm

```go
func (e *PolicyEvaluator) CheckAccess(ctx context.Context, req AuthzRequest) (bool, error) {
    // Step 1: Resolve API path to action(s)
    actions := e.registry.ResolvePathToActions(req.Path, req.Method)
    if len(actions) == 0 {
        return false, nil // No action mapping = deny
    }

    // Step 2: Get user's roles and their policies
    policies, err := e.getPoliciesForRoles(ctx, req.Roles)
    if err != nil {
        return false, err
    }

    // Step 3: Evaluate each resolved action
    for _, action := range actions {
        resource := e.extractResource(req.Path, action)

        // Check for explicit Deny first (Deny always wins)
        for _, policy := range policies {
            if e.matchesDenyStatement(policy, action, resource) {
                return false, nil
            }
        }

        // Check for Allow
        allowed := false
        for _, policy := range policies {
            if e.matchesAllowStatement(policy, action, resource) {
                allowed = true
                break
            }
        }

        if !allowed {
            return false, nil
        }
    }

    return true, nil
}

func (e *PolicyEvaluator) actionMatches(patterns []string, action string) bool {
    for _, pattern := range patterns {
        if pattern == "*:*" || pattern == action {
            return true
        }
        // Handle wildcards: "workflow:*" matches "workflow:Create"
        if strings.HasSuffix(pattern, ":*") {
            prefix := strings.TrimSuffix(pattern, ":*")
            if strings.HasPrefix(action, prefix+":") {
                return true
            }
        }
        // Handle resource wildcards: "*:Read" matches "workflow:Read"
        if strings.HasPrefix(pattern, "*:") {
            suffix := strings.TrimPrefix(pattern, "*:")
            if strings.HasSuffix(action, ":"+suffix) {
                return true
            }
        }
    }
    return false
}
```

---

## Implementation

### New Files

| File | Description |
|------|-------------|
| `external/src/service/authz_sidecar/server/action_registry.go` | Action constants and path mappings |
| `external/src/service/authz_sidecar/server/policy_evaluator.go` | Policy evaluation logic |
| `external/src/service/authz_sidecar/server/action_registry_test.go` | Unit tests for registry |
| `external/src/service/authz_sidecar/server/policy_evaluator_test.go` | Unit tests for evaluator |

### Database Schema Changes

```sql
-- Option 1: Modify existing column
ALTER TABLE roles
ALTER COLUMN policies TYPE JSONB
USING policies[1];

-- Option 2: Add new column for v2 policies (safer for migration)
ALTER TABLE roles
ADD COLUMN policy_v2 JSONB;

-- Add index for policy queries
CREATE INDEX idx_roles_policy_v2 ON roles USING GIN (policy_v2);
```

### Changes to authz_server.go

1. Add path-to-action resolution using ActionRegistry
2. Replace direct path matching with action-based policy evaluation
3. Support wildcard matching for actions (`workflow:*`, `*:*`)
4. Implement Deny precedence logic

---

## Migration Strategy

### Phase 1: Add New System (Parallel)

1. Implement action registry in authz_sidecar
2. Add policy evaluator supporting both old and new formats
3. Store new-format policies in `policy_v2` column
4. Default roles continue using old format

### Phase 2: Migrate Default Roles

1. Create new-format policies for all default roles
2. Add feature flag to switch between old/new evaluation
3. Test extensively in development

### Phase 3: Migrate Custom Roles

1. Write migration script to convert existing policies:
   ```python
   # Convert old format
   {"actions": [{"base": "http", "path": "/api/workflow/*", "method": "*"}]}

   # To new format (using path-to-action reverse lookup)
   {"statements": [{"effect": "Allow", "actions": ["workflow:*"], "resources": ["*"]}]}
   ```
2. Run migration
3. Validate all access patterns unchanged

### Phase 4: Deprecate Old Format

1. Remove old policy evaluation code
2. Drop old `policies` column
3. Rename `policy_v2` to `policy`
4. Update documentation

---

## Backwards Compatibility

The new resource-action model is designed to run alongside the existing path-based model during migration:

- **Parallel evaluation** — Both old and new policy formats can be evaluated simultaneously using a feature flag
- **No breaking changes to existing roles** — Existing path-based policies continue to work until explicitly migrated
- **Gradual migration** — Roles can be migrated one at a time; mixed environments are supported
- **Rollback capability** — Feature flag allows instant rollback to old evaluation if issues arise

Once migration is complete (Phase 4), the old format will be removed. This is a one-way migration with no long-term backward compatibility for the old format.

---

## Alternatives Considered

### [Casbin](https://www.casbin.org/)

After diving into Casbin, it would have been better suited when we didn't have any auth framework
and just wanted a basic allow/deny logic.

For more extensive use cases where we need to
look further into the db to get knowledge of like what pools are connected to workflows, Casbin
would be more work than our own implementation since we would need define our own policy rules
anyway but with the same amount of benefit.

Using Casbin as a reference for how we want to model our auth system after is good, but it doesn't
simplify any of the work.

Performance wise, it seemed to have similar performance (maybe slightly worse, but could be due
to optimization issues).


---

## Documentation

The following documentation will need to be created or updated:

| Document | Action |
|---|---|
| Role management guide | Update to describe new policy format with examples |
| API reference for `/api/roles` | Update request/response schemas for new policy format |
| Default roles reference | Document what actions each default role grants |
| Action reference | New document listing all available actions and their meanings |
| Migration guide | New document for customers migrating custom roles |

---

## Testing

### Unit Tests [Not added yet]

- `action_registry_test.go` — Test path-to-action resolution for all registered actions
- `policy_evaluator_test.go` — Test Allow/Deny evaluation, wildcard matching, deny precedence

### Integration Tests

- Verify all existing access patterns work identically with new model
- Test migration script converts policies correctly
- Test feature flag switching between old and new evaluation

### Test Metrics

| Metric | Target |
|---|---|
| Unit test coverage | >90% for action_registry.go and policy_evaluator.go |
| Integration test pass rate | 100% |
| Migration accuracy | 100% of existing roles produce identical access decisions |

---

## Complete Action Registry

```go
// ActionRegistry maps resource:action pairs to API endpoint patterns
var ActionRegistry = map[string][]EndpointPattern{
    // ==================== WORKFLOW ====================
    "workflow:Create": {
        {Path: "/api/pool/*/workflow", Methods: []string{"POST"}},
    },
    "workflow:Read": {
        {Path: "/api/workflow", Methods: []string{"GET"}},
        {Path: "/api/workflow/*", Methods: []string{"GET"}},
        {Path: "/api/task", Methods: []string{"GET"}},
        {Path: "/api/task/*", Methods: []string{"GET"}},
        {Path: "/api/tag", Methods: []string{"GET"}},
    },
    "workflow:Update": {
        {Path: "/api/workflow/*", Methods: []string{"PUT", "PATCH"}},
    },
    "workflow:Delete": {
        {Path: "/api/workflow/*", Methods: []string{"DELETE"}},
    },
    "workflow:Cancel": {
        {Path: "/api/workflow/*/cancel", Methods: []string{"POST"}},
    },
    "workflow:Exec": {
        {Path: "/api/workflow/*/exec", Methods: []string{"POST", "WEBSOCKET"}},
    },
    "workflow:PortForward": {
        {Path: "/api/workflow/*/portforward/*", Methods: []string{"*"}},
    },
    "workflow:Rsync": {
        {Path: "/api/workflow/*/rsync", Methods: []string{"POST"}},
    },

    // ==================== BUCKET ====================
    "dataset:Create": {
        {Path: "/api/bucket/*/dataset/*", Methods: []string{"POST", "PUT"}},
    },
    "dataset:Read": {
        {Path: "/api/bucket/*/dataset/", Methods: []string{"GET"}},
        {Path: "/api/bucket/*/dataset/*", Methods: []string{"GET"}},
    },
    "dataset:Delete": {
        {Path: "/api/bucket/*/dataset/*", Methods: []string{"DELETE"}},
    },

    // ==================== CREDENTIALS ====================
    "credentials:Create": {
        {Path: "/api/credentials", Methods: []string{"POST"}},
    },
    "credentials:Read": {
        {Path: "/api/credentials", Methods: []string{"GET"}},
        {Path: "/api/credentials/*", Methods: []string{"GET"}},
    },
    "credentials:Update": {
        {Path: "/api/credentials/*", Methods: []string{"PUT", "PATCH"}},
    },
    "credentials:Delete": {
        {Path: "/api/credentials/*", Methods: []string{"DELETE"}},
    },

    // ==================== PROFILE ====================
    "profile:Read": {
        {Path: "/api/profile/*", Methods: []string{"GET"}},
    },
    "profile:Update": {
        {Path: "/api/profile/*", Methods: []string{"PUT", "PATCH"}},
    },

    // ==================== USER ====================
    "user:List": {
        {Path: "/api/users", Methods: []string{"GET"}},
    },

    // ==================== APP ====================
    "app:Create": {
        {Path: "/api/app", Methods: []string{"POST"}},
    },
    "app:Read": {
        {Path: "/api/app", Methods: []string{"GET"}},
        {Path: "/api/app/*", Methods: []string{"GET"}},
    },
    "app:Update": {
        {Path: "/api/app/*", Methods: []string{"PUT", "PATCH"}},
    },
    "app:Delete": {
        {Path: "/api/app/*", Methods: []string{"DELETE"}},
    },

    // ==================== RESOURCES ====================
    "resources:Read": {
        {Path: "/api/resources", Methods: []string{"GET"}},
        {Path: "/api/resources/*", Methods: []string{"GET"}},
    },

    // ==================== CONFIG ====================
    "config:Read": {
        {Path: "/api/configs/*", Methods: []string{"GET"}},
    },
    "config:Update": {
        {Path: "/api/configs/*", Methods: []string{"PUT", "PATCH"}},
    },

    // ==================== AUTH ====================
    "auth:Login": {
        {Path: "/api/auth/login", Methods: []string{"GET"}},
        {Path: "/api/auth/keys", Methods: []string{"GET"}},
    },
    "auth:Refresh": {
        {Path: "/api/auth/refresh_token", Methods: []string{"*"}},
        {Path: "/api/auth/jwt/refresh_token", Methods: []string{"*"}},
        {Path: "/api/auth/jwt/access_token", Methods: []string{"*"}},
    },
    "auth:Token": {
        {Path: "/api/auth/access_token", Methods: []string{"*"}},
        {Path: "/api/auth/access_token/user", Methods: []string{"*"}},
        {Path: "/api/auth/access_token/user/*", Methods: []string{"*"}},
    },
    "auth:ServiceToken": {
        {Path: "/api/auth/access_token", Methods: []string{"*"}},
        {Path: "/api/auth/access_token/service", Methods: []string{"*"}},
        {Path: "/api/auth/access_token/service/*", Methods: []string{"*"}},
    },

    // ==================== ROUTER ====================
    // This one is still WIP to see if it is needed or can be merged
    "router:Client": {
        {Path: "/api/router/webserver/*/", Methods: []string{"*"}},
        {Path: "/api/router/webserver_enabled", Methods: []string{"*"}},
        {Path: "/api/router/*/*/client/*", Methods: []string{"*"}},
    },

    // ==================== SYSTEM (PUBLIC) ====================
    "system:Health": {
        {Path: "/health", Methods: []string{"*"}},
    },
    "system:Version": {
        {Path: "/api/version", Methods: []string{"*"}},
        {Path: "/api/router/version", Methods: []string{"*"}},
        {Path: "/client/version", Methods: []string{"*"}},
    },

    // ==================== INTERNAL (RESTRICTED) ====================
    "internal:Operator": {
        {Path: "/api/agent/listener/*", Methods: []string{"*"}},
        {Path: "/api/agent/worker/*", Methods: []string{"*"}},
    },
    "internal:Logger": {
        {Path: "/api/logger/workflow/*", Methods: []string{"*"}},
    },
    "internal:Router": {
        {Path: "/api/router/*/*/backend/*", Methods: []string{"*"}},
    },
}
```

---

## Next Steps

1. **Implement action registry** — Create `action_registry.go` with constants and mappings
2. **Implement policy evaluator** — Create `policy_evaluator.go` with AWS-style evaluation
3. **Add unit tests** — Test path resolution and policy matching
4. **Update authz_server.go** — Integrate new evaluator with feature flag
5. **Create migration script** — Convert existing roles to new format
6. **Test in development** — Validate all existing access patterns
7. **Roll out to staging** — Enable feature flag and monitor
8. **Document** — User-facing documentation for new policy format

---

## Open Questions

### Should we have a way to define whether is pool is public/private for logs/spec/exec/port-fowarding outside of roles?

Problem statement:

In the current design above, roles are mapped to a group of policies and evaluated independently.
This means that if one role evaluates to true, the authorization allows the user even in another
role denies.

We have the case where we want individual pools to restrict access so people without
access to submit to the pool cannot view logs/view spec/exec/port-foward. However, with the design,
we would then need to add the policy which denies access to that pool to all roles which allow access
to the pool such as the default role.

This cumbersome change will have to be done by an admin since we don't want to give users the access.

Ideally, the OSMO admin should be out of the loop and it is just the pool "admin" to determine the state of the
pool. In the future, OSMO admins should no longer need to deal with creating pools and everything
regarding the pool can be handed over to a team member using the pool.

A diagram showing the role policy model and how roles are evaluated is shown below as a reminder.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    ROLE-POLICY RELATIONSHIP MODEL                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────┐
│   USER   │
└────┬─────┘
     │
     │ has many (1:N)
     │
     ├─────────────┬─────────────┬─────────────┐
     ▼             ▼             ▼             ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│  Role 1 │   │  Role 2 │   │  Role 3 │   │  Role N │
│ (admin) │   │ (user)  │   │ (custom)│   │   ...   │
└────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
     │             │             │             │
     │ has one     │ has one     │ has one     │ has one
     │ (1:1)       │ (1:1)       │ (1:1)       │ (1:1)
     │             │             │             │
     ▼             ▼             ▼             ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ Policy1 │   │ Policy2 │   │ Policy3 │   │ PolicyN │
└────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘
     │             │             │             │
     │ contains    │ contains    │ contains    │ contains
     │ many        │ many        │ many        │ many
     │ (1:N)       │ (1:N)       │ (1:N)       │ (1:N)
     │             │             │             │
     ├──────────┐  ├──────────┐  ├──────────┐  ├──────────┐
     ▼          ▼  ▼          ▼  ▼          ▼  ▼          ▼
┌──────────┐ ┌──┐ ┌──────────┐ ┌──┐ ┌──────────┐ ┌──┐ ┌──────────┐ ┌──┐
│Statement1│ │..│ │Statement1│ │..│ │Statement1│ │..│ │Statement1│ │..│
├──────────┤ └──┘ ├──────────┤ └──┘ ├──────────┤ └──┘ ├──────────┤ └──┘
│Effect:   │      │Effect:   │      │Effect:   │      │Effect:   │
│  Allow   │      │  Allow   │      │  Deny    │      │  Allow   │
│Actions:  │      │Actions:  │      │Actions:  │      │Actions:  │
│  [...]   │      │  [...]   │      │  [...]   │      │  [...]   │
│Resources:│      │Resources:│      │Resources:│      │Resources:│
│  [...]   │      │  [...]   │      │  [...]   │      │  [...]   │
└──────────┘      └──────────┘      └──────────┘      └──────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTHORIZATION EVALUATION                              │
└─────────────────────────────────────────────────────────────────────────────┘

  Request: POST /api/workflow/abc123/cancel
      │
      ▼
  ┌────────────────────────────────────────────────────────────┐
  │ Step 1: Resolve action from path                           │
  │   POST /api/workflow/abc123/cancel → workflow:Cancel       │
  └────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
  ┌────────────────────────────────────────────────────────────┐
  │ Step 2: Collect ALL policies from ALL user's roles         │
  │   User has: [Role1, Role2, Role3, ..., RoleN]              │
  │   Collect: [Policy1, Policy2, Policy3, ..., PolicyN]       │
  └────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
  ┌────────────────────────────────────────────────────────────┐
  │ Step 3: Evaluate ALL statements from ALL policies          │
  │                                                            │
  │   Phase 1: Check for ANY Deny                              │
  │   ┌─────────────────────────────────────────────┐          │
  │   │ For each Policy (1..N):                     │          │
  │   │   For each Statement in Policy:             │          │
  │   │     If Effect == "Deny" AND                 │          │
  │   │        action matches workflow:Cancel AND   │          │
  │   │        resource matches workflow/abc123     │          │
  │   │     → RETURN DENY (deny always wins)        │          │
  │   └─────────────────────────────────────────────┘          │
  │                                                            │
  │   Phase 2: Check for ANY Allow                             │
  │   ┌─────────────────────────────────────────────┐          │
  │   │ For each Policy (1..N):                     │          │
  │   │   For each Statement in Policy:             │          │
  │   │     If Effect == "Allow" AND                │          │
  │   │        action matches workflow:Cancel AND   │          │
  │   │        resource matches workflow/abc123     │          │
  │   │     → Mark as allowed                       │          │
  │   └─────────────────────────────────────────────┘          │
  │                                                            │
  │   If ANY Allow found → RETURN ALLOW                        │
  │   If NO Allow found → RETURN DENY (implicit deny)          │
  └────────────────┬───────────────────────────────────────────┘
                   │
                   ▼
            ┌──────────┐
            │  RESULT  │
            └──────────┘
