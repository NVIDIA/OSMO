#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
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

###############################################################################
# Azure Terraform Provisioning Script for OSMO
#
# This script provisions Azure infrastructure using Terraform:
# - Virtual Network with subnets
# - Azure Kubernetes Service (AKS)
# - Azure Database for PostgreSQL Flexible Server
# - Azure Cache for Redis
# - Log Analytics Workspace
#
# Prerequisites:
# - Azure CLI installed and authenticated (az login)
# - Terraform >= 1.9
#
# Usage:
#   source azure/terraform.sh
#   azure_preflight_checks
#   azure_terraform_apply
#   azure_get_outputs
###############################################################################

# Get the directory where this script is located
AZURE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AZURE_TERRAFORM_DIR="${AZURE_TERRAFORM_DIR:-$AZURE_SCRIPT_DIR/../../terraform/azure/example}"

# Source common functions if not already loaded
if [[ -z "$BLUE" ]]; then
    source "$AZURE_SCRIPT_DIR/../common.sh"
fi

###############################################################################
# Azure-specific Configuration Defaults
###############################################################################

# These can be overridden by environment variables
TF_SUBSCRIPTION_ID="${TF_SUBSCRIPTION_ID:-}"
TF_RESOURCE_GROUP="${TF_RESOURCE_GROUP:-}"
TF_POSTGRES_PASSWORD="${TF_POSTGRES_PASSWORD:-}"
TF_CLUSTER_NAME="${TF_CLUSTER_NAME:-osmo-cluster}"
TF_REGION="${TF_REGION:-East US 2}"
TF_ENVIRONMENT="${TF_ENVIRONMENT:-dev}"
TF_PROJECT_NAME="${TF_PROJECT_NAME:-osmo}"
# Pin to AKS 1.33.x — the most recent minor with Ubuntu 22.04 + containerd 1.7.x
# defaults, validated against GPU Operator v25.10.1 and KAI Scheduler v0.14.0.
# AKS 1.34+ on Ubuntu 24.04 nodes ships containerd 2.x which the current
# NVIDIA toolchain in install-gpu-operator.sh has not been validated against.
# AKS 1.32 and older are LTS-only as of 2026-03-31 and cannot be used to
# create new standard-tier clusters.
TF_K8S_VERSION="${TF_K8S_VERSION:-1.33.11}"

# GPU node-pool inputs (used by azure_generate_tfvars to render
# gpu_node_pool_{min,max}_size + gpu_vm_size). Empty TF_GPU_COUNT +
# TF_GPU_NODE_POOL_ENABLED=false means
# CPU-only cluster. Populated by azure_configure_interactively when the user
# opts in via the GPU prompt.
TF_GPU_NODE_POOL_ENABLED="${TF_GPU_NODE_POOL_ENABLED:-false}"
TF_GPU_COUNT="${TF_GPU_COUNT:-0}"
TF_GPU_VM_SIZE="${TF_GPU_VM_SIZE:-Standard_NC40ads_H100_v5}"

# Candidate Azure regions to scan when the user answers "idk" to the region
# prompt. The first region with sufficient H100 quota for the requested GPU
# count wins. Override with TF_REGION_CANDIDATES="region1 region2 ...".
TF_REGION_CANDIDATES="${TF_REGION_CANDIDATES:-eastus2 swedencentral westus3 southcentralus westeurope}"

# Private cluster detection
IS_PRIVATE_CLUSTER=false

###############################################################################
# Azure Helper Functions
###############################################################################

# Run kubectl command - handles both public and private clusters
azure_run_kubectl() {
    local cmd="$*"

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        az aks command invoke \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --command "kubectl $cmd" \
            2>&1
    else
        kubectl $cmd
    fi
}

# Run kubectl with stdin input - for applying manifests
azure_run_kubectl_apply_stdin() {
    local manifest="$1"

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        local temp_dir=$(mktemp -d)
        local temp_file="$temp_dir/manifest.yaml"
        echo "$manifest" > "$temp_file"

        az aks command invoke \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --command "kubectl apply -f manifest.yaml" \
            --file "$temp_file" \
            2>&1

        rm -rf "$temp_dir"
    else
        echo "$manifest" | kubectl apply -f -
    fi
}

# Run helm command - handles both public and private clusters
azure_run_helm() {
    local cmd="$*"

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        az aks command invoke \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --command "helm $cmd" \
            2>&1
    else
        helm $cmd
    fi
}

# Run helm with values file
azure_run_helm_with_values() {
    local values_file="$1"
    shift
    local cmd="$*"

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        local temp_dir=$(mktemp -d)
        cp "$values_file" "$temp_dir/values.yaml"

        az aks command invoke \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --command "helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo && helm repo update && helm $cmd -f values.yaml" \
            --file "$temp_dir/values.yaml" \
            2>&1

        rm -rf "$temp_dir"
    else
        helm $cmd -f "$values_file"
    fi
}

