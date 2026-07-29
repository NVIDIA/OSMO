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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

KUBECTL="${KUBECTL:-kubectl}"
NAMESPACE="${NAMESPACE:?NAMESPACE not set}"
OUTPUT_VALUES="${OUTPUT_VALUES:?OUTPUT_VALUES not set}"
AUTH_METHOD="${AUTH_METHOD:-static}"
NGC_SECRET_NAME="${NGC_SECRET_NAME:-}"

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

MINIO_BUCKET="${MINIO_BUCKET:-${OSMO_WORKFLOW_BUCKET:-osmo-workflows}}"
MINIO_NAMESPACE="${MINIO_NAMESPACE:-minio-operator}"
MINIO_ADDRESSING_STYLE="${MINIO_ADDRESSING_STYLE:-${STORAGE_ADDRESSING_STYLE:-path}}"
validate_addressing_style "$MINIO_ADDRESSING_STYLE"
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
#    `mc mb --ignore-existing` makes the bucket-creation idempotent, but the
#    pod itself isn't. A unique per-invocation pod name sidesteps the case
#    where a prior run left a pod stuck Terminating (e.g. CNI plugin errors
#    blocking sandbox teardown) — the fixed name approach + delete-first
#    still hangs there because force-delete-on-stuck isn't a path we can
#    silently take from inside an automation.
#    Deliberately NOT `kubectl run -i`: attaching races a container that exits
#    in well under a second, and kubectl's log fallback then races pod
#    teardown — both lose intermittently and report failure even though the
#    bucket was created. Run detached, poll for a terminal phase, then read
#    the logs. (`--rm` isn't available without `-i`, hence the explicit
#    delete.)
BUCKET_SETUP_TIMEOUT="${BUCKET_SETUP_TIMEOUT:-300}"
BUCKET_SETUP_POD="minio-bucket-setup-$RANDOM-$RANDOM"
echo "[INFO] Ensuring MinIO bucket $MINIO_BUCKET exists (helper pod: $BUCKET_SETUP_POD)"
$KUBECTL run "$BUCKET_SETUP_POD" --restart=Never --attach=false \
    --namespace="$MINIO_NAMESPACE" \
    --image=minio/mc:latest --command -- \
    /bin/sh -c "
        mc alias set local $MINIO_ENDPOINT_URL '$MINIO_USER' '$MINIO_PASS' >/dev/null && \
        mc mb --ignore-existing local/$MINIO_BUCKET && \
        echo 'Bucket ready: $MINIO_BUCKET'
    " >/dev/null

bucket_setup_phase=""
bucket_setup_deadline=$(( $(date +%s) + BUCKET_SETUP_TIMEOUT ))
while [ "$(date +%s)" -lt "$bucket_setup_deadline" ]; do
    bucket_setup_phase=$($KUBECTL get pod "$BUCKET_SETUP_POD" --namespace="$MINIO_NAMESPACE" \
        -o jsonpath='{.status.phase}' 2>/dev/null || true)
    case "$bucket_setup_phase" in Succeeded|Failed) break ;; esac
    sleep 2
done

$KUBECTL logs "$BUCKET_SETUP_POD" --namespace="$MINIO_NAMESPACE" 2>/dev/null || true
$KUBECTL delete pod "$BUCKET_SETUP_POD" --namespace="$MINIO_NAMESPACE" \
    --ignore-not-found --wait=false >/dev/null 2>&1 || true

if [ "$bucket_setup_phase" != "Succeeded" ]; then
    echo "[ERROR] mc bucket setup failed (pod phase: ${bucket_setup_phase:-timed out after ${BUCKET_SETUP_TIMEOUT}s})"
    exit 1
fi

# 3. Create 3 K8s Secrets, one per workflow_* credential reference.
create_workflow_cred_secrets \
    "$MINIO_USER" "$MINIO_PASS" "s3://$MINIO_BUCKET" "us-east-1" "$MINIO_ENDPOINT_URL" \
    "$MINIO_ADDRESSING_STYLE"

# 4. Emit Helm values fragment.
emit_static_values_fragment minio "s3://$MINIO_BUCKET"

echo "[INFO] MinIO storage configured:"
echo "       bucket:      s3://$MINIO_BUCKET"
echo "       endpoint:    $MINIO_ENDPOINT_URL"
echo "       addressing:  $MINIO_ADDRESSING_STYLE"
echo "       secrets:     osmo-workflow-{data,log,app}-cred in $NAMESPACE"
echo "       values:      $OUTPUT_VALUES"
