#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# RustFS storage backend for configure-storage.sh.
# Expects KUBECTL, NAMESPACE, OUTPUT_VALUES in env (set by the dispatcher).
#
# RustFS (rustfs.com) is a self-hosted, S3-compatible object store installed by
# install-rustfs.sh via the official Helm chart. This helper mirrors minio.sh:
# it discovers credentials, ensures the `osmo-workflows` bucket exists, writes
# the 3 workflow credential Secrets, and emits the Helm values fragment.
#
# Discovers RustFS credentials in priority order:
#   1. RUSTFS_ACCESS_KEY + RUSTFS_SECRET_KEY env vars
#   2. chart secret (rustfs/<release>-secret, keys RUSTFS_ACCESS_KEY/RUSTFS_SECRET_KEY)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:?NAMESPACE not set}"
OUTPUT_VALUES="${OUTPUT_VALUES:?OUTPUT_VALUES not set}"
AUTH_METHOD="${AUTH_METHOD:-static}"
NGC_SECRET_NAME="${NGC_SECRET_NAME:-}"

# RustFS is a self-hosted in-cluster S3 — no cloud-vendor identity provider.
# Workload identity is meaningless here (same as minio).
if [[ "$AUTH_METHOD" == "workload-identity" ]]; then
    cat >&2 <<'MSG'
[ERROR] --auth-method workload-identity is not supported for the `rustfs` backend.

RustFS is self-hosted; there is no cloud-vendor identity provider to federate
against. Use --auth-method static (default) for RustFS, or switch to
--storage-backend azure-blob / byo to use Azure WI / AWS IRSA.
MSG
    exit 2
fi

RUSTFS_RELEASE="${RUSTFS_RELEASE:-rustfs}"
RUSTFS_BUCKET="${RUSTFS_BUCKET:-${OSMO_WORKFLOW_BUCKET:-osmo-workflows}}"
RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_ADDRESSING_STYLE="${RUSTFS_ADDRESSING_STYLE:-${STORAGE_ADDRESSING_STYLE:-path}}"
validate_addressing_style "$RUSTFS_ADDRESSING_STYLE"
RUSTFS_SVC_DNS="${RUSTFS_RELEASE}-svc.${RUSTFS_NAMESPACE}.svc.cluster.local"
# Discover the Service port (chart default 9000). Fall back to 9000.
RUSTFS_SVC_PORT=$($KUBECTL get svc "${RUSTFS_RELEASE}-svc" -n "$RUSTFS_NAMESPACE" \
    -o jsonpath='{.spec.ports[?(@.name=="endpoint")].port}' 2>/dev/null || true)
RUSTFS_SVC_PORT="${RUSTFS_SVC_PORT:-9000}"
RUSTFS_ENDPOINT_URL="http://${RUSTFS_SVC_DNS}:${RUSTFS_SVC_PORT}"

