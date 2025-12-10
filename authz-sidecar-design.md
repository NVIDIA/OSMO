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

# Authorization Sidecar Design Document

## Executive Summary

This document outlines the design and implementation plan for converting the Python `AccessControlMiddleware` (defined in `external/src/utils/connectors/postgres.py:4084-4113`) into a standalone Golang gRPC sidecar service that integrates with Envoy Proxy to provide centralized authorization for all OSMO services.

## Current Architecture

### Access Control Middleware (Python)

**Location:** `external/src/utils/connectors/postgres.py:4084-4113`

The current implementation is a Python ASGI middleware that:
- Intercepts HTTP and WebSocket requests
- Extracts user information from headers (`x-osmo-user`)
- Extracts user roles from headers (`x-osmo-roles`)
- Validates access by querying PostgreSQL for role policies
- Returns 403 Forbidden for unauthorized requests

**Current Flow:**
```
Client Request → Envoy → Python Service → AccessControlMiddleware → check_user_access() → PostgreSQL
                                                ↓
                                        Response (Allow/Deny)
```

### Authorization Logic

**Location:** `external/src/utils/connectors/postgres.py:3519-3556`

The `check_user_access()` function performs the following:

1. **Development Mode Check:** Bypasses auth if method is 'dev'
2. **Auth Configuration Check:** Allows all requests if auth is not configured
3. **Domain Access Check:** Optional custom domain-level access validation
4. **Role-Based Access Control:**
   - Extracts roles from `x-osmo-roles` header
   - Adds default role: `osmo-default`
   - Queries PostgreSQL roles table via `Role.list_from_db()`
   - Iterates through each role's policies to check access
   - Uses fnmatch pattern matching for path validation

**Location:** `external/src/utils/connectors/postgres.py:3961-3978`

The `Role.has_access()` method:
- Iterates through all policies in the role
- For each policy, checks all actions
- Matches HTTP method (supports wildcard `*`)
- Matches path using fnmatch patterns
- Supports deny patterns (paths starting with `!`)
- Returns `True` on first successful match

### Role Data Structure

**Location:** `external/src/lib/utils/role.py`

```python
class RoleAction(pydantic.BaseModel):
    base: str          # e.g., "http"
    path: str          # e.g., "/api/workflow/*", "!/api/admin/*"
    method: str        # e.g., "Get", "Post", "*", "Websocket"

class RolePolicy(pydantic.BaseModel):
    actions: List[RoleAction]

class Role(pydantic.BaseModel):
    name: str
    description: str
    policies: List[RolePolicy]
    immutable: bool
```

### PostgreSQL Schema

**Roles Table:** `roles`

Columns:
- `name` (string, primary key)
- `description` (string)
- `policies` (jsonb[]) - Array of JSON objects containing actions
- `immutable` (boolean)

**Query Pattern:**
```sql
SELECT * FROM roles WHERE name IN ('role1', 'role2', ...) ORDER BY name;
```

**Location:** `external/src/utils/connectors/postgres.py:3904-3915`

## Proposed Architecture

### New Flow with Authorization Sidecar

```
Client Request → Envoy Proxy → [Ext AuthZ gRPC] → AuthZ Sidecar → PostgreSQL
                     ↓                                    ↓
                     ↓ (if authorized)              Check Cache
                     ↓                                    ↓
                Python Service                    Query Roles Table
```

### Components

#### 1. Authorization Sidecar (Golang)

**Location:** `external/src/service/authz_sidecar/`

A new Golang gRPC service that implements the Envoy External Authorization API.

**Structure:**
```
external/src/service/authz_sidecar/
├── main.go                          # Entry point, server setup
├── server/
│   ├── authz_server.go             # gRPC server implementation
│   ├── authz_server_test.go        # Unit tests
│   ├── role_cache.go               # In-memory role cache
│   ├── role_cache_test.go          # Cache tests
│   └── postgres_client.go          # PostgreSQL client
├── BUILD                            # Bazel build file
└── proto/
    └── (uses Envoy ext_authz protos)
```

**Responsibilities:**
- Implement Envoy External Authorization v3 gRPC API
- Maintain connection pool to PostgreSQL
- Cache role policies in memory with TTL
- Parse and validate user roles from headers
- Execute path/method matching logic
- Return authorization decisions to Envoy

#### 2. Envoy Configuration Updates

**Location:** `external/deployments/charts/service/templates/_envoy-config.tpl`

Add External Authorization filter to the HTTP filter chain.

**Current Filter Chain (relevant section):** Lines 112-425
```yaml
http_filters:
  - name: block-spam-ips           # Line 113
  - name: strip-unauthorized-headers  # Line 141
  - name: add-auth-skip              # Line 153
  - name: add-forwarded-host         # Line 174
  - name: envoy.filters.http.lua.pre_oauth2  # Line 186
  - name: oauth2-with-matcher        # Line 257
  - name: jwt-authn-with-matcher     # Line 314
  - name: envoy.filters.http.lua.roles  # Line 391
  - name: envoy.filters.http.ratelimit  # Line 413
  - name: envoy.filters.http.router   # Line 423
```