# Check if cluster is private
azure_check_cluster_type() {
    log_info "Checking AKS cluster type..."

    local private_fqdn=$(az aks show \
        --resource-group "$RESOURCE_GROUP_NAME" \
        --name "$AKS_CLUSTER_NAME" \
        --query "privateFqdn" \
        -o tsv 2>/dev/null)

    if [[ -n "$private_fqdn" && "$private_fqdn" != "null" ]]; then
        IS_PRIVATE_CLUSTER=true
        log_info "Detected private AKS cluster - will use 'az aks command invoke'"
        log_warning "Commands will be executed via Azure API (may be slower)"
    else
        IS_PRIVATE_CLUSTER=false
        log_info "Detected public AKS cluster - will use direct kubectl/helm"
    fi
}

# Grant RBAC permissions for the current user
azure_grant_cluster_rbac() {
    log_info "Granting cluster admin permissions..."

    local user_id=$(az ad signed-in-user show --query id -o tsv 2>/dev/null)

    if [[ -z "$user_id" ]]; then
        log_warning "Could not get current user ID. Trying with service principal..."
        user_id=$(az account show --query "user.name" -o tsv 2>/dev/null)
    fi

    local aks_id=$(az aks show \
        --resource-group "$RESOURCE_GROUP_NAME" \
        --name "$AKS_CLUSTER_NAME" \
        --query id -o tsv)

    log_info "Assigning 'Azure Kubernetes Service Cluster Admin' role..."
    az role assignment create \
        --assignee "$user_id" \
        --role "Azure Kubernetes Service Cluster Admin" \
        --scope "$aks_id" \
        2>/dev/null || log_info "Role may already be assigned or assignment in progress"

    log_info "Assigning 'Azure Kubernetes Service RBAC Cluster Admin' role..."
    az role assignment create \
        --assignee "$user_id" \
        --role "Azure Kubernetes Service RBAC Cluster Admin" \
        --scope "$aks_id" \
        2>/dev/null || log_info "Role may already be assigned or assignment in progress"

    log_info "Waiting for role assignments to propagate (30 seconds)..."
    sleep 30

    log_success "RBAC permissions granted"
}

###############################################################################
# Azure Configuration Functions
###############################################################################

azure_list_resource_groups() {
    local subscription="${1:-}"
    if [[ -n "$subscription" ]]; then
        az group list --subscription "$subscription" --query "[].name" -o tsv 2>/dev/null || echo ""
    else
        az group list --query "[].name" -o tsv 2>/dev/null || echo ""
    fi
}

azure_get_current_subscription() {
    az account show --query "id" -o tsv 2>/dev/null || echo ""
}

azure_get_current_subscription_name() {
    az account show --query "name" -o tsv 2>/dev/null || echo ""
}

# Describe an Azure VM SKU. Echoes a single tab-separated line "<family>\t<vcpus>"
# so a single `az` call can serve both the quota filter and the vCPU-per-node
# sizing. Object projection (vs. array) keeps the output on one line under
# `-o tsv` — array form renders each element on its own line which would
# break the caller's `read family vcpus`. Empty fields on no-match — callers
# treat missing data as "0 available".
# Args: gpu_vm_size
azure_describe_vm_sku() {
    local sku="$1"
    az vm list-skus --size "$sku" --resource-type virtualMachines -o tsv \
        --query "[0].{f:family, v:capabilities[?name=='vCPUs'].value | [0]}" 2>/dev/null \
        | head -1
}

# Zones available for a SKU in a region as JSON array (e.g. `["1","3"]`).
# Args: region sku
_azure_sku_zones_json() {
    local region="$1" sku="$2"
    az vm list-skus -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
        --query "[?name=='$sku'].locationInfo[0].zones | [0]" -o json 2>/dev/null
}

# TF list literal of zones common to all active pools (both pools share
# var.availability_zones in TF). Falls back to `["1", "2"]` on az failure;
# returns `[]` only when both pools' zones are known but disjoint.
# Args: region node_sku gpu_enabled gpu_sku
_azure_resolve_pool_zones() {
    local region="$1" node_sku="$2" gpu_enabled="$3" gpu_sku="$4"
    local node_zones gpu_zones zones
    node_zones=$(_azure_sku_zones_json "$region" "$node_sku")
    if [[ -z "$node_zones" || "$node_zones" == "null" || "$node_zones" == "[]" ]]; then
        echo '["1", "2"]'
        return 0
    fi
    if [[ "$gpu_enabled" == "true" ]]; then
        gpu_zones=$(_azure_sku_zones_json "$region" "$gpu_sku")
        if [[ -n "$gpu_zones" && "$gpu_zones" != "null" && "$gpu_zones" != "[]" ]]; then
            zones=$(jq -nc --argjson a "$node_zones" --argjson b "$gpu_zones" \
                '[$a[] | select(IN($b[]))] | sort' 2>/dev/null)
        else
            zones=$(echo "$node_zones" | jq -c 'sort' 2>/dev/null)
        fi
    else
        zones=$(echo "$node_zones" | jq -c 'sort' 2>/dev/null)
    fi
    if [[ -z "$zones" || "$zones" == "[]" ]]; then
        echo '[]'
        return 0
    fi
    echo "$zones" | jq -r 'map("\"" + . + "\"") | "[" + join(", ") + "]"'
}

