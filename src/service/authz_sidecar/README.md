# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

# Authorization Sidecar Service

The Authorization Sidecar is a high-performance Golang gRPC service that implements Envoy's External Authorization API to provide centralized role-based access control (RBAC) for OSMO services.

## Overview

This service replaces the Python `AccessControlMiddleware` with a dedicated sidecar that:
- Implements Envoy External Authorization v3 gRPC API
- Queries PostgreSQL for role policies
- Caches role policies in memory for performance
- Provides sub-50ms authorization decisions

## Architecture

```
Envoy Proxy → [ext_authz gRPC] → AuthZ Sidecar → PostgreSQL
                                       ↓
                                  Role Cache (in-memory)
```

## Components

### Main Service (`main.go`)
- Entry point for the authorization sidecar
- Configures gRPC server with health checks
- Initializes PostgreSQL client and role cache
- Handles graceful startup and shutdown

### Authorization Server (`server/authz_server.go`)
- Implements Envoy `Authorization` service
- Handles `Check` RPC calls from Envoy
- Extracts user and roles from headers
- Performs path/method matching against role policies
- Returns allow/deny decisions

### Role Cache (`server/role_cache.go`)
- In-memory LRU cache for role policies
- Configurable TTL and max size
- Thread-safe operations
- Background expiration cleanup

### PostgreSQL Client (`../utils_go/postgres_client.go`)
- Connection pooling for PostgreSQL
- Queries roles table
- Parses JSONB policy arrays
- Handles role data structures

## Configuration

### Environment Variables

The service is configured via command-line flags, which can be set through environment variables:

#### gRPC Server
- `--grpc-port` (default: 50052): gRPC server port

#### PostgreSQL
- `--postgres-host` (default: "postgres"): PostgreSQL hostname
- `--postgres-port` (default: 5432): PostgreSQL port
- `--postgres-db` (default: "osmo"): Database name
- `--postgres-user` (default: "postgres"): Database user
- `--postgres-password` (required): Database password
- `--postgres-max-open-conns` (default: 10): Max open connections
- `--postgres-max-idle-conns` (default: 5): Max idle connections
- `--postgres-conn-max-lifetime` (default: 5m): Connection max lifetime
- `--postgres-sslmode` (default: "disable"): SSL mode

#### Cache
- `--cache-enabled` (default: true): Enable role caching
- `--cache-ttl` (default: 5m): Cache TTL for roles
- `--cache-max-size` (default: 1000): Maximum cache entries

## Database Schema

The service queries the `roles` table:

```sql
CREATE TABLE roles (
    name VARCHAR PRIMARY KEY,
    description TEXT,
    policies JSONB[],
    immutable BOOLEAN DEFAULT FALSE
);
```

### Role Policy Structure

```json
{
  "actions": [
    {
      "base": "http",
      "path": "/api/workflow/*",
      "method": "Get"
    }
  ]
}
```

## Headers

The service expects these headers to be set by Envoy (after JWT validation):

- `x-osmo-user`: Username extracted from JWT
- `x-osmo-roles`: Comma-separated list of roles

The service automatically adds the `osmo-default` role to all requests.

## Authorization Logic

1. **Extract** path, method, and roles from the request
2. **Lookup** roles in cache or query PostgreSQL
3. **Iterate** through each role's policies
4. **Match** path patterns using glob matching (e.g., `/api/workflow/*`)
5. **Match** HTTP methods (supports wildcards: `*`)
6. **Handle** deny patterns (paths starting with `!`)
7. **Return** allow (200 OK) or deny (403 Forbidden)

### Pattern Matching Examples

- Exact: `/api/workflow` matches `/api/workflow`
- Wildcard suffix: `/api/workflow/*` matches `/api/workflow/123`
- Wildcard all: `*` matches any path
- Deny pattern: `!/api/admin/*` blocks `/api/admin/users`

## Building

### Using Bazel

```bash
# Build binary
bazel build //src/service/authz_sidecar:authz_sidecar_bin

# Build Docker image
bazel build //src/service/authz_sidecar:authz_sidecar_image

# Build tarball
bazel build //src/service/authz_sidecar:authz_sidecar_pkg
```

### Using Go

```bash
cd external/src/service/authz_sidecar
go build -o authz_sidecar main.go
```

## Testing

### Unit Tests

```bash
# Test authorization server
bazel test //src/service/authz_sidecar/server:server_test

# Test specific functions
go test -v ./server -run TestHasAccess
```