**Proposed Addition:**

Insert new filter **after** `envoy.filters.http.lua.roles` (line 391) and **before** `envoy.filters.http.ratelimit` (line 413):

```yaml
# Insert at line ~412
- name: envoy.filters.http.ext_authz
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
    transport_api_version: V3
    with_request_body:
      max_request_bytes: 8192
      allow_partial_message: true
    failure_mode_allow: false
    grpc_service:
      envoy_grpc:
        cluster_name: authz-sidecar
      timeout: 0.5s
    metadata_context_namespaces:
      - envoy.filters.http.jwt_authn
```

**Cluster Definition:**

Add to clusters section (around line 478):

```yaml
- name: authz-sidecar
  typed_extension_protocol_options:
    envoy.extensions.upstreams.http.v3.HttpProtocolOptions:
      "@type": type.googleapis.com/envoy.extensions.upstreams.http.v3.HttpProtocolOptions
      explicit_http_config:
        http2_protocol_options: {}
  connect_timeout: 0.25s
  type: STRICT_DNS
  lb_policy: ROUND_ROBIN
  load_assignment:
    cluster_name: authz-sidecar
    endpoints:
      - lb_endpoints:
        - endpoint:
            address:
              socket_address:
                address: 127.0.0.1
                port_value: {{ .Values.sidecars.authz.grpcPort }}
```

#### 3. Helm Chart Updates

**Location:** `external/deployments/charts/service/values.yaml`

Add new sidecar configuration section:

```yaml
sidecars:
  # Existing sidecars (envoy, rateLimit, logAgent, etc.)

  authz:
    enabled: true
    image: {{ .Values.global.osmoImageLocation }}/authz-sidecar:{{ .Values.global.osmoImageTag }}
    imagePullPolicy: Always
    grpcPort: 50052

    # PostgreSQL connection settings
    postgres:
      host: postgres
      port: 5432
      database: osmo
      user: postgres
      passwordSecretName: postgres-secret
      passwordSecretKey: password

      # Connection pool settings
      maxOpenConns: 10
      maxIdleConns: 5
      connMaxLifetime: 300s

    # Cache settings
    cache:
      enabled: true
      ttl: 300s  # 5 minutes
      maxSize: 1000  # Maximum number of roles to cache

    # Resource limits
    resources:
      requests:
        cpu: 100m
        memory: 128Mi
      limits:
        cpu: 500m
        memory: 256Mi

    # Probes
    livenessProbe:
      grpc:
        port: 50052
      initialDelaySeconds: 10
      periodSeconds: 10

    readinessProbe:
      grpc:
        port: 50052
      initialDelaySeconds: 5
      periodSeconds: 5

    securityContext:
      allowPrivilegeEscalation: false
      capabilities:
        drop: ["ALL"]
      runAsNonRoot: true
      runAsUser: 10001
```

**Location:** `external/deployments/charts/service/templates/_sidecar-helpers.tpl`

Add new template definition (after line 196):

```yaml
{{/*
Authorization sidecar container
*/}}
{{- define "osmo.authz-sidecar-container" -}}
{{- if .Values.sidecars.authz.enabled }}
- name: authz-sidecar
  image: "{{ .Values.sidecars.authz.image }}"
  imagePullPolicy: {{ .Values.sidecars.authz.imagePullPolicy }}
  securityContext:
    {{- toYaml .Values.sidecars.authz.securityContext | nindent 4 }}
  ports:
    - containerPort: {{ .Values.sidecars.authz.grpcPort }}
      name: authz-grpc
      protocol: TCP
  env:
    - name: AUTHZ_GRPC_PORT
      value: "{{ .Values.sidecars.authz.grpcPort }}"
    - name: POSTGRES_HOST
      value: "{{ .Values.sidecars.authz.postgres.host }}"
    - name: POSTGRES_PORT
      value: "{{ .Values.sidecars.authz.postgres.port }}"
    - name: POSTGRES_DB
      value: "{{ .Values.sidecars.authz.postgres.database }}"
    - name: POSTGRES_USER
      value: "{{ .Values.sidecars.authz.postgres.user }}"
    - name: POSTGRES_PASSWORD
      valueFrom:
        secretKeyRef:
          name: {{ .Values.sidecars.authz.postgres.passwordSecretName }}
          key: {{ .Values.sidecars.authz.postgres.passwordSecretKey }}
    - name: POSTGRES_MAX_OPEN_CONNS
      value: "{{ .Values.sidecars.authz.postgres.maxOpenConns }}"
    - name: POSTGRES_MAX_IDLE_CONNS
      value: "{{ .Values.sidecars.authz.postgres.maxIdleConns }}"
    - name: POSTGRES_CONN_MAX_LIFETIME
      value: "{{ .Values.sidecars.authz.postgres.connMaxLifetime }}"
    - name: CACHE_ENABLED
      value: "{{ .Values.sidecars.authz.cache.enabled }}"
    - name: CACHE_TTL
      value: "{{ .Values.sidecars.authz.cache.ttl }}"
    - name: CACHE_MAX_SIZE
      value: "{{ .Values.sidecars.authz.cache.maxSize }}"
  resources:
    {{- toYaml .Values.sidecars.authz.resources | nindent 4 }}
  {{- with .Values.sidecars.authz.livenessProbe }}
  livenessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
  {{- with .Values.sidecars.authz.readinessProbe }}
  readinessProbe:
    {{- toYaml . | nindent 4 }}
  {{- end }}
{{- end }}
{{- end }}
```

