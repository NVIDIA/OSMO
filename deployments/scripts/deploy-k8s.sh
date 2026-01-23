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
# Kubernetes Deployment Script for OSMO
#
# This script handles:
# - Creating Kubernetes namespaces
# - Creating secrets (database, redis, MEK)
# - Creating PostgreSQL database
# - Deploying OSMO components via Helm
# - Setting up Backend Operator
#
# Prerequisites:
# - kubectl configured
# - Helm installed
# - Infrastructure outputs file with connection details
#
# Usage:
#   ./deploy-k8s.sh --provider azure|aws --outputs-file <path> [options]
###############################################################################

set -euo pipefail

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source common functions
source "$SCRIPT_DIR/common.sh"

###############################################################################
# Configuration
###############################################################################

OSMO_NAMESPACE="${OSMO_NAMESPACE:-osmo-minimal}"
OSMO_OPERATOR_NAMESPACE="${OSMO_OPERATOR_NAMESPACE:-osmo-operator}"
OSMO_WORKFLOWS_NAMESPACE="${OSMO_WORKFLOWS_NAMESPACE:-osmo-workflows}"

OSMO_IMAGE_REGISTRY="${OSMO_IMAGE_REGISTRY:-nvcr.io/nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
BACKEND_TOKEN_EXPIRY="${BACKEND_TOKEN_EXPIRY:-2027-01-01}"

# Provider-specific settings (set by loading provider script)
PROVIDER=""
OUTPUTS_FILE=""
VALUES_DIR=""
DRY_RUN=false
POSTGRES_PASSWORD=""

# Function references for provider-specific commands
RUN_KUBECTL="kubectl"
RUN_KUBECTL_APPLY_STDIN=""
RUN_HELM="helm"
RUN_HELM_WITH_VALUES=""

###############################################################################
# Parse Arguments
###############################################################################

parse_k8s_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --provider)
                PROVIDER="$2"
                shift 2
                ;;
            --outputs-file)
                OUTPUTS_FILE="$2"
                shift 2
                ;;
            --values-dir)
                VALUES_DIR="$2"
                shift 2
                ;;
            --postgres-password)
                POSTGRES_PASSWORD="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
}

###############################################################################
# Provider Setup
###############################################################################

setup_provider() {
    if [[ -z "$PROVIDER" ]]; then
        log_error "Provider not specified. Use --provider azure|aws"
        exit 1
    fi

    # Load outputs file
    if [[ -n "$OUTPUTS_FILE" && -f "$OUTPUTS_FILE" ]]; then
        source "$OUTPUTS_FILE"
    fi

    # Set up provider-specific functions
    case "$PROVIDER" in
        azure)
            source "$SCRIPT_DIR/azure/terraform.sh"
            RUN_KUBECTL="azure_run_kubectl"
            RUN_KUBECTL_APPLY_STDIN="azure_run_kubectl_apply_stdin"
            RUN_HELM="azure_run_helm"
            RUN_HELM_WITH_VALUES="azure_run_helm_with_values"
            ;;
        aws)
            source "$SCRIPT_DIR/aws/terraform.sh"
            RUN_KUBECTL="aws_run_kubectl"
            RUN_KUBECTL_APPLY_STDIN="aws_run_kubectl_apply_stdin"
            RUN_HELM="aws_run_helm"
            RUN_HELM_WITH_VALUES="aws_run_helm_with_values"
            ;;
        *)
            log_error "Unknown provider: $PROVIDER. Supported: azure, aws"
            exit 1
            ;;
    esac

    # Set default values directory
    if [[ -z "$VALUES_DIR" ]]; then
        VALUES_DIR="$SCRIPT_DIR/values"
    fi
    mkdir -p "$VALUES_DIR"
}

###############################################################################
# Namespace Functions
###############################################################################

