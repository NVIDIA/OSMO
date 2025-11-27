# Router Go Authorization Integration

## Overview

This document analyzes the authorization gaps between the existing Python router (`router.py`) and the new Go router (`router_go`), and provides a detailed implementation plan for bridging them.

## Current Python Router Authorization Flow

### Architecture

```
┌─────────────┐    HTTPS     ┌─────────┐     HTTP      ┌─────────────────┐     HTTP       ┌──────────────┐
│   Client    │─────────────►│   ALB   │──────────────►│   Envoy Proxy   │──────────────►│ Python Router│
│             │              │(TLS Term)│              │  (JWT Validation)│               │  (FastAPI)   │
└─────────────┘              └─────────┘              └─────────────────┘               └──────────────┘
                                                             │
                                                             ▼
                                                      ┌─────────────────┐
                                                      │  Headers Added: │
                                                      │  x-osmo-user    │
                                                      │  x-osmo-roles   │
                                                      └─────────────────┘
```

> **Note**: TLS is terminated at the AWS Application Load Balancer (ALB). Internal traffic between ALB, Envoy, and backend services uses HTTP.

### Header Constants

Defined in `src/lib/utils/login.py`:

| Header | Purpose | Example Value |
|--------|---------|---------------|
| `x-osmo-auth` | JWT token from client | `eyJhbGciOiJS...` |
| `x-osmo-user` | User identity (set by Envoy from JWT claim) | `john.doe@nvidia.com` |
| `x-osmo-roles` | Comma-separated roles (set by Envoy Lua) | `osmo-user,osmo-admin` |

### Envoy JWT Configuration

From `deployments/charts/router/templates/_envoy-config-helpers.tpl`:

1. **JWT Authentication Filter**:
   - Validates JWT from `x-osmo-auth` header or `IdToken` cookie
   - Fetches JWKS from remote URI with caching (600s)
   - Forwards validated JWT and stores in metadata

2. **Lua Script for Roles**:
   - Extracts `roles` claim from validated JWT metadata
   - Concatenates roles into `x-osmo-roles` header

3. **Claim to Header Mapping**:
   - Maps user claim (e.g., `unique_name`) to `x-osmo-user` header

### Python Middleware Flow

From `src/utils/connectors/postgres.py`:

```python
# AccessControlMiddleware.__call__()
async def __call__(self, scope, receive, send):
    # 1. Extract headers from request
    request_headers = request.headers

    # 2. Call check_user_access()
    response = await check_user_access(
        scope['path'], request_method, request_headers,
        self.method, self.domain_access_check
    )

    # 3. Create user profile if needed
    username = request_headers.get('x-osmo-user')
    if username:
        UserProfile.fetch_from_db(postgres, username)
```

```python
# check_user_access()
async def check_user_access(path, request_method, request_headers,
                            method=None, domain_access_check=None):
    # Skip auth in dev mode
    if method == 'dev':
        return None

    # Check if auth is enabled
    if not service_config.service_auth.login_info.device_endpoint:
        return None

    # Domain-based bypass (for webserver routing)
    if domain_access_check:
        allowed = bool(domain_access_check(request_headers))
        if allowed:
            return None

    # Role-based access control
    roles_header = request_headers.get('x-osmo-roles') or ''
    user_roles = roles_header.split(',') + ['osmo-default']

    # Check if user has access via roles - REQUIRES POSTGRES QUERY
    roles_list = Role.list_from_db(postgres, user_roles)  # Fetches role definitions from DB
    for role_entry in roles_list:
        allowed = role_entry.has_access(path, request_method)  # Checks path/method against role permissions
        if allowed:
            break

    if not allowed:
        return JSONResponse(status_code=403, content={'message': 'Forbidden'})

    return None
```

### Action-Level Permissions

From `src/service/core/workflow/workflow_service.py`:

```python
def check_action_permissions(workflow_id, action, user, roles, ...):
    # Skip in dev mode
    if context.config.method == 'dev':
        return

    # Admin bypass
    if 'osmo-admin' in roles:
        return

    # Pool-based permission levels: PUBLIC, PRIVATE, POOL
    pool_obj = Pool.fetch_from_db(context.database, workflow_response.pool)

    if action == ActionType.EXEC:
        permission = pool_obj.action_permissions.execute
    elif action == ActionType.PORTFORWARD:
        permission = pool_obj.action_permissions.portforward
    # ... etc
```

