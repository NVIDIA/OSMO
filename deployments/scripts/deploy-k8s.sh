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
OSMO_HELM_REPO_NAME="${OSMO_HELM_REPO_NAME:-osmo-deploy}"
OSMO_HELM_REPO_URL="${OSMO_HELM_REPO_URL:-https://helm.ngc.nvidia.com/nvidia/osmo}"
# Chart version pin. Empty string = let helm pick the latest stable. For 6.3
# prerelease testing, set OSMO_CHART_VERSION=1.3.0-prerelease-rc1 (or similar
# `--devel`-tagged version) to match the prerelease image tag.
OSMO_CHART_VERSION="${OSMO_CHART_VERSION:-}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
BACKEND_TOKEN_EXPIRY="${BACKEND_TOKEN_EXPIRY:-2027-01-01}"
NGC_API_KEY="${NGC_API_KEY:-}"
NGC_SECRET_NAME="${NGC_SECRET_NAME:-nvcr-secret}"
BACKEND_OPERATOR_USER="${BACKEND_OPERATOR_USER:-backend-operator}"

# DB-init pod used to issue `CREATE DATABASE` against an existing managed
# PostgreSQL. Locked-down clusters that can't pull from Docker Hub override
# POSTGRES_OPS_IMAGE; the rest can leave it. Pod name is parameterized so
# multiple deploys against shared namespaces don't collide.
OSMO_DB_OPS_POD="${OSMO_DB_OPS_POD:-osmo-db-ops}"
POSTGRES_OPS_IMAGE="${POSTGRES_OPS_IMAGE:-postgres:15}"
DB_OPS_TIMEOUT="${DB_OPS_TIMEOUT:-120}"

# Static values directory — see deployments/values/README.md
STATIC_VALUES_DIR="${STATIC_VALUES_DIR:-$SCRIPT_DIR/../values}"

# Storage values fragment written by configure-storage.sh; consumed at helm
# install time. Empty means storage was not configured (e.g. --storage-backend=none).
STORAGE_VALUES_FILE="${STORAGE_VALUES_FILE:-}"

# Force-regenerate the master encryption key (MEK) ConfigMap. Default is to
# preserve any existing one so encrypted DB data remains decryptable across
# re-runs. Set to "true" only on a clean cluster + clean DB.
RESET_MEK="${RESET_MEK:-false}"

# Provider-specific settings. Idempotent under `source` — the wrapper
# (deploy-osmo-minimal.sh) sets these before sourcing this file.
PROVIDER="${PROVIDER:-}"
OUTPUTS_FILE="${OUTPUTS_FILE:-}"
VALUES_DIR="${VALUES_DIR:-}"
DRY_RUN="${DRY_RUN:-false}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-}"
REDIS_PASSWORD="${REDIS_PASSWORD:-}"

# IS_PRIVATE_CLUSTER is set by azure/terraform.sh (when AKS is private) or by
# preflight in the BYO provider. Default to false so non-azure / non-byo
# providers (microk8s, aws) don't trip `set -u` later.
IS_PRIVATE_CLUSTER="${IS_PRIVATE_CLUSTER:-false}"

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
            --ngc-api-key)
                NGC_API_KEY="$2"
                shift 2
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
        byo|microk8s)
            # No cloud-specific kubectl/helm wrappers — use plain commands.
            # The functions defined here mirror the azure/aws wrapper signatures
            # so callers don't need to know which provider they're on.
            byo_run_kubectl() { kubectl "$@"; }
            byo_run_kubectl_apply_stdin() { echo "$1" | kubectl apply -f -; }
            byo_run_helm() { helm "$@"; }
            byo_run_helm_with_values() { local vf="$1"; shift; helm "$@" -f "$vf"; }
            export -f byo_run_kubectl byo_run_kubectl_apply_stdin byo_run_helm byo_run_helm_with_values 2>/dev/null || true
            RUN_KUBECTL="byo_run_kubectl"
            RUN_KUBECTL_APPLY_STDIN="byo_run_kubectl_apply_stdin"
            RUN_HELM="byo_run_helm"
            RUN_HELM_WITH_VALUES="byo_run_helm_with_values"
            ;;
        *)
            log_error "Unknown provider: $PROVIDER. Supported: azure, aws, microk8s, byo"
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
    # In-cluster postgres (microk8s) is provisioned by the helm install with
    # POSTGRES_DB=$db env baked in — the postgres image's entrypoint creates
    # the database on first init. The Service doesn't exist yet at this phase
    # so the db-ops pod can't connect; skip and let the chart handle it.
    if [[ "${OSMO_IN_CLUSTER_DB:-false}" == "true" ]]; then
        log_info "In-cluster DB mode — skipping pre-install database create (chart handles it)"
        return
    fi

    log_info "Creating PostgreSQL database 'osmo'..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would create database"
        return
    fi

    # Delete any existing db-ops pod
    $RUN_KUBECTL "delete pod $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
    sleep 3

    # Escape special characters in password
    local escaped_password=$(printf '%s' "$POSTGRES_PASSWORD" | sed "s/'/'\\\\''/g")

    local db_ops_manifest="apiVersion: v1
