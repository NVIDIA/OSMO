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
    [[ "$output" == *"Failed to generate the backend bootstrap credential"* ]]
)

run_generation_failure_case "command-failure"
run_generation_failure_case "empty"
