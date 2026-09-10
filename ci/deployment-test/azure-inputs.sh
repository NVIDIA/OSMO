#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Source from CI only. The public single-plane script remains the provisioning owner.
ci_azure_inputs() {
    : "${ARM_SUBSCRIPTION_ID:?Azure subscription is required}"
    : "${AZURE_RESOURCE_GROUP:?A dedicated, existing resource group is required}"
    export TF_INPUT=0
    export TF_SUBSCRIPTION_ID="$ARM_SUBSCRIPTION_ID"
    export TF_RESOURCE_GROUP="$AZURE_RESOURCE_GROUP"
    export TF_CLUSTER_NAME="${AZURE_CLUSTER_NAME:-osmo-deployment-test}"
    export TF_NODE_INSTANCE_TYPE=Standard_D8s_v3
    export TF_VAR_azure_region="${AZURE_REGION:-eastus2}"
    export TF_VAR_node_group_min_size=3
    export TF_VAR_redis_high_availability_enabled=false
    export TF_VAR_redis_sku_name=MemoryOptimized_M10
    export TF_VAR_redis_location=westus3
}

ci_azure_save_inputs() {
    local directory="$1"
    mkdir -p "$directory"
    cp "$(dirname "${BASH_SOURCE[0]}")/../../deployments/scripts/azure/single-plane.tfvars" \
        "$directory/single-plane.tfvars"
    jq -n --arg subscription "$TF_SUBSCRIPTION_ID" --arg group "$TF_RESOURCE_GROUP" \
        --arg cluster "$TF_CLUSTER_NAME" --arg region "$TF_VAR_azure_region" \
        --arg node "$TF_NODE_INSTANCE_TYPE" --arg sku "$TF_VAR_redis_sku_name" \
        --arg redis_region "$TF_VAR_redis_location" \
        --argjson nodes "$TF_VAR_node_group_min_size" \
        --argjson redis_ha "$TF_VAR_redis_high_availability_enabled" \
        '{subscription_id:$subscription, resource_group_name:$group, cluster_name:$cluster,
          azure_region:$region, node_instance_type:$node, node_group_min_size:$nodes,
          redis_high_availability_enabled:$redis_ha, redis_sku_name:$sku,
          redis_location:$redis_region}' > "$directory/ci.tfvars.json"
}

ci_azure_check_group() {
    local region
    region=$(az group show --subscription "$TF_SUBSCRIPTION_ID" \
        --name "$TF_RESOURCE_GROUP" --query location --output tsv) || return
    [[ "$region" == "$TF_VAR_azure_region" ]] || {
        echo "Resource group location does not match AZURE_REGION" >&2
        return 1
    }
}

# This document is uploaded successfully BEFORE pre-clean or provisioning.
ci_azure_write_marker() {
    jq -n --arg run "${GITHUB_RUN_ID:?}" --arg attempt "${GITHUB_RUN_ATTEMPT:?}" \
        --arg sha "${GITHUB_SHA:?}" --arg subscription "$TF_SUBSCRIPTION_ID" \
        --arg group "$TF_RESOURCE_GROUP" --arg cluster "$TF_CLUSTER_NAME" \
        '{run:$run, attempt:$attempt, sha:$sha, subscription:$subscription,
          resource_group:$group, cluster:$cluster}' > "$1"
}

ci_azure_check_marker() {
    jq -e --arg run "${GITHUB_RUN_ID:?}" --arg attempt "${PRODUCER_ATTEMPT:?}" \
        --arg sha "${GITHUB_SHA:?}" --arg subscription "$TF_SUBSCRIPTION_ID" \
        --arg group "$TF_RESOURCE_GROUP" --arg cluster "$TF_CLUSTER_NAME" \
        '. == {run:$run, attempt:$attempt, sha:$sha, subscription:$subscription,
               resource_group:$group, cluster:$cluster}' "$1" >/dev/null
}
