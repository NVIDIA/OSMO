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
TF_K8S_VERSION="${TF_K8S_VERSION:-1.32.9}"

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
availability_zones = ["1", "2"]

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

# Redis Cache Configuration
redis_sku_name = "Standard"
redis_family   = "C"
redis_capacity = 1

# Log Analytics Configuration
log_analytics_sku            = "PerGB2018"
log_analytics_retention_days = 30
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

    log_success "Azure pre-flight checks passed"
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

    # Grant RBAC permissions
    azure_grant_cluster_rbac

    if [[ "$IS_PRIVATE_CLUSTER" == true ]]; then
        log_info "Private cluster detected - skipping local kubectl config"
        log_info "Verifying cluster access via Azure API..."
        azure_run_kubectl "get nodes"
    else
        az aks get-credentials \
            --resource-group "$RESOURCE_GROUP_NAME" \
            --name "$AKS_CLUSTER_NAME" \
            --overwrite-existing

        kubectl get nodes
    fi

    log_success "kubectl configured successfully"
}

# Export functions for use by other scripts
export -f azure_run_kubectl
export -f azure_run_kubectl_apply_stdin
export -f azure_run_helm
export -f azure_run_helm_with_values
export -f azure_check_cluster_type
export -f azure_configure_kubectl
export -f azure_verify_postgres_config

