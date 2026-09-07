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
# Install RustFS (in-cluster S3 backend for OSMO workflow storage)
#
# Used when --storage-backend rustfs is selected. RustFS (rustfs.com) is a
# self-hosted, S3-compatible object store and a drop-in alternative to MinIO.
# Installed via the official Helm chart (https://charts.rustfs.com) in
# standalone mode (single pod, single PVC) — the right shape for the
# single-node / eval clusters this deployer targets.
#
# Critical performance settings (set unconditionally — see chart configmap):
#   config.rustfs.obs_environment -> RUSTFS_OBS_ENVIRONMENT  = "production"
#   config.rustfs.log_level       -> RUSTFS_OBS_LOGGER_LEVEL = "warn"
# Leaving these at the chart defaults ("development" / "info") makes RustFS log
# verbosely on the hot path and degrades throughput significantly.
#
# RustFS runs without resource limits — its throughput is sensitive to CPU
# throttling, and the chart's tiny defaults (200m CPU / 512Mi mem limits) would
# hobble it. We emit `resources: {}` so neither requests nor limits are set.
#
# MinIO exclusivity: RustFS and MinIO are mutually exclusive, but this script
# never uninstalls an existing MinIO — it simply doesn't install or add one.
# microk8s/install.sh skips enabling the `minio` addon for --storage-backend
# rustfs, so a fresh bootstrap never brings it up in the first place.
#
# Skips when:
#  - a rustfs helm release already exists in the target namespace
#  - a ready rustfs Deployment already exists in the target namespace
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_RELEASE="${RUSTFS_RELEASE:-rustfs}"
RUSTFS_CHART_REPO_NAME="${RUSTFS_CHART_REPO_NAME:-rustfs}"
RUSTFS_CHART_REPO_URL="${RUSTFS_CHART_REPO_URL:-https://charts.rustfs.com}"
# Pin the chart version for reproducible installs. Empty = latest in the repo.
RUSTFS_CHART_VERSION="${RUSTFS_CHART_VERSION:-}"
# Optional image tag override (chart appVersion default when unset).
RUSTFS_IMAGE_TAG="${RUSTFS_IMAGE_TAG:-}"
RUSTFS_STORAGE_SIZE="${RUSTFS_STORAGE_SIZE:-20Gi}"
RUSTFS_LOG_STORAGE_SIZE="${RUSTFS_LOG_STORAGE_SIZE:-1Gi}"
# StorageClass for the RustFS PVCs. Empty = use the cluster default, falling
# back to the first StorageClass found (same logic as install-minio.sh).
RUSTFS_STORAGE_CLASS="${RUSTFS_STORAGE_CLASS:-}"
# The chart rejects the well-known default credentials (rustfsadmin/rustfsadmin)
# unless secret.allowInsecureDefaults=true, so both keys must be non-default.
RUSTFS_ACCESS_KEY="${RUSTFS_ACCESS_KEY:-osmoadmin}"
RUSTFS_SECRET_KEY="${RUSTFS_SECRET_KEY:-}"
RUSTFS_ROLLOUT_TIMEOUT="${RUSTFS_ROLLOUT_TIMEOUT:-5m}"

KUBECTL="${KUBECTL:-kubectl}"
HELM="${HELM:-helm}"

detect_existing_rustfs() {
    if $HELM status "$RUSTFS_RELEASE" -n "$RUSTFS_NAMESPACE" &>/dev/null; then
        echo "helm release $RUSTFS_RELEASE/$RUSTFS_NAMESPACE"
        return 0
    fi
    if $KUBECTL get svc "$RUSTFS_RELEASE-svc" -n "$RUSTFS_NAMESPACE" &>/dev/null \
        && [[ "$($KUBECTL get deployment "$RUSTFS_RELEASE" -n "$RUSTFS_NAMESPACE" -o jsonpath='{.status.availableReplicas}' 2>/dev/null)" -ge 1 ]]; then
        echo "deployment $RUSTFS_RELEASE/$RUSTFS_NAMESPACE"
        return 0
    fi
    return 1
}