kind: Pod
metadata:
  name: $OSMO_DB_OPS_POD
  namespace: $OSMO_NAMESPACE
spec:
  containers:
    - name: $OSMO_DB_OPS_POD
      image: $POSTGRES_OPS_IMAGE
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
          echo 'Attempting to create database ${POSTGRES_DB_NAME:-osmo}...'
          psql -h \$PGHOST -U \$PGUSER -d postgres -c 'CREATE DATABASE \"${POSTGRES_DB_NAME:-osmo}\";' 2>&1 || echo 'Database may already exist (this is OK)'
          echo 'Verifying database connection...'
          psql -h \$PGHOST -U \$PGUSER -d ${POSTGRES_DB_NAME:-osmo} -c 'SELECT 1 as connected;' && echo 'SUCCESS: Database ${POSTGRES_DB_NAME:-osmo} is ready!'
  restartPolicy: Never"

    log_info "Creating database initialization pod..."
    $RUN_KUBECTL_APPLY_STDIN "$db_ops_manifest"

    # Wait for completion
    log_info "Waiting for database creation to complete..."
    local max_wait=$DB_OPS_TIMEOUT
    local waited=0
    while [[ $waited -lt $max_wait ]]; do
        local status_output=$($RUN_KUBECTL "get pod $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE -o jsonpath={.status.phase}" 2>/dev/null)
        local status=$(echo "$status_output" | grep -o 'Succeeded\|Failed\|Running\|Pending' | head -1)

        if [[ "$status" == "Succeeded" ]]; then
            log_success "Database created successfully"
            echo "--- Database creation logs ---"
            $RUN_KUBECTL "logs $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE" 2>/dev/null || true
            echo "---"
            $RUN_KUBECTL "delete pod $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
            return 0
        elif [[ "$status" == "Failed" ]]; then
            log_warning "Database creation pod failed, checking logs..."
            $RUN_KUBECTL "logs $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE" 2>/dev/null || true
            $RUN_KUBECTL "delete pod $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
            return 0
        fi

        sleep 5
        waited=$((waited + 5))
        echo -n "."
    done
    echo ""

    log_warning "Timeout waiting for database creation, continuing anyway..."
    $RUN_KUBECTL "delete pod $OSMO_DB_OPS_POD --namespace $OSMO_NAMESPACE --ignore-not-found=true" > /dev/null 2>&1 || true
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

    # Default admin secret — referenced by services.defaultAdmin.passwordSecretName
    # in values/service.yaml. The chart renders this into the bootstrap admin
    # user's credentials. The osmo service validates the password is exactly
    # 43 characters (matches src/utils/job/task_lib.REFRESH_TOKEN_STR_LENGTH);
    # mismatched length crashes osmo-service with OSMOUserError on startup.
    # Preserve on re-run to keep the admin password stable (caller can
    # `kubectl delete secret default-admin-secret` to force rotate).
    if ! $RUN_KUBECTL "get secret default-admin-secret -n $OSMO_NAMESPACE" &>/dev/null; then
        log_info "Generating default-admin-secret — first install"
        # 43 chars: openssl rand -base64 32 yields ~44 chars (incl. trailing =);
        # strip newlines + padding then take exactly 43.
        local admin_pw
        admin_pw=$(openssl rand -base64 32 | tr -d '\n=' | head -c 43)
        local admin_secret_yaml
        admin_secret_yaml=$(kubectl create secret generic default-admin-secret \
            --from-literal=password="$admin_pw" \
            --namespace "$OSMO_NAMESPACE" \
            --dry-run=client -o yaml)
        $RUN_KUBECTL_APPLY_STDIN "$admin_secret_yaml"
        log_info "  Admin user 'admin' password stored in $OSMO_NAMESPACE/default-admin-secret"
        log_info "  Recover via: kubectl get secret default-admin-secret -n $OSMO_NAMESPACE -o jsonpath='{.data.password}' | base64 -d"
    else
        log_info "default-admin-secret already exists in $OSMO_NAMESPACE — preserving"
    fi

    # MEK (Master Encryption Key) — DO NOT regenerate on re-run. Any data
    # encrypted with the previous MEK becomes unreadable if we replace it.
    # Generate only when the ConfigMap is missing, OR when RESET_MEK=true is
    # set explicitly (use only on a clean DB — replacing the MEK against an
    # existing DB silently breaks decryption of every encrypted field).
    local mek_exists="false"
    if $RUN_KUBECTL "get configmap mek-config -n $OSMO_NAMESPACE" &>/dev/null; then
        mek_exists="true"
    fi

    if [[ "$mek_exists" == "true" && "$RESET_MEK" != "true" ]]; then
        log_info "MEK ConfigMap already present in $OSMO_NAMESPACE — preserving (re-using existing key)"
        log_info "  Pass RESET_MEK=true (or --reset-mek) to force a fresh key — DESTRUCTIVE if DB has encrypted data"
    else
        if [[ "$mek_exists" == "true" && "$RESET_MEK" == "true" ]]; then
            log_warning "RESET_MEK=true — replacing existing MEK. Data encrypted with the previous key will be unreadable."
        else
            log_info "Generating Master Encryption Key (MEK) — first install"
        fi
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
    fi

    log_success "Secrets created"
}