# Iterate through TF_REGION_CANDIDATES looking for the first region whose
# remaining quota for the GPU SKU's family >= (count × vCPUs-per-node).
# Echoes the chosen region (empty if none qualifies).
# Args: gpu_vm_size gpu_count subscription_id
azure_find_region_with_gpu_quota() {
    local sku="$1" count="$2" sub="$3"
    if ! [[ "$count" =~ ^[1-9][0-9]*$ ]]; then return 0; fi
    local family vcpus_per_node
    read -r family vcpus_per_node <<<"$(azure_describe_vm_sku "$sku")"
    if [[ -z "$family" || -z "$vcpus_per_node" ]]; then
        log_warning "  az vm list-skus returned no family/vCPU data for '$sku' — auto-search cannot continue."
        return 0
    fi
    local need=$(( count * vcpus_per_node ))
    log_info "  Auto-search: looking for region with $need vCPU free in family '$family' (sku=$sku, $vcpus_per_node vCPU/node)"
    local region
    for region in $TF_REGION_CANDIDATES; do
        local used limit free
        # Object projection keeps used+limit on one tab-separated line under
        # `-o tsv`. Array form (`[0].[currentValue,limit]`) renders each
        # element on its own line which breaks `read -r used limit`.
        read -r used limit <<<"$(az vm list-usage -l "$region" --subscription "$sub" -o tsv \
                    --query "[?contains(name.value, '$family')] | [0].{u:currentValue, l:limit}" 2>/dev/null)"
        if [[ -z "$used" || -z "$limit" ]]; then continue; fi
        free=$(( limit - used ))
        log_info "    $region: used=$used limit=$limit free=$free vCPU"
        if [[ "$free" -ge "$need" ]]; then
            echo "$region"
            return 0
        fi
    done
    return 0
}

azure_configure_interactively() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║        Azure Infrastructure - Interactive Configuration          ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Subscription ID
    if [[ -z "$TF_SUBSCRIPTION_ID" ]]; then
        local current_sub=$(azure_get_current_subscription)
        local current_sub_name=$(azure_get_current_subscription_name)

        echo -e "${CYAN}Step 1: Azure Subscription${NC}"
        echo "─────────────────────────────"
        if [[ -n "$current_sub" ]]; then
            echo -e "  Detected subscription: ${GREEN}$current_sub_name${NC}"
            echo -e "  Subscription ID:       ${GREEN}$current_sub${NC}"
            echo ""
            echo -e "  ${YELLOW}Press Enter to use this subscription, or enter a different ID.${NC}"
        fi
        echo ""
        TF_SUBSCRIPTION_ID=$(prompt_value "Azure Subscription ID" "$current_sub")
    fi

    if [[ -z "$TF_SUBSCRIPTION_ID" ]]; then
        log_error "Subscription ID is required."
        exit 1
    fi

    # Resource Group
    if [[ -z "$TF_RESOURCE_GROUP" ]]; then
        echo ""
        echo -e "${CYAN}Step 2: Resource Group${NC}"
        echo "─────────────────────────────"
        echo -en "  Fetching resource groups from Azure... "
        local rgs=$(azure_list_resource_groups "$TF_SUBSCRIPTION_ID")
        echo -e "${GREEN}done${NC}"

        if [[ -n "$rgs" ]]; then
            echo ""
            echo "  Available resource groups:"
            echo "  ┌──────────────────────────────────────"
            echo "$rgs" | head -20 | while read rg; do
                echo "  │  $rg"
            done
            local rg_count=$(echo "$rgs" | wc -l | tr -d ' ')
            if [[ "$rg_count" -gt 20 ]]; then
                echo "  │  ... and $((rg_count - 20)) more"
            fi
            echo "  └──────────────────────────────────────"
        fi
        echo ""
        TF_RESOURCE_GROUP=$(prompt_value "Resource Group Name")
    fi

    if [[ -z "$TF_RESOURCE_GROUP" ]]; then
        log_error "Resource Group is required."
        exit 1
    fi

    # Verify resource group exists
    if ! az group show --name "$TF_RESOURCE_GROUP" --subscription "$TF_SUBSCRIPTION_ID" &>/dev/null; then
        log_error "Resource group '$TF_RESOURCE_GROUP' does not exist."
        log_info "Create with: az group create --name $TF_RESOURCE_GROUP --location \"East US 2\""
        exit 1
    fi
    log_success "Resource group '$TF_RESOURCE_GROUP' verified"

    # PostgreSQL Password
    if [[ -z "$TF_POSTGRES_PASSWORD" ]]; then
        echo ""
        echo -e "${CYAN}Step 3: PostgreSQL Password${NC}"
        echo "─────────────────────────────"
        echo "  Password requirements:"
        echo "    • Minimum 8 characters"
        echo "    • At least one uppercase letter (A-Z)"
        echo "    • At least one lowercase letter (a-z)"
        echo "    • At least one digit (0-9)"
        echo ""

        while true; do
            TF_POSTGRES_PASSWORD=$(prompt_value "PostgreSQL Admin Password" "" "true")

            if [[ -z "$TF_POSTGRES_PASSWORD" ]]; then
                log_error "Password is required."
                continue
            fi

            if ! validate_password "$TF_POSTGRES_PASSWORD"; then
                log_error "Password does not meet requirements."
                continue
            fi

            local confirm_password=$(prompt_value "Confirm PostgreSQL Password" "" "true")
            if [[ "$TF_POSTGRES_PASSWORD" != "$confirm_password" ]]; then
                log_error "Passwords do not match."
                continue
            fi

            break
        done
    fi

    # Optional Configuration
    echo ""
    echo -e "${CYAN}Step 4: Optional Configuration${NC}"
    echo "─────────────────────────────────"
    echo -e "  ${YELLOW}Press Enter to accept defaults shown in green.${NC}"
    echo ""

    TF_CLUSTER_NAME=$(prompt_value "AKS Cluster Name" "$TF_CLUSTER_NAME")
    echo ""
    echo -e "  ${YELLOW}East US 2 is recommended.${NC}"
    TF_REGION=$(prompt_value "Azure Region" "$TF_REGION")
    echo ""
    TF_K8S_VERSION=$(prompt_value "Kubernetes Version" "$TF_K8S_VERSION")
    TF_ENVIRONMENT=$(prompt_value "Environment (dev/staging/prod)" "$TF_ENVIRONMENT")

    echo ""
    log_success "Configuration complete!"
    echo ""

    # Display summary
    echo -e "${BLUE}Configuration Summary:${NC}"
    echo "  Subscription ID:     $TF_SUBSCRIPTION_ID"
    echo "  Resource Group:      $TF_RESOURCE_GROUP"
    echo "  Cluster Name:        $TF_CLUSTER_NAME"
    echo "  Region:              $TF_REGION"
    echo "  Kubernetes Version:  $TF_K8S_VERSION"
    echo "  Environment:         $TF_ENVIRONMENT"
    if [[ "$TF_GPU_NODE_POOL_ENABLED" == "true" ]]; then
        echo "  GPU node pool:       $TF_GPU_COUNT x $TF_GPU_VM_SIZE"
    fi
    echo ""

    local confirm=$(prompt_value "Proceed with this configuration? (yes/no)" "yes")
    if [[ "$confirm" != "yes" && "$confirm" != "y" ]]; then
        log_info "Deployment cancelled."
        exit 0
    fi
}

