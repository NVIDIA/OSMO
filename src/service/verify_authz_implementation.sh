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

echo "======================================"
echo "Authorization Sidecar Implementation"
echo "Verification Script"
echo "======================================"
echo

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TOTAL=0
SUCCESS=0
FAILED=0

check_file() {
    TOTAL=$((TOTAL + 1))
    if [ -f "$1" ]; then
        echo -e "${GREEN}✓${NC} $1"
        SUCCESS=$((SUCCESS + 1))
    else
        echo -e "${RED}✗${NC} $1 (MISSING)"
        FAILED=$((FAILED + 1))
    fi
}

check_dir() {
    TOTAL=$((TOTAL + 1))
    if [ -d "$1" ]; then
        echo -e "${GREEN}✓${NC} $1/"
        SUCCESS=$((SUCCESS + 1))
    else
        echo -e "${RED}✗${NC} $1/ (MISSING)"
        FAILED=$((FAILED + 1))
    fi
}

echo -e "${BLUE}Checking Directory Structure${NC}"
echo "-----------------------------------"
check_dir "authz_sidecar"
check_dir "authz_sidecar/server"
check_dir "utils_go"
echo

echo -e "${BLUE}Checking Core Service Files${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/main.go"
check_file "authz_sidecar/server/authz_server.go"
check_file "authz_sidecar/server/role_cache.go"
check_file "utils_go/postgres_client.go"
echo

echo -e "${BLUE}Checking Test Files${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/server/authz_server_test.go"
check_file "authz_sidecar/server/role_cache_test.go"
check_file "authz_sidecar/server/integration_test.go"
check_file "utils_go/postgres_client_test.go"
echo

echo -e "${BLUE}Checking Build Files${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/BUILD"
check_file "authz_sidecar/server/BUILD"
check_file "utils_go/BUILD"
check_file "go.mod"
echo

echo -e "${BLUE}Checking Docker Files${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/Dockerfile"
check_file "authz_sidecar/.dockerignore"
echo

echo -e "${BLUE}Checking Documentation${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/README.md"
check_file "AUTHZ_SIDECAR_SUMMARY.md"
echo

echo -e "${BLUE}Checking Scripts${NC}"
echo "-----------------------------------"
check_file "authz_sidecar/test_service.sh"
check_file "verify_authz_implementation.sh"
echo

echo "======================================"
echo "Verification Summary"
echo "======================================"
echo -e "Total checks: ${BLUE}${TOTAL}${NC}"
echo -e "Passed: ${GREEN}${SUCCESS}${NC}"
echo -e "Failed: ${RED}${FAILED}${NC}"
echo

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All files present!${NC}"
    echo
    echo "Next steps:"
    echo "1. Run tests: cd authz_sidecar && ./test_service.sh"
    echo "2. Build service: go build -o authz_sidecar main.go"
    echo "3. Review documentation: cat authz_sidecar/README.md"
    echo
    exit 0
else
    echo -e "${RED}✗ Some files are missing${NC}"
    exit 1
fi