**Update Deployment Templates:**

In service deployment templates (e.g., `external/deployments/charts/service/templates/core-deployment.yaml`), add the authz sidecar to the containers list:

```yaml
containers:
  - name: core
    # ... main container config ...
  {{- include "osmo.envoy-sidecar-container" . | nindent 8 }}
  {{- include "osmo.authz-sidecar-container" . | nindent 8 }}  # ADD THIS LINE
  {{- include "osmo.log-agent-sidecar-container" . | nindent 8 }}
  # ... other sidecars ...
```

## Implementation Details

### 1. Golang Authorization Service

#### main.go

**Location:** `external/src/service/authz_sidecar/main.go`

**Reference Implementation:** `external/src/service/router_go/main.go` (lines 1-185)

```go
/*
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
*/

package main

import (
    "flag"
    "fmt"
    "log/slog"
    "net"
    "os"
    "time"

    "google.golang.org/grpc"
    "google.golang.org/grpc/health"
    "google.golang.org/grpc/health/grpc_health_v1"
    "google.golang.org/grpc/keepalive"

    "go.corp.nvidia.com/osmo/service/authz_sidecar/server"
)

const (
    defaultGRPCPort = 50052
    defaultCacheTTL = 5 * time.Minute
    defaultCacheSize = 1000
)

var (
    grpcPort = flag.Int("grpc-port", defaultGRPCPort, "gRPC server port")

    // PostgreSQL flags
    postgresHost = flag.String("postgres-host", "postgres", "PostgreSQL host")
    postgresPort = flag.Int("postgres-port", 5432, "PostgreSQL port")
    postgresDB = flag.String("postgres-db", "osmo", "PostgreSQL database name")
    postgresUser = flag.String("postgres-user", "postgres", "PostgreSQL user")
    postgresPassword = flag.String("postgres-password", "", "PostgreSQL password")
    postgresMaxOpenConns = flag.Int("postgres-max-open-conns", 10, "Max open connections")
    postgresMaxIdleConns = flag.Int("postgres-max-idle-conns", 5, "Max idle connections")
    postgresConnMaxLifetime = flag.Duration("postgres-conn-max-lifetime", 5*time.Minute, "Connection max lifetime")

    // Cache flags
    cacheEnabled = flag.Bool("cache-enabled", true, "Enable role caching")
    cacheTTL = flag.Duration("cache-ttl", defaultCacheTTL, "Cache TTL for roles")
    cacheMaxSize = flag.Int("cache-max-size", defaultCacheSize, "Maximum cache size")
)

func main() {
    flag.Parse()

    // Setup structured logging
    logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
        Level: slog.LevelInfo,
    }))
    slog.SetDefault(logger)

    // Create PostgreSQL client
    pgConfig := server.PostgresConfig{
        Host:            *postgresHost,
        Port:            *postgresPort,
        Database:        *postgresDB,
        User:            *postgresUser,
        Password:        *postgresPassword,
        MaxOpenConns:    *postgresMaxOpenConns,
        MaxIdleConns:    *postgresMaxIdleConns,
        ConnMaxLifetime: *postgresConnMaxLifetime,
    }

    pgClient, err := server.NewPostgresClient(pgConfig, logger)
    if err != nil {
        logger.Error("failed to create postgres client", slog.String("error", err.Error()))
        os.Exit(1)
    }
    defer pgClient.Close()

    // Create role cache
    cacheConfig := server.RoleCacheConfig{
        Enabled:  *cacheEnabled,
        TTL:      *cacheTTL,
        MaxSize:  *cacheMaxSize,
    }
    roleCache := server.NewRoleCache(cacheConfig, logger)

    // Create authorization server
    authzServer := server.NewAuthzServer(pgClient, roleCache, logger)

    // Create gRPC server options
    opts := []grpc.ServerOption{
        grpc.KeepaliveParams(keepalive.ServerParameters{
            Time:    60 * time.Second,
            Timeout: 20 * time.Second,
        }),
        grpc.KeepaliveEnforcementPolicy(keepalive.EnforcementPolicy{
            MinTime:             30 * time.Second,
            PermitWithoutStream: true,
        }),
    }

    grpcServer := grpc.NewServer(opts...)

    // Register health service
    healthServer := health.NewServer()
    grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
    healthServer.SetServingStatus("", grpc_health_v1.HealthCheckResponse_SERVING)

    // Register authorization service
    server.RegisterAuthzService(grpcServer, authzServer)

    logger.Info("authz server configured",
        slog.Int("port", *grpcPort),
        slog.String("postgres_host", *postgresHost),
        slog.Bool("cache_enabled", *cacheEnabled),
        slog.Duration("cache_ttl", *cacheTTL),
    )

    // Start gRPC server
    lis, err := net.Listen("tcp", fmt.Sprintf(":%d", *grpcPort))
    if err != nil {
        logger.Error("failed to listen", slog.String("error", err.Error()))
        os.Exit(1)
    }

    logger.Info("authz server listening", slog.Int("port", *grpcPort))
    if err := grpcServer.Serve(lis); err != nil {
        logger.Error("server failed", slog.String("error", err.Error()))
        os.Exit(1)
    }
}
```

