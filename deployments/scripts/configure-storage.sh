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
#   --backend {auto|minio|azure-blob|byo|none}        Backend (default: auto)
#   --auth-method {static|workload-identity}          Auth mode (default: static)
#   --namespace NS                                    OSMO namespace (default: osmo-minimal)
#   --output-values PATH                              Where to write the values fragment
#                                                     (default: $SCRIPT_DIR/values/.storage-values.yaml)
#   --workload-identity-client-id ID                  Azure UAMI client ID (WI + azure-blob)
#   --workload-identity-role-arn ARN                  AWS IAM role ARN (WI + byo)
#   -h, --help                                        Show this help
#
# Backend selection:
#   auto       — Probe live signals: BYO env vars → microk8s minio addon →
#                helm-installed minio service → osmo Azure TF output → fail
#   minio      — Read MinIO root creds; create osmo-workflow-* Secrets
#   azure-blob — Read STORAGE_ACCOUNT/STORAGE_KEY (env or osmo TF) → connection string
#   byo        — Read all values from env vars (S3-compatible)
#   none       — Skip storage configuration entirely (caller will configure later)
#
# Auth modes:
#   static              — Workflow pods read static cloud credentials from
#                         K8s Secrets the script creates. Default. Works with
#                         any backend.
#   workload-identity   — No K8s Secrets created; OSMO services use the
#                         cluster's federated identity (AKS Workload Identity
#                         for azure-blob; AWS IRSA for byo). REQUIRES the
#                         caller to have provisioned the cloud-side identity
#                         (UAMI / IAM role) and storage RBAC out-of-band.
#                         Not supported for `minio` (no cloud-vendor identity
#                         provider exists).
#
# BYO env vars (--auth-method static):
#   STORAGE_ACCESS_KEY_ID   — required
#   STORAGE_ACCESS_KEY      — required
#   STORAGE_ENDPOINT        — required, e.g. s3://my-bucket
#   STORAGE_REGION          — optional (default us-east-1)
#   STORAGE_OVERRIDE_URL    — optional (e.g. https://s3.us-east-1.amazonaws.com)
#
# BYO env vars (--auth-method workload-identity, AWS IRSA):
#   WORKLOAD_IDENTITY_ROLE_ARN — required, e.g. arn:aws:iam::123:role/osmo-data-access
#   STORAGE_ENDPOINT           — required, e.g. s3://my-bucket
#   STORAGE_REGION             — optional (default us-east-1)
#   STORAGE_OVERRIDE_URL       — optional
#
# Azure-blob env vars (--auth-method static):
#   STORAGE_ACCOUNT         — Azure Storage Account name
#   STORAGE_KEY             — Account key
#   STORAGE_LOCATION        — Region (e.g. eastus2)
#                             (alternatively read from osmo Azure TF output)
#
# Azure-blob env vars (--auth-method workload-identity):
#   WORKLOAD_IDENTITY_CLIENT_ID — required, UAMI client ID (GUID)
#   STORAGE_ACCOUNT             — required, Azure Storage Account name
#   AZURE_CONTAINER_NAME        — optional (default: osmo-workflows)
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

BACKEND="auto"
AUTH_METHOD="${AUTH_METHOD:-static}"
NAMESPACE="${OSMO_NAMESPACE:-osmo-minimal}"
OUTPUT_VALUES="$SCRIPT_DIR/values/.storage-values.yaml"
NON_INTERACTIVE="${NON_INTERACTIVE:-false}"

while [[ $# -gt 0 ]]; do
    case $1 in
        --backend)
            BACKEND="$2"; shift 2 ;;
        --auth-method)
            AUTH_METHOD="$2"; shift 2 ;;
        --namespace)
            NAMESPACE="$2"; shift 2 ;;
        --output-values)
            OUTPUT_VALUES="$2"; shift 2 ;;
        --workload-identity-client-id)
            WORKLOAD_IDENTITY_CLIENT_ID="$2"; shift 2 ;;
        --workload-identity-role-arn)
            WORKLOAD_IDENTITY_ROLE_ARN="$2"; shift 2 ;;
        --non-interactive)
            NON_INTERACTIVE=true; shift ;;
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

