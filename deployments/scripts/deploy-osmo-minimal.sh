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
NGC_API_KEY="${NGC_API_KEY:-}"
TF_POSTGRES_PASSWORD="${TF_POSTGRES_PASSWORD:-}"
TF_REDIS_PASSWORD="${TF_REDIS_PASSWORD:-}"

# New flags (cluster-agnostic OSMO deploy)
GPU_NODE_POOL=false
STORAGE_BACKEND="${STORAGE_BACKEND:-auto}"
AUTH_METHOD="${AUTH_METHOD:-static}"
WORKLOAD_IDENTITY_CLIENT_ID="${WORKLOAD_IDENTITY_CLIENT_ID:-}"
WORKLOAD_IDENTITY_ROLE_ARN="${WORKLOAD_IDENTITY_ROLE_ARN:-}"
NO_GPU="${NO_GPU:-0}"
ENABLE_MICROK8S_GPU=false

# Output files
OUTPUTS_FILE=""
VALUES_DIR=""
STORAGE_VALUES_FILE=""

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
  --provider PROVIDER    Cloud / cluster provider: azure | aws | microk8s | byo

General Options:
  --skip-terraform       Skip Terraform provisioning (azure/aws only; implied for microk8s/byo)
  --skip-osmo            Skip OSMO deployment (only provision infrastructure)
  --destroy              Destroy all resources (azure/aws: TF destroy; microk8s/byo: OSMO ns cleanup)
  --dry-run              Show what would be done without making changes
  --non-interactive      Fail if required parameters are missing (for CI/CD)
  --ngc-api-key KEY      NGC API key for pulling images and Helm charts from nvcr.io
  --storage-backend X    Storage backend: auto|minio|azure-blob|byo|none (default: auto)
  --auth-method X        Storage auth: static|workload-identity (default: static)
                         workload-identity REQUIRES caller-provisioned cloud
                         identity (UAMI for Azure, IAM role for AWS) + RBAC.
                         Not valid for --storage-backend minio.
  --workload-identity-client-id ID
                         Azure UAMI client ID (required for azure-blob + WI)
  --workload-identity-role-arn ARN
                         AWS IAM role ARN (required for byo + WI / IRSA)
  --gpu-node-pool        Provision a GPU node pool (azure/aws only; requires TF variables)
  --no-gpu               Skip GPU Operator install + GPU smoke test
  --gpu                  microk8s only: enable the nvidia addon during bootstrap
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
  NGC_API_KEY            NGC API key (alternative to --ngc-api-key flag)

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
        --ngc-api-key)
            NGC_API_KEY="$2"; shift 2 ;;
        -h|--help)
            show_help
            exit 0
            ;;
        # Provider-specific arguments - set TF_ variables used by provider scripts
        --subscription-id)
            TF_SUBSCRIPTION_ID="$2"; shift 2 ;;
        --resource-group)
            TF_RESOURCE_GROUP="$2"; shift 2 ;;
        --postgres-password)
            TF_POSTGRES_PASSWORD="$2"; shift 2 ;;
        --redis-password)
            TF_REDIS_PASSWORD="$2"; shift 2 ;;
        --cluster-name)
            TF_CLUSTER_NAME="$2"; shift 2 ;;
        --region)
            TF_REGION="$2"; shift 2 ;;
        --aws-region)
            TF_AWS_REGION="$2"; shift 2 ;;
        --aws-profile)
            TF_AWS_PROFILE="$2"; shift 2 ;;
        --environment)
            TF_ENVIRONMENT="$2"; shift 2 ;;
        --k8s-version)
            TF_K8S_VERSION="$2"; shift 2 ;;
        # Cluster-agnostic OSMO deploy flags
        --gpu-node-pool)
            GPU_NODE_POOL=true; shift ;;
        --storage-backend)
            STORAGE_BACKEND="$2"; shift 2 ;;
        --auth-method)
            AUTH_METHOD="$2"; shift 2 ;;
        --workload-identity-client-id)
            WORKLOAD_IDENTITY_CLIENT_ID="$2"; shift 2 ;;
        --workload-identity-role-arn)
            WORKLOAD_IDENTITY_ROLE_ARN="$2"; shift 2 ;;
        --no-gpu)
            NO_GPU=1; shift ;;
        --gpu)
            ENABLE_MICROK8S_GPU=true; shift ;;
        *)
            shift
            ;;
    esac
