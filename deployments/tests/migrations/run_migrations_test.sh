#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

set -euo pipefail

if [ -n "${TEST_SRCDIR:-}" ]; then
    REPOSITORY_ROOT="${TEST_SRCDIR}/${TEST_WORKSPACE}"
else
    REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
fi

RUNNER="${REPOSITORY_ROOT}/deployments/charts/service/migrations/run_migrations.sh"
MOCK_BIN="${REPOSITORY_ROOT}/deployments/tests/migrations/mock_bin"
LATEST_MIGRATION=$(basename "$(find "$(dirname "$RUNNER")" -name '0*.json' | sort | tail -1)" .json)
TEST_TEMP_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_TEMP_DIRECTORY"' EXIT

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

run_runner() {
    local case_name="$1"
    local state_directory="${TEST_TEMP_DIRECTORY}/${case_name}"
    local target_schema="${8:-public}"
    mkdir -p "$state_directory"

    env \
        PATH="${MOCK_BIN}:${PATH}" \
        OSMO_POSTGRES_PASSWORD="test-password" \
        MOCK_STATE_DIR="$state_directory" \
        MOCK_INITIAL_VERSION="$2" \
        MOCK_INITIAL_STATE="$3" \
        MOCK_FINAL_VERSION="$4" \
        MOCK_FINAL_STATE="$5" \
        MOCK_COMPLETED_MIGRATIONS="$6" \
        MOCK_START_RESULT="$7" \
        bash "$RUNNER" "$target_schema" > "${state_directory}/output" 2>&1
}

run_runner already_current "$LATEST_MIGRATION" Complete "$LATEST_MIGRATION" Complete "" failure ||
    fail "an already-current public schema should succeed"
grep -q "All migrations are already applied (${LATEST_MIGRATION})" \
    "${TEST_TEMP_DIRECTORY}/already_current/output" || fail "missing already-applied message"
if [ -e "${TEST_TEMP_DIRECTORY}/already_current/started_migrations" ]; then
    fail "an already-current public schema should not start migrations"
fi

COMPLETED_MIGRATIONS="001_v6_0_0_data_prep,002_v6_0_0_schema,003_v6_2_0_schema,004_v6_2_0_data"
ALL_MIGRATIONS="${COMPLETED_MIGRATIONS},005_v6_4_0_workflow_labels,006_v6_4_0_workflow_labels_gin_index"
run_runner creates_versioned_schema "$LATEST_MIGRATION" Complete "$LATEST_MIGRATION" Complete \
    "$ALL_MIGRATIONS" failure public_v6_4_0 || fail "a missing versioned schema should be created"
grep -q "CREATE SCHEMA IF NOT EXISTS public_v6_4_0" \
    "${TEST_TEMP_DIRECTORY}/creates_versioned_schema/psql_queries" || fail "versioned schema was not created"

run_runner applies_pending 004_v6_2_0_data Complete "$LATEST_MIGRATION" Complete \
    "$COMPLETED_MIGRATIONS" success || fail "pending migrations should succeed"
EXPECTED_STARTED=$'005_v6_4_0_workflow_labels.json\n006_v6_4_0_workflow_labels_gin_index.json'
ACTUAL_STARTED=$(<"${TEST_TEMP_DIRECTORY}/applies_pending/started_migrations")
[ "$ACTUAL_STARTED" = "$EXPECTED_STARTED" ] || fail "only pending migrations should be started"

if run_runner incomplete 004_v6_2_0_data Complete 004_v6_2_0_data Complete \
    "$COMPLETED_MIGRATIONS" failure; then
    fail "an incomplete final migration state should fail"
fi
grep -q "Expected migration ${LATEST_MIGRATION} to be Complete" \
    "${TEST_TEMP_DIRECTORY}/incomplete/output" || fail "missing final-state failure"
if grep -q $'\033' "${TEST_TEMP_DIRECTORY}/incomplete/output"; then
    fail "captured pgroll errors should not contain ANSI control sequences"
fi

echo "PASS: run_migrations.sh"