---

## Go Router Current State

### What Exists

1. **TLS Transport Security** (`main.go`) - for local dev only, TLS terminated at ALB in production:
   ```go
   creds, err := credentials.NewServerTLSFromFile(*tlsCert, *tlsKey)
   opts = append(opts, grpc.Creds(creds))
   ```

2. **Session Cookie Validation** (`session_store.go`):
   ```go
   // Cookie matching on session join
   if loaded && session.Cookie != cookie {
       return nil, false, status.Error(codes.PermissionDenied, "cookie mismatch")
   }
   ```

3. **Health Check Endpoint**:
   ```go
   healthServer := health.NewServer()
   grpc_health_v1.RegisterHealthServer(grpcServer, healthServer)
   ```

### What's Missing

| Feature | Python Router | Go Router |
|---------|---------------|-----------|
| gRPC Auth Interceptor | N/A (HTTP middleware) | **Missing** |
| JWT Validation | Envoy + Middleware | **Missing** |
| User Identity Extraction | `x-osmo-user` header | **Missing** |
| Role Extraction | `x-osmo-roles` header | **Missing** |
| Role-Based Access Control | `check_user_access()` | **Missing** |
| PostgreSQL Connection | `PostgresConnector` | **Missing** |
| Role DB Queries | `Role.list_from_db()` | **Missing** |
| Dev Mode Bypass | `method == 'dev'` | **Missing** |
| Audit Logging | UserProfile tracking | **Missing** |

---

## Implementation Plan

### Recommended Architecture

```
┌─────────────┐    HTTPS     ┌─────────┐    HTTP/gRPC   ┌─────────────────┐    gRPC     ┌──────────────┐
│   Client    │─────────────►│   ALB   │───────────────►│   Envoy Proxy   │────────────►│  Go Router   │
│             │              │(TLS Term)│               │  (JWT Validation)│             │   (gRPC)     │
└─────────────┘              └─────────┘               └─────────────────┘             └──────────────┘
                                                              │                              │
                                                              ▼                              ▼
                                                       ┌─────────────────┐          ┌────────────────┐
                                                       │ gRPC Metadata:  │          │ Auth Intercept │
                                                       │  x-osmo-user    │          │ - Validate meta│
                                                       │  x-osmo-roles   │          │ - Add to ctx   │
                                                       └─────────────────┘          └────────────────┘
```

> **Note**: TLS is terminated at the AWS ALB. The Go router's `--tls-enabled` flag is for local development or when ALB is not present. In production, internal traffic uses plaintext gRPC.

### Phase 1: gRPC Metadata Extraction

**Goal**: Extract and validate auth headers from gRPC metadata.

**New File**: `server/auth.go`

```go
package server

import (
    "context"
    "strings"

    "google.golang.org/grpc"
    "google.golang.org/grpc/codes"
    "google.golang.org/grpc/metadata"
    "google.golang.org/grpc/status"
)

// Metadata keys (must be lowercase for gRPC)
const (
    MetadataKeyUser  = "x-osmo-user"
    MetadataKeyRoles = "x-osmo-roles"
    MetadataKeyAuth  = "x-osmo-auth"
)

// AuthInfo contains extracted authentication information
type AuthInfo struct {
    User  string
    Roles []string
}

// contextKey is a custom type for context keys to avoid collisions
type contextKey string

const authInfoKey contextKey = "authInfo"

// AuthInfoFromContext retrieves AuthInfo from context
func AuthInfoFromContext(ctx context.Context) (*AuthInfo, bool) {
    info, ok := ctx.Value(authInfoKey).(*AuthInfo)
    return info, ok
}

// ContextWithAuthInfo adds AuthInfo to context
func ContextWithAuthInfo(ctx context.Context, info *AuthInfo) context.Context {
    return context.WithValue(ctx, authInfoKey, info)
}

// ExtractAuthInfo extracts authentication info from gRPC metadata
func ExtractAuthInfo(ctx context.Context) (*AuthInfo, error) {
    md, ok := metadata.FromIncomingContext(ctx)
    if !ok {
        return nil, nil // No metadata, auth may be disabled
    }

    info := &AuthInfo{}

    // Extract user
    if users := md.Get(MetadataKeyUser); len(users) > 0 {
        info.User = users[0]
    }

    // Extract roles
    if roles := md.Get(MetadataKeyRoles); len(roles) > 0 {
        info.Roles = strings.Split(roles[0], ",")
    }

    return info, nil
}
```

