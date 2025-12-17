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

# Authorization Sidecar - Quick Start Guide

## TL;DR

```bash
# 1. Run tests
cd external/src/service/authz_sidecar
./test_service.sh

# 2. Build
go build -o authz_sidecar main.go

# 3. Run (requires PostgreSQL)
./authz_sidecar \
  --postgres-password=yourpassword
```

## Prerequisites

- **Go 1.21+** - Required for building and testing
- **PostgreSQL** (optional for local testing) - The service queries the `roles` table

## File Structure

```
authz_sidecar/
├── main.go                    # Service entry point
├── server/
│   ├── authz_server.go       # Authorization logic
│   ├── role_cache.go         # Caching layer
│   └── *_test.go             # All tests
├── BUILD                      # Bazel build config
├── Dockerfile                 # Container image
├── README.md                  # Full documentation
├── QUICKSTART.md             # This file
└── test_service.sh           # Test automation
```

## Quick Commands

### Run All Tests

```bash
./test_service.sh
```

This runs:
- Unit tests for authorization logic
- Cache tests
- Integration tests (with mocks)
- Builds the binary
- Generates coverage report

### Run Specific Tests

```bash
# Test authorization logic
go test -v ./server -run TestHasAccess

# Test caching
go test -v ./server -run TestRoleCache

# Test integration
go test -v ./server -run Integration

# All tests
go test -v ./server
```

### Build Binary

```bash
# Simple build
go build -o authz_sidecar main.go

# With optimizations
go build -ldflags="-w -s" -o authz_sidecar main.go

# Check binary
./authz_sidecar --help
```

### Build Docker Image

```bash
docker build -t authz-sidecar:latest .

# Run in container
docker run -it --rm \
  -p 50052:50052 \
  -e POSTGRES_PASSWORD=yourpassword \
  authz-sidecar:latest \
  --postgres-host=host.docker.internal
```

### Run Locally

```bash
# With default settings
./authz_sidecar --postgres-password=yourpassword

# With custom configuration
./authz_sidecar \
  --grpc-port=50052 \
  --postgres-host=localhost \
  --postgres-port=5432 \
  --postgres-db=osmo \
  --postgres-user=postgres \
  --postgres-password=yourpassword \
  --cache-enabled=true \
  --cache-ttl=5m \
  --cache-max-size=1000
```

## Testing with PostgreSQL

If you have PostgreSQL running:

```sql
-- Create test roles table
CREATE TABLE IF NOT EXISTS roles (
    name VARCHAR PRIMARY KEY,
    description TEXT,
    policies JSONB[],
    immutable BOOLEAN DEFAULT FALSE
);

-- Insert test role
INSERT INTO roles (name, description, policies, immutable) VALUES (
    'osmo-default',
    'Default role',
    ARRAY['{"actions": [{"base": "http", "path": "/health", "method": "*"}]}'::jsonb],
    false
);
```

Then run the service and test:

```bash
# Start service
./authz_sidecar --postgres-password=yourpassword &

# Test with grpcurl (if installed)
grpcurl -plaintext localhost:50052 grpc.health.v1.Health/Check
```

## Configuration Quick Reference

### Minimal Configuration

Only one flag is required:

```bash
./authz_sidecar --postgres-password=yourpassword
```

All other settings have sensible defaults.

### Common Configurations

**Development (local PostgreSQL):**
```bash
./authz_sidecar \
  --postgres-host=localhost \
  --postgres-password=dev123 \
  --cache-enabled=false  # Disable cache for testing
```

**Production (with caching):**
```bash
./authz_sidecar \
  --postgres-host=postgres.prod.svc.cluster.local \
  --postgres-password=${DB_PASSWORD} \
  --cache-enabled=true \
  --cache-ttl=5m \
  --postgres-max-open-conns=20
```

**Debug Mode:**
```bash
LOG_LEVEL=DEBUG ./authz_sidecar --postgres-password=yourpassword
```

## Health Checks

The service exposes a gRPC health check endpoint:

```bash
# Using grpcurl
grpcurl -plaintext localhost:50052 grpc.health.v1.Health/Check

# Response
{
  "status": "SERVING"
}
```

## Common Issues

### Tests Fail to Run

```bash
# Ensure you're in the right directory
cd external/src/service/authz_sidecar

# Make sure Go is installed
go version

# Download dependencies
cd .. && go mod download && cd authz_sidecar
```

### Build Fails

```bash
# Clean and rebuild
go clean
go build -o authz_sidecar main.go

# Check for missing dependencies
cd .. && go mod tidy && cd authz_sidecar
```

### Service Won't Start

```bash
# Check if port is already in use
lsof -i :50052

# Try different port
./authz_sidecar --grpc-port=50053 --postgres-password=yourpassword

# Check PostgreSQL connection
psql -h localhost -U postgres -d osmo
```

## What the Service Does

1. **Listens** on port 50052 (gRPC)
2. **Receives** authorization requests from Envoy
3. **Extracts** user and roles from headers
4. **Queries** PostgreSQL for role policies (with caching)
5. **Matches** request path/method against role policies
6. **Returns** allow (200) or deny (403) decision

## Integration with Envoy

This service is designed to work with Envoy's External Authorization filter:

```yaml
# Envoy config snippet
http_filters:
  - name: envoy.filters.http.ext_authz
    typed_config:
      "@type": type.googleapis.com/envoy.extensions.filters.http.ext_authz.v3.ExtAuthz
      grpc_service:
        envoy_grpc:
          cluster_name: authz-sidecar
      timeout: 0.5s
```

See the [design document](../../../../authz-sidecar-design.md) for full Envoy integration.

## Performance Expectations

- **Cache Hit:** < 5ms
- **Cache Miss:** < 30ms (includes DB query)
- **Target p99:** < 50ms
- **Throughput:** 1000+ req/s per instance

## Next Steps

1. ✅ **You are here** - Built and tested the service
2. 📋 **Review** [README.md](README.md) for full documentation
3. 📋 **Review** [Design Doc](../../../../authz-sidecar-design.md) for Envoy integration
4. 🚀 **Deploy** as sidecar in Kubernetes (see Helm charts)
5. 📊 **Monitor** with Prometheus/Grafana
6. 🔄 **Iterate** based on production metrics

## Help & Documentation

- **Full Documentation:** [README.md](README.md)
- **Design Document:** [authz-sidecar-design.md](../../../../authz-sidecar-design.md)
- **Implementation Summary:** [AUTHZ_SIDECAR_SUMMARY.md](../AUTHZ_SIDECAR_SUMMARY.md)
- **Test Script:** Run `./test_service.sh`
- **Verification:** Run `cd .. && ./verify_authz_implementation.sh`

## Example Test Run

```bash
$ ./test_service.sh

=== Authorization Sidecar Test Script ===

✓ Go is installed
go version go1.21.0 linux/amd64

=== Running Unit Tests ===

ok      go.corp.nvidia.com/osmo/service/authz_sidecar/server    0.123s
✓ Server tests passed

✓ Utils tests passed

=== Building Binary ===

✓ Build successful
-rwxr-xr-x 1 user user 8.1M Dec 10 10:30 authz_sidecar_test

=== Testing Binary Help ===

✓ Binary runs successfully

=== All Tests Completed Successfully ===
```

## Summary

The authorization sidecar is ready to use! Run `./test_service.sh` to verify everything works, then review the full documentation in [README.md](README.md) for deployment instructions.

**Questions?** Check the troubleshooting section in [README.md](README.md) or review the design document.

