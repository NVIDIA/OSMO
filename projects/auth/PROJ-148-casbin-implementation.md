<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

This document describes how to implement the resource-action permission model using [Casbin](https://casbin.org/), an open-source access control library. Casbin provides:

- **Flexible model definition** — Define custom access control models (ACL, RBAC, ABAC)
- **Policy storage adapters** — Store policies in PostgreSQL, Redis, or other backends
- **Custom functions** — Extend matchers with functions for request body/params inspection and DB lookups
- **Multi-language support** — Available in Go, Python, Java, Node.js, etc.

### Why Casbin?

| Benefit | Description |
|---------|-------------|
| Battle-tested | Used by thousands of production systems |
| RBAC + ABAC | Supports role-based AND attribute-based access control |
| pgx adapter | Works with existing pgxpool connections for policy storage |
| Custom functions | Can call external functions (DB lookups, body parsing) during policy evaluation |
| Wildcard matching | Built-in support for glob patterns |
| Deny precedence | Configurable policy effects including deny-override |

---

## Casbin Fundamentals

### Core Concepts

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
│  POLICY (PostgreSQL / CSV / Redis)                                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│  The actual access control rules:                                           │
│  • p, osmo-admin, workflow:*, *, allow                                      │
│  • p, osmo-user, workflow:Create, *, allow                                  │
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

### RBAC Model with Deny Support

Create `model.conf` for the resource-action model:

```ini
[request_definition]
# sub = subject (user or role)
# act = action (e.g., "workflow:Create")
# obj = object/resource (e.g., "workflow/abc123")
# ctx = context object (request body, params, headers - passed as JSON string or map)
r = sub, act, obj, ctx

[policy_definition]
# eft = effect (allow or deny)
p = sub, act, obj, eft

[role_definition]
# g = role assignment (user, role)
# g2 = role inheritance (child_role, parent_role)
g = _, _
g2 = _, _

[policy_effect]
# deny-override: if ANY policy denies, result is deny
# This matches AWS IAM behavior
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
# Match using roles and wildcard patterns
# actionMatch and resourceMatch are custom functions
m = g(r.sub, p.sub) && actionMatch(r.act, p.act) && resourceMatch(r.obj, p.obj)
```

### Extended Model with Context-Aware Matching

For APIs that need request body/params or database lookups:

```ini
[request_definition]
# Extended request with context for body/params
r = sub, act, obj, ctx

[policy_definition]
# Extended policy with optional condition
p = sub, act, obj, eft, condition

[role_definition]
g = _, _
g2 = _, _

[policy_effect]
e = some(where (p.eft == allow)) && !some(where (p.eft == deny))

[matchers]
# evalCondition is a custom function that:
# 1. Inspects request context (body, params)
# 2. Performs database lookups if needed
# 3. Evaluates the condition expression
m = g(r.sub, p.sub) && actionMatch(r.act, p.act) && resourceMatch(r.obj, p.obj) && evalCondition(r.ctx, p.condition)
```

---

## Custom Functions for Request Inspection

### Overview

Casbin allows registering custom functions that can be called in the matcher. This enables:

1. **Request body/params inspection** — Check fields in the request
2. **Database lookups** — Query PostgreSQL for additional context
3. **Complex business logic** — Ownership checks, quota validation, etc.

### Function Registration (Go)

```go
package authz

import (
    "context"
    "encoding/json"
    "strings"

    "github.com/casbin/casbin/v2"
    pgxadapter "github.com/pckhoi/casbin-pgx-adapter/v2"
    "github.com/jackc/pgx/v5/pgxpool"
)

type AuthzEnforcer struct {
    enforcer *casbin.Enforcer
    pool     *pgxpool.Pool // PostgreSQL connection pool
}

func NewAuthzEnforcer(ctx context.Context, pool *pgxpool.Pool, modelPath string) (*AuthzEnforcer, error) {
    // Use pgx adapter for policy storage (works with existing pgxpool)
    adapter, err := pgxadapter.NewAdapter(ctx, pool)
    if err != nil {
        return nil, err
    }

    enforcer, err := casbin.NewEnforcer(modelPath, adapter)
    if err != nil {
        return nil, err
    }

    ae := &AuthzEnforcer{
        enforcer: enforcer,
        pool:     pool,
    }

    // Register custom functions
    enforcer.AddFunction("actionMatch", ae.actionMatchFunc)
    enforcer.AddFunction("resourceMatch", ae.resourceMatchFunc)
    enforcer.AddFunction("evalCondition", ae.evalConditionFunc)
    enforcer.AddFunction("checkWorkflowOwner", ae.checkWorkflowOwnerFunc)
    enforcer.AddFunction("checkPoolAccess", ae.checkPoolAccessFunc)

    return ae, nil
}
```

### Action Matching with Wildcards

```go
// actionMatchFunc handles wildcard matching for actions
// Supports: "workflow:*", "*:Read", "*:*", exact matches
func (ae *AuthzEnforcer) actionMatchFunc(args ...interface{}) (interface{}, error) {
    requestAction := args[0].(string)
    policyAction := args[1].(string)

    // Exact match or full wildcard
    if policyAction == "*:*" || policyAction == requestAction {
        return true, nil
    }

    // Resource wildcard: "workflow:*" matches "workflow:Create"
    if strings.HasSuffix(policyAction, ":*") {
        prefix := strings.TrimSuffix(policyAction, ":*")
        if strings.HasPrefix(requestAction, prefix+":") {
            return true, nil
        }
    }

    // Action wildcard: "*:Read" matches "workflow:Read"
    if strings.HasPrefix(policyAction, "*:") {
        suffix := strings.TrimPrefix(policyAction, "*:")
        if strings.HasSuffix(requestAction, ":"+suffix) {
            return true, nil
        }
    }

    return false, nil
}

// resourceMatchFunc handles wildcard matching for resources
// Supports: "workflow/*", "pool/default/*", "*", exact matches
func (ae *AuthzEnforcer) resourceMatchFunc(args ...interface{}) (interface{}, error) {
    requestResource := args[0].(string)
    policyResource := args[1].(string)

    // Full wildcard or exact match
    if policyResource == "*" || policyResource == requestResource {
        return true, nil
    }

    // Prefix wildcard: "workflow/*" matches "workflow/abc123"
    if strings.HasSuffix(policyResource, "/*") {
        prefix := strings.TrimSuffix(policyResource, "/*")
        if strings.HasPrefix(requestResource, prefix+"/") || requestResource == prefix {
            return true, nil
        }
    }

    return false, nil
}
```

---

## Request Body and Params Inspection

### Context Structure

Pass request context to Casbin for inspection:

```go
// RequestContext contains all request information for authorization
type RequestContext struct {
    // Request metadata
    Method  string            `json:"method"`
    Path    string            `json:"path"`
    Headers map[string]string `json:"headers"`

    // URL parameters (e.g., /api/workflow/:id → {"id": "abc123"})
    Params map[string]string `json:"params"`

    // Query parameters (e.g., ?pool=default → {"pool": "default"})
    Query map[string]string `json:"query"`

    // Request body (parsed JSON)
    Body map[string]interface{} `json:"body"`

    // User information
    UserID   string   `json:"user_id"`
    UserName string   `json:"user_name"`
    Roles    []string `json:"roles"`
}
```

### Condition Evaluation Function

```go
// evalConditionFunc evaluates policy conditions against request context
// Conditions can reference:
// - ctx.body.field_name (request body fields)
// - ctx.params.param_name (URL parameters)
// - ctx.query.key (query parameters)
// - db.workflow.owner (database lookups)
func (ae *AuthzEnforcer) evalConditionFunc(args ...interface{}) (interface{}, error) {
    ctxJSON := args[0].(string)
    condition := args[1].(string)

    // Empty condition = no additional checks needed
    if condition == "" || condition == "*" {
        return true, nil
    }

    // Parse request context
    var ctx RequestContext
    if err := json.Unmarshal([]byte(ctxJSON), &ctx); err != nil {
        return false, err
    }

    // Evaluate condition based on type
    return ae.evaluateCondition(ctx, condition)
}

func (ae *AuthzEnforcer) evaluateCondition(ctx RequestContext, condition string) (bool, error) {
    // Example conditions:
    // "body.pool == 'default'" - Check request body field
    // "params.id == ctx.user_id" - Check URL param against user
    // "db.workflow.owner == ctx.user_id" - Database lookup
    // "body.spec.resources.gpu <= 8" - Numeric comparison

    switch {
    case strings.HasPrefix(condition, "body."):
        return ae.evaluateBodyCondition(ctx, condition)

    case strings.HasPrefix(condition, "params."):
        return ae.evaluateParamsCondition(ctx, condition)

    case strings.HasPrefix(condition, "db."):
        return ae.evaluateDBCondition(ctx, condition)

    case strings.HasPrefix(condition, "owner:"):
        return ae.evaluateOwnerCondition(ctx, condition)

    default:
        // CEL or custom expression evaluation
        return ae.evaluateExpression(ctx, condition)
    }
}
```

### Body Field Validation Example

```go
// evaluateBodyCondition checks request body fields
// Example: Ensure user can only create workflows in allowed pools
func (ae *AuthzEnforcer) evaluateBodyCondition(ctx RequestContext, condition string) (bool, error) {
    // Parse condition: "body.pool in ['default', 'development']"
    // or: "body.spec.resources.gpu <= 8"

    parts := strings.SplitN(condition, ".", 2)
    if len(parts) < 2 {
        return false, fmt.Errorf("invalid body condition: %s", condition)
    }

    fieldPath := parts[1] // e.g., "pool" or "spec.resources.gpu"
    value := getNestedValue(ctx.Body, fieldPath)

    // Check against allowed values (simplified example)
    // In practice, use a proper expression evaluator like CEL
    return value != nil, nil
}

// getNestedValue traverses nested maps to get a value
func getNestedValue(data map[string]interface{}, path string) interface{} {
    parts := strings.Split(path, ".")
    current := data

    for i, part := range parts {
        if val, ok := current[part]; ok {
            if i == len(parts)-1 {
                return val
            }
            if nested, ok := val.(map[string]interface{}); ok {
                current = nested
            } else {
                return nil
            }
        } else {
            return nil
        }
    }
    return nil
}
```

---

## Database Lookups for Authorization

### Use Case: Workflow Ownership Check

For endpoints like `/api/workflow/spec`, you need to check the database to verify workflow ownership:

```go
// checkWorkflowOwnerFunc checks if the user owns the workflow
// Called from matcher: checkWorkflowOwner(r.ctx, r.obj)
func (ae *AuthzEnforcer) checkWorkflowOwnerFunc(args ...interface{}) (interface{}, error) {
    ctxJSON := args[0].(string)
    resource := args[1].(string)

    var reqCtx RequestContext
    if err := json.Unmarshal([]byte(ctxJSON), &reqCtx); err != nil {
        return false, err
    }

    // Extract workflow ID from resource (e.g., "workflow/abc123" → "abc123")
    workflowID := extractResourceID(resource, "workflow")
    if workflowID == "" {
        return false, nil
    }

    // Query PostgreSQL for workflow owner using pgxpool
    var ownerID string
    err := ae.pool.QueryRow(context.Background(),
        "SELECT owner_id FROM workflows WHERE id = $1",
        workflowID,
    ).Scan(&ownerID)

    if err != nil {
        return false, err
    }

    // Check if current user is the owner
    return ownerID == reqCtx.UserID, nil
}

// evaluateDBCondition handles database lookup conditions
// Example: "db.workflow.owner == ctx.user_id"
// Example: "db.workflow.pool in ctx.user.allowed_pools"
func (ae *AuthzEnforcer) evaluateDBCondition(reqCtx RequestContext, condition string) (bool, error) {
    // Parse: "db.workflow.owner == ctx.user_id"
    parts := strings.Split(condition, " ")
    if len(parts) < 3 {
        return false, fmt.Errorf("invalid db condition: %s", condition)
    }

    dbPath := strings.TrimPrefix(parts[0], "db.") // "workflow.owner"
    operator := parts[1]                           // "=="
    compareTo := parts[2]                          // "ctx.user_id"

    // Extract table and field
    pathParts := strings.SplitN(dbPath, ".", 2)
    if len(pathParts) != 2 {
        return false, fmt.Errorf("invalid db path: %s", dbPath)
    }
    table := pathParts[0]  // "workflow"
    field := pathParts[1]  // "owner"

    // Get resource ID from URL params
    resourceID := reqCtx.Params["id"]
    if resourceID == "" {
        return false, nil
    }

    // Query database using pgxpool
    query := fmt.Sprintf("SELECT %s FROM %ss WHERE id = $1", field, table)
    var result string
    err := ae.pool.QueryRow(context.Background(), query, resourceID).Scan(&result)

    if err != nil {
        return false, err
    }

    // Get comparison value
    var compareValue string
    if strings.HasPrefix(compareTo, "ctx.") {
        switch compareTo {
        case "ctx.user_id":
            compareValue = reqCtx.UserID
        case "ctx.user_name":
            compareValue = reqCtx.UserName
        }
    } else {
        compareValue = strings.Trim(compareTo, "'\"")
    }

    // Evaluate
    switch operator {
    case "==":
        return result == compareValue, nil
    case "!=":
        return result != compareValue, nil
    default:
        return false, fmt.Errorf("unsupported operator: %s", operator)
    }
}
```

### Caching Database Lookups

To meet the <5ms p99 latency requirement, cache database lookups:

```go
import (
    "context"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
    "github.com/patrickmn/go-cache"
)

type AuthzEnforcer struct {
    enforcer *casbin.Enforcer
    pool     *pgxpool.Pool
    cache    *cache.Cache // In-memory cache
}

func NewAuthzEnforcer(ctx context.Context, pool *pgxpool.Pool, modelPath string) (*AuthzEnforcer, error) {
    // ... previous setup ...

    ae := &AuthzEnforcer{
        enforcer: enforcer,
        pool:     pool,
        cache:    cache.New(5*time.Minute, 10*time.Minute),
    }

    return ae, nil
}

// Cached workflow lookup
func (ae *AuthzEnforcer) getWorkflowOwner(ctx context.Context, workflowID string) (string, error) {
    cacheKey := "workflow_owner:" + workflowID

    // Check cache first
    if cached, found := ae.cache.Get(cacheKey); found {
        return cached.(string), nil
    }

    // Query database using pgxpool
    var ownerID string
    err := ae.pool.QueryRow(ctx,
        "SELECT owner_id FROM workflows WHERE id = $1",
        workflowID,
    ).Scan(&ownerID)

    if err != nil {
        return "", err
    }

    // Cache for 5 minutes
    ae.cache.Set(cacheKey, ownerID, cache.DefaultExpiration)
    return ownerID, nil
}
```

---

## Policy Storage in PostgreSQL

### Using pgx Adapter

The pgx adapter integrates with your existing `pgxpool.Pool` connection, avoiding the need
for a separate ORM like GORM. This aligns with the existing `postgres_client.go` pattern.

```go
import (
    "context"
    "fmt"

    "github.com/casbin/casbin/v2"
    pgxadapter "github.com/pckhoi/casbin-pgx-adapter/v2"
    "github.com/jackc/pgx/v5/pgxpool"
)

func SetupEnforcer(ctx context.Context, pool *pgxpool.Pool) (*casbin.Enforcer, error) {
    // Create Casbin adapter using existing pgxpool connection
    // The adapter will create the casbin_rule table if it doesn't exist
    adapter, err := pgxadapter.NewAdapter(ctx, pool)
    if err != nil {
        return nil, fmt.Errorf("failed to create casbin adapter: %w", err)
    }

    // Create enforcer
    enforcer, err := casbin.NewEnforcer("model.conf", adapter)
    if err != nil {
        return nil, fmt.Errorf("failed to create casbin enforcer: %w", err)
    }

    // Load policies from database
    err = enforcer.LoadPolicy()
    if err != nil {
        return nil, fmt.Errorf("failed to load policies: %w", err)
    }

    return enforcer, nil
}
```

### Policy Table Schema

The pgx adapter creates a table named `casbin_rule`:

```sql
CREATE TABLE IF NOT EXISTS casbin_rule (
    id SERIAL PRIMARY KEY,
    ptype VARCHAR NOT NULL,  -- "p" for policy, "g" for role assignment
    v0 VARCHAR,              -- subject
    v1 VARCHAR,              -- action
    v2 VARCHAR,              -- resource
    v3 VARCHAR,              -- effect (allow/deny)
    v4 VARCHAR,              -- condition (optional)
    v5 VARCHAR               -- reserved
);

-- Indexes for fast lookups
CREATE INDEX idx_casbin_ptype ON casbin_rule(ptype);
CREATE INDEX idx_casbin_v0 ON casbin_rule(v0);
CREATE INDEX idx_casbin_v0_v1 ON casbin_rule(v0, v1);
```

### Default Role Policies

```go
// LoadDefaultPolicies loads the default OSMO roles
func LoadDefaultPolicies(enforcer *casbin.Enforcer) error {
    // osmo-admin: Full access except internal
    policies := [][]string{
        // p, role, action, resource, effect, condition
        {"osmo-admin", "*:*", "*", "allow", ""},
        {"osmo-admin", "internal:*", "*", "deny", ""},

        // osmo-user: Standard user access
        {"osmo-user", "workflow:*", "*", "allow", ""},
        {"osmo-user", "bucket:*", "*", "allow", ""},
        {"osmo-user", "credentials:*", "*", "allow", ""},
        {"osmo-user", "profile:Read", "*", "allow", ""},
        {"osmo-user", "profile:Update", "*", "allow", ""},
        {"osmo-user", "pool:Read", "*", "allow", ""},
        {"osmo-user", "user:List", "*", "allow", ""},
        {"osmo-user", "app:*", "*", "allow", ""},
        {"osmo-user", "config:Read", "*", "allow", ""},
        {"osmo-user", "system:*", "*", "allow", ""},

        // osmo-viewer: Read-only access
        {"osmo-viewer", "workflow:Read", "*", "allow", ""},
        {"osmo-viewer", "workflow:List", "*", "allow", ""},
        {"osmo-viewer", "bucket:Read", "*", "allow", ""},
        {"osmo-viewer", "bucket:List", "*", "allow", ""},
        {"osmo-viewer", "system:*", "*", "allow", ""},

        // osmo-backend: For backend agents
        {"osmo-backend", "internal:Operator", "backend/*", "allow", ""},
        {"osmo-backend", "pool:Read", "pool/*", "allow", ""},
        {"osmo-backend", "config:Read", "config/backend", "allow", ""},

        // osmo-ctrl: For workflow pods
        {"osmo-ctrl", "internal:Logger", "*", "allow", ""},
        {"osmo-ctrl", "internal:Router", "*", "allow", ""},

        // osmo-default: Minimal access (unauthenticated)
        {"osmo-default", "system:Health", "*", "allow", ""},
        {"osmo-default", "system:Version", "*", "allow", ""},
        {"osmo-default", "auth:Login", "*", "allow", ""},
        {"osmo-default", "auth:Refresh", "*", "allow", ""},
        {"osmo-default", "auth:Token", "*", "allow", ""},
    }

    for _, p := range policies {
        _, err := enforcer.AddPolicy(p)
        if err != nil {
            return err
        }
    }

    return nil
}
```

---

## API Path to Action Resolution

### Action Registry

Map API paths to semantic actions (same as the original design):

```go
package authz

// EndpointPattern defines an API endpoint
type EndpointPattern struct {
    Path    string
    Methods []string
}

// ActionRegistry maps actions to endpoint patterns
var ActionRegistry = map[string][]EndpointPattern{
    "workflow:Create": {
        {Path: "/api/workflow", Methods: []string{"POST"}},
    },
    "workflow:Read": {
        {Path: "/api/workflow", Methods: []string{"GET"}},
        {Path: "/api/workflow/*", Methods: []string{"GET"}},
        {Path: "/api/workflow/spec", Methods: []string{"GET"}},  // Needs DB lookup
        {Path: "/api/task", Methods: []string{"GET"}},
        {Path: "/api/task/*", Methods: []string{"GET"}},
    },
    // ... rest of registry
}

// ReverseRegistry maps paths to actions (built at startup)
var ReverseRegistry map[string]map[string]string // path -> method -> action
```

### Path Resolution

```go
// ResolvePathToAction converts an API request to an action
func ResolvePathToAction(path, method string) (string, string, error) {
    // Normalize path
    normalizedPath := normalizePath(path)

    // Try exact match first
    for action, patterns := range ActionRegistry {
        for _, pattern := range patterns {
            if matchPath(normalizedPath, pattern.Path) && matchMethod(method, pattern.Methods) {
                resource := extractResource(normalizedPath, action)
                return action, resource, nil
            }
        }
    }

    return "", "", fmt.Errorf("no action found for %s %s", method, path)
}

// matchPath matches a request path against a pattern
func matchPath(path, pattern string) bool {
    // Handle wildcards in pattern
    if strings.HasSuffix(pattern, "/*") {
        prefix := strings.TrimSuffix(pattern, "/*")
        return path == prefix || strings.HasPrefix(path, prefix+"/")
    }
    if strings.Contains(pattern, "*") {
        // Convert to regex for complex patterns
        regex := pathToRegex(pattern)
        return regex.MatchString(path)
    }
    return path == pattern
}

// extractResource extracts the resource identifier from the path
func extractResource(path, action string) string {
    // /api/workflow/abc123 → workflow/abc123
    // /api/bucket/data → bucket/data

    parts := strings.Split(action, ":")
    resourceType := parts[0] // "workflow", "bucket", etc.

    // Extract ID from path
    pathParts := strings.Split(path, "/")
    for i, part := range pathParts {
        if part == resourceType || part == resourceType+"s" {
            if i+1 < len(pathParts) {
                return resourceType + "/" + pathParts[i+1]
            }
            return resourceType + "/*"
        }
    }
    return "*"
}
```

---

## Complete Authorization Flow

### Middleware Integration

```go
package middleware

import (
    "encoding/json"
    "net/http"

    "github.com/gin-gonic/gin"
)

// AuthzMiddleware creates authorization middleware using Casbin
func AuthzMiddleware(ae *AuthzEnforcer) gin.HandlerFunc {
    return func(c *gin.Context) {
        // Step 1: Get user from JWT (already authenticated)
        user := getUserFromContext(c)
        if user == nil {
            c.AbortWithStatus(http.StatusUnauthorized)
            return
        }

        // Step 2: Resolve path to action
        action, resource, err := ResolvePathToAction(c.Request.URL.Path, c.Request.Method)
        if err != nil {
            c.AbortWithStatus(http.StatusForbidden)
            return
        }

        // Step 3: Build request context for condition evaluation
        ctx := RequestContext{
            Method:   c.Request.Method,
            Path:     c.Request.URL.Path,
            Headers:  extractHeaders(c.Request.Header),
            Params:   extractParams(c),
            Query:    extractQuery(c.Request.URL.Query()),
            Body:     extractBody(c),
            UserID:   user.ID,
            UserName: user.Name,
            Roles:    user.Roles,
        }
        ctxJSON, _ := json.Marshal(ctx)

        // Step 4: Check authorization with Casbin
        // For each role the user has, check if access is allowed
        allowed := false
        for _, role := range user.Roles {
            ok, err := ae.enforcer.Enforce(role, action, resource, string(ctxJSON))
            if err != nil {
                c.AbortWithStatus(http.StatusInternalServerError)
                return
            }
            if ok {
                allowed = true
                break
            }
        }

        if !allowed {
            c.AbortWithStatus(http.StatusForbidden)
            return
        }

        c.Next()
    }
}
```

### Complete Authorization Example

```go
// AuthzRequest represents an authorization check request
type AuthzRequest struct {
    UserID    string
    Roles     []string
    Method    string
    Path      string
    Params    map[string]string
    Body      map[string]interface{}
}

// Authorize checks if the request is authorized
func (ae *AuthzEnforcer) Authorize(req AuthzRequest) (bool, error) {
    // Step 1: Resolve API path to semantic action
    action, resource, err := ResolvePathToAction(req.Path, req.Method)
    if err != nil {
        return false, nil // No action = implicit deny
    }

    // Step 2: Build context for condition evaluation
    ctx := RequestContext{
        Method:  req.Method,
        Path:    req.Path,
        Params:  req.Params,
        Body:    req.Body,
        UserID:  req.UserID,
        Roles:   req.Roles,
    }
    ctxJSON, _ := json.Marshal(ctx)

    // Step 3: Check each role (any role allowing = allowed, unless denied)
    for _, role := range req.Roles {
        allowed, err := ae.enforcer.Enforce(role, action, resource, string(ctxJSON))
        if err != nil {
            return false, err
        }
        if allowed {
            return true, nil
        }
    }

    return false, nil
}
```

---

## Specific Use Cases

### 1. Check Request Body Fields

**Scenario**: Only allow workflow creation in specific pools

```go
// Policy: Users can only create workflows in 'default' or 'development' pools
// p, osmo-user, workflow:Create, *, allow, body.pool in ['default', 'development']

// Condition evaluator
func (ae *AuthzEnforcer) evaluateBodyPoolCondition(ctx RequestContext) (bool, error) {
    pool, ok := ctx.Body["pool"].(string)
    if !ok {
        return false, nil
    }

    allowedPools := []string{"default", "development"}
    for _, allowed := range allowedPools {
        if pool == allowed {
            return true, nil
        }
    }
    return false, nil
}
```

### 2. Database Lookup for Workflow Ownership

**Scenario**: Users can only read spec for workflows they own

```go
// Policy: Users can only read workflow spec if they own it
// p, osmo-user, workflow:Read, workflow/*, allow, owner:self

// Special handling for /api/workflow/spec endpoint
func (ae *AuthzEnforcer) authorizeWorkflowSpec(reqCtx RequestContext) (bool, error) {
    workflowID := reqCtx.Params["id"]
    if workflowID == "" {
        return false, nil
    }

    // Query database for workflow owner using pgxpool
    var ownerID string
    err := ae.pool.QueryRow(context.Background(),
        "SELECT owner_id FROM workflows WHERE id = $1",
        workflowID,
    ).Scan(&ownerID)

    if err != nil {
        return false, err
    }

    // Check if current user is owner
    return ownerID == reqCtx.UserID, nil
}
```

### 3. Pool-Based Access Control

**Scenario**: Users can only access workflows in their allowed pools

```go
// Policy with pool constraint
// p, pool-user, workflow:*, pool/production/*, allow, ""
// p, pool-user, workflow:*, pool/staging/*, allow, ""

// Or with dynamic check:
// p, osmo-user, workflow:*, *, allow, db.workflow.pool in user.allowed_pools

func (ae *AuthzEnforcer) checkPoolAccess(reqCtx RequestContext, workflowID string) (bool, error) {
    ctx := context.Background()

    // Get workflow's pool using pgxpool
    var workflowPool string
    err := ae.pool.QueryRow(ctx,
        "SELECT pool FROM workflows WHERE id = $1",
        workflowID,
    ).Scan(&workflowPool)
    if err != nil {
        return false, err
    }

    // Get user's allowed pools using pgxpool
    rows, err := ae.pool.Query(ctx,
        "SELECT pool FROM user_pool_access WHERE user_id = $1",
        reqCtx.UserID,
    )
    if err != nil {
        return false, err
    }
    defer rows.Close()

    // Check if workflow's pool is in allowed list
    for rows.Next() {
        var pool string
        if err := rows.Scan(&pool); err != nil {
            return false, err
        }
        if pool == workflowPool || pool == "*" {
            return true, nil
        }
    }

    return false, rows.Err()
}
```

---

## Using CEL for Complex Conditions

For more complex conditions, integrate [Common Expression Language (CEL)](https://github.com/google/cel-go):

```go
import (
    "github.com/google/cel-go/cel"
    "github.com/google/cel-go/checker/decls"
)

// CEL environment for condition evaluation
func (ae *AuthzEnforcer) initCEL() error {
    env, err := cel.NewEnv(
        cel.Declarations(
            decls.NewVar("ctx", decls.NewMapType(decls.String, decls.Dyn)),
            decls.NewVar("resource", decls.NewMapType(decls.String, decls.Dyn)),
        ),
    )
    if err != nil {
        return err
    }
    ae.celEnv = env
    return nil
}

// Evaluate CEL expression
func (ae *AuthzEnforcer) evaluateCEL(ctx RequestContext, resource map[string]interface{}, expr string) (bool, error) {
    ast, issues := ae.celEnv.Compile(expr)
    if issues != nil && issues.Err() != nil {
        return false, issues.Err()
    }

    prg, err := ae.celEnv.Program(ast)
    if err != nil {
        return false, err
    }

    ctxMap := map[string]interface{}{
        "user_id":   ctx.UserID,
        "user_name": ctx.UserName,
        "roles":     ctx.Roles,
        "body":      ctx.Body,
        "params":    ctx.Params,
    }

    out, _, err := prg.Eval(map[string]interface{}{
        "ctx":      ctxMap,
        "resource": resource,
    })
    if err != nil {
        return false, err
    }

    return out.Value().(bool), nil
}

// Example CEL expressions:
// "resource.owner_id == ctx.user_id"
// "ctx.body.pool in ['default', 'staging']"
// "resource.gpu_count <= 8 || 'power-user' in ctx.roles"
```

---

## Migration from Current System

### Phase 1: Add Casbin Alongside Existing Auth

```go
// Hybrid authorizer that checks both systems
type HybridAuthorizer struct {
    oldAuth    *OldAuthorizer
    casbinAuth *AuthzEnforcer
    useCasbin  bool // Feature flag
}

func (h *HybridAuthorizer) Authorize(req AuthzRequest) (bool, error) {
    if h.useCasbin {
        return h.casbinAuth.Authorize(req)
    }
    return h.oldAuth.Authorize(req)
}
```

### Phase 2: Migrate Policies

```python
# Migration script: Convert old policies to Casbin format
def migrate_policies(old_policies):
    casbin_policies = []

    for old in old_policies:
        for action in old['actions']:
            # Convert path-based action to semantic action
            semantic_action = path_to_action(action['path'], action['method'])
            if semantic_action:
                casbin_policies.append({
                    'ptype': 'p',
                    'v0': old['role'],
                    'v1': semantic_action,
                    'v2': '*',  # resource
                    'v3': 'allow' if not action.get('deny') else 'deny',
                    'v4': '',  # condition
                })

    return casbin_policies
```

---

## Performance Considerations

### Caching Strategies

```go
type AuthzEnforcer struct {
    enforcer      *casbin.Enforcer
    pool          *pgxpool.Pool
    resourceCache *cache.Cache // Workflow/resource metadata
    policyCache   *cache.Cache // Compiled policies
}

// Cache authorization decisions
func (ae *AuthzEnforcer) AuthorizeWithCache(req AuthzRequest) (bool, error) {
    cacheKey := fmt.Sprintf("%s:%s:%s:%s",
        strings.Join(req.Roles, ","),
        req.Method,
        req.Path,
        req.Params["id"])

    if cached, found := ae.policyCache.Get(cacheKey); found {
        return cached.(bool), nil
    }

    result, err := ae.Authorize(req)
    if err != nil {
        return false, err
    }

    // Cache for 1 minute (adjust based on requirements)
    ae.policyCache.Set(cacheKey, result, time.Minute)
    return result, nil
}
```

### Benchmark Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Policy evaluation (cached) | <1ms p99 | In-memory policy lookup |
| Policy evaluation (uncached) | <5ms p99 | Includes DB adapter query |
| DB condition check (cached) | <2ms p99 | Workflow owner lookup |
| DB condition check (uncached) | <10ms p99 | Fresh database query |

---

## Summary

### Casbin Advantages

1. **Mature ecosystem** — Well-tested, extensive documentation
2. **Flexible model** — Same model file supports multiple access control paradigms
3. **PostgreSQL integration** — pgx adapter integrates with existing pgxpool connections
4. **Custom functions** — Easy to add request body/params inspection and DB lookups
5. **Performance** — Built-in caching, efficient policy matching

### Implementation Checklist

- [ ] Define Casbin model (`model.conf`)
- [ ] Set up pgx adapter with existing pgxpool connection
- [ ] Register custom functions (action matching, DB lookups)
- [ ] Create action registry (path → action mapping)
- [ ] Load default role policies
- [ ] Implement authorization middleware
- [ ] Add caching layer for performance
- [ ] Write migration scripts
- [ ] Test all existing access patterns

---

## References

- [Casbin Documentation](https://casbin.org/docs/en/overview)
- [Casbin Go](https://github.com/casbin/casbin)
- [Casbin pgx Adapter](https://github.com/pckhoi/casbin-pgx-adapter)
- [pgx - PostgreSQL Driver](https://github.com/jackc/pgx)
- [CEL-Go](https://github.com/google/cel-go)
- [AWS IAM Policy Reference](https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_policies.html)