create_image_pull_secrets() {
    # Find a namespace that already has the named pull secret (externally
    # managed); copy it to any namespace that's missing it. This handles the
    # common case of an `imagepullsecret` provisioned out-of-band by infra.
    local source_ns=""
    for namespace in "$OSMO_NAMESPACE" "$OSMO_OPERATOR_NAMESPACE" "$OSMO_WORKFLOWS_NAMESPACE"; do
        if $RUN_KUBECTL "get secret $NGC_SECRET_NAME -n $namespace" &>/dev/null; then
            source_ns="$namespace"
            break
        fi
    done

    if [[ -n "$source_ns" ]]; then
        log_info "Image pull secret '$NGC_SECRET_NAME' found in $source_ns — propagating to missing namespaces"
        for namespace in "$OSMO_NAMESPACE" "$OSMO_OPERATOR_NAMESPACE" "$OSMO_WORKFLOWS_NAMESPACE"; do
            [[ "$namespace" == "$source_ns" ]] && continue
            if ! $RUN_KUBECTL "get secret $NGC_SECRET_NAME -n $namespace" &>/dev/null; then
                local copied
                copied=$(kubectl get secret "$NGC_SECRET_NAME" -n "$source_ns" -o yaml \
                    | sed -e 's/^  namespace:.*$/  namespace: '"$namespace"'/' \
                          -e '/resourceVersion:/d' -e '/uid:/d' -e '/creationTimestamp:/d')
                $RUN_KUBECTL_APPLY_STDIN "$copied"
                log_info "  Copied $NGC_SECRET_NAME -> $namespace"
            fi
        done
        return
    fi

    if [[ -z "$NGC_API_KEY" ]]; then
        log_warning "NGC_API_KEY not set and $NGC_SECRET_NAME missing from all OSMO namespaces — skipping creation"
        log_warning "Either set NGC_API_KEY, or pre-create $NGC_SECRET_NAME in osmo-minimal/osmo-operator/osmo-workflows"
        return
    fi

    log_info "Creating NGC image pull secrets..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would create $NGC_SECRET_NAME in namespaces: $OSMO_NAMESPACE, $OSMO_OPERATOR_NAMESPACE, $OSMO_WORKFLOWS_NAMESPACE"
        return
    fi

    for namespace in "$OSMO_NAMESPACE" "$OSMO_OPERATOR_NAMESPACE" "$OSMO_WORKFLOWS_NAMESPACE"; do
        local secret_yaml
        secret_yaml=$(kubectl create secret docker-registry "$NGC_SECRET_NAME" \
            --docker-server=nvcr.io \
            --docker-username='$oauthtoken' \
            --docker-password="$NGC_API_KEY" \
            --namespace "$namespace" \
            --dry-run=client -o yaml)
        $RUN_KUBECTL_APPLY_STDIN "$secret_yaml"
        log_info "  Applied $NGC_SECRET_NAME in namespace $namespace"
    done

    log_success "NGC image pull secrets created"
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

    # If a repo with the same name already points at the desired URL, skip
    # `helm repo add` — `--force-update` would otherwise wipe stored credentials
    # (common with private nvstaging repos that were pre-authenticated by infra).
    local existing_url
    existing_url=$(helm repo list -o json 2>/dev/null \
        | python3 -c "import sys,json; print(next((r['url'] for r in json.load(sys.stdin) if r['name']=='$OSMO_HELM_REPO_NAME'), ''))" 2>/dev/null || echo "")

    if [[ "$existing_url" == "$OSMO_HELM_REPO_URL" ]]; then
        log_info "Helm repo '$OSMO_HELM_REPO_NAME' already points at $OSMO_HELM_REPO_URL — preserving stored credentials"
    elif [[ "$IS_PRIVATE_CLUSTER" == "true" ]]; then
        $RUN_HELM "repo add $OSMO_HELM_REPO_NAME $OSMO_HELM_REPO_URL --force-update"
    else
        local auth_args=""
        if [[ -n "$NGC_API_KEY" ]]; then
            auth_args="--username=\$oauthtoken --password=$NGC_API_KEY"
        fi
        # shellcheck disable=SC2086
        helm repo add "$OSMO_HELM_REPO_NAME" "$OSMO_HELM_REPO_URL" --force-update $auth_args
    fi
    helm repo update "$OSMO_HELM_REPO_NAME"

    log_success "Helm repositories added"
}

