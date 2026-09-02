#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# shellcheck disable=SC1091 # Bazel runfile paths are resolved at runtime.

set -euo pipefail

test_directory="$(mktemp -d)"
trap 'rm -rf "$test_directory"' EXIT
command_log="$test_directory/commands.log"

source "${TEST_SRCDIR}/_main/deployments/scripts/common.sh"
source "${TEST_SRCDIR}/_main/deployments/scripts/azure/terraform.sh"

terraform() {
    printf '%s\n' "$*" >>"$command_log"
    if [[ "$*" == output\ -raw* ]]; then
        case "${!#}" in
            resource_group_name) echo test-resource-group ;;
            aks_cluster_name) echo test-aks ;;
            postgres_server_fqdn) echo postgres.example.com ;;
            postgres_database_name) echo osmo ;;
            postgres_admin_username) echo postgres ;;
            redis_cache_hostname) echo redis.example.com ;;
            redis_cache_ssl_port) echo 10000 ;;
            redis_cache_primary_access_key) echo redis-secret ;;
            postgres_password) echo postgres-secret ;;
            single_plane_storage_account) echo teststorage ;;
            single_plane_storage_account_id) echo /subscriptions/test/storageAccounts/teststorage ;;
            single_plane_storage_container_name) echo osmo-workflows ;;
            single_plane_blob_identity_client_id) echo test-client-id ;;
            *) return 1 ;;
        esac
    fi
}

mkdir -p "$test_directory/terraform"
azure_terraform_apply "$test_directory/terraform" false
[[ "$(sed -n '1p' "$command_log")" == "apply -auto-approve" ]] || {
    echo "legacy apply command changed" >&2
    exit 1
}

azure_terraform_apply "$test_directory/terraform" true -var-file=single-plane.tfvars
[[ "$(sed -n '2p' "$command_log")" == "plan -var-file=single-plane.tfvars" ]] || {
    echo "dry-run arguments were not forwarded" >&2
    exit 1
}

: >"$command_log"
legacy_outputs="$test_directory/legacy.env"
IS_PRIVATE_CLUSTER=false azure_get_terraform_outputs "$test_directory/terraform" "$legacy_outputs"
grep -Fq 'export PROVIDER="azure"' "$legacy_outputs"
grep -Fq 'export REDIS_PASSWORD="redis-secret"' "$legacy_outputs"
if grep -Fq 'export POSTGRES_PASSWORD=' "$legacy_outputs"; then exit 1; fi
if grep -Fq 'single_plane_' "$command_log"; then exit 1; fi
if grep -Fq 'postgres_password' "$command_log"; then exit 1; fi

: >"$command_log"
single_plane_outputs="$test_directory/single-plane.env"
IS_PRIVATE_CLUSTER=false azure_get_terraform_outputs \
    "$test_directory/terraform" "$single_plane_outputs" single-plane
grep -Fq 'export POSTGRES_PASSWORD="postgres-secret"' "$single_plane_outputs"
grep -Fq 'export STORAGE_ACCOUNT="teststorage"' "$single_plane_outputs"
grep -Fq 'export STORAGE_ACCOUNT_ID="/subscriptions/test/storageAccounts/teststorage"' "$single_plane_outputs"
grep -Fq 'export STORAGE_CONTAINER="osmo-workflows"' "$single_plane_outputs"
grep -Fq 'export WORKLOAD_IDENTITY_CLIENT_ID="test-client-id"' "$single_plane_outputs"

if azure_get_terraform_outputs "$test_directory/terraform" "$test_directory/invalid.env" invalid; then
    echo "invalid output mode unexpectedly succeeded" >&2
    exit 1
fi