#### server/authz_server.go

**Location:** `external/src/service/authz_sidecar/server/authz_server.go`

**Dependencies:**
- Envoy External Authorization API v3
- PostgreSQL client
- Role cache

**Key Functions:**

1. **Check()** - Main gRPC handler
   - Receives CheckRequest from Envoy
   - Extracts headers (x-osmo-user, x-osmo-roles)
   - Calls authorization logic
   - Returns CheckResponse (OK/PERMISSION_DENIED)

2. **checkAccess()** - Authorization logic
   - Equivalent to Python `check_user_access()`
   - Parses user roles from header
   - Queries roles from cache or PostgreSQL
   - Iterates through role policies
   - Returns authorization decision

3. **matchPath()** - Path matching logic
   - Equivalent to Python `Role.has_access()`
   - Uses filepath.Match for glob patterns
   - Handles deny patterns (paths with `!` prefix)
   - Case-insensitive method matching

**Pseudocode:**

```go
func (s *AuthzServer) Check(ctx context.Context, req *authv3.CheckRequest) (*authv3.CheckResponse, error) {
    // Extract request attributes
    headers := req.GetAttributes().GetRequest().GetHttp().GetHeaders()
    path := req.GetAttributes().GetRequest().GetHttp().GetPath()
    method := req.GetAttributes().GetRequest().GetHttp().GetMethod()

    // Extract user and roles
    user := headers["x-osmo-user"]
    rolesHeader := headers["x-osmo-roles"]

    // Parse roles (comma-separated)
    roles := strings.Split(rolesHeader, ",")
    roles = append(roles, "osmo-default")  // Add default role

    // Check access
    allowed, err := s.checkAccess(ctx, path, method, roles)
    if err != nil {
        return &authv3.CheckResponse{
            Status: &status.Status{Code: int32(codes.Internal)},
        }, err
    }

    if !allowed {
        return &authv3.CheckResponse{
            Status: &status.Status{Code: int32(codes.PermissionDenied)},
        }, nil
    }

    return &authv3.CheckResponse{
        Status: &status.Status{Code: int32(codes.OK)},
    }, nil
}

func (s *AuthzServer) checkAccess(ctx context.Context, path, method string, roleNames []string) (bool, error) {
    // Try cache first
    roles, found := s.roleCache.Get(roleNames)
    if !found {
        // Query PostgreSQL
        var err error
        roles, err = s.pgClient.GetRoles(ctx, roleNames)
        if err != nil {
            return false, err
        }
        // Update cache
        s.roleCache.Set(roleNames, roles)
    }

    // Check each role's policies
    for _, role := range roles {
        if s.hasAccess(role, path, method) {
            return true, nil
        }
    }

    return false, nil
}

func (s *AuthzServer) hasAccess(role *Role, path, method string) bool {
    for _, policy := range role.Policies {
        allowed := false
        for _, action := range policy.Actions {
            // Check method match
            if !s.matchMethod(action.Method, method) {
                continue
            }

            // Check path match
            if strings.HasPrefix(action.Path, "!") {
                // Deny pattern
                if s.matchPathPattern(action.Path[1:], path) {
                    allowed = false
                    break
                }
            } else {
                // Allow pattern
                if s.matchPathPattern(action.Path, path) {
                    allowed = true
                }
            }
        }

        if allowed {
            return true
        }
    }

    return false
}

func (s *AuthzServer) matchMethod(pattern, method string) bool {
    return strings.EqualFold(pattern, "*") || strings.EqualFold(pattern, method)
}

func (s *AuthzServer) matchPathPattern(pattern, path string) bool {
    matched, _ := filepath.Match(pattern, path)
    return matched
}
```

#### server/postgres_client.go