resolve_static_values() {
    # Validate the static values directory exists. Per-cluster overrides come
    # from --set; layered fragments (PodMonitor, GPU pool, storage) come from
    # extra_values_flags and the file is opt-in (presence == enable).
    if [[ ! -f "$STATIC_VALUES_DIR/service.yaml" ]]; then
        log_error "Static values not found: $STATIC_VALUES_DIR/service.yaml"
        log_error "  Set STATIC_VALUES_DIR to the deployments/values directory"
        return 1
    fi
    if [[ ! -f "$STATIC_VALUES_DIR/backend-operator.yaml" ]]; then
        log_error "Static values not found: $STATIC_VALUES_DIR/backend-operator.yaml"
        return 1
    fi

    # Auto-detect prometheus-operator CRDs to layer values/pod-monitor-on.yaml.
    # OSMO_POD_MONITOR_ENABLED env var force-overrides the auto-detect (true|false).
    PODMONITOR_VALUES_FILE=""
    local pm_decision="auto"
    case "${OSMO_POD_MONITOR_ENABLED:-auto}" in
        true|1|yes)  pm_decision="on" ;;
        false|0|no)  pm_decision="off" ;;
        auto|"")     pm_decision="auto" ;;
        *)           pm_decision="auto" ;;
    esac
    if [[ "$pm_decision" == "auto" ]]; then
        if kubectl get crd podmonitors.monitoring.coreos.com &>/dev/null; then
            pm_decision="on"
            log_info "prometheus-operator CRDs detected — enabling PodMonitor scraping"
        else
            log_info "prometheus-operator CRDs not detected — leaving PodMonitor disabled"
        fi
    fi
    if [[ "$pm_decision" == "on" && -f "$STATIC_VALUES_DIR/pod-monitor-on.yaml" ]]; then
        PODMONITOR_VALUES_FILE="$STATIC_VALUES_DIR/pod-monitor-on.yaml"
    fi
    export PODMONITOR_VALUES_FILE

    log_success "Static values resolved (service + backend-operator from $STATIC_VALUES_DIR)"
}