### Phase 2: Unary Interceptor

**Goal**: Add authentication interceptor for unary RPCs (GetSessionInfo, TerminateSession).

**Add to `server/auth.go`**:

```go
// AuthConfig holds authentication configuration
type AuthConfig struct {
    Enabled  bool     // Enable authentication
    DevMode  bool     // Skip auth checks in dev mode
    Required bool     // Require auth for all requests (if enabled)
}

// NewAuthUnaryInterceptor creates a unary interceptor for authentication
func NewAuthUnaryInterceptor(config AuthConfig, logger *slog.Logger) grpc.UnaryServerInterceptor {
    return func(
        ctx context.Context,
        req interface{},
        info *grpc.UnaryServerInfo,
        handler grpc.UnaryHandler,
    ) (interface{}, error) {
        // Skip auth in dev mode
        if config.DevMode {
            return handler(ctx, req)
        }

        // Skip if auth is disabled
        if !config.Enabled {
            return handler(ctx, req)
        }

        // Extract auth info
        authInfo, err := ExtractAuthInfo(ctx)
        if err != nil {
            logger.ErrorContext(ctx, "failed to extract auth info",
                slog.String("error", err.Error()))
            return nil, status.Error(codes.Internal, "auth extraction failed")
        }

        // Require user if auth is required
        if config.Required && (authInfo == nil || authInfo.User == "") {
            return nil, status.Error(codes.Unauthenticated, "authentication required")
        }

        // Add auth info to context
        if authInfo != nil {
            ctx = ContextWithAuthInfo(ctx, authInfo)
        }

        return handler(ctx, req)
    }
}
```

### Phase 3: Stream Interceptor

**Goal**: Add authentication interceptor for streaming RPCs (Tunnel).

**Add to `server/auth.go`**:

```go
// NewAuthStreamInterceptor creates a stream interceptor for authentication
func NewAuthStreamInterceptor(config AuthConfig, logger *slog.Logger) grpc.StreamServerInterceptor {
    return func(
        srv interface{},
        ss grpc.ServerStream,
        info *grpc.StreamServerInfo,
        handler grpc.StreamHandler,
    ) error {
        ctx := ss.Context()

        // Skip auth in dev mode
        if config.DevMode {
            return handler(srv, ss)
        }

        // Skip if auth is disabled
        if !config.Enabled {
            return handler(srv, ss)
        }

        // Extract auth info
        authInfo, err := ExtractAuthInfo(ctx)
        if err != nil {
            logger.ErrorContext(ctx, "failed to extract auth info",
                slog.String("error", err.Error()))
            return status.Error(codes.Internal, "auth extraction failed")
        }

        // Require user if auth is required
        if config.Required && (authInfo == nil || authInfo.User == "") {
            return status.Error(codes.Unauthenticated, "authentication required")
        }

        // Wrap stream with auth context
        if authInfo != nil {
            wrappedStream := &authServerStream{
                ServerStream: ss,
                ctx:          ContextWithAuthInfo(ctx, authInfo),
            }
            return handler(srv, wrappedStream)
        }

        return handler(srv, ss)
    }
}

// authServerStream wraps ServerStream to provide modified context
type authServerStream struct {
    grpc.ServerStream
    ctx context.Context
}

func (s *authServerStream) Context() context.Context {
    return s.ctx
}
```

### Phase 4: Main.go Integration

**Goal**: Wire up interceptors in server startup.

**Modify `main.go`**:

```go
// Add new flags
var (
    authEnabled  = flag.Bool("auth-enabled", false, "Enable authentication")
    authRequired = flag.Bool("auth-required", false, "Require authentication for all requests")
    devMode      = flag.Bool("dev-mode", false, "Run in development mode (skip auth)")
)

func main() {
    // ... existing code ...

    // Create auth config
    authConfig := server.AuthConfig{
        Enabled:  *authEnabled,
        Required: *authRequired,
        DevMode:  *devMode,
    }

    // Create interceptors
    authUnary := server.NewAuthUnaryInterceptor(authConfig, logger)
    authStream := server.NewAuthStreamInterceptor(authConfig, logger)

    // Add to server options
    opts := []grpc.ServerOption{
        grpc.ChainUnaryInterceptor(authUnary),
        grpc.ChainStreamInterceptor(authStream),
        // ... existing options ...
    }
}
```