azure_generate_tfvars() {
    local tfvars_file="$1"
    log_info "Generating terraform.tfvars..."

    # TF_AVAILABILITY_ZONES (comma-separated) overrides auto-detection.
    local resolved_zones
    if [[ -n "${TF_AVAILABILITY_ZONES:-}" ]]; then
        resolved_zones=$(echo "$TF_AVAILABILITY_ZONES" | tr ',' '\n' | \
            jq -Rcn '[inputs | select(length > 0) | gsub("^ +| +$"; "")] | map("\"" + . + "\"") | "[" + join(", ") + "]"' -r)
    else
        local sub_args=()
        [[ -n "${TF_SUBSCRIPTION_ID:-}" ]] && sub_args+=(--subscription "$TF_SUBSCRIPTION_ID")
        resolved_zones=$(_azure_resolve_pool_zones \
            "${TF_REGION:-eastus2}" \
            "${TF_NODE_INSTANCE_TYPE:-Standard_D2s_v3}" \
            "${TF_GPU_NODE_POOL_ENABLED:-false}" \
            "${TF_GPU_VM_SIZE:-Standard_NC40ads_H100_v5}")
    fi

    cat > "$tfvars_file" <<EOF
# Auto-generated by deploy-osmo-minimal.sh
# Generated on: $(date)

# General Configuration
subscription_id     = "$TF_SUBSCRIPTION_ID"
azure_region        = "$TF_REGION"
environment         = "$TF_ENVIRONMENT"
project_name        = "$TF_PROJECT_NAME"
owner               = "platform-team"
cluster_name        = "$TF_CLUSTER_NAME"
resource_group_name = "$TF_RESOURCE_GROUP"

# Virtual Network Configuration
vnet_cidr        = "10.0.0.0/16"
private_subnets  = ["10.0.1.0/24", "10.0.2.0/24"]
database_subnets = ["10.0.201.0/24", "10.0.202.0/24"]

# Availability Zones
availability_zones = $resolved_zones

# AKS Configuration
kubernetes_version                  = "$TF_K8S_VERSION"
node_instance_type                  = "Standard_D2s_v3"
node_group_min_size                 = 1
node_group_max_size                 = 5
node_group_desired_size             = 3
aks_private_cluster_enabled         = false
aks_public_network_access_enabled   = true
aks_admin_group_object_ids          = []
aks_msi_auth_for_monitoring_enabled = true
aks_service_cidr                    = "192.168.0.0/16"
aks_dns_service_ip                  = "192.168.0.10"

# PostgreSQL Configuration
postgres_version                       = "15"
postgres_sku_name                      = "GP_Standard_D2s_v3"
postgres_storage_mb                    = 32768
postgres_db_name                       = "osmo"
postgres_username                      = "postgres"
postgres_password                      = "$TF_POSTGRES_PASSWORD"
postgres_backup_retention_days         = 7
postgres_geo_redundant_backup_enabled  = false
postgres_extensions                    = ["hstore", "uuid-ossp", "pg_stat_statements"]

# Azure Managed Redis Configuration (OSMO requires Redis 7+).
# Default ComputeOptimized_X3 — empirically validated against eastus2 capacity
# on 2026-05-01: Balanced_B0/B1/B3 all returned AllocationFailed, while
# X3/M10/A250 allocated cleanly. X3 is small (3GB) + cheap (~200 USD/mo).
# Override TF_REDIS_SKU_NAME for different tiers.
redis_sku_name  = "${TF_REDIS_SKU_NAME:-ComputeOptimized_X3}"
redis_version   = "7"

# Log Analytics Configuration
log_analytics_sku            = "PerGB2018"
log_analytics_retention_days = 30

# Optional GPU node pool
# Triggered by --gpu-node-pool on deploy-osmo-minimal.sh, or by answering "yes"
# to the GPU prompt in azure_configure_interactively.
gpu_node_pool_enabled  = ${TF_GPU_NODE_POOL_ENABLED:-false}
gpu_vm_size            = "${TF_GPU_VM_SIZE:-Standard_NC40ads_H100_v5}"
gpu_node_pool_min_size = ${TF_GPU_COUNT:-0}
gpu_node_pool_max_size = ${TF_GPU_COUNT:-0}

# Optional Azure Blob Storage Account for workflow data
# Triggered by --storage-backend azure-blob on deploy-osmo-minimal.sh
# (the storage backend script reads storage_account/storage_account_key TF outputs)
storage_account_enabled = ${TF_STORAGE_ACCOUNT_ENABLED:-false}

# Optional NFS Premium FileStorage account for downstream RWX consumers (e.g.
# NIM Operator). osmo provisions just the SA + role assignments here; the
# StorageClass manifest + default-SC swap are owned by the consumer skill.
nfs_storage_account_enabled = ${TF_NFS_STORAGE_ACCOUNT_ENABLED:-false}
EOF

    log_success "terraform.tfvars generated successfully"
}

