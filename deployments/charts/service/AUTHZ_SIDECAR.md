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

# Authorization Sidecar Integration

This document explains how to enable the `authz_sidecar` for role-based authorization in OSMO services.

## Overview

The authz_sidecar is a Golang gRPC service that integrates with Envoy Proxy to provide centralized role-based access control (RBAC). It implements the Envoy External Authorization API and queries PostgreSQL for user roles and policies.

## Architecture

```
Client Request → Envoy Proxy → authz_sidecar → PostgreSQL
                      ↓               ↓            (roles table)
                      ↓         Check Cache
                      ↓               ↓
                 Service      ALLOW or DENY
```

### Request Flow

1. Client sends request to Envoy (port 80/443)
2. Envoy processes filter chain:
   - JWT authentication validates token
   - Lua filter extracts roles from JWT → `x-osmo-roles` header
   - **External Authorization** calls authz_sidecar:
     - Sends request path, method, headers
     - authz_sidecar checks role policies
     - Returns ALLOW or DENY
   - If allowed, continues to rate limiting and routing
   - If denied, returns 403 Forbidden

## Enabling the Authz Sidecar

### Step 1: Update values.yaml

Set the authz configuration in your values file or override file:

```yaml
sidecars:
  authz:
    enabled: true
    image: "{{ .Values.global.osmoImageLocation }}/authz-sidecar:{{ .Values.global.osmoImageTag }}"

    postgres:
      host: postgres
      port: 5432
      database: osmo_db
      user: postgres
      passwordSecretName: postgres-secret
      passwordSecretKey: password
      sslMode: require  # Use 'require' or 'verify-full' in production
```

### Step 2: Build and Push Authz Sidecar Image

```bash
cd external
bazel run //src/service/authz_sidecar:authz_sidecar_image
docker tag <image> your-registry/authz-sidecar:v1.0.0
docker push your-registry/authz-sidecar:v1.0.0
```

### Step 3: Deploy with Helm

```bash
helm upgrade --install osmo-service ./external/deployments/charts/service \
  --set sidecars.authz.enabled=true \
  --set sidecars.authz.image=your-registry/authz-sidecar:v1.0.0 \
  --set sidecars.authz.postgres.passwordSecretName=postgres-credentials \
  -f your-values.yaml
```

## Configuration Options

### PostgreSQL Settings

```yaml
sidecars:
  authz:
    postgres:
      host: postgres              # Database host
      port: 5432                  # Database port
      database: osmo_db           # Database name
      user: postgres              # Database user
      passwordSecretName: postgres-secret  # K8s secret name
      passwordSecretKey: password          # K8s secret key
      sslMode: require            # SSL mode (disable/require/verify-full)
      maxOpenConns: 10            # Connection pool size
      maxIdleConns: 5             # Idle connections to keep
      connMaxLifetime: 300s       # Max lifetime of a connection
```

### Cache Settings

```yaml
sidecars:
  authz:
    cache:
      enabled: true    # Enable in-memory role caching
      ttl: 300s        # Cache TTL (5 minutes)
      maxSize: 1000    # Max role combinations to cache
```

### Resource Limits

```yaml
sidecars:
  authz:
    resources:
      requests:
        cpu: 100m       # Minimum CPU
        memory: 128Mi   # Minimum memory
      limits:
        cpu: 500m       # Maximum CPU
        memory: 256Mi   # Maximum memory
```

## Verification

### Check Authz Sidecar is Running

```bash
# Get pods
kubectl get pods -l app=osmo-service

# Check authz-sidecar container
kubectl logs <pod-name> -c authz-sidecar

# Expected output:
# {"level":"info","msg":"postgres client connected successfully"}
# {"level":"info","msg":"authz server listening","port":50052}
```

### Check Envoy Configuration

```bash
# View Envoy config
kubectl exec <pod-name> -c envoy -- curl -s http://localhost:9901/config_dump | jq '.configs[] | select(.["@type"] == "type.googleapis.com/envoy.admin.v3.ClustersConfigDump") | .static_clusters[] | select(.cluster.name == "authz-sidecar")'
```

### Test Authorization

```bash
# Make a request that should be allowed
curl -H "Authorization: Bearer <token>" https://your-service/api/version

# Make a request that should be denied (without proper role)
curl -H "Authorization: Bearer <token>" https://your-service/api/workflow
# Should return 403 if user doesn't have osmo-user role
```

## Monitoring

### Logs

The authz_sidecar logs all authorization decisions:

```json
{
  "level": "info",
  "msg": "access allowed",
  "user": "john.doe",
  "path": "/api/workflow/123",
  "method": "GET",
  "roles": ["osmo-user", "osmo-default"]
}
```

### Health Checks

The sidecar has gRPC health probes:

```yaml
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
```

## Troubleshooting

### Authz Sidecar Not Starting

Check logs:
```bash
kubectl logs <pod-name> -c authz-sidecar
```

Common issues:
- PostgreSQL connection failed: Check host, credentials, network connectivity
- Secret not found: Verify `passwordSecretName` and `passwordSecretKey` are correct
- Port conflict: Ensure port 50052 is not used by another container

### All Requests Return 403

Possible causes:
1. Roles not set in JWT: Check JWT contains `roles` claim
2. Roles not in database: Verify roles table has expected roles (osmo-default, osmo-user, etc.)
3. Policy mismatch: Check role policies match request path/method

Debug steps:
```bash
# Check what roles JWT contains
kubectl logs <pod-name> -c authz-sidecar | grep "extracted authorization info"

# Check database for roles
kubectl exec -it <postgres-pod> -- psql -U postgres -d osmo_db -c "SELECT name FROM roles;"
```

### High Latency

If authorization adds >50ms latency:
1. Check cache hit rate (should be >95%)
2. Increase cache TTL: `cache.ttl: 600s` (10 minutes)
3. Increase cache size: `cache.maxSize: 2000`
4. Check PostgreSQL query performance
5. Increase connection pool: `postgres.maxOpenConns: 20`

## Migration from Python Middleware

The authz_sidecar replaces the Python `AccessControlMiddleware`. To migrate:

### Step 1: Enable authz_sidecar

Update values.yaml:
```yaml
sidecars:
  authz:
    enabled: true
    image: "your-registry/authz-sidecar:v1.0.0"
```

### Step 2: Deploy and Test

```bash
helm upgrade osmo-service ./charts/service -f values.yaml
# Test thoroughly to ensure authorization works correctly
```

### Step 3: Remove Python Middleware (Future)

Once authz_sidecar is validated:
- Remove `AccessControlMiddleware` from Python services
- Remove `check_user_access()` calls
- Simplify service code

## Security

- Runs as non-root user (UID 10001)
- All capabilities dropped
- Password loaded from Kubernetes secrets
- Communicates with Envoy over localhost only
- Database access is read-only for roles table

## Performance

- **Cache Hit Rate**: >95% typical
- **Latency (cached)**: <5ms
- **Latency (uncached)**: <30ms
- **Throughput**: 1000+ req/s per sidecar
- **Memory**: ~100-200Mi typical usage

## See Also

- Design document: `external/authz-sidecar-design.md`
- Source code: `external/src/service/authz_sidecar/`
- Integration tests: `external/src/service/authz_sidecar/integration_test.go`
- Envoy External Authorization: https://www.envoyproxy.io/docs/envoy/latest/api-v3/service/auth/v3/external_auth.proto

