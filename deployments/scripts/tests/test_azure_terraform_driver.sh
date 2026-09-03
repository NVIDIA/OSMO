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
    if [[ "$*" == *output\ -raw* ]]; then
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
            workload_identity_storage_account) echo teststorage ;;
            workload_identity_storage_account_id) echo /subscriptions/test/storageAccounts/teststorage ;;
            workload_identity_storage_container_name) echo osmo-workflows ;;
            blob_workload_identity_client_id) echo test-client-id ;;
            *) return 1 ;;
        esac
    fi
}

mkdir -p "$test_directory/terraform"
azure_terraform_apply "$test_directory/terraform"
[[ "$(sed -n '1p' "$command_log")" == "apply -auto-approve" ]] || {
    echo "default apply command changed" >&2
    exit 1
}

azure_terraform_apply "$test_directory/terraform" false -var-file=single-plane.tfvars
[[ "$(sed -n '2p' "$command_log")" == "apply -auto-approve -var-file=single-plane.tfvars" ]] || {
    echo "apply arguments were not forwarded" >&2
    exit 1
}

azure_terraform_apply "$test_directory/terraform" true -var-file=single-plane.tfvars
[[ "$(sed -n '3p' "$command_log")" == "plan -var-file=single-plane.tfvars" ]] || {
    echo "dry-run arguments were not forwarded" >&2
    exit 1
}

: >"$command_log"
legacy_outputs="$test_directory/legacy.env"
IS_PRIVATE_CLUSTER=false azure_get_terraform_outputs "$test_directory/terraform" "$legacy_outputs"
grep -Fq 'export PROVIDER="azure"' "$legacy_outputs"
grep -Fq 'export REDIS_PASSWORD="redis-secret"' "$legacy_outputs"
if grep -Fq 'export POSTGRES_PASSWORD=' "$legacy_outputs"; then exit 1; fi
if grep -Fq 'workload_identity_' "$command_log"; then exit 1; fi
if grep -Fq 'postgres_password' "$command_log"; then exit 1; fi

: >"$command_log"
[[ "$(azure_get_terraform_output "$test_directory/terraform" postgres_password)" == "postgres-secret" ]]
[[ "$(azure_get_terraform_output "$test_directory/terraform" workload_identity_storage_account)" == "teststorage" ]]
[[ "$(azure_get_terraform_output "$test_directory/terraform" workload_identity_storage_account_id)" == \
    "/subscriptions/test/storageAccounts/teststorage" ]]
[[ "$(azure_get_terraform_output "$test_directory/terraform" workload_identity_storage_container_name)" == \
    "osmo-workflows" ]]
[[ "$(azure_get_terraform_output "$test_directory/terraform" blob_workload_identity_client_id)" == \
    "test-client-id" ]]
grep -Fq -- "-chdir=$test_directory/terraform output -raw postgres_password" "$command_log"