###############################################################################
# Main Azure Terraform Functions
###############################################################################

azure_preflight_checks() {
    log_info "Running Azure pre-flight checks..."

    check_command "az"
    check_command "terraform"

    # Check Azure CLI authentication
    if ! az account show &> /dev/null; then
        log_error "Azure CLI is not authenticated. Please run 'az login' first."
        exit 1
    fi

    # Resource group: TF uses a `data` block (assumes RG exists). Create here
    # if missing, with a marker tag so destroy can recognize what we created
    # vs. what was pre-existing. This unblocks the "create new RG" flow without
    # requiring TF restructuring.
    if [[ -n "${TF_RESOURCE_GROUP:-}" ]]; then
        if ! az group show -n "$TF_RESOURCE_GROUP" --subscription "$TF_SUBSCRIPTION_ID" &>/dev/null; then
            log_info "Resource group '$TF_RESOURCE_GROUP' does not exist — creating in '$TF_REGION'"
            az group create \
                --name "$TF_RESOURCE_GROUP" \
                --location "$TF_REGION" \
                --subscription "$TF_SUBSCRIPTION_ID" \
                --tags 'osmo-deploy-managed=true' \
                --output none
            log_success "Resource group created (tagged osmo-deploy-managed=true)"
        else
            log_info "Resource group '$TF_RESOURCE_GROUP' already exists — using as-is"
        fi
    fi

    log_success "Azure pre-flight checks passed"
}

# Compare requested vCPU count against (limit - used) for a Microsoft.Compute
# family. Returns 0 when OK or when quota data is unavailable; 1 when the
# request exceeds available. Reads `${sub_args[@]}` from caller scope.
# Args: region family need pool_label math_label
_azure_check_vcpu_quota() {
    local region="$1" family="$2" need="$3" pool_label="$4" math_label="$5"
    local row limit used available
    row=$(az vm list-usage -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
        --query "[?contains(name.value, '$family')] | [0].[limit, currentValue]" -o tsv 2>/dev/null)
    if [[ -z "$row" ]]; then
        log_warning "  vCPU quota: no usage row matching family '$family' in $region — skipping math."
        return 0
    fi
    read -r limit used <<<"$row"
    if [[ ! "$limit" =~ ^[0-9]+$ || ! "$used" =~ ^[0-9]+$ ]]; then
        log_warning "  vCPU quota: malformed row for '$family' (limit=$limit used=$used) — skipping math."
        return 0
    fi
    available=$(( limit - used ))
    if (( need > available )); then
        log_error "Insufficient vCPU quota for $pool_label in $region."
        log_error "  Need: $need vCPUs ($math_label)"
        log_error "  Available: $available vCPUs ($used used / $limit limit, family '$family')"
        log_error "  Request more via: Azure Portal → Subscriptions → Usage + quotas (filter to '$family Family vCPUs')"
        return 1
    fi
    log_info "  ✓ vCPU quota OK for $pool_label: need $need, available $available ($used/$limit used)"
    return 0
}