**Location:** `external/src/service/authz_sidecar/server/postgres_client.go`

**Responsibilities:**
- Manage PostgreSQL connection pool
- Query roles table
- Parse JSON policies
- Map database rows to Go structs

**Key Functions:**

1. **NewPostgresClient()** - Initialize connection
2. **GetRoles()** - Query roles by names
3. **Close()** - Cleanup connections

**Database Query:**

```go
func (c *PostgresClient) GetRoles(ctx context.Context, roleNames []string) ([]*Role, error) {
    query := `SELECT name, description, policies, immutable
              FROM roles
              WHERE name = ANY($1)
              ORDER BY name`

    rows, err := c.db.QueryContext(ctx, query, pq.Array(roleNames))
    if err != nil {
        return nil, err
    }
    defer rows.Close()

    var roles []*Role
    for rows.Next() {
        var role Role
        var policiesJSON []byte

        err := rows.Scan(&role.Name, &role.Description, &policiesJSON, &role.Immutable)
        if err != nil {
            return nil, err
        }

        // Parse policies JSON
        err = json.Unmarshal(policiesJSON, &role.Policies)
        if err != nil {
            return nil, err
        }

        roles = append(roles, &role)
    }

    return roles, nil
}
```

**PostgreSQL Connection:**

Uses `github.com/lib/pq` driver with connection string:
```
host={host} port={port} user={user} password={password} dbname={dbname} sslmode=disable
```

#### server/role_cache.go

**Location:** `external/src/service/authz_sidecar/server/role_cache.go`

**Responsibilities:**
- In-memory caching of role policies
- TTL-based expiration
- Thread-safe operations
- LRU eviction when max size reached

**Implementation:**

Use `github.com/hashicorp/golang-lru` or custom implementation with `sync.RWMutex`

```go
type RoleCache struct {
    cache   *lru.Cache
    ttl     time.Duration
    enabled bool
    mu      sync.RWMutex
    logger  *slog.Logger
}

type cachedRoles struct {
    roles     []*Role
    expiresAt time.Time
}

func (c *RoleCache) Get(roleNames []string) ([]*Role, bool) {
    if !c.enabled {
        return nil, false
    }

    c.mu.RLock()
    defer c.mu.RUnlock()

    key := c.cacheKey(roleNames)
    val, found := c.cache.Get(key)
    if !found {
        return nil, false
    }

    cached := val.(*cachedRoles)
    if time.Now().After(cached.expiresAt) {
        c.cache.Remove(key)
        return nil, false
    }

    return cached.roles, true
}

func (c *RoleCache) Set(roleNames []string, roles []*Role) {
    if !c.enabled {
        return
    }

    c.mu.Lock()
    defer c.mu.Unlock()

    key := c.cacheKey(roleNames)
    cached := &cachedRoles{
        roles:     roles,
        expiresAt: time.Now().Add(c.ttl),
    }
    c.cache.Add(key, cached)
}

func (c *RoleCache) cacheKey(roleNames []string) string {
    sort.Strings(roleNames)
    return strings.Join(roleNames, ",")
}
```

### 2. Envoy Integration

#### External Authorization Flow

1. **Request arrives at Envoy** on port 443 (or configured listener port)
2. **Envoy processes filter chain:**
   - Strip unauthorized headers (line 141)
   - OAuth2 authentication (line 257)
   - JWT validation (line 314)
   - Extract roles from JWT to `x-osmo-roles` header (line 391)
   - **[NEW] Call External Authorization service** via gRPC
   - Rate limiting (line 413)
   - Route to upstream service (line 423)
3. **External Authorization request:**
   - Envoy sends CheckRequest with headers, path, method
   - Waits for CheckResponse (max 500ms)
   - On OK: continues to next filter
   - On PERMISSION_DENIED: returns 403 to client
   - On timeout/error: returns 500 (failure_mode_allow: false)

#### Configuration Details

**Filter Position:** After JWT/roles extraction, before rate limiting

**Rationale:**
- JWT must be validated first to extract roles
- Authorization happens before expensive operations (rate limiting, upstream calls)
- Short timeout (500ms) prevents cascading failures

**Metadata Context:**

The Envoy JWT filter populates dynamic metadata with verified JWT claims. The External Authorization filter can access this metadata, though in our case we primarily use the `x-osmo-roles` header that was already extracted by the Lua filter at line 391.

### 3. PostgreSQL Integration

#### Connection Configuration

The authz sidecar connects to PostgreSQL using environment variables passed from Helm values:

- **Host:** Usually `postgres` (Kubernetes service name) or external host
- **Port:** 5432 (default PostgreSQL port)
- **Database:** `osmo`
- **User:** `postgres`
- **Password:** Retrieved from Kubernetes secret

**Connection Pool Settings:**
- Max Open Connections: 10
- Max Idle Connections: 5
- Connection Max Lifetime: 5 minutes

