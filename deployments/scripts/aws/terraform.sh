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
# Auto-generated by deploy-osmo.sh for AWS
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
rds_engine_version = "15.12"
rds_instance_class = "db.t3.medium"
rds_db_name        = "osmo"
rds_username       = "postgres"
rds_password       = "$TF_POSTGRES_PASSWORD"

# Redis Configuration
redis_node_type       = "cache.t3.micro"
redis_num_cache_nodes = 1
redis_auth_token      = "$TF_REDIS_PASSWORD"

# Optional S3 bucket for OSMO workflow data
# Triggered by --storage-backend s3 on deploy-osmo.sh
# (the unified installer reads s3_bucket / s3_access_key_id /
# s3_secret_access_key TF outputs)
s3_bucket_enabled = ${TF_S3_BUCKET_ENABLED:-false}

gpu_node_pool_enabled = ${TF_GPU_NODE_POOL_ENABLED:-false}
gpu_instance_type = "${TF_GPU_INSTANCE_TYPE:-g5.xlarge}"
gpu_node_group_min_size = ${TF_GPU_COUNT:-0}
gpu_node_group_max_size = ${TF_GPU_MAX_COUNT:-${TF_GPU_COUNT:-1}}
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
