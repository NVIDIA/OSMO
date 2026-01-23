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
# OSMO Minimal Deployment Script
#
# This script orchestrates the deployment of OSMO on cloud providers:
# 1. Provisions infrastructure using Terraform (provider-specific)
# 2. Deploys OSMO minimal deployment onto Kubernetes
#
# Prerequisites:
# - Cloud CLI installed and authenticated (az login / aws configure)
# - Terraform >= 1.9
# - kubectl
# - Helm
# - OSMO CLI (osmo)
# - jq
#
# Usage:
#   ./deploy-osmo-minimal.sh --provider azure|aws [options]
#
# Options:
#   --provider PROVIDER  Cloud provider: azure or aws (required)
#   --skip-terraform     Skip Terraform provisioning (use existing infrastructure)
#   --skip-osmo          Skip OSMO deployment (only provision infrastructure)
#   --destroy            Destroy all resources
#   --dry-run            Show what would be done without making changes
#   --non-interactive    Fail if required parameters are missing (for CI/CD)
#   -h, --help           Show this help message
#
# Azure-specific options:
#   --subscription-id    Azure subscription ID
#   --resource-group     Existing Azure resource group name
#   --postgres-password  PostgreSQL admin password
#   --cluster-name       AKS cluster name (default: osmo-cluster)
#   --region             Azure region (default: East US 2)
#   --environment        Environment name (default: dev)
#
# AWS-specific options:
#   --aws-region         AWS region (default: us-west-2)
#   --aws-profile        AWS profile (default: default)
#   --cluster-name       EKS cluster name (default: osmo-cluster)
#   --postgres-password  PostgreSQL admin password
#
###############################################################################

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions
source "$SCRIPT_DIR/common.sh"

###############################################################################
# Global Configuration
###############################################################################

PROVIDER=""
SKIP_TERRAFORM=false
SKIP_OSMO=false
DESTROY=false
DRY_RUN=false
NON_INTERACTIVE=false

# Output files
OUTPUTS_FILE=""
VALUES_DIR=""

# Terraform directory (set based on provider)
TERRAFORM_DIR=""

###############################################################################
# Help Function
###############################################################################

show_help() {
    cat << 'EOF'
OSMO Minimal Deployment Script

Usage: ./deploy-osmo-minimal.sh --provider azure|aws [options]

Required:
  --provider PROVIDER    Cloud provider: azure or aws

General Options:
  --skip-terraform       Skip Terraform provisioning (use existing infrastructure)
  --skip-osmo            Skip OSMO deployment (only provision infrastructure)
  --destroy              Destroy all resources
  --dry-run              Show what would be done without making changes
  --non-interactive      Fail if required parameters are missing (for CI/CD)
  -h, --help             Show this help message

Azure-specific Options:
  --subscription-id ID   Azure subscription ID
  --resource-group NAME  Existing Azure resource group name
  --postgres-password PW PostgreSQL admin password
  --cluster-name NAME    AKS cluster name (default: osmo-cluster)
  --region REGION        Azure region (default: East US 2)
  --environment ENV      Environment name (default: dev)
  --k8s-version VER      Kubernetes version (default: 1.32.9)

AWS-specific Options:
  --aws-region REGION    AWS region (default: us-west-2)
  --aws-profile PROFILE  AWS profile (default: default)
  --cluster-name NAME    EKS cluster name (default: osmo-cluster)
  --postgres-password PW PostgreSQL admin password
  --environment ENV      Environment name (default: dev)

Environment Variables:
  OSMO_IMAGE_REGISTRY    OSMO image registry (default: nvcr.io/nvidia/osmo)
  OSMO_IMAGE_TAG         OSMO image tag (default: latest)
  BACKEND_TOKEN_EXPIRY   Backend token expiry date (default: 2027-01-01)

Examples:
  # Interactive Azure deployment
  ./deploy-osmo-minimal.sh --provider azure

  # Azure with parameters
  ./deploy-osmo-minimal.sh --provider azure \
    --subscription-id abc123 \
    --resource-group my-rg \
    --postgres-password 'SecurePass123!'

  # AWS deployment
  ./deploy-osmo-minimal.sh --provider aws \
    --aws-region us-west-2 \
    --postgres-password 'SecurePass123!'

  # Only provision infrastructure
  ./deploy-osmo-minimal.sh --provider azure --skip-osmo

  # Only deploy OSMO (infrastructure exists)
  ./deploy-osmo-minimal.sh --provider azure --skip-terraform

  # Destroy everything
  ./deploy-osmo-minimal.sh --provider azure --destroy
EOF
}

###############################################################################
# Parse Arguments
###############################################################################

# Store all arguments for passing to sub-scripts
ALL_ARGS=("$@")