**Reference:** Similar to how Python services connect via `PostgresConnector.get_instance()`

#### Database Schema

**Table:** `roles`

```sql
CREATE TABLE roles (
    name VARCHAR PRIMARY KEY,
    description TEXT,
    policies JSONB[],
    immutable BOOLEAN DEFAULT FALSE
);
```

**Policy JSON Structure:**

```json
{
  "actions": [
    {
      "base": "http",
      "path": "/api/workflow/*",
      "method": "Get"
    },
    {
      "base": "http",
      "path": "!/api/admin/*",
      "method": "*"
    }
  ]
}
```

#### Query Pattern

**Fetch Roles:**

```sql
SELECT name, description, policies, immutable
FROM roles
WHERE name = ANY($1)
ORDER BY name;
```

**Input:** Array of role names (e.g., `['osmo-user', 'osmo-default']`)
**Output:** Array of role records with policies

**Performance Considerations:**
- Query is indexed on `name` (primary key)
- Typical query returns 1-3 roles
- JSONB parsing happens in application layer
- Results are cached for 5 minutes

### 4. Default Roles

**Location:** `external/src/utils/connectors/postgres.py:3981-4081`

The system includes several default roles that must be supported:

1. **osmo-admin** - Full access except agent/logger/router backend endpoints
2. **osmo-user** - Standard user access to workflows, tasks, buckets, etc.
3. **osmo-backend** - For backend agents (limited access)
4. **osmo-ctrl** - For workflow pods (logger and router backend access)
5. **osmo-default** - Minimal access (version, health, login endpoints)

These roles are created during database initialization and marked as `immutable: true`.

## Migration Strategy

### Phase 1: Development and Testing

1. **Implement Golang service**
   - Create project structure in `external/src/service/authz_sidecar/`
   - Implement gRPC server with Envoy External Authorization API
   - Implement PostgreSQL client
   - Implement role cache
   - Write unit tests

2. **Add to build system**
   - Create BUILD file with Bazel rules
   - Update `external/src/go.mod` with dependencies
   - Create Docker image build configuration
   - Update CI/CD pipelines

3. **Local testing**
   - Deploy PostgreSQL with test roles
   - Run authz sidecar locally
   - Use grpcurl or custom client to test authorization
   - Verify database queries and caching

### Phase 2: Helm Chart Integration

1. **Update Helm charts**
   - Add authz sidecar configuration to `values.yaml`
   - Create sidecar template in `_sidecar-helpers.tpl`
   - Update Envoy configuration to include ext_authz filter
   - Update deployment templates to include authz container

2. **Feature flag**
   - Add `sidecars.authz.enabled` flag (default: false)
   - Allow gradual rollout per service
   - Enable easy rollback if issues arise

### Phase 3: Staged Rollout

1. **Deploy to development environment**
   - Enable authz sidecar for one service
   - Monitor logs and metrics
   - Validate authorization decisions
   - Load test with realistic traffic

2. **Deploy to staging**
   - Enable for all services
   - Run integration tests
   - Validate performance impact
   - Monitor latency (target: p99 < 50ms)

3. **Production rollout**
   - Enable for non-critical services first
   - Monitor error rates and latency
   - Gradually enable for all services
   - Keep Python middleware as fallback

### Phase 4: Cleanup

1. **Remove Python middleware**
   - Once authz sidecar is stable and proven
   - Remove `AccessControlMiddleware` from Python services
   - Update service code to remove dependency on `check_user_access()`
   - Clean up imports and related code

2. **Documentation**
   - Update architecture documentation
   - Create runbook for authz sidecar operations
   - Document troubleshooting procedures

## Monitoring and Observability

### Metrics

**gRPC Metrics:**
- Request count (by decision: allow/deny)
- Request latency (p50, p95, p99)
- Error rate
- Active connections

**Cache Metrics:**
- Hit rate
- Miss rate
- Eviction count
- Cache size

**PostgreSQL Metrics:**
- Query count
- Query latency
- Connection pool utilization
- Error count

**Implementation:** Use Prometheus client library in Go

### Logging

**Structured Logging:**
- Use `log/slog` package (as in router_go)
- JSON format for log aggregation
- Include request ID for correlation

**Log Events:**
- Authorization decisions (allow/deny) with user, path, method, roles
- Cache hits/misses
- Database query errors
- Configuration changes

### Tracing

**OpenTelemetry Integration:**
- Trace authorization requests end-to-end
- Link Envoy trace context
- Measure database query time
- Identify bottlenecks

## Performance Considerations

### Expected Performance

**Latency:**
- Target: p99 < 50ms
- Cache hit: < 5ms
- Cache miss: < 30ms (including DB query)

**Throughput:**
- Expected: 1000+ req/s per sidecar instance
- Connection pool: 10 connections supports high concurrency
- gRPC is highly efficient for high-throughput scenarios

### Optimization Strategies