case "$AUTH_METHOD" in
    static|workload-identity) ;;
    *)
        log_error "Unknown --auth-method '$AUTH_METHOD' (expected: static|workload-identity)"
        exit 1
        ;;
esac

KUBECTL="${KUBECTL:-kubectl}"
export KUBECTL NAMESPACE OUTPUT_VALUES AUTH_METHOD
[[ -n "${WORKLOAD_IDENTITY_CLIENT_ID:-}" ]] && export WORKLOAD_IDENTITY_CLIENT_ID
[[ -n "${WORKLOAD_IDENTITY_ROLE_ARN:-}" ]] && export WORKLOAD_IDENTITY_ROLE_ARN

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
# AWS S3 TF outputs → Azure Blob TF outputs. `auto` with no signal is a hard
# error — storage is required for any non-trivial OSMO workload.
if [[ "$BACKEND" == "auto" ]]; then
    if [[ -n "${STORAGE_ACCESS_KEY_ID:-}" || -n "${STORAGE_ENDPOINT:-}" ]]; then
        BACKEND="byo"
    elif command -v microk8s &>/dev/null && microk8s status --addon minio 2>/dev/null | grep -q "enabled"; then
        BACKEND="minio"
    elif $KUBECTL get svc minio -n minio-operator &>/dev/null; then
        BACKEND="minio"
    elif [[ -n "${STORAGE_BUCKET:-}" ]]; then
        BACKEND="s3"
    elif [[ -n "${STORAGE_ACCOUNT:-}" ]]; then
        BACKEND="azure-blob"
    else
        AWS_TF_DIR="$SCRIPT_DIR/../terraform/aws/example"
        AZURE_TF_DIR="$SCRIPT_DIR/../terraform/azure/example"
        if [[ -d "$AWS_TF_DIR" ]] && terraform -chdir="$AWS_TF_DIR" output s3_bucket &>/dev/null \
            && [[ -n "$(terraform -chdir="$AWS_TF_DIR" output -raw s3_bucket 2>/dev/null)" ]]; then
            BACKEND="s3"
        elif [[ -d "$AZURE_TF_DIR" ]] && terraform -chdir="$AZURE_TF_DIR" output storage_account &>/dev/null; then
            BACKEND="azure-blob"
        else
            cat >&2 <<'MSG'
ERROR: no storage backend detected. Pick one explicitly with --backend:

  --backend minio        — in-cluster MinIO (microk8s addon or helm-installed)
  --backend s3           — AWS S3; set STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID /
                           STORAGE_ACCESS_KEY (or use the osmo AWS TF outputs
                           when s3_bucket_enabled = true)
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
log_info "Auth method:    $AUTH_METHOD"
log_info "Namespace:      $NAMESPACE"
log_info "Output values fragment: $OUTPUT_VALUES"

# ────────────────────────────────────────────────────────────────────────────
# BIG WARNING when running with workload-identity auth.
# We do NOT provision the cloud-side identity (UAMI / IAM role / RBAC / OIDC
# federation) — those are owned by the caller (typically the platform/security
# team). Fail fast and visibly so users know what they need to have ready.
# ────────────────────────────────────────────────────────────────────────────
if [[ "$AUTH_METHOD" == "workload-identity" ]]; then
    case "$BACKEND" in
        azure-blob)
            cat >&2 <<EOF

${YELLOW}╔══════════════════════════════════════════════════════════════════════════════╗
║                  ⚠  WORKLOAD IDENTITY MODE — Azure Blob  ⚠                  ║
╚══════════════════════════════════════════════════════════════════════════════╝${NC}

${RED}This script does NOT provision Azure-side identity or storage RBAC.${NC}
You must have the following in place BEFORE this run, owned by your platform
/ security team (typically out-of-band Terraform or az CLI commands):