### Phase 5: Role-Based Access Control (Required)

**Goal**: Implement role-based authorization with PostgreSQL backend using sqlc + pgx.

#### Technology Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Driver | `github.com/jackc/pgx/v5` | Native PostgreSQL driver (faster than database/sql) |
| Pool | `github.com/jackc/pgx/v5/pgxpool` | Connection pooling with health checks |
| Codegen | `github.com/sqlc-dev/sqlc` | Type-safe Go from SQL queries |

**Why this stack?**
- **pgx**: Native protocol, better performance, full PostgreSQL feature support
- **pgxpool**: Production-ready connection pooling, automatic reconnection
- **sqlc**: Compile-time SQL validation, generated type-safe code, no reflection

#### File Structure

Shared packages live in `src/internal/` for reuse across Go services:

```
external/src/
├── go.mod                          # module go.corp.nvidia.com/osmo
├── go.work                         # use . and ./runtime (temporary)
│
├── internal/                       # Shared server-side packages
│   ├── db/                         # Database layer (sqlc)
│   │   ├── sqlc.yaml               # sqlc configuration
│   │   ├── schema/                 # Schema references (read-only, for sqlc)
│   │   │   ├── roles.sql
│   │   │   └── ...                 # Future: workflows.sql, users.sql, etc.
│   │   ├── queries/                # SQL queries
│   │   │   ├── roles.sql           # Role queries
│   │   │   └── ...                 # Future: workflows.sql, users.sql, etc.
│   │   └── generated/              # sqlc output (DO NOT EDIT)
│   │       ├── db.go
│   │       ├── models.go
│   │       ├── querier.go
│   │       └── roles.sql.go
│   │
│   ├── postgres/                   # PostgreSQL connection management
│   │   ├── client.go               # pgxpool wrapper
│   │   └── config.go               # Config struct
│   │
│   └── auth/                       # Authentication + Authorization (gRPC)
│       ├── metadata.go             # ExtractAuthInfo from gRPC metadata
│       ├── roles.go                # CheckUserAccess, HasAdminRole
│       ├── interceptor.go          # Unary + stream interceptors
│       └── auth_test.go
│
├── service/
│   └── router_go/                  # Router gRPC server
│       ├── main.go                 # Entry point (uses internal/)
│       └── server/                 # Router-specific handlers
│           ├── server.go
│           └── session_store.go
│
└── runtime/                        # Existing (can also use internal/)
    ├── go.mod                      # Existing module (temporary)
    └── cmd/
        └── ctrl/
```

#### Import Paths

```go
// In service/router_go/main.go
import (
    "go.corp.nvidia.com/osmo/internal/auth"
    "go.corp.nvidia.com/osmo/internal/postgres"
)

// In internal/auth/roles.go
import (
    db "go.corp.nvidia.com/osmo/internal/db/generated"
    "go.corp.nvidia.com/osmo/internal/postgres"
)

// In runtime/cmd/ctrl/ctrl.go (future)
import (
    "go.corp.nvidia.com/osmo/internal/auth"  // Single import for all auth needs
)
```

#### sqlc Configuration

**File**: `internal/db/sqlc.yaml`

```yaml
version: "2"
sql:
  - engine: "postgresql"
    queries: "queries/"
    schema: "schema/"
    gen:
      go:
        package: "db"
        out: "generated"
        sql_package: "pgx/v5"
        emit_json_tags: true
        emit_prepared_queries: true
        emit_interface: true
```

#### Schema Reference

**File**: `internal/db/schema/roles.sql`

```sql
-- Schema reference for sqlc (matches existing Python schema)
-- This is read-only, actual migrations managed by Python services

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    path_pattern VARCHAR(255) NOT NULL,
    methods VARCHAR(255),  -- comma-separated: GET,POST,WEBSOCKET,GRPC
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_roles_name ON roles(name);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
```

#### SQL Queries

**File**: `internal/db/queries/roles.sql`

```sql
-- name: GetRolesByNames :many
-- Fetch roles with their permissions by role names
SELECT
    r.id,
    r.name,
    r.description,
    rp.path_pattern,
    rp.methods
FROM roles r
LEFT JOIN role_permissions rp ON r.id = rp.role_id
WHERE r.name = ANY(@role_names::text[]);

-- name: GetRoleByName :one
SELECT id, name, description, created_at
FROM roles
WHERE name = @name;

-- name: ListAllRoles :many
SELECT id, name, description, created_at
FROM roles
ORDER BY name;
```