done

###############################################################################
# Validate Arguments
###############################################################################

if [[ -z "$PROVIDER" ]]; then
    log_error "Provider is required. Use --provider azure|aws|microk8s|byo"
    echo ""
    show_help
    exit 1
fi

case "$PROVIDER" in
    azure|aws|microk8s|byo)
        ;;
    *)
        log_error "Unknown provider: $PROVIDER. Supported: azure, aws, microk8s, byo"
        exit 1
        ;;
esac

# Providers without cloud TF: skip terraform-related flow regardless of flag
case "$PROVIDER" in
    microk8s|byo)
        SKIP_TERRAFORM=true
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
        microk8s|byo)
            # No TF for these providers
            TERRAFORM_DIR=""
            ;;
    esac

    # Set output file paths
    OUTPUTS_FILE="$SCRIPT_DIR/.${PROVIDER}_outputs.env"
    VALUES_DIR="$SCRIPT_DIR/values"
    STORAGE_VALUES_FILE="$VALUES_DIR/.storage-values.yaml"
    mkdir -p "$VALUES_DIR"
}

###############################################################################
# Pre-flight Checks
###############################################################################

preflight_checks() {
    log_info "Running pre-flight checks..."

    check_command "kubectl"
    check_command "helm"
    check_command "jq"

    # terraform is only required for cloud providers that run TF
    case "$PROVIDER" in
        azure|aws)
            check_command "terraform"
            ;;
    esac

    # Provider-specific checks
    case "$PROVIDER" in
        azure)
            azure_preflight_checks
            ;;
        aws)
            aws_preflight_checks
            ;;
        microk8s)
            # microk8s/install.sh handles its own preflight (snapd, driver, ports)
            ;;
        byo)
            # BYO requires kubectl already configured against the cluster
            if ! kubectl cluster-info &>/dev/null; then
                log_error "BYO provider requires kubectl already pointing at a reachable cluster"
                exit 1
            fi
            # BYO requires DB/Redis env vars (no TF outputs to read from)
            for var in POSTGRES_HOST POSTGRES_USERNAME POSTGRES_PASSWORD POSTGRES_DB_NAME \
                       REDIS_HOST REDIS_PORT REDIS_PASSWORD; do
                if [[ -z "${!var:-}" ]]; then
                    log_error "BYO provider requires env var: $var"
                    log_error "All required: POSTGRES_HOST POSTGRES_USERNAME POSTGRES_PASSWORD"
                    log_error "              POSTGRES_DB_NAME REDIS_HOST REDIS_PORT REDIS_PASSWORD"
                    log_error "              IS_PRIVATE_CLUSTER (optional, default: false)"
                    exit 1
                fi
            done
            export IS_PRIVATE_CLUSTER="${IS_PRIVATE_CLUSTER:-false}"
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
        microk8s|byo)
            # No cloud-side config to verify
            ;;
    esac
}

###############################################################################
# Cluster bootstrap (MicroK8s only — TF providers handle their own bootstrap)
###############################################################################

bootstrap_microk8s() {
    if command -v microk8s &>/dev/null && microk8s status --wait-ready --timeout 5 &>/dev/null; then
        log_info "MicroK8s already installed and ready — skipping bootstrap"
        return 0
    fi
    log_info "Bootstrapping MicroK8s..."
    local args=()
    [[ "$ENABLE_MICROK8S_GPU" == "true" ]] && args+=(--gpu)
    sudo "$SCRIPT_DIR/microk8s/install.sh" "${args[@]}"
}

###############################################################################
# Cluster-agnostic dependencies (run regardless of how the cluster came up)
###############################################################################

install_cluster_dependencies() {
    log_info "Installing cluster dependencies..."

    NO_GPU="$NO_GPU" bash "$SCRIPT_DIR/install-kai-scheduler.sh"
    NO_GPU="$NO_GPU" bash "$SCRIPT_DIR/install-gpu-operator.sh"

    # MinIO is only installed if the user actually selected it as the backend.
    if [[ "$STORAGE_BACKEND" == "minio" ]] || [[ "$STORAGE_BACKEND" == "auto" && "$PROVIDER" == "microk8s" ]]; then
        bash "$SCRIPT_DIR/install-minio.sh"
    fi

    log_success "Cluster dependencies installed"
}

