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
# Install MinIO (in-cluster S3 backend for OSMO workflow storage)
#
# Used when --storage-backend minio is selected and no MinIO is already running.
# Deploys a single-pod MinIO via plain K8s manifests using the official
# quay.io/minio/minio image. Bitnami's free Docker Hub images were deprecated
# in 2025, and this self-contained path avoids any chart-registry dependency.
#
# Skips when:
#  - microk8s `minio` addon is enabled (single-node K8s)
#  - a `minio` service already exists in the target namespace
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

MINIO_NAMESPACE="${MINIO_NAMESPACE:-minio-operator}"
MINIO_IMAGE="${MINIO_IMAGE:-quay.io/minio/minio:RELEASE.2025-09-07T16-13-09Z}"
MINIO_STORAGE_SIZE="${MINIO_STORAGE_SIZE:-20Gi}"
# StorageClass for the MinIO PVC. Empty = use the cluster default. Some
# clusters (EKS bootstrap, bare clusters) have a SC available but no default
# marked, so we detect that case below and fall back to the first SC found.
MINIO_STORAGE_CLASS="${MINIO_STORAGE_CLASS:-}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-osmoadmin}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-}"
MINIO_API_PORT="${MINIO_API_PORT:-9000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"
MINIO_ROLLOUT_TIMEOUT="${MINIO_ROLLOUT_TIMEOUT:-5m}"

KUBECTL="${KUBECTL:-kubectl}"

detect_existing_minio() {
    if microk8s_addon_enabled minio; then
        echo "microk8s minio addon"
        return 0
    fi
    # A working install needs both Service AND Deployment ready. Bare Services
    # without a backing Deployment are stale leftovers, not a working MinIO.
    if $KUBECTL get svc minio -n "$MINIO_NAMESPACE" &>/dev/null \
        && [[ "$($KUBECTL get deployment minio -n "$MINIO_NAMESPACE" -o jsonpath='{.status.availableReplicas}' 2>/dev/null)" -ge 1 ]]; then
        echo "deployment minio/$MINIO_NAMESPACE"
        return 0
    fi
    return 1
}

main() {
    check_command "$KUBECTL"

    local detection
    if detection=$(detect_existing_minio); then
        log_warning "MinIO already provided by: $detection — skipping"
        return 0
    fi

    if [[ -z "$MINIO_ROOT_PASSWORD" ]]; then
        check_command openssl
        MINIO_ROOT_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
        log_info "Generated MinIO root password (set MINIO_ROOT_PASSWORD to override)"
    fi

    # Resolve PVC StorageClass: explicit override → cluster default → first SC.
    # Bare clusters often have an SC available but no default-class annotation;
    # without this, the PVC stays Pending and the rollout times out.
    if [[ -z "$MINIO_STORAGE_CLASS" ]]; then
        MINIO_STORAGE_CLASS="$($KUBECTL get storageclass \
            -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' \
            2>/dev/null | head -n1)"
    fi
    if [[ -z "$MINIO_STORAGE_CLASS" ]]; then
        MINIO_STORAGE_CLASS="$($KUBECTL get storageclass \
            -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)"
    fi
    local pvc_sc_line=""
    if [[ -n "$MINIO_STORAGE_CLASS" ]]; then
        pvc_sc_line="  storageClassName: $MINIO_STORAGE_CLASS"
        log_info "Using StorageClass: $MINIO_STORAGE_CLASS"
    else
        log_warning "No StorageClass found; PVC will rely on cluster behavior and may stay Pending"
    fi

    log_info "Installing MinIO into namespace $MINIO_NAMESPACE"

    $KUBECTL get namespace "$MINIO_NAMESPACE" &>/dev/null \
        || $KUBECTL create namespace "$MINIO_NAMESPACE"

    # Apply credentials secret first (referenced by the Deployment)
    $KUBECTL create secret generic minio-root \
        --namespace "$MINIO_NAMESPACE" \
        --from-literal=root-user="$MINIO_ROOT_USER" \
        --from-literal=root-password="$MINIO_ROOT_PASSWORD" \
        --dry-run=client -o yaml | $KUBECTL apply -f -

    cat <<EOF | $KUBECTL apply -f -
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: minio-data
  namespace: $MINIO_NAMESPACE
spec:
  accessModes: [ReadWriteOnce]
${pvc_sc_line}
  resources:
    requests:
      storage: $MINIO_STORAGE_SIZE
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: minio
  namespace: $MINIO_NAMESPACE
  labels:
    app.kubernetes.io/name: minio
spec:
  replicas: 1
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: minio
  template:
    metadata:
      labels:
        app.kubernetes.io/name: minio
    spec:
      containers:
      - name: minio
        image: $MINIO_IMAGE
        args: ["server", "/data", "--console-address", ":$MINIO_CONSOLE_PORT"]
        env:
        - name: MINIO_ROOT_USER
          valueFrom: { secretKeyRef: { name: minio-root, key: root-user } }
        - name: MINIO_ROOT_PASSWORD
          valueFrom: { secretKeyRef: { name: minio-root, key: root-password } }
        ports:
        - { name: api, containerPort: $MINIO_API_PORT }
        - { name: console, containerPort: $MINIO_CONSOLE_PORT }
        volumeMounts:
        - { name: data, mountPath: /data }
        readinessProbe:
          httpGet: { path: /minio/health/ready, port: $MINIO_API_PORT }
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet: { path: /minio/health/live, port: $MINIO_API_PORT }
          initialDelaySeconds: 30
          periodSeconds: 30
        resources:
          requests: { cpu: 100m, memory: 256Mi }
          limits:   { cpu: "2", memory: 2Gi }
      volumes:
      - name: data
        persistentVolumeClaim:
          claimName: minio-data
---
apiVersion: v1
kind: Service
metadata:
  name: minio
  namespace: $MINIO_NAMESPACE
  labels:
    app.kubernetes.io/name: minio
spec:
  type: ClusterIP
  selector:
    app.kubernetes.io/name: minio
  ports:
  - { name: api,     port: $MINIO_API_PORT,     targetPort: $MINIO_API_PORT }
  - { name: console, port: $MINIO_CONSOLE_PORT, targetPort: $MINIO_CONSOLE_PORT }
EOF

    log_info "Waiting for MinIO to become Ready..."
    $KUBECTL rollout status deployment/minio -n "$MINIO_NAMESPACE" --timeout="$MINIO_ROLLOUT_TIMEOUT"

    log_success "MinIO installed in namespace $MINIO_NAMESPACE"
    log_info "Root user: $MINIO_ROOT_USER (credentials in secret minio-root/$MINIO_NAMESPACE)"
}

main "$@"
