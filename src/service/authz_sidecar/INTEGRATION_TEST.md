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

# Authz Sidecar Integration Tests

This directory contains integration tests for the `authz_sidecar` service that verify the service is running correctly and can handle authorization requests.

## Prerequisites

The integration tests assume the `authz_sidecar` service is **already running** on `localhost:50052` (default port).

### Starting the Required Services

#### Terminal 1: Start PostgreSQL

The authz_sidecar requires PostgreSQL for storing role and policy data:

```bash
docker run --rm -d --name osmo-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=osmo \
  -e POSTGRES_DB=osmo \
  postgres:15.1
```

#### Terminal 2: Start authz_sidecar

From the `external` directory:

```bash
cd external

bazel run //src/service/authz_sidecar:authz_sidecar_bin -- \
  --postgres-password=osmo \
  --postgres-db=osmo \
  --postgres-host=localhost
```

## Running the Integration Tests

### Option 1: Using the Helper Script (Recommended)

From the `external` directory:

```bash
./src/service/authz_sidecar/run_integration_test.sh
```

The script will:
- Check if the service is running
- Run all integration tests with nice formatting
- Display test results in a summary table

### Option 2: Using Bazel Directly

From the `external` directory:

```bash
bazel test //src/service/authz_sidecar:authz_sidecar_integration_test \
  --test_output=streamed
```

### Option 3: Using Bazel Run (Interactive)

```bash
bazel run //src/service/authz_sidecar:authz_sidecar_integration_test
```

## Test Coverage

The integration tests cover:

1. **Health Check Test** (`TestAuthzSidecarHealth`)
   - Verifies the gRPC health check endpoint is responding
   - Ensures the service is in SERVING status

2. **Basic Role Authorization Test** (`TestAuthzSidecarBasicRole`)
   - Tests default role (`osmo-default`) permissions
   - Tests user role (`osmo-user`) permissions
   - Verifies access to public endpoints (`/api/version`, `/health`)
   - Verifies access control for protected endpoints (`/api/workflow`)
   - Tests path pattern matching (`/api/workflow/*`)

## Customizing the Test

### Changing the Service Address

If your authz_sidecar is running on a different address:

```bash
# Using the helper script
AUTHZ_ADDR=localhost:9999 ./src/service/authz_sidecar/run_integration_test.sh

# Using bazel directly
bazel test //src/service/authz_sidecar:authz_sidecar_integration_test \
  --test_arg=-authz-addr=localhost:9999 \
  --test_output=streamed
```

## Expected Output

When tests pass, you should see output like:

```
✓ Health check passed: service is SERVING
✓ default role can access version endpoint: GET /api/version (roles: ) - ALLOWED
✓ default role cannot access workflow endpoint: GET /api/workflow (roles: ) - DENIED
✓ user role can access workflow endpoint: GET /api/workflow (roles: osmo-user) - ALLOWED
✓ user role can access workflow with ID: POST /api/workflow/abc-123 (roles: osmo-user) - ALLOWED

╔══════════════════════════════════════════════════════════════╗
║              Authorization Test Summary                      ║
╠══════════════════════════════════════════════════════════════╣
║  Total Tests:  5                                             ║
║  Passed:       5                                             ║
║  Failed:       0                                             ║
╚══════════════════════════════════════════════════════════════╝
```

## Troubleshooting

### "Failed to connect to authz_sidecar"

This means the service is not running. Make sure you've started both PostgreSQL and the authz_sidecar service as described in Prerequisites.

### "Authorization mismatch"

This could indicate:
- The PostgreSQL database doesn't have the expected roles configured
- The role policies have been modified
- There's an issue with the authorization logic

Check the service logs for more details.

### Database Setup

If the database doesn't have the required roles, you may need to populate it with the default roles. The service should create roles automatically, but if you're testing with a fresh database, ensure the following roles exist:

- `osmo-default`: Basic role with access to `/api/version`, `/health`, and login endpoints
- `osmo-user`: User role with access to workflow and task endpoints
- `osmo-admin`: Admin role with broad permissions

## Adding New Tests

To add new test cases, edit `integration_test.go` and add entries to the `tests` slice in `TestAuthzSidecarBasicRole`:

```go
{
    name:          "description of test",
    path:          "/api/some/path",
    method:        "GET",
    user:          "test-user",
    roles:         "osmo-user",
    expectAllowed: true,
    description:   "Explanation of what this test verifies",
},
```

## Notes

- These are **integration tests**, not unit tests. They require a running service.
- The tests use the Envoy External Authorization API.
- Tests verify both positive (allowed) and negative (denied) authorization scenarios.
- The default role (`osmo-default`) is automatically added to all requests.