# Build the chain of `--set` overrides for the service chart. Cluster-specific
# values (PG/Redis hosts, image tag, namespace, NGC pull secret name) live here
# so values/service.yaml can stay generic and self-documenting.
service_set_flags() {
    local sets=""
    sets+=" --set global.osmoImageLocation=${OSMO_IMAGE_REGISTRY}"
    sets+=" --set global.osmoImageTag=${OSMO_IMAGE_TAG}"

    local has_pull_secret=false
    if [[ -n "$NGC_API_KEY" ]] \
        || $RUN_KUBECTL "get secret $NGC_SECRET_NAME -n $OSMO_NAMESPACE" &>/dev/null; then
        sets+=" --set global.imagePullSecret=${NGC_SECRET_NAME}"
        has_pull_secret=true
    fi

    sets+=" --set services.postgres.serviceName=${POSTGRES_HOST}"
    sets+=" --set services.postgres.port=${POSTGRES_PORT:-5432}"
    sets+=" --set services.postgres.db=${POSTGRES_DB_NAME}"
    sets+=" --set services.postgres.user=${POSTGRES_USERNAME}"

    sets+=" --set services.redis.serviceName=${REDIS_HOST}"
    sets+=" --set services.redis.port=${REDIS_PORT}"

    # AWS without aws-load-balancer-controller: the in-tree cloud provider
    # creates a Classic ELB for type=LoadBalancer Services, but it requires
    # exactly one SG tagged kubernetes.io/cluster/<name>=owned on each node.
    # The eks module attaches both the cluster-primary-sg AND its own node-sg
    # (both tagged), so the controller refuses to provision the LB. Install
    # aws-load-balancer-controller (uses target groups, no SG tagging) for the
    # production path; for the minimal/test path, use ClusterIP and rely on
    # the port-forward watchdog the deploy script already starts.
    if [[ "${PROVIDER:-}" == "aws" ]]; then
        sets+=" --set gateway.envoy.service.type=ClusterIP"
    fi

    # In-cluster DB mode (microk8s): chart deploys its own postgres + redis.
    # postgres.password is read by the postgres template directly (not from a
    # Secret); redis runs without auth so consumers must not negotiate TLS.
    if [[ "${OSMO_IN_CLUSTER_DB:-false}" == "true" ]]; then
        sets+=" --set services.postgres.enabled=true"
        sets+=" --set services.postgres.password=${POSTGRES_PASSWORD}"
        sets+=" --set services.redis.enabled=true"
        sets+=" --set services.redis.tlsEnabled=false"

        # Chart's PVC template renders `storageClassName: ""` (empty string)
        # when the value is unset, which K8s interprets as "no dynamic
        # provisioning" — even when a default SC exists. Auto-detect the
        # default SC and pass it explicitly so PVCs bind on microk8s/EKS/etc.
        # Plain `kubectl` (not $RUN_KUBECTL) — the byo wrapper word-splits its
        # single-arg form and would re-quote the jsonpath output.
        local default_sc
        default_sc=$(kubectl get sc -o jsonpath="{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=='true')].metadata.name}" 2>/dev/null || echo "")
        if [[ -n "$default_sc" ]]; then
            sets+=" --set services.postgres.storageClassName=${default_sc}"
            sets+=" --set services.redis.storageClassName=${default_sc}"
        fi
    fi

    # UI talks to the API through the gateway (which injects auth headers in
    # minimal mode and is the only HTTP entry point when gateway.enabled=true).
    # Matches the docs minimal-deploy reference (deploy_minimal.rst:306).
    sets+=" --set services.ui.apiHostname=osmo-gateway.${OSMO_NAMESPACE}.svc.cluster.local:80"

    # services.configs.* — namespace and image-tag substitutions for the
    # ConfigMap-rendered configfile. service.yaml carries the structural
    # defaults; these --set overrides fill in the per-cluster bits.
    local gateway_dns="osmo-gateway.${OSMO_NAMESPACE}.svc.cluster.local"
    sets+=" --set services.configs.service.service_base_url=http://${gateway_dns}"
    sets+=" --set services.configs.backends.default.router_address=ws://${gateway_dns}"

    # Workflow-pod backend images (init + osmo_ctrl client). These get rendered
    # into every workflow Pod spec by the backend-worker — empty fields cause K8s 422.
    sets+=" --set services.configs.workflow.backend_images.init=${OSMO_IMAGE_REGISTRY}/init-container:${OSMO_IMAGE_TAG}"
    sets+=" --set services.configs.workflow.backend_images.client=${OSMO_IMAGE_REGISTRY}/client:${OSMO_IMAGE_TAG}"

    # Override the NGC pull secret reference when the cluster ships a secret
    # with a non-default name (e.g. `imagepullsecret` on infra-managed AKS).
    # service.yaml's secretRefs is `[nvcr-secret]`; the storage fragment
    # appends data/log/app secret refs in static mode (or none in WI mode).
    if [[ "$has_pull_secret" == "true" && "$NGC_SECRET_NAME" != "nvcr-secret" ]]; then
        sets+=" --set services.configs.secretRefs[0].secretName=${NGC_SECRET_NAME}"
        sets+=" --set services.configs.workflow.backend_images.credential.secretName=${NGC_SECRET_NAME}"
    fi

    echo "$sets"
}