#### PostgreSQL Client

**File**: `internal/postgres/client.go`

```go
package postgres

import (
    "context"
    "fmt"
    "log/slog"
    "time"

    "github.com/jackc/pgx/v5/pgxpool"
)

// Config holds database connection configuration
type Config struct {
    Host            string
    Port            int
    User            string
    Password        string
    Database        string
    SSLMode         string
    MaxConns        int32
    MinConns        int32
    MaxConnLifetime time.Duration
    MaxConnIdleTime time.Duration
}

// Client wraps pgxpool with health checks and logging
type Client struct {
    Pool   *pgxpool.Pool
    logger *slog.Logger
}

// NewClient creates a new PostgreSQL client with connection pooling
func NewClient(ctx context.Context, config Config, logger *slog.Logger) (*Client, error) {
    connString := fmt.Sprintf(
        "postgres://%s:%s@%s:%d/%s?sslmode=%s",
        config.User, config.Password,
        config.Host, config.Port,
        config.Database, config.SSLMode,
    )

    poolConfig, err := pgxpool.ParseConfig(connString)
    if err != nil {
        return nil, fmt.Errorf("failed to parse connection string: %w", err)
    }

    poolConfig.MaxConns = config.MaxConns
    poolConfig.MinConns = config.MinConns
    poolConfig.MaxConnLifetime = config.MaxConnLifetime
    poolConfig.MaxConnIdleTime = config.MaxConnIdleTime

    pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
    if err != nil {
        return nil, fmt.Errorf("failed to create connection pool: %w", err)
    }

    if err := pool.Ping(ctx); err != nil {
        pool.Close()
        return nil, fmt.Errorf("failed to ping database: %w", err)
    }

    return &Client{Pool: pool, logger: logger}, nil
}

// Close closes the connection pool
func (c *Client) Close() {
    c.Pool.Close()
}

// Healthy returns true if the database is reachable
func (c *Client) Healthy(ctx context.Context) bool {
    return c.Pool.Ping(ctx) == nil
}
```

#### Auth Package

**File**: `internal/auth/roles.go`

```go
package auth

import (
    "context"
    "fmt"
    "strings"

    db "go.corp.nvidia.com/osmo/internal/db/generated"
    "go.corp.nvidia.com/osmo/internal/postgres"
)

// RoleChecker handles role-based access control queries
type RoleChecker struct {
    queries *db.Queries
}

// NewRoleChecker creates a new role checker using the postgres client
func NewRoleChecker(pgClient *postgres.Client) *RoleChecker {
    return &RoleChecker{
        queries: db.New(pgClient.Pool),
    }
}

// CheckUserAccess verifies if user roles allow access to the path/method
func (rc *RoleChecker) CheckUserAccess(ctx context.Context, userRoles []string, path, method string) (bool, error) {
    // Always include default role
    allRoles := append(userRoles, "osmo-default")

    // Use sqlc-generated query
    rows, err := rc.queries.GetRolesByNames(ctx, allRoles)
    if err != nil {
        return false, fmt.Errorf("failed to query roles: %w", err)
    }

    // Check permissions
    for _, row := range rows {
        if row.PathPattern.Valid && matchPath(path, row.PathPattern.String) {
            if row.Methods.Valid {
                methods := strings.Split(row.Methods.String, ",")
                for _, m := range methods {
                    if strings.EqualFold(strings.TrimSpace(m), method) || m == "*" {
                        return true, nil
                    }
                }
            }
        }
    }

    return false, nil
}

// HasAdminRole checks if the user has admin privileges
func HasAdminRole(roles []string) bool {
    for _, role := range roles {
        if role == "osmo-admin" {
            return true
        }
    }
    return false
}

// matchPath checks if path matches the pattern (supports trailing wildcard)
func matchPath(path, pattern string) bool {
    if strings.HasSuffix(pattern, "*") {
        prefix := strings.TrimSuffix(pattern, "*")
        return strings.HasPrefix(path, prefix)
    }
    return path == pattern
}
```

#### Main.go Integration

**Update `service/router_go/main.go`**:

```go
import (
    // ... existing imports ...
    "time"

    "go.corp.nvidia.com/osmo/internal/auth"
    "go.corp.nvidia.com/osmo/internal/postgres"
)

var (
    // ... existing flags ...

    // Authentication flags
    authEnabled  = flag.Bool("auth-enabled", false, "Enable authentication")
    authRequired = flag.Bool("auth-required", false, "Require authentication")
    devMode      = flag.Bool("dev-mode", false, "Development mode (skip auth)")

    // PostgreSQL configuration
    pgHost            = flag.String("pg-host", "localhost", "PostgreSQL host")
    pgPort            = flag.Int("pg-port", 5432, "PostgreSQL port")
    pgUser            = flag.String("pg-user", "osmo", "PostgreSQL user")
    pgPassword        = flag.String("pg-password", "", "PostgreSQL password (use PG_PASSWORD env)")
    pgDatabase        = flag.String("pg-database", "osmo", "PostgreSQL database")
    pgSSLMode         = flag.String("pg-sslmode", "disable", "PostgreSQL SSL mode")
    pgMaxConns        = flag.Int("pg-max-conns", 10, "PostgreSQL max connections")
    pgMinConns        = flag.Int("pg-min-conns", 2, "PostgreSQL min connections")
    pgMaxConnLifetime = flag.Duration("pg-max-conn-lifetime", time.Hour, "PostgreSQL max connection lifetime")
)

func main() {
    flag.Parse()

    // ... existing setup ...

    // Initialize PostgreSQL and auth (if auth enabled)
    var pgClient *postgres.Client
    var roleChecker *auth.RoleChecker

    if *authEnabled && !*devMode {
        pgConfig := postgres.Config{
            Host:            *pgHost,
            Port:            *pgPort,
            User:            *pgUser,
            Password:        getPassword(),
            Database:        *pgDatabase,
            SSLMode:         *pgSSLMode,
            MaxConns:        int32(*pgMaxConns),
            MinConns:        int32(*pgMinConns),
            MaxConnLifetime: *pgMaxConnLifetime,
            MaxConnIdleTime: 30 * time.Minute,
        }

        var err error
        pgClient, err = postgres.NewClient(context.Background(), pgConfig, logger)
        if err != nil {
            logger.Error("failed to connect to PostgreSQL", slog.String("error", err.Error()))
            os.Exit(1)
        }
        defer pgClient.Close()

        roleChecker = auth.NewRoleChecker(pgClient)

        logger.Info("connected to PostgreSQL",
            slog.String("host", *pgHost),
            slog.Int("port", *pgPort),
            slog.String("database", *pgDatabase),
        )
    }

    // Create auth config for interceptors
    authConfig := auth.Config{
        Enabled:     *authEnabled,
        Required:    *authRequired,
        DevMode:     *devMode,
        RoleChecker: roleChecker,
    }

    // Create interceptors
    authUnary := auth.NewUnaryInterceptor(authConfig, logger)
    authStream := auth.NewStreamInterceptor(authConfig, logger)

    opts := []grpc.ServerOption{
        grpc.ChainUnaryInterceptor(authUnary),
        grpc.ChainStreamInterceptor(authStream),
        // ... existing options ...
    }

    // ... rest of setup ...
}

func getPassword() string {
    if *pgPassword != "" {
        return *pgPassword
    }
    return os.Getenv("PG_PASSWORD")
}
```

#### Build Integration

**Add to `go.mod`**:

```
require (
    github.com/jackc/pgx/v5 v5.5.0
    github.com/sqlc-dev/sqlc v1.25.0  // dev dependency for codegen
)
```

**Generate sqlc code** (add to build script):

```bash
# Install sqlc
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest

# Generate code from src/internal/db
cd external/src/internal/db && sqlc generate
```

**Bazel BUILD** (if using Bazel):

```python
# In internal/db/BUILD
genrule(
    name = "sqlc_generate",
    srcs = [
        "sqlc.yaml",
        "queries/roles.sql",
        "schema/roles.sql",
    ],
    outs = [
        "generated/db.go",
        "generated/models.go",
        "generated/querier.go",
        "generated/roles.sql.go",
    ],
    cmd = "cd external/src/internal/db && sqlc generate",
    tools = ["@sqlc//:sqlc"],
)
```

### Phase 6: Envoy Configuration for gRPC

**Goal**: Configure Envoy to handle JWT validation for gRPC traffic.