while [[ $# -gt 0 ]]; do
    case $1 in
        --provider)
            PROVIDER="$2"
            shift 2
            ;;
        --skip-terraform)
            SKIP_TERRAFORM=true
            shift
            ;;
        --skip-osmo)
            SKIP_OSMO=true
            shift
            ;;
        --destroy)
            DESTROY=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --non-interactive)
            NON_INTERACTIVE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        # Pass through other arguments (handled by provider scripts)
        --subscription-id|--resource-group|--postgres-password|--cluster-name|--region|--environment|--k8s-version|--aws-region|--aws-profile)
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

###############################################################################
# Validate Arguments
###############################################################################

if [[ -z "$PROVIDER" ]]; then
    log_error "Provider is required. Use --provider azure|aws"
    echo ""
    show_help
    exit 1
fi

case "$PROVIDER" in
    azure|aws)
        ;;
    *)
        log_error "Unknown provider: $PROVIDER. Supported: azure, aws"
        exit 1
        ;;
esac

###############################################################################
# Setup Provider
###############################################################################

setup_provider_env() {
    case "$PROVIDER" in
        azure)
            source "$SCRIPT_DIR/azure/terraform.sh"
            TERRAFORM_DIR="${AZURE_TERRAFORM_DIR:-$SCRIPT_DIR/../terraform/azure/example}"
            ;;
        aws)
            source "$SCRIPT_DIR/aws/terraform.sh"
            TERRAFORM_DIR="${AWS_TERRAFORM_DIR:-$SCRIPT_DIR/../terraform/aws/example}"
            ;;
    esac

    # Set output file paths
    OUTPUTS_FILE="$SCRIPT_DIR/.${PROVIDER}_outputs.env"
    VALUES_DIR="$SCRIPT_DIR/values"
    mkdir -p "$VALUES_DIR"
}

###############################################################################
# Pre-flight Checks
###############################################################################

preflight_checks() {
    log_info "Running pre-flight checks..."

    check_command "terraform"
    check_command "kubectl"
    check_command "helm"
    check_command "jq"

    # Provider-specific checks
    case "$PROVIDER" in
        azure)
            azure_preflight_checks
            ;;
        aws)
            aws_preflight_checks
            ;;
    esac

    log_success "Pre-flight checks passed"
}

###############################################################################
# Terraform Functions
###############################################################################

run_terraform_init() {
    case "$PROVIDER" in
        azure)
            azure_terraform_init "$TERRAFORM_DIR"
            ;;
        aws)
            aws_terraform_init "$TERRAFORM_DIR"
            ;;
    esac
}

run_terraform_apply() {
    case "$PROVIDER" in
        azure)
            azure_terraform_apply "$TERRAFORM_DIR" "$DRY_RUN"
            ;;
        aws)
            aws_terraform_apply "$TERRAFORM_DIR" "$DRY_RUN"
            ;;
    esac
}

run_terraform_destroy() {
    case "$PROVIDER" in
        azure)
            azure_terraform_destroy "$TERRAFORM_DIR" "$DRY_RUN"
            ;;
        aws)
            aws_terraform_destroy "$TERRAFORM_DIR" "$DRY_RUN"
            ;;
    esac
}

get_terraform_outputs() {
    case "$PROVIDER" in
        azure)
            azure_get_terraform_outputs "$TERRAFORM_DIR" "$OUTPUTS_FILE"
            ;;
        aws)
            aws_get_terraform_outputs "$TERRAFORM_DIR" "$OUTPUTS_FILE"
            ;;
    esac
}

configure_kubectl() {
    case "$PROVIDER" in
        azure)
            azure_configure_kubectl
            ;;
        aws)
            aws_configure_kubectl
            ;;
    esac
}

verify_provider_config() {
    case "$PROVIDER" in
        azure)
            azure_verify_postgres_config
            ;;
        aws)
            # AWS-specific verification if needed
            log_info "Verifying AWS configuration..."
            ;;
    esac
}

###############################################################################
# Configuration Functions
###############################################################################

handle_configuration() {
    local tfvars_file="$TERRAFORM_DIR/terraform.tfvars"

    if [[ ! -f "$tfvars_file" ]]; then
        log_info "terraform.tfvars not found."

        if [[ "$NON_INTERACTIVE" == true ]]; then
            log_error "Non-interactive mode: terraform.tfvars required"
            exit 1
        fi

        # Interactive configuration
        case "$PROVIDER" in
            azure)
                azure_configure_interactively
                azure_generate_tfvars "$tfvars_file"
                ;;
            aws)
                aws_configure_interactively
                aws_generate_tfvars "$tfvars_file"
                ;;
        esac
    else
        log_info "Using existing terraform.tfvars"

        # Load passwords from tfvars
        TF_POSTGRES_PASSWORD=$(grep 'postgres_password\|rds_password' "$tfvars_file" | head -1 | cut -d'"' -f2 || echo "")
        TF_REDIS_PASSWORD=$(grep 'redis_auth_token\|redis_password' "$tfvars_file" | head -1 | cut -d'"' -f2 || echo "")
    fi
}

