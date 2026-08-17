#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    BOOTSTRAP_SCRIPT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts/osmo/files/object-storage-bootstrap.sh"
else
    BOOTSTRAP_SCRIPT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/files/object-storage-bootstrap.sh
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT
FAKE_AWS_DIRECTORY="$TEST_DIRECTORY/bin"
FAKE_AWS_STATE="$TEST_DIRECTORY/state"
mkdir -p "$FAKE_AWS_DIRECTORY" "$FAKE_AWS_STATE" "$TEST_DIRECTORY/tmp"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

require_file_contains() {
    local file=$1
    local expected=$2
    grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

require_call_count() {
    local command=$1
    local expected=$2
    local actual
    actual=$(grep -Fc -- "$command" "$FAKE_AWS_STATE/calls" || true)
    [[ "$actual" -eq "$expected" ]] || \
        fail "expected $command $expected times, found $actual"
}

cat >"$FAKE_AWS_DIRECTORY/aws" <<'EOF'
#!/bin/sh
set -eu

printf '%s\n' "$*" >>"$FAKE_AWS_STATE/calls"
cp "$AWS_CONFIG_FILE" "$FAKE_AWS_STATE/aws-config"

if [ "$1" = "s3api" ] && [ "$2" = "list-buckets" ]; then
    attempt_file="$FAKE_AWS_STATE/readiness-attempts"
    attempts=0
    if [ -f "$attempt_file" ]; then
        attempts=$(cat "$attempt_file")
    fi
    attempts=$((attempts + 1))
    printf '%s\n' "$attempts" >"$attempt_file"
    if [ "$attempts" -le "${AWS_FAKE_READINESS_FAILURES:-0}" ]; then
        exit 1
    fi
    exit 0
fi

if [ "$1" = "s3api" ] && [ "$2" = "head-bucket" ]; then
    bucket=''
    shift 2
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "--bucket" ]; then
            bucket=$2
            break
        fi
        shift
    done
    grep -Fxq -- "$bucket" "$FAKE_AWS_STATE/buckets" && exit 0
    exit 1
fi

if [ "$1" = "s3api" ] && [ "$2" = "create-bucket" ]; then
    [ "${AWS_FAKE_CREATE_FAILURE:-false}" != true ] || exit 1
    bucket=''
    shift 2
    while [ "$#" -gt 0 ]; do
        if [ "$1" = "--bucket" ]; then
            bucket=$2
            break
        fi
        shift
    done
    printf '%s\n' "$bucket" >>"$FAKE_AWS_STATE/buckets"
    exit 0
fi

exit 2
EOF
chmod +x "$FAKE_AWS_DIRECTORY/aws"

run_bootstrap() {
    FAKE_AWS_STATE="$FAKE_AWS_STATE" \
        AWS_FAKE_READINESS_FAILURES="${1:-0}" \
        PATH="$FAKE_AWS_DIRECTORY:/usr/bin:/bin" \
        TMPDIR="$TEST_DIRECTORY/tmp" \
        AWS_ENDPOINT_URL=http://rustfs:9000 \
        AWS_ACCESS_KEY_ID=test-access-key \
        AWS_SECRET_ACCESS_KEY=test-secret-key \
        AWS_DEFAULT_REGION=us-east-1 \
        OSMO_WORKFLOW_BUCKET="${3:-existing-workflows}" \
        OSMO_LOG_BUCKET="${4:-missing-logs}" \
        OSMO_APP_BUCKET="${5:-missing-apps}" \
        OSMO_STORAGE_BOOTSTRAP_ATTEMPTS="${2:-3}" \
        "$BOOTSTRAP_SCRIPT"
}

printf '%s\n' existing-workflows >"$FAKE_AWS_STATE/buckets"
: >"$FAKE_AWS_STATE/calls"

if FAKE_AWS_STATE="$FAKE_AWS_STATE" PATH="$FAKE_AWS_DIRECTORY:/usr/bin:/bin" \
    AWS_ENDPOINT_URL=http://rustfs:9000 \
    AWS_ACCESS_KEY_ID=test-access-key \
    AWS_DEFAULT_REGION=us-east-1 \
    OSMO_WORKFLOW_BUCKET=existing-workflows \
    OSMO_LOG_BUCKET=missing-logs \
    OSMO_APP_BUCKET=missing-apps \
    "$BOOTSTRAP_SCRIPT" >/dev/null 2>&1; then
    fail "missing required environment must fail"
fi
[[ ! -s "$FAKE_AWS_STATE/calls" ]] || fail "missing environment called AWS"

run_bootstrap 2 3
require_call_count "s3api list-buckets" 3
require_file_contains "$FAKE_AWS_STATE/aws-config" "addressing_style = path"
require_call_count "s3api head-bucket --bucket existing-workflows" 1
require_call_count "s3api head-bucket --bucket missing-logs" 1
require_call_count "s3api head-bucket --bucket missing-apps" 1
require_call_count "s3api create-bucket --bucket missing-logs" 1
require_call_count "s3api create-bucket --bucket missing-apps" 1

: >"$FAKE_AWS_STATE/calls"
printf '%s\n' existing-workflows >"$FAKE_AWS_STATE/buckets"
run_bootstrap 0 3 existing-workflows shared-bucket shared-bucket
require_call_count "s3api head-bucket --bucket existing-workflows" 1
require_call_count "s3api head-bucket --bucket shared-bucket" 1
require_call_count "s3api create-bucket --bucket shared-bucket" 1

: >"$FAKE_AWS_STATE/calls"
printf '%s\n' existing-workflows >"$FAKE_AWS_STATE/buckets"
printf '%s\n' missing-logs >>"$FAKE_AWS_STATE/buckets"
printf '%s\n' missing-apps >>"$FAKE_AWS_STATE/buckets"
run_bootstrap 0 3
require_call_count "s3api head-bucket --bucket existing-workflows" 1
require_call_count "s3api head-bucket --bucket missing-logs" 1
require_call_count "s3api head-bucket --bucket missing-apps" 1
require_call_count "s3api create-bucket" 0

: >"$FAKE_AWS_STATE/calls"
rm -f "$FAKE_AWS_STATE/readiness-attempts"
if run_bootstrap 3 3 >/dev/null 2>&1; then
    fail "exhausted endpoint readiness must fail"
fi
require_call_count "s3api list-buckets" 3

: >"$FAKE_AWS_STATE/calls"
printf '%s\n' existing-workflows >"$FAKE_AWS_STATE/buckets"
if AWS_FAKE_CREATE_FAILURE=true run_bootstrap 0 3 >/dev/null 2>&1; then
    fail "failed bucket creation must fail"
fi
require_call_count "s3api create-bucket --bucket missing-logs" 1

echo "PASS: object storage bootstrap shell tests"