read_creds_from_chart_secret() {
    # install-rustfs.sh deploys the rustfs chart, which writes credentials to
    # secret `<release>-secret` with keys RUSTFS_ACCESS_KEY / RUSTFS_SECRET_KEY.
    local secret_name="${RUSTFS_RELEASE}-secret"
    RUSTFS_USER=$($KUBECTL get secret "$secret_name" -n "$RUSTFS_NAMESPACE" \
        -o jsonpath='{.data.RUSTFS_ACCESS_KEY}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    RUSTFS_PASS=$($KUBECTL get secret "$secret_name" -n "$RUSTFS_NAMESPACE" \
        -o jsonpath='{.data.RUSTFS_SECRET_KEY}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
    [[ -n "$RUSTFS_USER" && -n "$RUSTFS_PASS" ]]
}

# 1. Discover credentials
if [[ -n "${RUSTFS_ACCESS_KEY:-}" && -n "${RUSTFS_SECRET_KEY:-}" ]]; then
    RUSTFS_USER="$RUSTFS_ACCESS_KEY"
    RUSTFS_PASS="$RUSTFS_SECRET_KEY"
    echo "[INFO] Using RustFS credentials from env vars"
elif read_creds_from_chart_secret; then
    echo "[INFO] Using RustFS credentials from chart secret ${RUSTFS_RELEASE}-secret"
else
    echo "[ERROR] Could not discover RustFS credentials. Set RUSTFS_ACCESS_KEY + RUSTFS_SECRET_KEY" >&2
    exit 1
fi

# 2. Create the bucket via the AWS CLI running as a one-shot pod inside the
#    cluster. RustFS is 100% S3-compatible, so we use the vendor-neutral
#    `aws s3api` (Apache-2.0) rather than MinIO's `mc` (AGPLv3) — pulling the
#    MinIO client to bootstrap a MinIO alternative would be both ironic and a
#    license mismatch for this Apache-2.0 repo. Path-style addressing is forced
#    to match how OSMO talks to the in-cluster endpoint (a bare Service DNS name
#    isn't virtual-host addressable). head-bucket makes this idempotent without
#    parsing provider-specific "already exists" error strings. A unique
#    per-invocation pod name avoids collisions with a prior run's helper pod
#    stuck Terminating; `--rm` reaps it; `timeout` guards against stuck image
#    pull / Pending-forever scheduling.
BUCKET_SETUP_TIMEOUT="${BUCKET_SETUP_TIMEOUT:-300}"
AWS_CLI_IMAGE="${AWS_CLI_IMAGE:-amazon/aws-cli:latest}"
BUCKET_SETUP_POD="rustfs-bucket-setup-$RANDOM-$RANDOM"
echo "[INFO] Ensuring RustFS bucket $RUSTFS_BUCKET exists (helper pod: $BUCKET_SETUP_POD)"
timeout "$BUCKET_SETUP_TIMEOUT" \
  $KUBECTL run "$BUCKET_SETUP_POD" --rm -i --restart=Never \
    --namespace="$RUSTFS_NAMESPACE" \
    --image="$AWS_CLI_IMAGE" --command -- \
    /bin/sh -c "
        set -e
        mkdir -p \$HOME/.aws
        printf '[default]\ns3 =\n  addressing_style = path\n' > \$HOME/.aws/config
        export AWS_ACCESS_KEY_ID='$RUSTFS_USER' AWS_SECRET_ACCESS_KEY='$RUSTFS_PASS' AWS_DEFAULT_REGION=us-east-1
        if aws --endpoint-url $RUSTFS_ENDPOINT_URL s3api head-bucket --bucket $RUSTFS_BUCKET 2>/dev/null; then
            echo 'Bucket already exists: $RUSTFS_BUCKET'
        else
            aws --endpoint-url $RUSTFS_ENDPOINT_URL s3api create-bucket --bucket $RUSTFS_BUCKET
            echo 'Bucket ready: $RUSTFS_BUCKET'
        fi
    " || { echo "[ERROR] aws-cli bucket setup failed"; exit 1; }

# 3. Create 3 K8s Secrets, one per workflow_* credential reference.
create_workflow_cred_secrets \
    "$RUSTFS_USER" "$RUSTFS_PASS" "s3://$RUSTFS_BUCKET" "us-east-1" "$RUSTFS_ENDPOINT_URL" \
    "$RUSTFS_ADDRESSING_STYLE"

# 4. Emit Helm values fragment.
emit_static_values_fragment rustfs "s3://$RUSTFS_BUCKET"

echo "[INFO] RustFS storage configured:"
echo "       bucket:      s3://$RUSTFS_BUCKET"
echo "       endpoint:    $RUSTFS_ENDPOINT_URL"
echo "       addressing:  $RUSTFS_ADDRESSING_STYLE"
echo "       secrets:     osmo-workflow-{data,log,app}-cred in $NAMESPACE"
echo "       values:      $OUTPUT_VALUES"
