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
# AWS Terraform Provisioning Script for OSMO
#
# This script provisions AWS infrastructure using Terraform:
# - VPC with subnets
# - Amazon EKS
# - Amazon RDS PostgreSQL
# - Amazon ElastiCache Redis
#
# Prerequisites:
# - AWS CLI installed and authenticated
# - Terraform >= 1.9
#
# Usage:
#   source aws/terraform.sh
#   aws_preflight_checks
#   aws_terraform_apply
#   aws_get_outputs
###############################################################################

# Get the directory where this script is located
AWS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_TERRAFORM_DIR="${AWS_TERRAFORM_DIR:-$AWS_SCRIPT_DIR/../../terraform/aws/example}"

# Source common functions if not already loaded
if [[ -z "$BLUE" ]]; then
    source "$AWS_SCRIPT_DIR/../common.sh"
fi

###############################################################################
# AWS-specific Configuration Defaults
###############################################################################

TF_AWS_REGION="${TF_AWS_REGION:-us-west-2}"
TF_AWS_PROFILE="${TF_AWS_PROFILE:-default}"
TF_CLUSTER_NAME="${TF_CLUSTER_NAME:-osmo-cluster}"
TF_POSTGRES_PASSWORD="${TF_POSTGRES_PASSWORD:-}"
TF_REDIS_PASSWORD="${TF_REDIS_PASSWORD:-}"
TF_ENVIRONMENT="${TF_ENVIRONMENT:-dev}"
TF_K8S_VERSION="${TF_K8S_VERSION:-1.30}"

###############################################################################
# AWS Helper Functions
###############################################################################