# Build the chain of `--set` overrides for the backend-operator chart.
backend_operator_set_flags() {
    local sets=""
    sets+=" --set global.osmoImageLocation=${OSMO_IMAGE_REGISTRY}"
    sets+=" --set global.osmoImageTag=${OSMO_IMAGE_TAG}"

    if [[ -n "$NGC_API_KEY" ]] \
        || $RUN_KUBECTL "get secret $NGC_SECRET_NAME -n $OSMO_OPERATOR_NAMESPACE" &>/dev/null; then
        sets+=" --set global.imagePullSecret=${NGC_SECRET_NAME}"
    fi

    # Backend-operator hits OSMO via the Envoy gateway (single entry that fronts
    # service/router/agent/logger). Direct osmo-agent.svc was the 6.2 path; the
    # 6.3 chart's auth filters live at the gateway, so worker login fails on the
    # agent service ClusterIP with "Connection aborted / Remote disconnected".
    sets+=" --set global.serviceUrl=http://osmo-gateway.${OSMO_NAMESPACE}.svc.cluster.local"
    sets+=" --set global.agentNamespace=${OSMO_OPERATOR_NAMESPACE}"
    sets+=" --set global.backendNamespace=${OSMO_WORKFLOWS_NAMESPACE}"

    echo "$sets"
}

# Build the helm `--version` flag when OSMO_CHART_VERSION is set. Empty echoes
# nothing so helm picks the latest stable. Required for 6.3 prerelease testing
# because `helm install` ignores prerelease tags by default.
chart_version_flag() {
    if [[ -n "${OSMO_CHART_VERSION:-}" ]]; then
        echo " --version $OSMO_CHART_VERSION"
    fi
}

# Build extra helm `-f` flags for the service release. Layering order matters:
# later files override earlier ones. The static service.yaml is passed as the
# RUN_HELM_WITH_VALUES primary file (always first); these are appended after.
#
#  1. PodMonitor on/off fragment (auto-detected via prometheus-operator CRDs)
#  2. GPU pool fragment (when GPU nodes are detected)
#  3. Storage values fragment (written by configure-storage.sh)
extra_values_flags() {
    local flags=""
    if [[ -n "${PODMONITOR_VALUES_FILE:-}" && -s "${PODMONITOR_VALUES_FILE}" ]]; then
        flags="$flags -f $PODMONITOR_VALUES_FILE"
    fi
    if [[ -n "${GPU_POOL_VALUES_FILE:-}" && -s "${GPU_POOL_VALUES_FILE}" ]]; then
        flags="$flags -f $GPU_POOL_VALUES_FILE"
    fi
    if [[ -n "${STORAGE_VALUES_FILE:-}" && -s "${STORAGE_VALUES_FILE}" ]]; then
        flags="$flags -f $STORAGE_VALUES_FILE"
    fi
    echo "$flags"
}

# Layer values/gpu-pool.yaml when GPU nodes are detected (or when --gpu-node-pool
# was passed via NO_GPU=0 + force). Replaces the 6.2-era `osmo config update`
# CLI dance — in 6.3 ConfigMap mode the pool definition lives in Helm values.
#
# To force-enable on a cluster without the gpu.present label, set
# OSMO_GPU_POOL_ENABLED=true. To force-disable, set NO_GPU=1.
render_gpu_pool_values() {
    GPU_POOL_VALUES_FILE=""
    if [[ "${NO_GPU:-0}" == "1" ]]; then
        log_info "NO_GPU=1 — skipping GPU pool values"
        return 0
    fi

    local force="${OSMO_GPU_POOL_ENABLED:-auto}"
    local detected="false"
    if kubectl get nodes -l nvidia.com/gpu.present 2>/dev/null \
        | grep -q "nvidia.com/gpu.present"; then
        detected="true"
    fi

    if [[ "$force" != "true" && "$detected" != "true" ]]; then
        log_info "No GPU nodes detected — skipping GPU pool values"
        return 0
    fi

    if [[ ! -f "$STATIC_VALUES_DIR/gpu-pool.yaml" ]]; then
        log_warning "GPU detected but $STATIC_VALUES_DIR/gpu-pool.yaml is missing — skipping"
        return 0
    fi

    GPU_POOL_VALUES_FILE="$STATIC_VALUES_DIR/gpu-pool.yaml"
    log_success "GPU nodes detected — layering $GPU_POOL_VALUES_FILE"
}

