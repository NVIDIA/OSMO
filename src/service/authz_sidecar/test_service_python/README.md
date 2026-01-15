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

# Python Test Service for Performance Comparison

This directory contains a minimal Python service that implements the `AccessControlMiddleware` for performance comparison against the Go `authz_sidecar`.

## Purpose

This service is used exclusively for performance benchmarking. It replicates the Python authorization middleware behavior to enable apples-to-apples comparison with the Go implementation.

## Files

- `middleware.py` - AccessControlMiddleware implementation with role caching
- `service.py` - Minimal FastAPI service with the middleware
- `requirements.txt` - Python dependencies

## Setup

```bash
cd external/src/service/authz_sidecar/test_service_python

# Install dependencies
pip install -r requirements.txt

# Or use a virtual environment
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Running

```bash
# With default settings (requires PostgreSQL on localhost:5432/osmo_db)
python service.py --postgres-password=osmo

# Custom PostgreSQL
python service.py \
  --postgres-host=localhost \
  --postgres-port=5432 \
  --postgres-db=osmo_db \
  --postgres-user=postgres \
  --postgres-password=osmo \
  --port=8000
```

## Testing

Once running, test the service:

```bash
# Should be allowed (osmo-default role)
curl -H "x-osmo-roles: " http://localhost:8000/api/version

# Should be denied (requires osmo-user role)
curl -H "x-osmo-roles: " http://localhost:8000/api/workflow

# Should be allowed (osmo-user role)
curl -H "x-osmo-roles: osmo-user" http://localhost:8000/api/workflow
```

## Performance Comparison

See `../performance_comparison_test.go` for the benchmark test.

To run performance comparison:

```bash
# Terminal 1: Start PostgreSQL
docker run --rm -d --name postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo_db postgres:15.1

# Terminal 2: Start Python service
python service.py --postgres-password=osmo

# Terminal 3: Start Go authz_sidecar
cd external && bazel run //src/service/authz_sidecar:authz_sidecar_bin -- \
  --postgres-password=osmo --postgres-db=osmo_db --postgres-host=localhost

# Terminal 4: Run benchmark
cd external && bazel test //src/service/authz_sidecar:performance_comparison --test_output=streamed
```

## Notes

- This is a **simplified** version of AccessControlMiddleware for testing purposes only
- Uses the same database queries and caching strategy as production middleware
- Implements the same role matching logic (fnmatch patterns, deny rules, etc.)
- Not intended for production use