# Run kubectl command for AWS (standard kubectl)
aws_run_kubectl() {
    # Handle both "cmd arg1 arg2" (single string) and cmd arg1 arg2 (multiple args)
    if [[ $# -eq 1 ]]; then
        eval kubectl $1
    else
        kubectl "$@"
    fi
}

# Run kubectl with stdin input
aws_run_kubectl_apply_stdin() {
    local manifest="$1"
    echo "$manifest" | kubectl apply -f -
}

# Run helm command
aws_run_helm() {
    # Handle both "cmd arg1 arg2" (single string) and cmd arg1 arg2 (multiple args)
    if [[ $# -eq 1 ]]; then
        eval helm $1
    else
        helm "$@"
    fi
}

# Run helm with values file
aws_run_helm_with_values() {
    local values_file="$1"
    local helm_cmd="$2"
    # The helm command comes as a single string, so use eval to expand it
    eval helm $helm_cmd -f "$values_file"
}

###############################################################################
# AWS Configuration Functions
###############################################################################

aws_configure_interactively() {
    echo ""
    echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║         AWS Infrastructure - Interactive Configuration           ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # AWS Region
    echo -e "${CYAN}Step 1: AWS Region${NC}"
    TF_AWS_REGION=$(prompt_value "AWS Region" "$TF_AWS_REGION")

    # AWS Profile
    echo ""
    echo -e "${CYAN}Step 2: AWS Profile${NC}"
    TF_AWS_PROFILE=$(prompt_value "AWS Profile" "$TF_AWS_PROFILE")

    # Cluster Name
    echo ""
    echo -e "${CYAN}Step 3: EKS Cluster Name${NC}"
    TF_CLUSTER_NAME=$(prompt_value "EKS Cluster Name" "$TF_CLUSTER_NAME")

    # PostgreSQL Password
    if [[ -z "$TF_POSTGRES_PASSWORD" ]]; then
        echo ""
        echo -e "${CYAN}Step 4: PostgreSQL Password${NC}"
        echo "  Password requirements:"
        echo "    • Minimum 8 characters"
        echo "    • At least one uppercase, lowercase, and digit"
        echo ""

        while true; do
            TF_POSTGRES_PASSWORD=$(prompt_value "PostgreSQL Admin Password" "" "true")
            if validate_password "$TF_POSTGRES_PASSWORD"; then
                local confirm=$(prompt_value "Confirm Password" "" "true")
                if [[ "$TF_POSTGRES_PASSWORD" == "$confirm" ]]; then
                    break
                fi
                log_error "Passwords do not match."
            else
                log_error "Password does not meet requirements."
            fi
        done
    fi

    # Redis Password
    if [[ -z "$TF_REDIS_PASSWORD" ]]; then
        echo ""
        echo -e "${CYAN}Step 5: Redis Password${NC}"
        echo "  Password requirements for Redis auth token:"
        echo "    • Minimum 16 characters"
        echo "    • Alphanumeric characters, hyphens, and underscores only"
        echo ""

        while true; do
            TF_REDIS_PASSWORD=$(prompt_value "Redis Auth Token" "" "true")
            if [[ ${#TF_REDIS_PASSWORD} -ge 16 ]]; then
                local confirm=$(prompt_value "Confirm Redis Auth Token" "" "true")
                if [[ "$TF_REDIS_PASSWORD" == "$confirm" ]]; then
                    break
                fi
                log_error "Passwords do not match."
            else
                log_error "Redis auth token must be at least 16 characters."
            fi
        done
    fi

    # Environment
    echo ""
    echo -e "${CYAN}Step 6: Environment${NC}"
    TF_ENVIRONMENT=$(prompt_value "Environment (dev/staging/prod)" "$TF_ENVIRONMENT")

    echo ""
    log_success "Configuration complete!"
}

aws_generate_tfvars() {
    local tfvars_file="$1"
    log_info "Generating terraform.tfvars for AWS..."

    cat > "$tfvars_file" <<EOF
# Auto-generated by deploy-osmo-minimal.sh for AWS
# Generated on: $(date)

# General Configuration
aws_region     = "$TF_AWS_REGION"
environment    = "$TF_ENVIRONMENT"
project_name   = "osmo"
owner          = "platform-team"
cluster_name   = "$TF_CLUSTER_NAME"

# VPC Configuration
vpc_cidr         = "10.0.0.0/16"
private_subnets  = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
public_subnets   = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
database_subnets = ["10.0.201.0/24", "10.0.202.0/24"]
single_nat_gateway = true

# EKS Configuration
kubernetes_version     = "$TF_K8S_VERSION"
node_instance_types    = ["t3.xlarge"]
node_group_min_size    = 1
node_group_max_size    = 5
node_group_desired_size = 3

# RDS Configuration
rds_engine_version = "15.4"
rds_instance_class = "db.t3.medium"
rds_db_name        = "osmo"
rds_username       = "postgres"
rds_password       = "$TF_POSTGRES_PASSWORD"

# Redis Configuration
redis_node_type       = "cache.t3.micro"
redis_num_cache_nodes = 1
redis_auth_token      = "$TF_REDIS_PASSWORD"
EOF

    log_success "terraform.tfvars generated for AWS"
}

###############################################################################
# Main AWS Terraform Functions
###############################################################################

aws_preflight_checks() {
    log_info "Running AWS pre-flight checks..."

    check_command "aws"
    check_command "terraform"

    # Check AWS CLI authentication
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "AWS CLI is not authenticated. Please configure credentials."
        exit 1
    fi

    log_success "AWS pre-flight checks passed"
}

aws_terraform_init() {
    local terraform_dir="$1"
    log_info "Initializing Terraform for AWS..."
    cd "$terraform_dir"
    terraform init
    log_success "Terraform initialized"
}

aws_terraform_apply() {
    local terraform_dir="$1"
    local dry_run="${2:-false}"

    log_info "Applying Terraform configuration for AWS..."
    cd "$terraform_dir"

    if [[ "$dry_run" == true ]]; then
        terraform plan
        return
    fi

    terraform apply -auto-approve
    log_success "Terraform apply completed"
}

aws_terraform_destroy() {
    local terraform_dir="$1"
    local dry_run="${2:-false}"

    log_info "Destroying Terraform resources on AWS..."
    cd "$terraform_dir"

    if [[ "$dry_run" == true ]]; then
        return
    fi

    terraform destroy -auto-approve
    log_success "Terraform resources destroyed"
}

aws_get_terraform_outputs() {
    local terraform_dir="$1"
    local outputs_file="$2"

    log_info "Retrieving Terraform outputs from AWS..."
    cd "$terraform_dir"

    # Get outputs from terraform
    local cluster_name=$(terraform output -raw cluster_name 2>/dev/null || echo "$TF_CLUSTER_NAME")
    local postgres_host=$(terraform output -raw rds_instance_address 2>/dev/null || echo "")
    local redis_host=$(terraform output -raw redis_primary_endpoint_address 2>/dev/null || echo "")
    local aws_region=$(terraform output -raw aws_region 2>/dev/null || echo "$TF_AWS_REGION")

    # Get passwords from tfvars if not already set
    local postgres_password="${TF_POSTGRES_PASSWORD:-}"
    local redis_password="${TF_REDIS_PASSWORD:-}"
    if [[ -z "$postgres_password" && -f "$terraform_dir/terraform.tfvars" ]]; then
        postgres_password=$(grep 'rds_password' "$terraform_dir/terraform.tfvars" | cut -d'"' -f2 || echo "")
    fi
    if [[ -z "$redis_password" && -f "$terraform_dir/terraform.tfvars" ]]; then
        redis_password=$(grep 'redis_auth_token' "$terraform_dir/terraform.tfvars" | cut -d'"' -f2 || echo "")
    fi

    cat > "$outputs_file" <<EOF
# AWS Terraform Outputs - Auto-generated
export PROVIDER="aws"
export AKS_CLUSTER_NAME="$cluster_name"
export EKS_CLUSTER_NAME="$cluster_name"
export POSTGRES_HOST="$postgres_host"
export POSTGRES_DB_NAME="osmo"
export POSTGRES_USERNAME="postgres"
export POSTGRES_PASSWORD="$postgres_password"
export REDIS_HOST="$redis_host"
export REDIS_PORT="6379"
export REDIS_PASSWORD="$redis_password"
export AWS_REGION="$aws_region"
export TF_AWS_REGION="$aws_region"
export IS_PRIVATE_CLUSTER="false"
EOF

    source "$outputs_file"

    log_success "Terraform outputs retrieved"
    log_info "  EKS Cluster: $EKS_CLUSTER_NAME"
    log_info "  PostgreSQL Host: $POSTGRES_HOST"
    log_info "  Redis Host: $REDIS_HOST"
}

aws_configure_kubectl() {
    log_info "Configuring kubectl for EKS cluster..."

    aws eks update-kubeconfig \
        --region "$TF_AWS_REGION" \
        --name "$EKS_CLUSTER_NAME" \
        --profile "$TF_AWS_PROFILE"

    kubectl get nodes
    log_success "kubectl configured successfully"
}

# Export functions
# Export functions (suppress output that some shells produce)
export -f aws_run_kubectl 2>/dev/null || true
export -f aws_run_kubectl_apply_stdin 2>/dev/null || true
export -f aws_run_helm 2>/dev/null || true
export -f aws_run_helm_with_values 2>/dev/null || true
export -f aws_configure_kubectl 2>/dev/null || true