1. **Caching:**
   - 5-minute TTL reduces DB load by ~99%
   - LRU eviction prevents memory bloat
   - Cache key based on sorted role names

2. **Connection Pooling:**
   - Reuse PostgreSQL connections
   - Configurable pool size
   - Automatic connection health checks

3. **gRPC Efficiency:**
   - HTTP/2 multiplexing
   - Protobuf serialization
   - Local communication (127.0.0.1)

4. **Pattern Matching:**
   - Use Go's `filepath.Match` (compiled patterns)
   - Short-circuit evaluation (return on first match)
   - Deny patterns checked first

### Scalability

**Horizontal Scaling:**
- One authz sidecar per service pod
- No shared state (cache is local)
- Scales automatically with service replicas

**Vertical Scaling:**
- Configurable resource limits
- Default: 100m CPU, 128Mi memory
- Can increase for high-traffic services

## Security Considerations

### Threat Model

1. **Header Injection:**
   - Mitigated by Envoy's `strip-unauthorized-headers` filter (line 141)
   - `internal_only_headers` configuration (line 98-100)
   - Authz sidecar trusts headers from Envoy

2. **Database Access:**
   - Read-only access to roles table
   - Credentials stored in Kubernetes secrets
   - Connection encrypted (sslmode=require in production)

3. **Cache Poisoning:**
   - Cache is not user-controlled
   - TTL limits impact of stale data
   - Cache key derivation is deterministic

4. **Bypass Attempts:**
   - Envoy enforces filter order
   - `failure_mode_allow: false` prevents bypass on errors
   - Authz sidecar runs in same pod (network isolation)

### Best Practices

1. **Least Privilege:**
   - Run as non-root user (uid: 10001)
   - Drop all capabilities
   - Read-only root filesystem (where possible)

2. **Secrets Management:**
   - Never log passwords or tokens
   - Retrieve credentials from Kubernetes secrets
   - Rotate database credentials regularly

3. **Input Validation:**
   - Validate role names (alphanumeric + hyphens)
   - Sanitize paths and methods
   - Limit header sizes (Envoy configured with max 64KB)

## Testing Strategy

### Unit Tests

**Location:** `external/src/service/authz_sidecar/server/*_test.go`

**Coverage:**
- Path matching logic (glob patterns, deny rules)
- Method matching (case-insensitive, wildcards)
- Role policy evaluation
- Cache operations (get, set, expiry, eviction)
- PostgreSQL client (mock database)

**Example:**

```go
func TestHasAccess(t *testing.T) {
    tests := []struct {
        name       string
        role       *Role
        path       string
        method     string
        wantAccess bool
    }{
        {
            name: "exact match",
            role: &Role{
                Policies: []RolePolicy{
                    {Actions: []RoleAction{
                        {Base: "http", Path: "/api/workflow", Method: "Get"},
                    }},
                },
            },
            path:       "/api/workflow",
            method:     "GET",
            wantAccess: true,
        },
        {
            name: "wildcard path",
            role: &Role{
                Policies: []RolePolicy{
                    {Actions: []RoleAction{
                        {Base: "http", Path: "/api/workflow/*", Method: "Get"},
                    }},
                },
            },
            path:       "/api/workflow/123",
            method:     "GET",
            wantAccess: true,
        },
        {
            name: "deny pattern",
            role: &Role{
                Policies: []RolePolicy{
                    {Actions: []RoleAction{
                        {Base: "http", Path: "*", Method: "*"},
                        {Base: "http", Path: "!/api/admin/*", Method: "*"},
                    }},
                },
            },
            path:       "/api/admin/users",
            method:     "GET",
            wantAccess: false,
        },
    }

    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            s := &AuthzServer{}
            got := s.hasAccess(tt.role, tt.path, tt.method)
            if got != tt.wantAccess {
                t.Errorf("hasAccess() = %v, want %v", got, tt.wantAccess)
            }
        })
    }
}
```

### Integration Tests

**Scenarios:**
- Deploy authz sidecar + PostgreSQL in test environment
- Populate roles table with test data
- Send CheckRequest via gRPC client
- Verify CheckResponse decisions
- Test cache behavior (first miss, subsequent hits)
- Test cache expiry (wait > TTL, verify miss)

### End-to-End Tests

**Scenarios:**
- Deploy full stack: Envoy + authz sidecar + service + PostgreSQL
- Send HTTP requests through Envoy
- Verify authorized requests succeed (200 OK)
- Verify unauthorized requests fail (403 Forbidden)
- Test with different user roles
- Test with WebSocket upgrades
- Test performance under load

## Troubleshooting Guide

### Common Issues

#### 1. Authorization Always Denies

**Symptoms:** All requests return 403 Forbidden

**Diagnosis:**
- Check authz sidecar logs for errors
- Verify `x-osmo-roles` header is set by JWT filter
- Query PostgreSQL to verify roles exist
- Check role policies for correct paths/methods