### Integration Tests

```bash
# Run all tests including integration tests
bazel test //src/service/authz_sidecar/server:server_test

# Run with PostgreSQL (requires running database)
go test -v ./server -run TestAuthzServerIntegration
```

## Running Locally

### With Docker Compose

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Run authz sidecar
./authz_sidecar \
  --grpc-port=50052 \
  --postgres-host=localhost \
  --postgres-port=5432 \
  --postgres-db=osmo \
  --postgres-user=postgres \
  --postgres-password=yourpassword \
  --cache-enabled=true \
  --cache-ttl=5m
```

### Testing with grpcurl

```bash
# Install grpcurl
go install github.com/fullstorydev/grpcurl/cmd/grpcurl@latest

# List services
grpcurl -plaintext localhost:50052 list

# Health check
grpcurl -plaintext localhost:50052 grpc.health.v1.Health/Check

# Test authorization (requires proto definitions)
grpcurl -plaintext -d @ localhost:50052 envoy.service.auth.v3.Authorization/Check <<EOF
{
  "attributes": {
    "request": {
      "http": {
        "path": "/api/workflow",
        "method": "GET",
        "headers": {
          "x-osmo-user": "testuser",
          "x-osmo-roles": "osmo-user"
        }
      }
    }
  }
}
EOF
```

## Deployment

The service is deployed as a sidecar container alongside OSMO services. See the Helm chart configuration in:

- `external/deployments/charts/service/values.yaml` - Configuration values
- `external/deployments/charts/service/templates/_sidecar-helpers.tpl` - Sidecar template

### Kubernetes Deployment

The sidecar is automatically included when enabled in Helm values:

```yaml
sidecars:
  authz:
    enabled: true
    image: nvcr.io/nvidia/osmo/authz-sidecar:latest
    grpcPort: 50052
    postgres:
      host: postgres
      port: 5432
      database: osmo
      user: postgres
      passwordSecretName: postgres-secret
      passwordSecretKey: password
```

## Monitoring

### Metrics

The service exposes standard gRPC metrics and custom metrics for:
- Authorization decisions (allow/deny counts)
- Cache hit/miss rates
- PostgreSQL query latency
- Request latency percentiles

### Logging

Structured JSON logging using Go's `log/slog`:

```json
{
  "time": "2025-12-09T10:30:00Z",
  "level": "INFO",
  "msg": "access allowed",
  "user": "testuser",
  "path": "/api/workflow",
  "method": "GET",
  "roles": ["osmo-user", "osmo-default"]
}
```

### Health Checks

gRPC health check endpoint for Kubernetes probes:

```yaml
livenessProbe:
  grpc:
    port: 50052
  initialDelaySeconds: 10
  periodSeconds: 10
```

## Performance

### Expected Latency
- Cache hit: < 5ms
- Cache miss: < 30ms (including PostgreSQL query)
- Target p99: < 50ms

### Throughput
- Expected: 1000+ requests/second per instance
- Scales linearly with service pods (one sidecar per pod)

## Troubleshooting

### Common Issues

#### High Latency
- Check cache hit rate (should be > 95%)
- Verify PostgreSQL connection pool settings
- Check for network issues between sidecar and database

#### All Requests Denied
- Verify `x-osmo-roles` header is set by JWT filter
- Check role policies in PostgreSQL
- Verify default role exists and has basic permissions

#### Cache Not Working
- Verify `--cache-enabled=true`
- Check cache stats in logs
- Ensure TTL is appropriate for your use case

### Debug Logging

Enable debug logging with environment variable:

```bash
LOG_LEVEL=DEBUG ./authz_sidecar ...
```

## Development

### Adding New Features

1. Update `server/authz_server.go` for authorization logic
2. Add tests in `server/authz_server_test.go`
3. Update documentation

### Code Organization

```
authz_sidecar/
├── main.go                      # Entry point
├── server/
│   ├── authz_server.go         # Main authorization logic
│   ├── authz_server_test.go    # Unit tests
│   ├── role_cache.go           # Caching layer
│   ├── role_cache_test.go      # Cache tests
│   ├── integration_test.go     # Integration tests
│   └── BUILD                    # Bazel build file
├── BUILD                        # Main build file
└── README.md                    # This file
```

## References

- [Design Document](../../../../authz-sidecar-design.md)
- [Envoy External Authorization](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/ext_authz_filter)
- [Python Middleware](../../utils/connectors/postgres.py) (lines 4084-4113)

## License

Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0.