${CYAN}  1. AKS cluster has OIDC issuer + Workload Identity addons enabled${NC}
       az aks show -g <rg> -n <cluster> --query oidcIssuerProfile.enabled
       az aks show -g <rg> -n <cluster> --query securityProfile.workloadIdentity.enabled

${CYAN}  2. Azure Storage Account + Blob container exist and are reachable${NC}
       Account name: ${STORAGE_ACCOUNT:-<NOT SET>}
       Container:    ${AZURE_CONTAINER_NAME:-${OSMO_WORKFLOW_BUCKET:-osmo-workflows}}

${CYAN}  3. User-Assigned Managed Identity (UAMI) provisioned${NC}
       client-id:    ${WORKLOAD_IDENTITY_CLIENT_ID:-<NOT SET>}

${CYAN}  4. UAMI has 'Storage Blob Data Contributor' role on the storage account${NC}
       az role assignment create \\
         --role "Storage Blob Data Contributor" \\
         --assignee <UAMI-principal-id> \\
         --scope /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Storage/storageAccounts/${STORAGE_ACCOUNT:-<account>}

${CYAN}  5. Federated credential links UAMI to AKS OIDC issuer + namespace + SA${NC}
       az identity federated-credential create \\
         --name osmo-${NAMESPACE} \\
         --identity-name <UAMI-name> \\
         --resource-group <rg> \\
         --issuer <AKS-OIDC-issuer-URL> \\
         --subject "system:serviceaccount:${NAMESPACE}:osmo-minimal"

${RED}If ANY of these prerequisites is missing, OSMO services will start but workflows
will fail at runtime with 401/403 from Azure Blob. There is no safety net here.${NC}

EOF
            ;;
        byo)
            cat >&2 <<EOF

${YELLOW}╔══════════════════════════════════════════════════════════════════════════════╗
║                ⚠  WORKLOAD IDENTITY MODE — AWS IRSA / S3  ⚠                 ║
╚══════════════════════════════════════════════════════════════════════════════╝${NC}

${RED}This script does NOT provision AWS-side identity or S3 bucket policy.${NC}
You must have the following in place BEFORE this run, owned by your platform
/ security team:

${CYAN}  1. EKS cluster has an OIDC identity provider configured${NC}
       aws eks describe-cluster --name <cluster> \\
         --query "cluster.identity.oidc.issuer"

${CYAN}  2. S3 bucket exists and is reachable${NC}
       Endpoint: ${STORAGE_ENDPOINT:-<NOT SET>}

${CYAN}  3. IAM role provisioned with bucket access${NC}
       Role ARN: ${WORKLOAD_IDENTITY_ROLE_ARN:-<NOT SET>}
       Trust policy MUST admit:
         system:serviceaccount:${NAMESPACE}:osmo-minimal

${CYAN}  4. IAM policy attached to the role grants S3 read/write on the bucket${NC}
       Minimum: s3:GetObject s3:PutObject s3:DeleteObject s3:ListBucket
       Scope:   arn:aws:s3:::<bucket> arn:aws:s3:::<bucket>/*

${RED}If ANY of these prerequisites is missing, OSMO services will start but workflows
will fail at runtime with 401/403 from S3. There is no safety net here.${NC}

EOF
            ;;
        minio)
            log_error "Workload identity is not supported for the minio backend (no cloud-vendor IdP)."
            log_error "Use --auth-method static for minio, or switch to azure-blob / byo."
            exit 2
            ;;
    esac

    if [[ "$NON_INTERACTIVE" != "true" ]]; then
        echo -en "${YELLOW}Have you completed the prerequisites above? Type 'yes' to continue:${NC} " >&2
        read -r ack
        if [[ "$ack" != "yes" ]]; then
            log_error "Aborting. Re-run when the cloud-side prerequisites are in place."
            exit 1
        fi
    else
        log_warning "--non-interactive: skipping the WI prerequisite confirmation prompt."
        log_warning "Caller is responsible for the prerequisites listed above."
    fi
fi


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
