#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# MinIO storage backend for configure-storage.sh.
# Expects KUBECTL, NAMESPACE, OUTPUT_VALUES in env (set by the dispatcher).
#
# Discovers MinIO credentials in priority order:
#   1. MINIO_ROOT_USER + MINIO_ROOT_PASSWORD env vars
#   2. microk8s addon secret (minio-operator/microk8s-env-configuration)
#   3. bitnami chart secret (minio-operator/<release>-minio)
#
# Creates an `osmo-workflows` bucket via `mc` (idempotent: --ignore-existing).
# Writes 3 K8s Secrets (workflow-{data,log,app}-cred) and a Helm values
# fragment to $OUTPUT_VALUES.

set -euo pipefail

KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:?NAMESPACE not set}"
OUTPUT_VALUES="${OUTPUT_VALUES:?OUTPUT_VALUES not set}"
AUTH_METHOD="${AUTH_METHOD:-static}"
NGC_SECRET_NAME="${NGC_SECRET_NAME:-nvcr-secret}"

# MinIO is a self-hosted in-cluster S3 — no cloud-vendor identity provider.
# Workload identity is meaningless here.
if [[ "$AUTH_METHOD" == "workload-identity" ]]; then
    cat >&2 <<'MSG'
[ERROR] --auth-method workload-identity is not supported for the `minio` backend.

MinIO is self-hosted; there is no cloud-vendor identity provider to federate
against. Use --auth-method static (default) for MinIO, or switch to
--storage-backend azure-blob / byo to use Azure WI / AWS IRSA.
MSG
    exit 2
fi

MINIO_BUCKET="${MINIO_BUCKET:-osmo-workflows}"
MINIO_NAMESPACE="${MINIO_NAMESPACE:-minio-operator}"
MINIO_SVC_DNS="minio.${MINIO_NAMESPACE}.svc.cluster.local"
# Detect the actual Service port. The microk8s `minio` addon exposes the API on
# Service port 80 (targetPort 9000); install-minio.sh / bitnami chart uses 9000
# directly. Fallback to 9000 when discovery fails (Service not yet present).
MINIO_SVC_PORT=$($KUBECTL get svc minio -n "$MINIO_NAMESPACE" \
    -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)
MINIO_SVC_PORT="${MINIO_SVC_PORT:-9000}"
MINIO_ENDPOINT_URL="http://${MINIO_SVC_DNS}:${MINIO_SVC_PORT}"

read_creds_from_microk8s_addon() {
    local secret
    secret=$($KUBECTL get secret microk8s-env-configuration -n "$MINIO_NAMESPACE" \
        -o jsonpath='{.data.config\.env}' 2>/dev/null | base64 -d 2>/dev/null || true)
    [[ -z "$secret" ]] && return 1
    MINIO_USER=$(echo "$secret" | grep MINIO_ROOT_USER | cut -d'"' -f2)
    MINIO_PASS=$(echo "$secret" | grep MINIO_ROOT_PASSWORD | cut -d'"' -f2)
    [[ -n "$MINIO_USER" && -n "$MINIO_PASS" ]]
}

