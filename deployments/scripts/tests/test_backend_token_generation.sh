#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck source=/dev/null
source "${TEST_SRCDIR}/_main/deployments/scripts/deploy-k8s.sh"

export PROVIDER="aws"
export IS_PRIVATE_CLUSTER="false"
export BACKEND_TOKEN_SECRET_NAME="test-backend-token"
export OSMO_NAMESPACE="test-control"
export OSMO_OPERATOR_NAMESPACE="test-operator"

assert_contains() {
    local description="$1"
    local value="$2"
    local expected="$3"
    if [[ "$value" != *"$expected"* ]]; then
        echo "assertion failed: $description" >&2
        exit 1
    fi
}

assert_file_count() {
    local description="$1"
    local pattern="$2"
    local expected_count="$3"
    local file="$4"
    local observed_count
    observed_count=$(grep -c -- "$pattern" "$file" || true)
    if [[ "$observed_count" -ne "$expected_count" ]]; then
        echo "assertion failed: $description (expected $expected_count, got $observed_count)" >&2
        exit 1
    fi
}

get_backend_token_data() {
    return 1
}

run_generation_failure_case() (
    local generation_mode="$1"
    # Invoked indirectly by create_backend_token_secrets.
    # shellcheck disable=SC2329
    openssl() {
        [[ "$generation_mode" == "empty" ]]
    }

    if output=$(create_backend_token_secrets 2>&1); then
        echo "Expected backend token generation failure for mode $generation_mode" >&2
        exit 1
    fi
    assert_contains "generation mode $generation_mode reports failure" "$output" \
        'Failed to generate the backend bootstrap credential'
)

run_generation_failure_case "command-failure"
run_generation_failure_case "empty"

run_both_missing_case() (
    local apply_log
    apply_log=$(mktemp)
    trap 'rm -f "$apply_log"' EXIT
    get_backend_token_data() {
        return 1
    }
    openssl() {
        printf 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\n'
    }
    capture_manifest() {
        printf '%s\n---\n' "$1" >> "$apply_log"
    }
    RUN_KUBECTL_APPLY_STDIN=capture_manifest

    output=$(create_backend_token_secrets 2>&1)

    assert_contains 'both-missing case reports creation' "$output" \
        'Created test-backend-token in test-control and test-operator'
    assert_file_count 'both-missing case creates two Secrets' '^kind: Secret$' 2 "$apply_log"
)

run_one_missing_case() (
    local apply_log
    apply_log=$(mktemp)
    trap 'rm -f "$apply_log"' EXIT
    get_backend_token_data() {
        if [[ "$1" == "$OSMO_NAMESPACE" ]]; then
            printf 'c2hhcmVkLXRva2Vu'
            return
        fi
        return 1
    }
    capture_manifest() {
        printf '%s\n' "$1" >> "$apply_log"
    }
    RUN_KUBECTL_APPLY_STDIN=capture_manifest

    output=$(create_backend_token_secrets 2>&1)

    assert_contains 'one-missing case reports the copied Secret' "$output" \
        'Copied test-backend-token to test-operator'
    if [[ "$output" == *'already exists — preserving'* ]]; then
        echo 'assertion failed: copy case incorrectly reported no-op preservation' >&2
        exit 1
    fi
    assert_file_count 'one-missing case creates one Secret' '^kind: Secret$' 1 "$apply_log"
)

run_mismatch_case() (
    get_backend_token_data() {
        if [[ "$1" == "$OSMO_NAMESPACE" ]]; then
            printf 'Y29udHJvbC10b2tlbg=='
        else
            printf 'b3BlcmF0b3ItdG9rZW4='
        fi
    }

    if output=$(create_backend_token_secrets 2>&1); then
        echo 'assertion failed: mismatched backend tokens were accepted' >&2
        exit 1
    fi
    assert_contains 'mismatch case explains the failure' "$output" \
        'Backend token Secrets differ between control and operator namespaces'
)

run_both_existing_case() (
    get_backend_token_data() {
        printf 'c2hhcmVkLXRva2Vu'
    }

    output=$(create_backend_token_secrets 2>&1)

    assert_contains 'matching existing tokens are preserved' "$output" \
        'Backend bootstrap credential already exists — preserving'
)

run_both_missing_case
run_one_missing_case
run_mismatch_case
run_both_existing_case
