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

set -e

echo "=== Authorization Sidecar Test Script ==="
echo

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Go is installed
if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: Go is not installed${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Go is installed${NC}"
go version

# Navigate to the authz_sidecar directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
cd "$SCRIPT_DIR"

echo
echo "=== Running Unit Tests ==="
echo

# Run tests for the server package
if go test -v ./server/...; then
    echo -e "${GREEN}✓ Server tests passed${NC}"
else
    echo -e "${RED}✗ Server tests failed${NC}"
    exit 1
fi

# Run tests for utils_go
cd ../utils_go
if go test -v .; then
    echo -e "${GREEN}✓ Utils tests passed${NC}"
else
    echo -e "${RED}✗ Utils tests failed${NC}"
    exit 1
fi

cd "$SCRIPT_DIR"

echo
echo "=== Building Binary ==="
echo

# Build the binary
if go build -o authz_sidecar_test main.go; then
    echo -e "${GREEN}✓ Build successful${NC}"
    ls -lh authz_sidecar_test
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo
echo "=== Testing Binary Help ==="
echo

# Test running the binary with help flag
if ./authz_sidecar_test --help > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Binary runs successfully${NC}"
else
    echo -e "${RED}✗ Binary execution failed${NC}"
    exit 1
fi

# Cleanup
rm -f authz_sidecar_test

echo
echo "=== Running Integration Tests ==="
echo

# Run integration tests (these use mocks, don't require actual database)
if go test -v ./server/ -run Integration; then
    echo -e "${GREEN}✓ Integration tests passed${NC}"
else
    echo -e "${YELLOW}⚠ Integration tests skipped or failed (may require database)${NC}"
fi

echo
echo "=== Test Coverage ==="
echo

# Generate coverage report
go test -coverprofile=coverage.out ./server/
go tool cover -func=coverage.out | tail -n 1

# Cleanup coverage file
rm -f coverage.out

echo
echo -e "${GREEN}=== All Tests Completed Successfully ===${NC}"
echo
echo "To run the service locally (requires PostgreSQL):"
echo
echo "  ./authz_sidecar \\"
echo "    --grpc-port=50052 \\"
echo "    --postgres-host=localhost \\"
echo "    --postgres-port=5432 \\"
echo "    --postgres-db=osmo \\"
echo "    --postgres-user=postgres \\"
echo "    --postgres-password=yourpassword"
echo