###############################################################################
# Storage configuration phase (writes K8s Secrets + Helm values fragment)
###############################################################################

configure_storage_phase() {
    if [[ "$STORAGE_BACKEND" == "none" ]]; then
        log_info "Storage backend = none — skipping storage configuration"
        : > "$STORAGE_VALUES_FILE"
        return 0
    fi

    log_info "Configuring storage backend: $STORAGE_BACKEND (auth: $AUTH_METHOD)"

    local extra_args=()
    if [[ "$AUTH_METHOD" == "workload-identity" ]]; then
        extra_args+=(--auth-method workload-identity)
        [[ -n "$WORKLOAD_IDENTITY_CLIENT_ID" ]] && \
            extra_args+=(--workload-identity-client-id "$WORKLOAD_IDENTITY_CLIENT_ID")
        [[ -n "$WORKLOAD_IDENTITY_ROLE_ARN" ]] && \
            extra_args+=(--workload-identity-role-arn "$WORKLOAD_IDENTITY_ROLE_ARN")
    fi
    [[ "$NON_INTERACTIVE" == "true" ]] && extra_args+=(--non-interactive)

    OSMO_NAMESPACE="${OSMO_NAMESPACE:-osmo-minimal}" \
    NAMESPACE="${OSMO_NAMESPACE:-osmo-minimal}" \
    bash "$SCRIPT_DIR/configure-storage.sh" \
        --backend "$STORAGE_BACKEND" \
        --namespace "${OSMO_NAMESPACE:-osmo-minimal}" \
        --output-values "$STORAGE_VALUES_FILE" \
        "${extra_args[@]}"
}

###############################################################################
# Configuration Functions
###############################################################################

handle_configuration() {
    local tfvars_file="$TERRAFORM_DIR/terraform.tfvars"

    # Determine whether all required values were supplied via flags/env vars.
    # If so, always regenerate tfvars so that flag values (e.g. a new postgres
    # version or region) are never silently overridden by a stale file.
    local has_all_required=false
    case "$PROVIDER" in
        azure)
            if [[ -n "$TF_POSTGRES_PASSWORD" ]]; then
                has_all_required=true
            fi
            ;;
        aws)
            if [[ -n "$TF_POSTGRES_PASSWORD" && -n "$TF_REDIS_PASSWORD" ]]; then
                has_all_required=true
            fi
            ;;
    esac

    if [[ "$has_all_required" == true ]]; then
        # All required values provided — regenerate so flags always win.
        # Skip interactive configuration entirely; go straight to tfvars generation.
        case "$PROVIDER" in
            azure)
                azure_generate_tfvars "$tfvars_file"
                ;;
            aws)
                aws_generate_tfvars "$tfvars_file"
                ;;
        esac
    elif [[ ! -f "$tfvars_file" ]]; then
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
    local saved_storage_values_file="$STORAGE_VALUES_FILE"

    # Resolve passwords. Priority: --postgres-password/--redis-password flags
    # (TF_*) → POSTGRES_PASSWORD/REDIS_PASSWORD env (BYO contract) → tfvars file.
    # Skip the tfvars grep when TERRAFORM_DIR is empty (microk8s/byo) — otherwise
    # `grep ... /terraform.tfvars` errors and silently leaves the password empty.
    local postgres_password="${TF_POSTGRES_PASSWORD:-${POSTGRES_PASSWORD:-}}"
    local redis_password="${TF_REDIS_PASSWORD:-${REDIS_PASSWORD:-}}"
    if [[ -z "$postgres_password" && -n "$TERRAFORM_DIR" && -f "$TERRAFORM_DIR/terraform.tfvars" ]]; then
        postgres_password=$(grep 'postgres_password\|rds_password' "$TERRAFORM_DIR/terraform.tfvars" | head -1 | cut -d'"' -f2 || echo "")
    fi
    if [[ -z "$redis_password" && -n "$TERRAFORM_DIR" && -f "$TERRAFORM_DIR/terraform.tfvars" ]]; then
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
    # configure-storage.sh writes here; deploy-k8s.sh layers it via extra_values_flags
    STORAGE_VALUES_FILE="$saved_storage_values_file"

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
    create_image_pull_secrets

    # 6.3 ConfigMap mode: no inline value templating. Values come from static
    # YAML files in deployments/values/, layered with auto-detected fragments
    # (PodMonitor, GPU pool) and the storage fragment from configure-storage.sh.
    resolve_static_values
    render_gpu_pool_values

    # The 6.3 service chart bundles router + UI — single helm release.
    deploy_osmo_service
    wait_for_pods "$OSMO_NAMESPACE" 300 "" "$RUN_KUBECTL"

    setup_backend_operator
    wait_for_pods "$OSMO_OPERATOR_NAMESPACE" 180 "" "$RUN_KUBECTL"

    verify_deployment
    print_access_instructions
}

