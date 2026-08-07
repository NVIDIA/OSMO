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

    [[ -n "$remote_command" ]]
    [[ -f "$remote_script_file" ]]
    [[ "$remote_command" != *"$known_token"* ]]
    [[ "$remote_command" != *"jsonpath"* ]]
    if grep -q 'OSMO_BACKEND_TOKEN_FOUND' "$remote_script_file"; then
        return 1
    fi

    printf 'untrusted Azure log containing %s\n' "$known_token"
    if [[ "$az_result" == "ready" ]]; then
        printf 'OSMO_BACKEND_TOKEN_READY\n'
    fi
}

output=$(create_backend_token_secrets 2>&1)
[[ "$output" != *"$known_token"* ]]
[[ "$output" == *"Backend bootstrap credential is ready"* ]]

az_result="missing-marker"
if output=$(create_backend_token_secrets 2>&1); then
    echo "Expected missing Azure status marker to fail" >&2
    exit 1
fi
[[ "$output" != *"$known_token"* ]]
[[ "$output" == *"Unable to reconcile backend token Secrets"* ]]