deploy_osmo_service() {
    log_info "Deploying OSMO service..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would deploy OSMO service"
        return
    fi

    # Layer order — IMPORTANT: helm REPLACES list values when the same path
    # appears in multiple -f files; later wins. service.yaml MUST come first
    # so the storage fragment's secretRefs list (4 entries: NGC + 3 workflow
    # creds) replaces service.yaml's (1 entry: NGC). Earlier versions of this
    # function used RUN_HELM_WITH_VALUES which appended service.yaml LAST,
    # which clobbered the storage fragment's secretRefs and left workflow
    # pods unable to mount /etc/osmo/secrets/osmo-workflow-*-cred/.
    #
    #   1. values/service.yaml                     (base — first)
    #   2. values/pod-monitor-on.yaml              (if prometheus-operator detected)
    #   3. values/gpu-pool.yaml                    (if GPU nodes detected)
    #   4. .storage-values.yaml                    (from configure-storage.sh — overrides as needed)
    #   5. --set per-cluster overrides             (PG/Redis hosts, image tag, etc.)
    # In 6.3 the service chart bundles router + UI, so this is the only release.
    # --timeout 15m by default — Azure Managed Redis cold start (~10-15 min)
    # + AKS image pulls (~3-5 min) + Postgres + service init can push past 10m
    # on a fresh cluster. Override via HELM_TIMEOUT_SERVICE for slower envs.
    $RUN_HELM \
        "upgrade --install osmo-minimal $OSMO_HELM_REPO_NAME/service --namespace $OSMO_NAMESPACE --wait --timeout ${HELM_TIMEOUT_SERVICE:-15m}$(chart_version_flag) -f $STATIC_VALUES_DIR/service.yaml$(extra_values_flags)$(service_set_flags)"

    log_success "OSMO service deployed"
}

setup_backend_operator() {
    log_info "Setting up Backend Operator..."

    if [[ "$DRY_RUN" == true ]]; then
        log_info "[DRY-RUN] Would setup backend operator"
        return
    fi

    # Phase 1: ensure the osmo-operator-token secret exists with a real value.
    # Token mint is the only step that actually requires the osmo CLI; the
    # subsequent helm install runs unconditionally so re-runs of this function
    # always reconcile the backend-operator deployment with the chart.
    if [[ "$IS_PRIVATE_CLUSTER" == "true" ]]; then
        log_warning "Private cluster - token generation requires manual steps; assuming token is pre-provisioned"
    else
        local existing_token
        existing_token=$($RUN_KUBECTL "get secret osmo-operator-token -n $OSMO_OPERATOR_NAMESPACE -o jsonpath={.data.token}" 2>/dev/null \
            | base64 -d 2>/dev/null || echo "")
        if [[ -n "$existing_token" && "$existing_token" != "placeholder" ]]; then
            log_info "Backend operator token already present in $OSMO_OPERATOR_NAMESPACE — reusing"
        else
            mint_backend_operator_token || return 1
        fi
    fi

    # Phase 2: install/upgrade backend-operator chart unconditionally.
    log_info "Deploying Backend Operator..."
    # backend-operator.yaml first, then --set overrides last (no per-cluster
    # values fragment for backend-operator, so order is straightforward).
    $RUN_HELM \
        "upgrade --install osmo-operator $OSMO_HELM_REPO_NAME/backend-operator --namespace $OSMO_OPERATOR_NAMESPACE --wait --timeout ${HELM_TIMEOUT_OPERATOR:-10m}$(chart_version_flag) -f $STATIC_VALUES_DIR/backend-operator.yaml$(backend_operator_set_flags)"

    log_success "Backend Operator deployed"
}