# Fail fast on SKU/region/quota mismatches that would otherwise only surface
# 15-25 min into `terraform apply`.
azure_preflight_sku_quota() {
    log_info "Pre-flight: SKU availability + vCPU quota..."

    local region
    region=$(echo "${TF_REGION:-eastus2}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')

    local k8s_version="${TF_K8S_VERSION:-1.33.11}"
    local postgres_sku="${TF_POSTGRES_SKU:-GP_Standard_D2s_v3}"
    local redis_sku="${TF_REDIS_SKU_NAME:-ComputeOptimized_X3}"
    local node_sku="${TF_NODE_INSTANCE_TYPE:-Standard_D2s_v3}"
    local node_max="${TF_NODE_GROUP_MAX_SIZE:-5}"
    local gpu_enabled="${TF_GPU_NODE_POOL_ENABLED:-false}"
    local gpu_sku="${TF_GPU_VM_SIZE:-Standard_NC40ads_H100_v5}"
    local gpu_max="${TF_GPU_COUNT:-0}"

    # Defense-in-depth before interpolating into JMESPath / az args.
    if [[ ! "$k8s_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        log_error "TF_K8S_VERSION='$k8s_version' is not in expected x.y.z format (e.g. 1.33.11)"
        exit 1
    fi

    local sub_args=()
    if [[ -n "${TF_SUBSCRIPTION_ID:-}" ]]; then
        sub_args+=(--subscription "$TF_SUBSCRIPTION_ID")
    fi

    # `values[].version` is principal-only ("1.33") in every region; full
    # patches ("1.33.11") live as keys under `patchVersions`. TF azurerm
    # requires a full x.y.z, so match against the flattened key list.
    if ! az aks get-versions -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
            --query "values[].patchVersions.keys(@) | []" -o tsv 2>/dev/null \
            | grep -Fqx "$k8s_version"; then
        log_error "AKS Kubernetes version $k8s_version is not in $region's supported patch list."
        log_error "  See: az aks get-versions -l $region --query 'values[].patchVersions.keys(@) | []' -o tsv"
        exit 1
    fi
    log_info "  ✓ AKS $k8s_version is GA in $region"

    # `TF_POSTGRES_SKU` carries the azurerm tier prefix (GP_/MO_/B_) which
    # maps to `supportedServerEditions[].name` upstream; the SKU under
    # `supportedServerSkus[].name` does not carry the prefix.
    local postgres_sku_name="${postgres_sku#GP_}"
    postgres_sku_name="${postgres_sku_name#MO_}"
    postgres_sku_name="${postgres_sku_name#B_}"
    # `grep -F`: SKU names contain `.` which would otherwise be a regex metachar.
    if ! az postgres flexible-server list-skus -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
            --query "[].supportedServerEditions[].supportedServerSkus[].name" -o tsv 2>/dev/null \
            | grep -Fqx "$postgres_sku_name"; then
        log_error "Postgres Flexible Server SKU '$postgres_sku' (resolves to '$postgres_sku_name') is not available in $region."
        log_error "  See: az postgres flexible-server list-skus -l $region \\"
        log_error "         --query '[].supportedServerEditions[].supportedServerSkus[].name' -o tsv"
        exit 1
    fi
    log_info "  ✓ Postgres SKU $postgres_sku available in $region"

    if ! az vm list-skus -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
            --query "[?name=='$node_sku'].name | [0]" -o tsv 2>/dev/null | grep -Fqx "$node_sku"; then
        log_error "AKS node-pool VM SKU '$node_sku' is not available in $region."
        log_error "  See: az vm list-skus -l $region --query \"[?name=='$node_sku']\" -o table"
        exit 1
    fi
    log_info "  ✓ Node-pool SKU $node_sku available in $region"

    # azure_describe_vm_sku returns Azure's authoritative `family` field so
    # the contains() filter in _azure_check_vcpu_quota matches name.value.
    local node_family node_vcpus
    read -r node_family node_vcpus <<<"$(azure_describe_vm_sku "$node_sku")"
    if [[ -n "$node_family" && "$node_vcpus" =~ ^[0-9]+$ && "$node_max" =~ ^[0-9]+$ ]]; then
        local node_need=$(( node_max * node_vcpus ))
        if ! _azure_check_vcpu_quota "$region" "$node_family" "$node_need" "AKS system pool" "$node_max × $node_sku ($node_vcpus vCPUs each)"; then
            exit 1
        fi
    else
        log_warning "  vCPU quota: couldn't read family/vCPU data for $node_sku — skipping quota math"
    fi

    if [[ "$gpu_enabled" == "true" ]]; then
        if ! az vm list-skus -l "$region" ${sub_args[@]+"${sub_args[@]}"} \
                --query "[?name=='$gpu_sku'].name | [0]" -o tsv 2>/dev/null | grep -Fqx "$gpu_sku"; then
            log_error "AKS GPU-pool VM SKU '$gpu_sku' is not available in $region."
            log_error "  See: az vm list-skus -l $region --query \"[?name=='$gpu_sku']\" -o table"
            exit 1
        fi
        log_info "  ✓ GPU-pool SKU $gpu_sku available in $region"

        local gpu_family gpu_vcpus
        read -r gpu_family gpu_vcpus <<<"$(azure_describe_vm_sku "$gpu_sku")"
        if [[ -n "$gpu_family" && "$gpu_vcpus" =~ ^[0-9]+$ && "$gpu_max" =~ ^[0-9]+$ && "$gpu_max" -gt 0 ]]; then
            local gpu_need=$(( gpu_max * gpu_vcpus ))
            if ! _azure_check_vcpu_quota "$region" "$gpu_family" "$gpu_need" "GPU pool" "$gpu_max × $gpu_sku ($gpu_vcpus vCPUs each)"; then
                exit 1
            fi
        elif [[ "$gpu_max" -eq 0 ]]; then
            log_info "  GPU pool: gpu_max=0 — skipping quota math"
        else
            log_warning "  vCPU quota: couldn't read family/vCPU data for $gpu_sku — skipping quota math"
        fi
    fi

    # Informational usage table. Skip when no family resolved so we don't
    # emit `contains(name.value, '')` which would match every row.
    local family_filter=""
    if [[ -n "$node_family" ]]; then
        family_filter="contains(name.value, '$node_family')"
    fi
    if [[ "$gpu_enabled" == "true" && -n "${gpu_family:-}" ]]; then
        if [[ -n "$family_filter" ]]; then
            family_filter="$family_filter || contains(name.value, '$gpu_family')"
        else
            family_filter="contains(name.value, '$gpu_family')"
        fi
    fi
    if [[ -n "$family_filter" ]]; then
        log_info "  vCPU usage in $region (informational):"
        az vm list-usage -l "$region" ${sub_args[@]+"${sub_args[@]}"} -o table \
            --query "[?$family_filter].{name:name.localizedValue, used:currentValue, limit:limit}" \
            2>/dev/null || log_warning "    (vm list-usage failed — check quota manually if apply errors)"
    fi

    # Empty intersection = TF apply will fail with AvailabilityZoneNotSupported.
    local resolved_zones
    resolved_zones=$(_azure_resolve_pool_zones "$region" "$node_sku" "$gpu_enabled" "$gpu_sku")
    if [[ "$resolved_zones" == "[]" ]]; then
        log_error "No availability zone supports both node SKU '$node_sku' and GPU SKU '$gpu_sku' in $region."
        log_error "  Node SKU zones: $(_azure_sku_zones_json "$region" "$node_sku")"
        log_error "  GPU SKU zones:  $(_azure_sku_zones_json "$region" "$gpu_sku")"
        log_error "  Pick a region where the two zone sets overlap, or split into two pools manually."
        exit 1
    fi
    log_info "  ✓ Availability zones: $resolved_zones"

    # No `az redis-managed list-skus` per region today; warn on the
    # AllocationFailed-prone tiers (see variables.tf for the empirical note).
    case "$redis_sku" in
        Balanced_B0|Balanced_B1|Balanced_B3)
            log_warning "  redis_sku_name='$redis_sku' has hit AllocationFailed in capacity-constrained regions."
            log_warning "  Consider ComputeOptimized_X3 (variables.tf empirically validated default)."
            ;;
        *)
            log_info "  Managed Redis SKU: $redis_sku"
            ;;
    esac

    log_success "Pre-flight SKU + quota checks passed"
}

azure_terraform_init() {
    local terraform_dir="$1"
    log_info "Initializing Terraform..."
    cd "$terraform_dir"
    terraform init
    log_success "Terraform initialized"
}

azure_terraform_apply() {
    local terraform_dir="$1"
    local dry_run="${2:-false}"

    log_info "Applying Terraform configuration..."
    cd "$terraform_dir"

    if [[ "$dry_run" == true ]]; then
        log_info "[DRY-RUN] Would run: terraform plan"
        terraform plan
        return
    fi

    terraform apply -auto-approve
    log_success "Terraform apply completed"
}

azure_terraform_destroy() {
    local terraform_dir="$1"
    local dry_run="${2:-false}"

    log_info "Destroying Terraform resources..."
    cd "$terraform_dir"

    if [[ "$dry_run" == true ]]; then
        log_info "[DRY-RUN] Would run: terraform destroy"
        return
    fi

    terraform destroy -auto-approve
    log_success "Terraform resources destroyed"

    # Resource group cleanup: TF uses a `data` block so it doesn't own the RG.
    # Delete it here if azure_preflight_checks created it (marked with tag
    # `osmo-deploy-managed=true`). Pre-existing RGs are left intact.
    if [[ -n "${TF_RESOURCE_GROUP:-}" ]] && az group show -n "$TF_RESOURCE_GROUP" --subscription "$TF_SUBSCRIPTION_ID" &>/dev/null; then
        local managed_tag
        managed_tag=$(az group show -n "$TF_RESOURCE_GROUP" --subscription "$TF_SUBSCRIPTION_ID" --query "tags.\"osmo-deploy-managed\"" -o tsv 2>/dev/null)
        if [[ "$managed_tag" == "true" ]]; then
            log_info "Resource group '$TF_RESOURCE_GROUP' was created by deploy (tag osmo-deploy-managed=true) — deleting"
            az group delete --name "$TF_RESOURCE_GROUP" --subscription "$TF_SUBSCRIPTION_ID" --yes --no-wait
            log_success "Resource group deletion initiated (running in background)"
        else
            log_info "Resource group '$TF_RESOURCE_GROUP' is not deploy-managed — preserving"
        fi
    fi
}

azure_get_terraform_outputs() {
    local terraform_dir="$1"
    local outputs_file="$2"

    log_info "Retrieving Terraform outputs..."
    cd "$terraform_dir"

    # Export outputs to file for other scripts to use
    cat > "$outputs_file" <<EOF
# Azure Terraform Outputs - Auto-generated
export PROVIDER="azure"
export RESOURCE_GROUP_NAME="$(terraform output -raw resource_group_name)"
export AKS_CLUSTER_NAME="$(terraform output -raw aks_cluster_name)"
export POSTGRES_HOST="$(terraform output -raw postgres_server_fqdn)"
export POSTGRES_DB_NAME="$(terraform output -raw postgres_database_name)"
export POSTGRES_USERNAME="$(terraform output -raw postgres_admin_username)"
export REDIS_HOST="$(terraform output -raw redis_cache_hostname)"
export REDIS_PORT="$(terraform output -raw redis_cache_ssl_port)"
export REDIS_PASSWORD="$(terraform output -raw redis_cache_primary_access_key)"
export IS_PRIVATE_CLUSTER="$IS_PRIVATE_CLUSTER"
EOF

    # Also export to current shell
    source "$outputs_file"

    log_success "Terraform outputs retrieved"
    log_info "  Resource Group: $RESOURCE_GROUP_NAME"
    log_info "  AKS Cluster: $AKS_CLUSTER_NAME"
    log_info "  PostgreSQL Host: $POSTGRES_HOST"
    log_info "  Redis Host: $REDIS_HOST"
}

azure_verify_postgres_config() {
    log_info "Verifying PostgreSQL configuration..."

    local server_name="${AKS_CLUSTER_NAME}-postgres"

    # Check SSL setting
    local ssl_value=$(az postgres flexible-server parameter show \
        --resource-group "$RESOURCE_GROUP_NAME" \
        --server-name "$server_name" \
        --name require_secure_transport \
        --query "value" -o tsv 2>/dev/null)

    if [[ "$ssl_value" == "off" ]]; then
        log_success "SSL requirement is disabled"
    else
        log_warning "SSL is still enabled ($ssl_value) - Terraform may still be applying"
    fi

    # Check extensions
    local ext_value=$(az postgres flexible-server parameter show \
        --resource-group "$RESOURCE_GROUP_NAME" \
        --server-name "$server_name" \
        --name azure.extensions \
        --query "value" -o tsv 2>/dev/null)

    if [[ -n "$ext_value" ]]; then
        log_success "PostgreSQL extensions configured: $ext_value"
    else
        log_warning "Extensions not yet configured - Terraform may still be applying"
    fi
}

azure_configure_kubectl() {
    log_info "Configuring kubectl for AKS cluster..."

    # Check cluster type
    azure_check_cluster_type

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        # Private clusters route through `az aks command invoke` which
        # authenticates via the caller's Azure AD RBAC. Grant the role
        # assignments and verify access via the API.
        azure_grant_cluster_rbac
        log_info "Private cluster detected - skipping local kubectl config"
        log_info "Verifying cluster access via Azure API..."
        azure_run_kubectl "get nodes"
    else
        # Public cluster — fetch the local cluster-admin certificate via --admin
        # rather than Azure-AD-bound credentials. --admin uses the cluster's
        # built-in admin cert (stored in the kubeconfig) and bypasses Azure AD
        # RBAC entirely. This is the right choice for an automated deploy
        # script because:
        #   1. Azure AD role-assignment propagation is racy (30s–15min). The
        #      prior code's 30s sleep + immediate `kubectl get nodes` would
        #      sporadically fail on fresh clusters with "User does not have
        #      access to the resource in Azure".
        #   2. The deploy needs cluster-admin-equivalent power anyway (creates
        #      namespaces, secrets, ConfigMaps, helm installs).
        # For non-admin Azure AD access by human users *after* the deploy,
        # run `az aks get-credentials` (without --admin) separately and grant
        # role assignments out-of-band.
        az aks get-credentials \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --admin \
            --overwrite-existing

        kubectl get nodes
    fi

    log_success "kubectl configured successfully"
}

# Export functions for use by other scripts
export -f azure_preflight_sku_quota
export -f _azure_check_vcpu_quota
export -f _azure_sku_zones_json
export -f _azure_resolve_pool_zones
export -f azure_run_kubectl
export -f azure_run_kubectl_apply_stdin
export -f azure_run_helm
export -f azure_run_helm_with_values
export -f azure_check_cluster_type
export -f azure_configure_kubectl
export -f azure_verify_postgres_config