###############################################################################
# OSMO Deployment
###############################################################################

deploy_osmo() {
    log_info "Deploying OSMO..."

    # Save current values before sourcing deploy-k8s.sh (which resets them)
    local saved_provider="$PROVIDER"
    local saved_outputs_file="$OUTPUTS_FILE"
    local saved_values_dir="$VALUES_DIR"
    local saved_dry_run="$DRY_RUN"

    # Get passwords
    local postgres_password="${TF_POSTGRES_PASSWORD:-}"
    local redis_password="${TF_REDIS_PASSWORD:-}"
    if [[ -z "$postgres_password" ]]; then
        postgres_password=$(grep 'postgres_password\|rds_password' "$TERRAFORM_DIR/terraform.tfvars" | head -1 | cut -d'"' -f2 || echo "")
    fi
    if [[ -z "$redis_password" ]]; then
        redis_password=$(grep 'redis_auth_token\|redis_password' "$TERRAFORM_DIR/terraform.tfvars" | head -1 | cut -d'"' -f2 || echo "")
    fi

    # Run K8s deployment script
    source "$SCRIPT_DIR/deploy-k8s.sh"

    # Restore variables for deploy-k8s.sh
    PROVIDER="$saved_provider"
    OUTPUTS_FILE="$saved_outputs_file"
    VALUES_DIR="$saved_values_dir"
    POSTGRES_PASSWORD="$postgres_password"
    REDIS_PASSWORD="$redis_password"
    DRY_RUN="$saved_dry_run"

    # Source the outputs file
    if [[ -f "$OUTPUTS_FILE" ]]; then
        source "$OUTPUTS_FILE"
    fi

    # Setup provider and run deployment
    setup_provider

    create_namespaces
    add_helm_repos
    create_database
    create_secrets
    create_helm_values

    deploy_osmo_service
    deploy_osmo_ui
    deploy_osmo_router

    wait_for_pods "$OSMO_NAMESPACE" 300 "" "kubectl"

    setup_backend_operator
    wait_for_pods "$OSMO_OPERATOR_NAMESPACE" 180 "" "kubectl"

    verify_deployment
    print_access_instructions
}

###############################################################################
# Cleanup
###############################################################################

cleanup_all() {
    log_warning "Destroying all resources..."

    # Save current values
    local saved_provider="$PROVIDER"

    # Load outputs if available
    if [[ -f "$OUTPUTS_FILE" ]]; then
        source "$OUTPUTS_FILE"
    fi

    # Try to get outputs from Terraform
    if [[ -d "$TERRAFORM_DIR/.terraform" ]] || [[ -f "$TERRAFORM_DIR/terraform.tfstate" ]]; then
        get_terraform_outputs || true
        configure_kubectl || true

        # Cleanup OSMO
        source "$SCRIPT_DIR/deploy-k8s.sh"
        PROVIDER="$saved_provider"
        setup_provider
        cleanup_osmo || true
    fi

    # Destroy Terraform resources
    run_terraform_destroy

    # Clean up output files
    rm -f "$OUTPUTS_FILE"

    log_success "All resources destroyed"
}

###############################################################################
# Main Execution
###############################################################################

main() {
    echo ""
    echo "=============================================================================="
    echo "           OSMO Minimal Deployment Script - Provider: $PROVIDER"
    echo "=============================================================================="
    echo ""

    # Setup provider environment
    setup_provider_env

    # Pre-flight checks
    preflight_checks

    # Handle destroy
    if [[ "$DESTROY" == true ]]; then
        cleanup_all
        exit 0
    fi

    # Handle configuration
    if [[ "$SKIP_TERRAFORM" == false ]]; then
        handle_configuration
    fi

    # Terraform provisioning
    if [[ "$SKIP_TERRAFORM" == false ]]; then
        run_terraform_init
        run_terraform_apply
    fi

    # Get Terraform outputs
    get_terraform_outputs

    # Verify provider configuration
    verify_provider_config

    # Configure kubectl
    configure_kubectl

    # OSMO deployment
    if [[ "$SKIP_OSMO" == false ]]; then
        deploy_osmo
    else
        log_success "Infrastructure provisioned. OSMO deployment skipped."
        echo ""
        echo "To deploy OSMO later, run:"
        echo "  ./deploy-osmo-minimal.sh --provider $PROVIDER --skip-terraform"
    fi
}

# Run main function
main