create_namespaces() {
    log_info "Creating Kubernetes namespaces..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would create namespaces"
        return
    fi

    $RUN_KUBECTL "create namespace $OSMO_NAMESPACE" 2>/dev/null || log_info "Namespace $OSMO_NAMESPACE may already exist"
    $RUN_KUBECTL "create namespace $OSMO_OPERATOR_NAMESPACE" 2>/dev/null || log_info "Namespace $OSMO_OPERATOR_NAMESPACE may already exist"
    $RUN_KUBECTL "create namespace $OSMO_WORKFLOWS_NAMESPACE" 2>/dev/null || log_info "Namespace $OSMO_WORKFLOWS_NAMESPACE may already exist"

    log_success "Namespaces created"
}

###############################################################################
# Database Functions
###############################################################################

create_database() {
    log_info "Creating PostgreSQL database 'osmo'..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would create database"
        return
    fi

    # Delete any existing db-ops pod
    $RUN_KUBECTL "delete pod osmo-db-ops --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
    sleep 3

    # Escape special characters in password
    local escaped_password=$(printf '%s' "$POSTGRES_PASSWORD" | sed "s/'/'\\\\''/g")

    local db_ops_manifest="apiVersion: v1
kind: Pod
metadata:
  name: osmo-db-ops
  namespace: $OSMO_NAMESPACE
spec:
  containers:
    - name: osmo-db-ops
      image: postgres:15
      env:
        - name: PGPASSWORD
          value: '$escaped_password'
        - name: PGHOST
          value: '$POSTGRES_HOST'
        - name: PGUSER
          value: '$POSTGRES_USERNAME'
      command:
        - /bin/bash
        - -c
        - |
          echo 'Attempting to create database osmo...'
          psql -h \$PGHOST -U \$PGUSER -d postgres -c 'CREATE DATABASE osmo;' 2>&1 || echo 'Database may already exist (this is OK)'
          echo 'Verifying database connection...'
          psql -h \$PGHOST -U \$PGUSER -d osmo -c 'SELECT 1 as connected;' && echo 'SUCCESS: Database osmo is ready!'
  restartPolicy: Never"

    log_info "Creating database initialization pod..."
    $RUN_KUBECTL_APPLY_STDIN "$db_ops_manifest"

    # Wait for completion
    log_info "Waiting for database creation to complete..."
    local max_wait=120
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        local status_output=$($RUN_KUBECTL "get pod osmo-db-ops --namespace $OSMO_NAMESPACE -o jsonpath={.status.phase}" 2>/dev/null)
        local status=$(echo "$status_output" | grep -o 'Succeeded\|Failed\|Running\|Pending' | head -1)

        if [[ "$status" == "Succeeded" ]]; then
            log_success "Database created successfully"
            echo "--- Database creation logs ---"
            $RUN_KUBECTL "logs osmo-db-ops --namespace $OSMO_NAMESPACE" 2>/dev/null || true
            echo "---"
            $RUN_KUBECTL "delete pod osmo-db-ops --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
            return 0
        elif [[ "$status" == "Failed" ]]; then
            log_warning "Database creation pod failed, checking logs..."
            $RUN_KUBECTL "logs osmo-db-ops --namespace $OSMO_NAMESPACE" 2>/dev/null || true
            $RUN_KUBECTL "delete pod osmo-db-ops --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
            return 0
        fi

        sleep 5
        waited=$((waited + 5))
        echo -n "."
    done
    echo ""

    log_warning "Timeout waiting for database creation, continuing anyway..."
    $RUN_KUBECTL "delete pod osmo-db-ops --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
}

###############################################################################
# Secrets Functions
###############################################################################

