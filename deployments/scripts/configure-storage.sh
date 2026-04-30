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
# Configure OSMO storage backend (6.3 ConfigMap mode)
#
# Generates K8s Secrets for OSMO workflow storage credentials and emits a Helm
# values fragment that the chart consumes via
# `services.configs.workflow.workflow_*.credential.secretName`.
#
# Runs BEFORE the OSMO helm install — values must be ready at install time.
# In 6.3, CLI-based config writes (`osmo config update`, `osmo credential set`)
# return HTTP 409, so all storage configuration must be in Helm values.
#
# Usage:
#   configure-storage.sh [options]
#
# Options:
#   --backend {auto|minio|azure-blob|byo|none}   Backend selection (default: auto)
#   --namespace NS                               OSMO namespace (default: osmo-minimal)
#   --output-values PATH                         Where to write the values fragment
#                                                (default: $SCRIPT_DIR/values/.storage-values.yaml)
#   -h, --help                                   Show this help
#
# Backend selection:
#   auto       — Probe live signals: BYO env vars → microk8s minio addon →
#                helm-installed minio service → osmo Azure TF output → fail
#   minio      — Read MinIO root creds; create osmo-workflow-* Secrets
#   azure-blob — Read STORAGE_ACCOUNT/STORAGE_KEY (env or osmo TF) → connection string
#   byo        — Read all values from env vars (S3-compatible)
#   none       — Skip storage configuration entirely (caller will configure later)
#
# BYO env vars:
#   STORAGE_ACCESS_KEY_ID   — required
#   STORAGE_ACCESS_KEY      — required
#   STORAGE_ENDPOINT        — required, e.g. s3://my-bucket
#   STORAGE_REGION          — optional (default us-east-1)
#   STORAGE_OVERRIDE_URL    — optional (e.g. https://s3.us-east-1.amazonaws.com)
#
# Azure-blob env vars (used when --backend azure-blob):
#   STORAGE_ACCOUNT         — Azure Storage Account name
#   STORAGE_KEY             — Account key
#   STORAGE_LOCATION        — Region (e.g. eastus2), used to build endpoint
#                             (alternatively read from osmo Azure TF output)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

BACKEND="auto"
NAMESPACE="${OSMO_NAMESPACE:-osmo-minimal}"
OUTPUT_VALUES="$SCRIPT_DIR/values/.storage-values.yaml"

while [[ $# -gt 0 ]]; do
    case $1 in
        --backend)
            BACKEND="$2"; shift 2 ;;
        --namespace)
            NAMESPACE="$2"; shift 2 ;;
        --output-values)
            OUTPUT_VALUES="$2"; shift 2 ;;
        -h|--help)
            sed -n '/^# Usage:/,/^###/p' "${BASH_SOURCE[0]}" | sed 's/^# \?//'
            exit 0
            ;;
        *)
            log_error "Unknown argument: $1"
            exit 1
            ;;
    esac
done

KUBECTL="${KUBECTL:-kubectl}"
export KUBECTL NAMESPACE OUTPUT_VALUES

if [[ "$BACKEND" == "none" ]]; then
    log_info "Storage backend = none — skipping storage configuration"
    : > "$OUTPUT_VALUES"
    exit 0
fi

check_command "$KUBECTL"

if ! $KUBECTL cluster-info &>/dev/null; then
    log_error "kubectl cannot reach the cluster"
    exit 1
fi

# Auto-detect backend by probing live signals. BYO wins if any BYO env var is
# set (explicit opt-in). Otherwise probe MicroK8s addon → existing MinIO svc →
# Azure Blob TF outputs. `auto` with no signal is a hard error — storage is
# required for any non-trivial OSMO workload.
if [[ "$BACKEND" == "auto" ]]; then
    if [[ -n "${STORAGE_ACCESS_KEY_ID:-}" || -n "${STORAGE_ENDPOINT:-}" ]]; then
        BACKEND="byo"
    elif command -v microk8s &>/dev/null && microk8s status --addon minio 2>/dev/null | grep -q "enabled"; then
        BACKEND="minio"
    elif $KUBECTL get svc minio -n minio-operator &>/dev/null; then
        BACKEND="minio"
    elif [[ -n "${STORAGE_ACCOUNT:-}" ]]; then
        BACKEND="azure-blob"
    else
        TF_DIR="$SCRIPT_DIR/../terraform/azure/example"
        if [[ -d "$TF_DIR" ]] && terraform -chdir="$TF_DIR" output storage_account &>/dev/null; then
            BACKEND="azure-blob"
        else
            cat >&2 <<'MSG'
ERROR: no storage backend detected. Pick one explicitly with --backend:

  --backend minio        — in-cluster MinIO (microk8s addon or helm-installed)
  --backend azure-blob   — Azure Blob Storage; set STORAGE_ACCOUNT and STORAGE_KEY
                           (or use the osmo Azure TF Storage Account output)
  --backend byo          — bring-your-own S3-compatible; set:
                             STORAGE_ACCESS_KEY_ID STORAGE_ACCESS_KEY
                             STORAGE_ENDPOINT [STORAGE_REGION] [STORAGE_OVERRIDE_URL]
  --backend none         — skip storage configuration entirely
MSG
            exit 1
        fi
    fi
fi

log_info "Storage backend: $BACKEND"
log_info "Namespace: $NAMESPACE"
log_info "Output values fragment: $OUTPUT_VALUES"

HELPER="$SCRIPT_DIR/storage/${BACKEND}.sh"
if [[ ! -f "$HELPER" ]]; then
    log_error "Unknown backend '$BACKEND' (no helper at $HELPER)"
    log_error "Available: $(ls "$SCRIPT_DIR/storage/" 2>/dev/null | sed 's/\.sh$//' | tr '\n' ' ')"
    exit 1
fi

mkdir -p "$(dirname "$OUTPUT_VALUES")"
$KUBECTL get namespace "$NAMESPACE" &>/dev/null \
    || $KUBECTL create namespace "$NAMESPACE"

# Run with bash so the helper doesn't need the executable bit set
bash "$HELPER"

if [[ ! -s "$OUTPUT_VALUES" ]]; then
    log_error "Backend '$BACKEND' did not write a values fragment to $OUTPUT_VALUES"
    exit 1
fi

log_success "Storage configured. Values fragment: $OUTPUT_VALUES"
log_info "Pass to helm: helm install ... --values $OUTPUT_VALUES"
