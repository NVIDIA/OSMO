#!/bin/bash
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

# Integration test script for authz_sidecar
# This script assumes the authz_sidecar service is already running.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Default configuration
AUTHZ_ADDR="${AUTHZ_ADDR:-localhost:50052}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "╔════════════════════════════════════════════════════════════════════╗"
echo "║         Authz Sidecar Integration Test Runner                     ║"
echo "╚════════════════════════════════════════════════════════════════════╝"
echo ""
echo "Testing authz_sidecar at: ${AUTHZ_ADDR}"
echo ""

# Check if service is running
if ! nc -z localhost 50052 2>/dev/null; then
    echo -e "${RED}✗ Error: authz_sidecar is not running on ${AUTHZ_ADDR}${NC}"
    echo ""
    echo "Please start the service first:"
    echo "  Terminal 1 - Start PostgreSQL:"
    echo "    docker run --rm -d --name osmo-postgres -p 5432:5432 \\"
    echo "      -e POSTGRES_PASSWORD=osmo -e POSTGRES_DB=osmo postgres:15.1"
    echo ""
    echo "  Terminal 2 - Start authz_sidecar:"
    echo "    cd external && bazel run //src/service/authz_sidecar:authz_sidecar_bin -- \\"
    echo "      --postgres-password=osmo \\"
    echo "      --postgres-db=osmo \\"
    echo "      --postgres-host=localhost"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ Service is reachable${NC}"
echo ""

# Run the integration test
cd "$REPO_ROOT"
echo "Running integration tests..."
echo ""

bazel test //src/service/authz_sidecar:authz_sidecar_integration_test \
    --test_arg=-authz-addr="${AUTHZ_ADDR}" \
    --test_output=streamed \
    --test_timeout=30

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                  All Tests Passed! ✓                               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════════╝${NC}"