create_secrets() {
    log_info "Creating Kubernetes secrets..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would create secrets"
        return
    fi

    # Create database secret
    $RUN_KUBECTL "delete secret db-secret --namespace $OSMO_NAMESPACE --ignore-not-found=true"
    $RUN_KUBECTL "create secret generic db-secret --from-literal=db-password=$POSTGRES_PASSWORD --namespace $OSMO_NAMESPACE"

    # Create redis secret
    $RUN_KUBECTL "delete secret redis-secret --namespace $OSMO_NAMESPACE --ignore-not-found=true"
    $RUN_KUBECTL "create secret generic redis-secret --from-literal=redis-password=$REDIS_PASSWORD --namespace $OSMO_NAMESPACE"

    # Generate and create MEK
    log_info "Generating Master Encryption Key (MEK)..."
    local random_key=$(openssl rand -base64 32 | tr -d '\n')
    local jwk_json="{\"k\":\"$random_key\",\"kid\":\"key1\",\"kty\":\"oct\"}"
    local encoded_jwk=$(echo -n "$jwk_json" | base64 | tr -d '\n')

    local mek_manifest="apiVersion: v1
kind: ConfigMap
metadata:
  name: mek-config
  namespace: $OSMO_NAMESPACE
data:
  mek.yaml: |
    currentMek: key1
    meks:
      key1: $encoded_jwk"

    $RUN_KUBECTL_APPLY_STDIN "$mek_manifest"

    log_success "Secrets created"
}

###############################################################################
# Helm Functions
###############################################################################

add_helm_repos() {
    log_info "Adding Helm repositories..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would add helm repo"
        return
    fi

    if [[ "$IS_PRIVATE_CLUSTER" == "true" ]]; then
        $RUN_HELM "repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo && helm repo update"
    else
        helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo || true
        helm repo update
    fi

    log_success "Helm repositories added"
}

create_helm_values() {
    log_info "Creating OSMO Helm values files..."

    # Service values
    cat > "$VALUES_DIR/service_values.yaml" <<EOF
# OSMO Service Values - Auto-generated
global:
  osmoImageLocation: ${OSMO_IMAGE_REGISTRY}
  osmoImageTag: ${OSMO_IMAGE_TAG}

services:
  configFile:
    enabled: true

  postgres:
    enabled: false
    serviceName: ${POSTGRES_HOST}
    port: 5432
    db: ${POSTGRES_DB_NAME}
    user: ${POSTGRES_USERNAME}
    passwordSecretName: db-secret
    passwordSecretKey: db-password

  redis:
    enabled: false
    serviceName: ${REDIS_HOST}
    port: ${REDIS_PORT}
    tlsEnabled: true

  service:
    scaling:
      minReplicas: 1
      maxReplicas: 1
    ingress:
      enabled: false

  agent:
    scaling:
      minReplicas: 1
      maxReplicas: 1

  worker:
    scaling:
      minReplicas: 1
      maxReplicas: 1

  logger:
    scaling:
      minReplicas: 1
      maxReplicas: 1

sidecars:
  otel:
    enabled: false
  rateLimit:
    enabled: false
  envoy:
    enabled: false
  logAgent:
    enabled: false
EOF

    # UI values
    cat > "$VALUES_DIR/ui_values.yaml" <<EOF
# OSMO Web UI Values - Auto-generated
global:
  osmoImageLocation: ${OSMO_IMAGE_REGISTRY}
  osmoImageTag: ${OSMO_IMAGE_TAG}

services:
  ui:
    replicas: 1
    hostname: "osmo-minimal.local"
    apiHostname: "osmo-service.${OSMO_NAMESPACE}.svc.cluster.local:80"
    ingress:
      enabled: false

sidecars:
  envoy:
    enabled: false
  logAgent:
    enabled: false
EOF

    # Router values
    cat > "$VALUES_DIR/router_values.yaml" <<EOF
# OSMO Router Values - Auto-generated
global:
  osmoImageLocation: ${OSMO_IMAGE_REGISTRY}
  osmoImageTag: ${OSMO_IMAGE_TAG}

services:
  configFile:
    enabled: true

  service:
    scaling:
      minReplicas: 1
      maxReplicas: 1
    ingress:
      enabled: false

  postgres:
    serviceName: ${POSTGRES_HOST}
    port: 5432
    db: ${POSTGRES_DB_NAME}
    user: ${POSTGRES_USERNAME}
    passwordSecretName: db-secret
    passwordSecretKey: db-password

sidecars:
  otel:
    enabled: false
  envoy:
    enabled: false
  logAgent:
    enabled: false
EOF

    # Backend operator values
    cat > "$VALUES_DIR/backend_operator_values.yaml" <<EOF
# Backend Operator Values - Auto-generated
global:
  osmoImageLocation: ${OSMO_IMAGE_REGISTRY}
  osmoImageTag: ${OSMO_IMAGE_TAG}
  serviceUrl: http://osmo-agent.${OSMO_NAMESPACE}.svc.cluster.local
  agentNamespace: ${OSMO_OPERATOR_NAMESPACE}
  backendNamespace: ${OSMO_WORKFLOWS_NAMESPACE}
  backendName: default
  accountTokenSecret: osmo-operator-token
  loginMethod: token

services:
  backendListener:
    resources:
      requests:
        cpu: "125m"
        memory: "128Mi"
      limits:
        cpu: "250m"
        memory: "256Mi"
  backendWorker:
    resources:
      requests:
        cpu: "125m"
        memory: "128Mi"
      limits:
        cpu: "250m"
        memory: "256Mi"

sidecars:
  otel:
    enabled: false
EOF

    log_success "Helm values files created"
}