**Add to Helm chart** (`charts/router-grpc/templates/_envoy-config.tpl`):

```yaml
# gRPC-aware JWT authentication filter
http_filters:
- name: envoy.filters.http.jwt_authn
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.jwt_authn.v3.JwtAuthentication
    providers:
      osmo_jwt:
        issuer: {{ .Values.auth.jwt.issuer }}
        audiences:
          - {{ .Values.auth.jwt.audience }}
        forward: true
        payload_in_metadata: verified_jwt
        from_headers:
          - name: x-osmo-auth
        remote_jwks:
          http_uri:
            uri: {{ .Values.auth.jwt.jwks_uri }}
            cluster: jwks_cluster
            timeout: 5s
          cache_duration:
            seconds: 600
        claim_to_headers:
          - claim_name: unique_name
            header_name: x-osmo-user

# Lua filter to extract roles
- name: envoy.filters.http.lua
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.lua.v3.Lua
    default_source_code:
      inline_string: |
        function envoy_on_request(request_handle)
          local meta = request_handle:streamInfo():dynamicMetadata():get('envoy.filters.http.jwt_authn')
          if meta and meta.verified_jwt and meta.verified_jwt.roles then
            local roles_list = table.concat(meta.verified_jwt.roles, ',')
            request_handle:headers():replace('x-osmo-roles', roles_list)
          end
        end

# gRPC router
- name: envoy.filters.http.router
  typed_config:
    "@type": type.googleapis.com/envoy.extensions.filters.http.router.v3.Router
```

---

## Implementation Checklist

### Phase 1: Metadata Extraction
- [ ] Create `server/auth.go` with metadata extraction functions
- [ ] Add `AuthInfo` struct and context helpers
- [ ] Add unit tests for metadata extraction

### Phase 2: Unary Interceptor
- [ ] Implement `NewAuthUnaryInterceptor`
- [ ] Add `AuthConfig` struct
- [ ] Add unit tests for unary interceptor

### Phase 3: Stream Interceptor
- [ ] Implement `NewAuthStreamInterceptor`
- [ ] Implement `authServerStream` wrapper
- [ ] Add unit tests for stream interceptor

### Phase 4: Main.go Integration
- [ ] Add auth-related command line flags
- [ ] Wire interceptors into gRPC server options
- [ ] Add integration tests

### Phase 5: Role-Based Access Control (Required)
- [ ] Create `src/go.mod` with module `go.corp.nvidia.com/osmo`
- [ ] Create `src/go.work` to link with `./runtime`
- [ ] Add pgx/pgxpool dependencies (`github.com/jackc/pgx/v5`)
- [ ] Create `internal/db/` structure with sqlc.yaml
- [ ] Create schema reference `internal/db/schema/roles.sql`
- [ ] Write SQL queries in `internal/db/queries/roles.sql`
- [ ] Run `sqlc generate` to create type-safe Go code
- [ ] Create `internal/postgres/client.go` with pgxpool wrapper
- [ ] Create `internal/auth/` package (roles + interceptors)
- [ ] Update `service/router_go/main.go` to use internal packages
- [ ] Add pgxpool health check metrics
- [ ] Add unit tests with pgxmock

### Phase 6: Envoy Configuration
- [ ] Create Envoy config template for gRPC
- [ ] Add Helm values for JWT configuration
- [ ] Test end-to-end with Envoy + Go router

---

## Security Considerations

1. **Trust Boundary**: The Go router trusts that Envoy has validated JWTs. Direct gRPC access without Envoy should be blocked at network level (Kubernetes NetworkPolicy) or require the router to validate JWTs directly.

2. **TLS Termination**: TLS is terminated at the AWS ALB. Internal cluster traffic (ALB → Envoy → Go Router) uses plaintext. This is standard for Kubernetes deployments where pod-to-pod traffic is considered trusted within the cluster network.

3. **Metadata Injection**: gRPC metadata can be set by clients. In production, Envoy should strip/replace `x-osmo-user` and `x-osmo-roles` headers to prevent spoofing.

4. **Dev Mode**: The `--dev-mode` flag bypasses authentication entirely. This should NEVER be enabled in production.

5. **Audit Logging**: Consider logging user identity for all operations for compliance and debugging.

---

## Testing Strategy

### Unit Tests (no database)