###############################################################################
# Cleanup
###############################################################################

cleanup_all() {
    log_warning "Destroying all resources..."

    # Stop any port-forward watchdogs so they don't survive teardown
    pkill -f 'osmo-pf-watchdog:' 2>/dev/null || true

    # microk8s/byo: we don't own the cluster — only clean up OSMO-side resources
    case "$PROVIDER" in
        microk8s|byo)
            log_info "Cleaning up OSMO resources (cluster itself not destroyed for $PROVIDER)"
            for ns in osmo-minimal osmo-operator osmo-workflows; do
                kubectl delete namespace "$ns" --ignore-not-found --wait=false 2>/dev/null || true
            done
            return 0
            ;;
    esac

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

    # ── Phase: cluster bootstrap ──────────────────────────────────────────────
    case "$PROVIDER" in
        azure|aws)
            if [[ "$SKIP_TERRAFORM" == false ]]; then
                handle_configuration
                run_terraform_init
                run_terraform_apply
            fi

            if [[ "$DRY_RUN" == true ]]; then
                log_success "Dry-run complete. No resources were created."
                exit 0
            fi

            get_terraform_outputs
            verify_provider_config
            configure_kubectl
            ;;
        microk8s)
            bootstrap_microk8s
            ;;
        byo)
            log_info "BYO provider — using existing kubectl context"
            ;;
    esac

    # Bail out if --skip-osmo was requested (TF providers only)
    if [[ "$SKIP_OSMO" == true ]]; then
        log_success "Infrastructure provisioned. OSMO deployment skipped."
        echo ""
        echo "To deploy OSMO later, run:"
        echo "  ./deploy-osmo-minimal.sh --provider $PROVIDER --skip-terraform"
        exit 0
    fi

    # ── Phase: install cluster-agnostic dependencies ──────────────────────────
    install_cluster_dependencies

    # ── Phase: configure storage (writes K8s Secrets + Helm values fragment) ──
    configure_storage_phase

    # ── Phase: install OSMO ───────────────────────────────────────────────────
    deploy_osmo

    # ── Phase: smoke tests ────────────────────────────────────────────────────
    if [[ "${SKIP_VERIFY:-0}" != "1" ]]; then
        # Start a watchdog port-forward so verify.sh and subsequent CLI calls
        # have a stable :9000. The target service is gateway-aware: when the
        # chart's Envoy gateway is rendered (osmo-gateway-envoy Service exists)
        # we forward to that for proper auth-header injection; otherwise the
        # chart is in direct-service mode and we forward to osmo-service.
        # Caller can stop all watchdogs with: pkill -f 'osmo-pf-watchdog:'
        local osmo_ns="${OSMO_NAMESPACE:-osmo-minimal}"
        local api_svc
        api_svc=$(resolve_osmo_api_service "$osmo_ns")
        log_info "OSMO API service detected: $api_svc"
        bash "$SCRIPT_DIR/port-forward.sh" --watchdog "$api_svc" 9000 "$osmo_ns"

        local skip_gpu=0
        [[ "$NO_GPU" == "1" ]] && skip_gpu=1
        SKIP_GPU="$skip_gpu" OSMO_NAMESPACE="$osmo_ns" \
            bash "$SCRIPT_DIR/verify.sh" || log_warning "Smoke tests reported failures"

        # Bring up the UI watchdog too for convenience
        bash "$SCRIPT_DIR/port-forward.sh" --watchdog osmo-ui 3000 "$osmo_ns" || true
    fi

    log_success "OSMO deploy complete."
}

# Run main function
main