deploy_osmo_service() {
    log_info "Deploying OSMO service..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy OSMO service"
        return
    fi

    $RUN_HELM_WITH_VALUES "$VALUES_DIR/service_values.yaml" \
        "upgrade --install osmo-minimal osmo/service --namespace $OSMO_NAMESPACE --wait --timeout 10m"

    log_success "OSMO service deployed"
}

deploy_osmo_ui() {
    log_info "Deploying OSMO UI..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy OSMO UI"
        return
    fi

    $RUN_HELM_WITH_VALUES "$VALUES_DIR/ui_values.yaml" \
        "upgrade --install ui-minimal osmo/web-ui --namespace $OSMO_NAMESPACE --wait --timeout 5m"

    log_success "OSMO UI deployed"
}

deploy_osmo_router() {
    log_info "Deploying OSMO Router..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy OSMO Router"
        return
    fi

    $RUN_HELM_WITH_VALUES "$VALUES_DIR/router_values.yaml" \
        "upgrade --install router-minimal osmo/router --namespace $OSMO_NAMESPACE --wait --timeout 5m"

    log_success "OSMO Router deployed"
}

setup_backend_operator() {
    log_info "Setting up Backend Operator..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would setup backend operator"
        return
    fi

    local token_created=false

    if [[ "$IS_PRIVATE_CLUSTER" == "true" ]]; then
        log_warning "Private cluster - token generation requires manual steps"
    else
        # Port forward to OSMO service
        log_info "Starting port-forward to OSMO service..."
        kubectl port-forward service/osmo-service 9000:80 -n "$OSMO_NAMESPACE" &
        local port_forward_pid=$!
        sleep 5

        if command -v osmo &> /dev/null; then
            log_info "Logging into OSMO..."
            osmo login http://localhost:9000 --method=dev --username=testuser || true

            log_info "Generating backend operator token..."
            local backend_token=$(osmo token set backend-token \
                --expires-at "$BACKEND_TOKEN_EXPIRY" \
                --description "Backend Operator Token" \
                --service \
                --roles osmo-backend \
                -t json 2>/dev/null | jq -r '.token' || echo "")

            if [[ -n "$backend_token" && "$backend_token" != "null" ]]; then
                kubectl create secret generic osmo-operator-token \
                    --from-literal=token="$backend_token" \
                    --namespace "$OSMO_OPERATOR_NAMESPACE" \
                    --dry-run=client -o yaml | kubectl apply -f -

                log_success "Backend token created"
                token_created=true
            fi
        fi

        kill $port_forward_pid 2>/dev/null || true
    fi

    if [[ "$token_created" == false ]]; then
        log_warning "Backend token not created automatically."
        log_info "Creating placeholder token secret..."
        $RUN_KUBECTL "delete secret osmo-operator-token --namespace $OSMO_OPERATOR_NAMESPACE --ignore-not-found=true"
        $RUN_KUBECTL "create secret generic osmo-operator-token --from-literal=token=placeholder --namespace $OSMO_OPERATOR_NAMESPACE"
    fi

    # Deploy backend operator
    log_info "Deploying Backend Operator..."
    $RUN_HELM_WITH_VALUES "$VALUES_DIR/backend_operator_values.yaml" \
        "upgrade --install osmo-operator osmo/backend-operator --namespace $OSMO_OPERATOR_NAMESPACE --wait --timeout 5m"

    log_success "Backend Operator deployed"
}