```go
func TestExtractAuthInfo(t *testing.T) {
    // Test with valid metadata
    // Test with missing metadata
    // Test with partial metadata
}

func TestAuthUnaryInterceptor(t *testing.T) {
    // Test auth enabled + valid user
    // Test auth enabled + missing user
    // Test auth disabled
    // Test dev mode
}

func TestAuthStreamInterceptor(t *testing.T) {
    // Similar to unary tests
    // Verify context propagation through stream
}

func TestMatchPath(t *testing.T) {
    // Test exact match
    // Test wildcard suffix
    // Test no match
}
```

### Database Tests (with pgxmock)

Use `github.com/pashagolub/pgxmock/v3` for unit testing database queries without a real PostgreSQL:

```go
func TestCheckUserAccess(t *testing.T) {
    mock, err := pgxmock.NewPool()
    require.NoError(t, err)
    defer mock.Close()

    // Set up expected query
    mock.ExpectQuery("SELECT .+ FROM roles").
        WithArgs([]string{"osmo-user", "osmo-default"}).
        WillReturnRows(pgxmock.NewRows([]string{"id", "name", "path_pattern", "methods"}).
            AddRow(1, "osmo-user", "/api/router/*", "GET,GRPC"))

    store := &RoleStore{pool: mock, queries: db.New(mock)}

    allowed, err := store.CheckUserAccess(ctx, []string{"osmo-user"}, "/api/router/exec", "GRPC")
    assert.NoError(t, err)
    assert.True(t, allowed)

    assert.NoError(t, mock.ExpectationsWereMet())
}
```

### Test Dependencies

```
require (
    github.com/pashagolub/pgxmock/v3 v3.3.0
    github.com/stretchr/testify v1.8.4
)
```

> **Note**: With sqlc providing compile-time SQL validation and type-safe generated code, pgxmock is sufficient for testing. Real database integration tests are not required for the auth layer.

---

## Migration Path

1. **Deploy with auth disabled** (`--auth-enabled=false`)
   - Validates basic gRPC functionality
   - No behavior change from current state
   - No PostgreSQL connection required

2. **Enable auth without requiring it** (`--auth-enabled=true --auth-required=false`)
   - Requires PostgreSQL connection for role lookups
   - Extracts auth info when present
   - Logs user identity
   - Doesn't reject unauthenticated requests

3. **Require auth for new deployments** (`--auth-enabled=true --auth-required=true`)
   - Full authentication enforcement
   - Role-based access control via PostgreSQL
   - Matches Python router behavior

**PostgreSQL Connection Requirements**:
- Same PostgreSQL instance used by Python services
- Read-only access to `roles` and `role_permissions` tables
- Connection string passed via flags or environment variables

---

## Database Schema

The role-based access control queries depend on the existing PostgreSQL schema used by the Python services. The Go router uses **read-only access** to these tables.

**Key Tables** (from `src/utils/connectors/postgres.py`):

```sql
-- roles table stores role definitions
CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- role_permissions defines what paths/methods each role can access
CREATE TABLE role_permissions (
    id SERIAL PRIMARY KEY,
    role_id INTEGER REFERENCES roles(id) ON DELETE CASCADE,
    path_pattern VARCHAR(255) NOT NULL,
    methods VARCHAR(255),  -- comma-separated: GET,POST,WEBSOCKET,GRPC
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for query performance
CREATE INDEX idx_roles_name ON roles(name);
CREATE INDEX idx_role_permissions_role_id ON role_permissions(role_id);
```

**sqlc Integration**: The schema file at `server/db/schema/roles.sql` is a reference copy for sqlc code generation. Schema migrations are owned by Python services - the Go router only reads.

> **Note**: Verify the actual schema against `src/utils/connectors/postgres.py` before implementation. The Role model and table structure must match exactly for sqlc-generated queries to work.

---

## References

- Python Router: `external/src/service/router/router.py`
- AccessControlMiddleware: `external/src/utils/connectors/postgres.py` (lines 4091-4119)
- Role Model: `external/src/utils/connectors/postgres.py` (search for `class Role`)
- Header Constants: `external/src/lib/utils/login.py` (lines 35-38)
- Envoy JWT Config: `external/deployments/charts/router/templates/_envoy-config-helpers.tpl`
- gRPC Interceptors: https://grpc.io/docs/guides/interceptors/
- Envoy JWT Filter: https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/jwt_authn_filter
