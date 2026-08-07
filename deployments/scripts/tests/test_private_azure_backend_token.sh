#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck source=/dev/null
source "${TEST_SRCDIR}/_main/deployments/scripts/deploy-k8s.sh"

export PROVIDER="azure"
export IS_PRIVATE_CLUSTER="true"
export RESOURCE_GROUP_NAME="test-resource-group"
export AKS_CLUSTER_NAME="test-cluster"
export BACKEND_TOKEN_SECRET_NAME="test-backend-token"
export OSMO_NAMESPACE="test-control"
export OSMO_OPERATOR_NAMESPACE="test-operator"

known_token="c2Vuc2l0aXZlLWJhY2tlbmQtdG9rZW4"
az_result="ready"

assert() {
    local description="$1"
    shift
    if ! "$@"; then
        echo "assertion failed: $description" >&2
        return 1
    fi
}

does_not_contain() {
    [[ "$1" != *"$2"* ]]
}

file_does_not_contain() {
    ! grep -q "$2" "$1"
}

az() {
    local remote_command=""
    local remote_script_file=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --command)
                remote_command="$2"
                shift 2
                ;;
            --file)
                remote_script_file="$2"
                shift 2
                ;;
            *)
                shift
                ;;
        esac
    done

    assert 'remote command is present' test -n "$remote_command" || return 1
    assert 'remote script file exists' test -f "$remote_script_file" || return 1
    assert 'remote command does not contain token material' \
        does_not_contain "$remote_command" "$known_token" || return 1
    assert 'remote command does not read token data' \
        does_not_contain "$remote_command" jsonpath || return 1
    assert 'remote script does not emit a token-found marker' \
        file_does_not_contain "$remote_script_file" OSMO_BACKEND_TOKEN_FOUND || return 1

    printf 'untrusted Azure log containing %s\n' "$known_token"
    if [[ "$az_result" == "ready" ]]; then
        printf 'OSMO_BACKEND_TOKEN_READY\n'
    fi
}

output=$(create_backend_token_secrets 2>&1)
assert 'deployment output does not contain token material' \
    does_not_contain "$output" "$known_token"
assert 'deployment reports the credential is ready' \
    grep -q 'Backend bootstrap credential is ready' <<<"$output"

az_result="missing-marker"
if output=$(create_backend_token_secrets 2>&1); then
    echo "Expected missing Azure status marker to fail" >&2
    exit 1
fi
assert 'failed deployment output does not contain token material' \
    does_not_contain "$output" "$known_token"
assert 'missing Azure marker reports reconciliation failure' \
    grep -q 'Unable to reconcile backend token Secrets' <<<"$output"