main() {
    check_command "$KUBECTL"
    check_command "$HELM"

    # Note: if MinIO is already installed we leave it alone — RustFS and MinIO
    # are mutually exclusive, but we never uninstall a pre-existing MinIO.
    if microk8s_addon_enabled minio; then
        log_warning "MicroK8s 'minio' addon is enabled. RustFS is being installed alongside it;"
        log_warning "OSMO will use RustFS for storage. To remove MinIO, run 'microk8s disable minio' yourself."
    fi

    local detection
    if detection=$(detect_existing_rustfs); then
        log_warning "RustFS already provided by: $detection — skipping"
        return 0
    fi

    if [[ -z "$RUSTFS_SECRET_KEY" ]]; then
        check_command openssl
        RUSTFS_SECRET_KEY=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
        log_info "Generated RustFS secret key (set RUSTFS_SECRET_KEY to override)"
    fi

    # Resolve PVC StorageClass: explicit override -> cluster default -> first SC.
    # The chart writes storageClassName verbatim into the PVCs, so an empty
    # value would disable the default-class fallback and leave them Pending.
    if [[ -z "$RUSTFS_STORAGE_CLASS" ]]; then
        RUSTFS_STORAGE_CLASS="$($KUBECTL get storageclass \
            -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' \
            2>/dev/null | head -n1)"
    fi
    if [[ -z "$RUSTFS_STORAGE_CLASS" ]]; then
        RUSTFS_STORAGE_CLASS="$($KUBECTL get storageclass \
            -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    fi
    if [[ -n "$RUSTFS_STORAGE_CLASS" ]]; then
        log_info "Using StorageClass: $RUSTFS_STORAGE_CLASS"
    else
        log_warning "No StorageClass found; RustFS PVCs may stay Pending"
    fi

    log_info "Installing RustFS into namespace $RUSTFS_NAMESPACE (standalone mode)"

    $HELM repo add "$RUSTFS_CHART_REPO_NAME" "$RUSTFS_CHART_REPO_URL" --force-update >/dev/null
    $HELM repo update "$RUSTFS_CHART_REPO_NAME" >/dev/null

    local values_file
    values_file="$(mktemp)"
    trap 'rm -f "$values_file"' RETURN

    cat > "$values_file" <<EOF
# Generated by install-rustfs.sh — DO NOT EDIT.
# Standalone single-pod deployment for OSMO in-cluster S3 storage.
mode:
  standalone:
    enabled: true
  distributed:
    enabled: false
replicaCount: 1

# No cluster ingress — OSMO reaches RustFS via the in-cluster Service.
ingress:
  enabled: false

# Single node: pods can't spread across hosts, so anti-affinity must be off.
affinity:
  podAntiAffinity:
    enabled: false

secret:
  rustfs:
    access_key: "$RUSTFS_ACCESS_KEY"
    secret_key: "$RUSTFS_SECRET_KEY"

config:
  rustfs:
    # Performance-critical: production observability + warn-level logging.
    obs_environment: "production"
    log_level: "warn"
    region: "us-east-1"

# RustFS runs without resource limits — empty so neither requests nor limits
# are set. The chart defaults (200m CPU / 512Mi mem limits) throttle throughput.
resources: {}

storageclass:
  dataStorageSize: "$RUSTFS_STORAGE_SIZE"
  logStorageSize: "$RUSTFS_LOG_STORAGE_SIZE"
EOF

    if [[ -n "$RUSTFS_STORAGE_CLASS" ]]; then
        echo "  name: \"$RUSTFS_STORAGE_CLASS\"" >> "$values_file"
    fi

    if [[ -n "$RUSTFS_IMAGE_TAG" ]]; then
        cat >> "$values_file" <<EOF
image:
  rustfs:
    tag: "$RUSTFS_IMAGE_TAG"
EOF
    fi

    local version_arg=()
    [[ -n "$RUSTFS_CHART_VERSION" ]] && version_arg=(--version "$RUSTFS_CHART_VERSION")

    $HELM upgrade --install "$RUSTFS_RELEASE" "$RUSTFS_CHART_REPO_NAME/rustfs" \
        --namespace "$RUSTFS_NAMESPACE" --create-namespace \
        --values "$values_file" \
        "${version_arg[@]}" \
        --wait --timeout "$RUSTFS_ROLLOUT_TIMEOUT"

    log_success "RustFS installed in namespace $RUSTFS_NAMESPACE"
    log_info "Access key: $RUSTFS_ACCESS_KEY (credentials in secret $RUSTFS_RELEASE-secret/$RUSTFS_NAMESPACE)"
}

main "$@"
