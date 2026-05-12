#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# AWS S3 storage backend for configure-storage.sh.
# Two auth modes:
#
#   --auth-method static (default)
#     Static IAM access keys. Resolves credentials from:
#       1. STORAGE_ACCESS_KEY_ID + STORAGE_ACCESS_KEY + STORAGE_BUCKET env vars
#       2. osmo AWS TF outputs (s3_bucket, s3_access_key_id, s3_secret_access_key)
#     Creates 3 K8s Secrets and emits a values fragment with secretName refs.
#
#   --auth-method workload-identity (AWS IRSA)
#     Defers to the BYO backend's IRSA path — IRSA needs a pre-provisioned
#     IAM role + OIDC trust policy; this script doesn't manage role creation.
#     Use --backend byo --auth-method workload-identity instead.

set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:?NAMESPACE not set}"
OUTPUT_VALUES="${OUTPUT_VALUES:?OUTPUT_VALUES not set}"
AUTH_METHOD="${AUTH_METHOD:-static}"
NGC_SECRET_NAME="${NGC_SECRET_NAME:-nvcr-secret}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"
TF_DIR="${TF_DIR:-$SCRIPT_DIR/../../terraform/aws/example}"

if [[ "$AUTH_METHOD" == "workload-identity" ]]; then
    cat >&2 <<'MSG'
[ERROR] --auth-method workload-identity is not supported on the s3 backend.
The osmo AWS TF doesn't manage IRSA role creation; use the byo backend
instead (it accepts an externally-provisioned role ARN):

  configure-storage.sh --backend byo --auth-method workload-identity
MSG
    exit 2
fi

# 1. Discover credentials + bucket.
#    Precedence: explicit env vars > AWS TF outputs.
if [[ -n "${STORAGE_ACCESS_KEY_ID:-}" && -n "${STORAGE_ACCESS_KEY:-}" \
   && -n "${STORAGE_BUCKET:-}" ]]; then
    BUCKET="$STORAGE_BUCKET"
    ACCESS_KEY_ID="$STORAGE_ACCESS_KEY_ID"
    SECRET_ACCESS_KEY="$STORAGE_ACCESS_KEY"
    REGION="${STORAGE_REGION:-${AWS_REGION:-us-west-2}}"
    echo "[INFO] Using S3 credentials from env vars (STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_ACCESS_KEY)"
elif command -v terraform &>/dev/null && [[ -d "$TF_DIR" ]] \
        && terraform -chdir="$TF_DIR" output s3_bucket &>/dev/null; then
    BUCKET=$(terraform -chdir="$TF_DIR" output -raw s3_bucket)
    ACCESS_KEY_ID=$(terraform -chdir="$TF_DIR" output -raw s3_access_key_id)
    SECRET_ACCESS_KEY=$(terraform -chdir="$TF_DIR" output -raw s3_secret_access_key)
    REGION=$(terraform -chdir="$TF_DIR" output -raw aws_region 2>/dev/null \
              || echo "${AWS_REGION:-us-west-2}")
    if [[ -z "$BUCKET" ]]; then
        cat >&2 <<MSG
[ERROR] AWS TF s3_bucket output is empty — bucket provisioning is disabled.
Set s3_bucket_enabled = true in terraform.tfvars and re-run TF apply, or
pass STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID / STORAGE_ACCESS_KEY explicitly.
MSG
        exit 1
    fi
    echo "[INFO] Using S3 credentials from osmo AWS TF outputs"
else
    cat >&2 <<'MSG'
[ERROR] S3 backend (static auth) requires credentials. Provide either:

  STORAGE_BUCKET=<bucket-name>
  STORAGE_ACCESS_KEY_ID=<aws-access-key-id>
  STORAGE_ACCESS_KEY=<aws-secret-access-key>

Optional:
  STORAGE_REGION       (default: $AWS_REGION or us-west-2)
  STORAGE_ADDRESSING_STYLE (virtual|path|auto)

or run osmo AWS terraform with `s3_bucket_enabled = true` and let the script
read its outputs from terraform/aws/example/.

For IRSA / workload-identity mode, use --backend byo instead.
MSG
    exit 1
fi

ENDPOINT="s3://${BUCKET}"
ADDRESSING_STYLE="${STORAGE_ADDRESSING_STYLE:-}"
validate_addressing_style "$ADDRESSING_STYLE"

# 2. Best-effort bucket reachability check via aws CLI when available.
#    Skip silently if the IAM user's keys haven't propagated yet (eventually
#    consistent — fresh IAM keys can lag a few seconds before Sigv4 accepts).
if command -v aws &>/dev/null; then
    echo "[INFO] Verifying access to s3://${BUCKET}"
    AWS_ACCESS_KEY_ID="$ACCESS_KEY_ID" \
    AWS_SECRET_ACCESS_KEY="$SECRET_ACCESS_KEY" \
    AWS_REGION="$REGION" \
        aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null \
        && echo "[INFO] Bucket $BUCKET is reachable" \
        || echo "[WARN] head-bucket failed; bucket may exist but IAM keys not yet propagated"
else
    echo "[INFO] aws CLI not available — skipping bucket reachability check"
fi

# 3. Create 3 K8s Secrets, one per workflow_* credential reference.
create_workflow_cred_secrets \
    "$ACCESS_KEY_ID" "$SECRET_ACCESS_KEY" "$ENDPOINT" "$REGION" "" "$ADDRESSING_STYLE"

# 4. Emit Helm values fragment.
emit_static_values_fragment s3 "$ENDPOINT"

echo "[INFO] S3 storage configured (static auth):"
echo "       bucket:     $BUCKET"
echo "       endpoint:   $ENDPOINT"
echo "       region:     $REGION"
echo "       addressing: ${ADDRESSING_STYLE:-<default>}"
echo "       secrets:    osmo-workflow-{data,log,app}-cred in $NAMESPACE"
echo "       values:     $OUTPUT_VALUES"