mint_backend_operator_token() {
    # Make sure the osmo CLI is available before we depend on it
    if ! command -v osmo &>/dev/null; then
        if [[ -f "$SCRIPT_DIR/common.sh" ]]; then source "$SCRIPT_DIR/common.sh"; fi
        if declare -F install_osmo_cli_if_missing &>/dev/null; then
            install_osmo_cli_if_missing
        fi
    fi
    if ! command -v osmo &>/dev/null; then
        log_error "osmo CLI required for backend-operator token mint, not found on PATH"
        return 1
    fi

    local api_svc
    api_svc=$(resolve_osmo_api_service "$OSMO_NAMESPACE")
    log_info "Starting port-forward to $api_svc (gateway-aware target)..."
    bash "$SCRIPT_DIR/port-forward.sh" --watchdog "$api_svc" 9000 "$OSMO_NAMESPACE" \
        || { log_error "Failed to establish port-forward for token mint"; return 1; }

    log_info "Logging into OSMO..."
    osmo login http://localhost:9000 --method=dev --username=admin || {
        log_error "osmo login failed — cannot mint backend-operator token"
        return 1
    }

    # 6.3 CLI: `--service` flag is gone; mint a token *for* a dedicated
    # service-account user via `--user`. Create the user idempotently first.
    # Default `backend-operator` matches the docs minimal-deploy reference.
    local sa_user="$BACKEND_OPERATOR_USER"
    if ! osmo user get "$sa_user" -t json &>/dev/null; then
        log_info "Creating service-account user '$sa_user' with role osmo-backend..."
        if ! osmo user create "$sa_user" --roles osmo-backend &>/tmp/osmo-user-create.log; then
            log_error "Failed to create service-account user '$sa_user'"
            cat /tmp/osmo-user-create.log >&2 || true
            return 1
        fi
    else
        log_info "Service-account user '$sa_user' already exists"
    fi

    log_info "Generating backend operator token for $sa_user..."
    local backend_token
    backend_token=$(osmo token set backend-token \
        --expires-at "$BACKEND_TOKEN_EXPIRY" \
        --description "Backend Operator Token" \
        --user "$sa_user" \
        --roles osmo-backend \
        -t json 2>/tmp/osmo-token-set.log | jq -r '.token' || echo "")

    if [[ -z "$backend_token" || "$backend_token" == "null" ]]; then
        log_error "Failed to mint backend-operator token (osmo CLI returned empty)"
        cat /tmp/osmo-token-set.log >&2 || true
        return 1
    fi

    local token_secret_yaml
    token_secret_yaml=$(kubectl create secret generic osmo-operator-token \
        --from-literal=token="$backend_token" \
        --namespace "$OSMO_OPERATOR_NAMESPACE" \
        --dry-run=client -o yaml)
    $RUN_KUBECTL_APPLY_STDIN "$token_secret_yaml"

    log_success "Backend token minted and stored in $OSMO_OPERATOR_NAMESPACE/osmo-operator-token"
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
    $RUN_HELM "uninstall osmo-operator --namespace $OSMO_OPERATOR_NAMESPACE" 2>/dev/null || true

    for namespace in "$OSMO_NAMESPACE" "$OSMO_OPERATOR_NAMESPACE" "$OSMO_WORKFLOWS_NAMESPACE"; do
        $RUN_KUBECTL "delete secret $NGC_SECRET_NAME --namespace $namespace --ignore-not-found=true" 2>/dev/null || true
    done

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
    create_image_pull_secrets

    # Resolve which static values fragments to layer (PodMonitor on/off,
    # backend-operator base file). Per-cluster overrides ride on --set.
    resolve_static_values

    # Layer values/gpu-pool.yaml when GPU nodes are detected.
    # 6.3 ConfigMap mode: pod template + pool defs go into Helm values, not CLI.
    render_gpu_pool_values

    deploy_osmo_service
    wait_for_pods "$OSMO_NAMESPACE" "${OSMO_WAIT_TIMEOUT_SERVICE:-300}" "" "$RUN_KUBECTL"

    setup_backend_operator
    wait_for_pods "$OSMO_OPERATOR_NAMESPACE" "${OSMO_WAIT_TIMEOUT_OPERATOR:-180}" "" "$RUN_KUBECTL"

    verify_deployment
    print_access_instructions
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    deploy_k8s_main "$@"
fi