**Resolution:**
- Ensure JWT filter runs before authz filter
- Verify database connection and credentials
- Check for typos in role names or policies

#### 2. High Latency

**Symptoms:** Slow response times, p99 > 100ms

**Diagnosis:**
- Check cache hit rate (should be > 95%)
- Monitor PostgreSQL query latency
- Check connection pool utilization
- Look for network issues (Envoy <-> authz)

**Resolution:**
- Increase cache TTL
- Increase cache size
- Optimize PostgreSQL queries (add indexes)
- Increase connection pool size

#### 3. Cache Inconsistency

**Symptoms:** Policy changes not reflected immediately

**Diagnosis:**
- Check cache TTL configuration
- Verify role updates in database
- Check cache eviction logs

**Resolution:**
- This is expected behavior (5-minute TTL)
- For immediate effect, restart authz sidecar pod
- Consider implementing cache invalidation (future enhancement)

#### 4. Database Connection Errors

**Symptoms:** Authz sidecar can't connect to PostgreSQL

**Diagnosis:**
- Check PostgreSQL service is running
- Verify network connectivity (DNS resolution)
- Check credentials in Kubernetes secret
- Review PostgreSQL logs

**Resolution:**
- Verify POSTGRES_HOST environment variable
- Check secret name and key in Helm values
- Ensure PostgreSQL accepts connections from authz pod
- Check PostgreSQL connection limits

## Future Enhancements

### 1. Dynamic Cache Invalidation

**Problem:** Role policy updates require cache expiry (5 minutes)

**Solution:**
- Implement PostgreSQL LISTEN/NOTIFY
- Authz sidecar listens for role update events
- Invalidate specific cache entries on notification
- Provides near-instant policy updates

### 2. Attribute-Based Access Control (ABAC)

**Enhancement:** Support more complex authorization rules

**Features:**
- User attributes (department, location, etc.)
- Resource attributes (owner, tags, etc.)
- Context attributes (time, IP, etc.)
- Policy evaluation engine (e.g., Open Policy Agent)

### 3. Audit Logging

**Enhancement:** Detailed authorization decision audit trail

**Features:**
- Log all authorization decisions with full context
- Ship to centralized logging (e.g., Elasticsearch)
- Support compliance requirements (SOC2, GDPR)
- Queryable audit log API

### 4. Authorization Metrics Dashboard

**Enhancement:** Real-time visibility into authorization

**Features:**
- Grafana dashboard with key metrics
- Authorization decision trends
- Top denied paths/users
- Cache performance metrics

### 5. Multi-Tenancy Support

**Enhancement:** Tenant-specific role policies

**Features:**
- Tenant ID from JWT claims
- Per-tenant role tables or namespaced roles
- Isolation between tenants
- Tenant-specific default roles

## Conclusion

This design document outlines a comprehensive plan to migrate access control from Python middleware to a Golang gRPC sidecar integrated with Envoy. The proposed architecture provides:

- **Better Performance:** Sub-50ms latency, high throughput
- **Scalability:** Scales with service pods, efficient caching
- **Reliability:** Failure isolation, health checks, graceful degradation
- **Security:** Defense in depth, least privilege, secure defaults
- **Observability:** Metrics, logging, tracing for debugging
- **Maintainability:** Clean separation of concerns, well-tested

The implementation leverages existing patterns from the router_go service and Envoy sidecar configuration, ensuring consistency with the current architecture.

## References

### Code Locations

- **Current Middleware:** `external/src/utils/connectors/postgres.py:4084-4113`
- **Authorization Logic:** `external/src/utils/connectors/postgres.py:3519-3556`
- **Role Model:** `external/src/lib/utils/role.py`
- **Envoy Config:** `external/deployments/charts/service/templates/_envoy-config.tpl`
- **Sidecar Helpers:** `external/deployments/charts/service/templates/_sidecar-helpers.tpl`
- **Chart Values:** `external/deployments/charts/service/values.yaml`
- **Router Go Reference:** `external/src/service/router_go/main.go`

### External Documentation

- [Envoy External Authorization](https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/external_auth.proto)
- [Envoy gRPC External Authorization Filter](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter)
- [PostgreSQL Go Driver (pq)](https://github.com/lib/pq)
- [gRPC Go](https://grpc.io/docs/languages/go/)
- [Structured Logging (slog)](https://pkg.go.dev/log/slog)

### Headers

- **User Header:** `x-osmo-user` (defined in `external/src/lib/utils/login.py:37`)
- **Roles Header:** `x-osmo-roles` (defined in `external/src/lib/utils/login.py:38`)

### Database Schema

- **Roles Table:** `roles` (name, description, policies, immutable)
- **Profile Table:** `profile` (user_name, email_notification, slack_notification, bucket, pool)

---

**Document Version:** 1.0
**Last Updated:** 2025-12-09
**Author:** AI Assistant
**Status:** Design Proposal