###############################################################################
# Cleanup Functions
###############################################################################

cleanup_osmo() {
    log_info "Cleaning up OSMO deployment..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would cleanup OSMO"
        return
    fi

    $RUN_HELM "uninstall osmo-minimal --namespace $OSMO_NAMESPACE" 2>/dev/null || true
    $RUN_HELM "uninstall ui-minimal --namespace $OSMO_NAMESPACE" 2>/dev/null || true
    $RUN_HELM "uninstall router-minimal --namespace $OSMO_NAMESPACE" 2>/dev/null || true
    $RUN_HELM "uninstall osmo-operator --namespace $OSMO_OPERATOR_NAMESPACE" 2>/dev/null || true

    $RUN_KUBECTL "delete namespace $OSMO_NAMESPACE" 2>/dev/null || true
    $RUN_KUBECTL "delete namespace $OSMO_OPERATOR_NAMESPACE" 2>/dev/null || true
    $RUN_KUBECTL "delete namespace $OSMO_WORKFLOWS_NAMESPACE" 2>/dev/null || true

    log_success "OSMO cleanup completed"
}

###############################################################################
# Verification Functions
###############################################################################

verify_deployment() {
    log_info "Verifying deployment..."

    if [[ "$DRY_RUN" == true ]]; then
        return
    fi

    echo ""
    log_info "=== Deployment Status ==="

    echo ""
    log_info "Pods in $OSMO_NAMESPACE namespace:"
    $RUN_KUBECTL "get pods -n $OSMO_NAMESPACE"

    echo ""
    log_info "Pods in $OSMO_OPERATOR_NAMESPACE namespace:"
    $RUN_KUBECTL "get pods -n $OSMO_OPERATOR_NAMESPACE"

    echo ""
    log_info "Services in $OSMO_NAMESPACE namespace:"
    $RUN_KUBECTL "get services -n $OSMO_NAMESPACE"

    log_success "Deployment verification completed"
}

print_access_instructions() {
    echo ""
    echo "=============================================================================="
    echo "                    OSMO Minimal Deployment Complete!"
    echo "=============================================================================="
    echo ""

    if [[ "$IS_PRIVATE_CLUSTER" == "true" ]]; then
        echo "Private Cluster Access Instructions:"
        echo "  Use 'az aks command invoke' (Azure) or bastion host to interact."
    else
        echo "Access Instructions (using port-forwarding):"
        echo ""
        echo "1. Access OSMO Service API:"
        echo "   kubectl port-forward service/osmo-service 9000:80 -n $OSMO_NAMESPACE"
        echo "   Then visit: http://localhost:9000/api/docs"
        echo ""
        echo "2. Access OSMO UI:"
        echo "   kubectl port-forward service/osmo-ui 3000:80 -n $OSMO_NAMESPACE"
        echo "   Then visit: http://localhost:3000"
        echo ""
        echo "3. Login with OSMO CLI:"
        echo "   osmo login http://localhost:9000 --method=dev --username=testuser"
    fi

    echo ""
    echo "Documentation: https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_minimal.html"
    echo "=============================================================================="
}

###############################################################################
# Main Function
###############################################################################

deploy_k8s_main() {
    parse_k8s_args "$@"
    setup_provider

    # K8s deployment
    check_command "kubectl"
    check_command "helm"

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

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    deploy_k8s_main "$@"
fi

