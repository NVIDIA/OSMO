#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    CHART_ROOT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts/osmo"
else
    CHART_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fi
RUNNER="$CHART_ROOT/migrations/run_migrations.sh"
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
FAKE_BIN="$TEST_DIRECTORY/bin"
CALL_DIRECTORY="$TEST_DIRECTORY/calls"
mkdir -p "$FAKE_BIN" "$CALL_DIRECTORY"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

cat >"$FAKE_BIN/pgroll" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

command_name=$1
shift
printf '%s %s\n' "$command_name" "$*" >>"$FAKE_CALL_DIRECTORY/pgroll"

case "$command_name" in
    init)
        exit "${FAKE_PGROLL_INIT_EXIT:-0}"
        ;;
    status)
        count_file="$FAKE_CALL_DIRECTORY/status-count"
        count=0
        if [[ -f "$count_file" ]]; then
            count=$(<"$count_file")
        fi
        count=$((count + 1))
        printf '%s\n' "$count" >"$count_file"
        if [[ "$count" -gt 1 ]]; then
            exit "${FAKE_PGROLL_FINAL_STATUS_EXIT:-0}"
        fi
        if [[ "${FAKE_PGROLL_STATUS_EXIT:-0}" -ne 0 ]]; then
            exit "$FAKE_PGROLL_STATUS_EXIT"
        fi
        printf '{"status": "%s"}\n' "${FAKE_PGROLL_STATUS:-Complete}"
        ;;
    complete)
        exit "${FAKE_PGROLL_COMPLETE_EXIT:-0}"
        ;;
    migrate)
        exit "${FAKE_PGROLL_MIGRATE_EXIT:-0}"
        ;;
    *)
        echo "unexpected pgroll command: $command_name" >&2
        exit 99
        ;;
esac
EOF

cat >"$FAKE_BIN/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$FAKE_CALL_DIRECTORY/psql"
exit "${FAKE_PSQL_EXIT:-0}"
EOF

chmod +x "$FAKE_BIN/pgroll" "$FAKE_BIN/psql"

run_runner() {
    rm -f "$CALL_DIRECTORY/pgroll" "$CALL_DIRECTORY/psql" \
        "$CALL_DIRECTORY/status-count"
    env \
        PATH="$FAKE_BIN:$PATH" \
        FAKE_CALL_DIRECTORY="$CALL_DIRECTORY" \
        OSMO_POSTGRES_PASSWORD=test-password \
        PGSSLMODE=disable \
        "$@" \
        bash "$RUNNER" public
}

expect_failure() {
    local description=$1
    shift
    if run_runner "$@" >"$TEST_DIRECTORY/failure-output" 2>&1; then
        fail "$description unexpectedly succeeded"
    fi
}

run_runner >"$TEST_DIRECTORY/success-output"
grep -Fq 'sslmode=disable' "$CALL_DIRECTORY/pgroll" || \
    fail "runner did not propagate sslmode=disable"
if grep -Fq 'sslrootcert=' "$CALL_DIRECTORY/pgroll"; then
    fail "runner added sslrootcert without PGSSLROOTCERT"
fi
grep -Fq 'migrate ' "$CALL_DIRECTORY/pgroll" || \
    fail "runner did not use pgroll migrate"
if grep -Fq 'complete ' "$CALL_DIRECTORY/pgroll"; then
    fail "runner completed a migration that was not in progress"
fi

run_runner \
    PGSSLMODE=verify-full \
    'PGSSLROOTCERT=/etc/osmo/ca/postgresql/root ca.crt' \
    >"$TEST_DIRECTORY/tls-output"
grep -Fq 'sslmode=verify-full' "$CALL_DIRECTORY/pgroll" || \
    fail "runner did not propagate sslmode=verify-full"
grep -Fq 'sslrootcert=%2Fetc%2Fosmo%2Fca%2Fpostgresql%2Froot%20ca.crt' \
    "$CALL_DIRECTORY/pgroll" || fail "runner did not encode PGSSLROOTCERT"

run_runner 'FAKE_PGROLL_STATUS=In progress' \
    >"$TEST_DIRECTORY/in-progress-output"
grep -Fq 'complete ' "$CALL_DIRECTORY/pgroll" || \
    fail "runner did not complete an in-progress migration"

run_runner 'FAKE_PGROLL_STATUS=No migrations' \
    >"$TEST_DIRECTORY/baseline-output"
grep -Fq 'INSERT INTO pgroll.migrations' "$CALL_DIRECTORY/psql" || \
    fail "runner did not create the OSMO 6.3 baseline"

expect_failure "pgroll init failure" FAKE_PGROLL_INIT_EXIT=21
expect_failure "pgroll status failure" FAKE_PGROLL_STATUS_EXIT=22
expect_failure "pgroll complete failure" \
    'FAKE_PGROLL_STATUS=In progress' FAKE_PGROLL_COMPLETE_EXIT=23
expect_failure "pgroll migrate failure" FAKE_PGROLL_MIGRATE_EXIT=24
expect_failure "final pgroll status failure" FAKE_PGROLL_FINAL_STATUS_EXIT=25
expect_failure "baseline psql failure" \
    'FAKE_PGROLL_STATUS=No migrations' FAKE_PSQL_EXIT=26

echo "PASS: OSMO database migration runner tests"