read_creds_from_install_secret() {
    # install-minio.sh writes credentials to secret `minio-root` with keys
    # root-user / root-password. Also matches the old bitnami chart layout
    # (`<release>-minio`) as a fallback.
    for candidate in minio-root minio "$($KUBECTL get secret -n "$MINIO_NAMESPACE" -o name 2>/dev/null | grep -E '/.*minio[^/]*$' | head -1 | cut -d/ -f2)"; do
        [[ -z "$candidate" ]] && continue
        MINIO_USER=$($KUBECTL get secret "$candidate" -n "$MINIO_NAMESPACE" \
            -o jsonpath='{.data.root-user}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
        MINIO_PASS=$($KUBECTL get secret "$candidate" -n "$MINIO_NAMESPACE" \
            -o jsonpath='{.data.root-password}' 2>/dev/null | base64 -d 2>/dev/null || echo "")
        if [[ -n "$MINIO_USER" && -n "$MINIO_PASS" ]]; then
            return 0
        fi
    done
    return 1
}

# 1. Discover credentials
if [[ -n "${MINIO_ROOT_USER:-}" && -n "${MINIO_ROOT_PASSWORD:-}" ]]; then
    MINIO_USER="$MINIO_ROOT_USER"
    MINIO_PASS="$MINIO_ROOT_PASSWORD"
    echo "[INFO] Using MinIO credentials from env vars"
elif read_creds_from_microk8s_addon; then
    echo "[INFO] Using MinIO credentials from microk8s addon secret"
elif read_creds_from_install_secret; then
    echo "[INFO] Using MinIO credentials from install-minio.sh secret"
else
    echo "[ERROR] Could not discover MinIO credentials. Set MINIO_ROOT_USER + MINIO_ROOT_PASSWORD" >&2
    exit 1
fi

# 2. Create the bucket via `mc` running as a one-shot pod inside the cluster.
# --ignore-existing makes this idempotent.
echo "[INFO] Ensuring MinIO bucket $MINIO_BUCKET exists"
$KUBECTL run minio-bucket-setup --rm -i --restart=Never \
    --namespace="$MINIO_NAMESPACE" \
    --image=minio/mc:latest --command -- \
    /bin/sh -c "
        mc alias set local $MINIO_ENDPOINT_URL '$MINIO_USER' '$MINIO_PASS' >/dev/null && \
        mc mb --ignore-existing local/$MINIO_BUCKET && \
        echo 'Bucket ready: $MINIO_BUCKET'
    " || { echo "[ERROR] mc bucket setup failed"; exit 1; }

# 3. Create 3 K8s Secrets, one per workflow_* credential reference.
# OSMO chart reads these via services.configs.workflow.workflow_*.credential.secretName
create_cred_secret() {
    local secret_name="$1"
    $KUBECTL create secret generic "$secret_name" -n "$NAMESPACE" \
        --from-literal=access_key_id="$MINIO_USER" \
        --from-literal=access_key="$MINIO_PASS" \
        --from-literal=endpoint="s3://$MINIO_BUCKET" \
        --from-literal=region="us-east-1" \
        --from-literal=override_url="$MINIO_ENDPOINT_URL" \
        --dry-run=client -o yaml | $KUBECTL apply -f -
}

create_cred_secret "osmo-workflow-data-cred"
create_cred_secret "osmo-workflow-log-cred"
create_cred_secret "osmo-workflow-app-cred"

# 4. Emit Helm values fragment.
# service.yaml's secretRefs is just `[nvcr-secret]` — the storage fragment
# replaces the full list to add the workflow-cred refs that the chart needs to
# mount at /etc/osmo/secrets/<name>/. Same pattern in azure-blob.sh / byo.sh
# (static branch).
cat > "$OUTPUT_VALUES" <<EOF
# Generated by configure-storage.sh --backend minio --auth-method static — DO NOT EDIT.
services:
  configs:
    secretRefs:
      - secretName: ${NGC_SECRET_NAME}
      - secretName: osmo-workflow-data-cred
      - secretName: osmo-workflow-log-cred
      - secretName: osmo-workflow-app-cred
    workflow:
      workflow_data:
        credential:
          secretName: osmo-workflow-data-cred
        base_url: s3://$MINIO_BUCKET
      workflow_log:
        credential:
          secretName: osmo-workflow-log-cred
      workflow_app:
        credential:
          secretName: osmo-workflow-app-cred
EOF

echo "[INFO] MinIO storage configured:"
echo "       bucket:      s3://$MINIO_BUCKET"
echo "       endpoint:    $MINIO_ENDPOINT_URL"
echo "       secrets:     osmo-workflow-{data,log,app}-cred in $NAMESPACE"
echo "       values:      $OUTPUT_VALUES"
