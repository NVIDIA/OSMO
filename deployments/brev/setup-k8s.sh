#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION. All rights reserved.
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

set -e

# OSMO Single-node Kubernetes Deployment Script
# For use with Brev's "Single-node Kubernetes" mode which provides:
#   MicroK8s, GPU Operator, DNS, Hostpath Storage, kubectl, Helm 3
# This script installs KAI Scheduler and OSMO on the pre-configured cluster.

echo "=================================================="
echo "OSMO Single-node K8s Deployment Script"
echo "=================================================="
echo ""

print_status() {
    echo "[INFO] $1"
}

print_warning() {
    echo "[WARN] $1"
}

print_error() {
    echo "[ERROR] $1"
}

command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# ============================================
# Version Constants
# ============================================
KAI_SCHEDULER_VERSION="v0.13.4"

# LocalStack S3 object storage settings
LOCALSTACK_S3_HOST="localstack-s3.osmo"
LOCALSTACK_S3_PORT="4566"
LOCALSTACK_S3_OVERRIDE_URL="http://${LOCALSTACK_S3_HOST}:${LOCALSTACK_S3_PORT}"
LOCALSTACK_S3_ENDPOINT="s3://osmo"
LOCALSTACK_S3_ACCESS_KEY_ID="test"
LOCALSTACK_S3_ACCESS_KEY="test"
LOCALSTACK_S3_REGION="us-east-1"

# ============================================
# Step 0: Validate Prerequisites
# ============================================
print_status "Validating prerequisites..."

# Verify kubectl works
if ! kubectl get nodes >/dev/null 2>&1; then
    print_error "kubectl cannot reach the cluster. Is MicroK8s running?"
    exit 1
fi
print_status "Cluster is reachable"

# Show cluster info
kubectl get nodes -o wide
echo ""

# Check for GPU availability
print_status "Checking GPU availability..."
if kubectl get nodes -o json | python3 -c "
import json, sys
nodes = json.load(sys.stdin)['items']
for n in nodes:
    gpus = n.get('status', {}).get('capacity', {}).get('nvidia.com/gpu', '0')
    print(f\"  Node {n['metadata']['name']}: {gpus} GPU(s)\")
    if int(gpus) > 0:
        sys.exit(0)
sys.exit(1)
" 2>/dev/null; then
    print_status "GPU(s) detected in cluster"
else
    print_warning "No GPUs detected yet — GPU operator may still be initializing"
fi

# Check storage class
print_status "Available storage classes:"
kubectl get storageclass 2>/dev/null || print_warning "No storage classes found"

# Detect the storage class to use
STORAGE_CLASS=""
if kubectl get storageclass microk8s-hostpath >/dev/null 2>&1; then
    STORAGE_CLASS="microk8s-hostpath"
elif kubectl get storageclass standard >/dev/null 2>&1; then
    STORAGE_CLASS="standard"
else
    # Use whatever default storage class exists
    STORAGE_CLASS=$(kubectl get storageclass -o jsonpath='{.items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")].metadata.name}' 2>/dev/null || echo "")
    if [ -z "$STORAGE_CLASS" ]; then
        print_warning "No default storage class found — PVCs may fail"
        STORAGE_CLASS="microk8s-hostpath"
    fi
fi
print_status "Using storage class: $STORAGE_CLASS"

# ============================================
# Step 1: Label node for OSMO scheduling
# ============================================
# The OSMO Helm chart uses nodeSelector with node_group labels to place pods.
# In a multi-node KIND cluster these map to separate worker nodes (service,
# data, compute, ingress, kai-scheduler). On a single-node cluster we label
# the only node as "compute" and point every chart nodeSelector at it.
NODE_NAME=$(kubectl get nodes -o jsonpath='{.items[0].metadata.name}')
print_status "Labeling node $NODE_NAME with node_group=compute..."
kubectl label node "$NODE_NAME" node_group=compute --overwrite

# ============================================
# Step 2: Install KAI Scheduler
# ============================================
print_status "Installing KAI Scheduler..."

helm upgrade --install kai-scheduler \
  oci://ghcr.io/kai-scheduler/kai-scheduler/kai-scheduler \
  --version ${KAI_SCHEDULER_VERSION} \
  --create-namespace -n kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true"

print_status "Waiting for KAI Scheduler pods..."
kubectl -n kai-scheduler wait --for=condition=Available deployment --all --timeout=300s
print_status "KAI Scheduler ready"

# ============================================
# Step 3: Install OSMO
# ============================================
print_status "Installing OSMO (this may take 5-10 minutes)..."

helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update

# All nodeSelectors are pointed at "compute" to match the label applied in
# Step 1. The chart defaults use different node_group values (service, data,
# ingress) for multi-node clusters — here we unify them onto the single node.
helm upgrade --install osmo osmo/quick-start \
  --namespace osmo \
  --create-namespace \
  --set global.nodeSelector.node_group=compute \
  --set service.services.postgres.nodeSelector.node_group=compute \
  --set service.services.postgres.storageClassName="${STORAGE_CLASS}" \
  --set service.services.redis.nodeSelector.node_group=compute \
  --set service.services.redis.storageClassName="${STORAGE_CLASS}" \
  --set service.services.localstackS3.nodeSelector.node_group=compute \
  --set ingress-nginx.controller.nodeSelector.node_group=compute \
  --set ingress-nginx.controller.admissionWebhooks.nodeSelector.node_group=compute \
  --set global.objectStorage.endpoint="${LOCALSTACK_S3_ENDPOINT}" \
  --set global.objectStorage.overrideUrl="${LOCALSTACK_S3_OVERRIDE_URL}" \
  --set global.objectStorage.accessKeyId="${LOCALSTACK_S3_ACCESS_KEY_ID}" \
  --set global.objectStorage.accessKey="${LOCALSTACK_S3_ACCESS_KEY}" \
  --set global.objectStorage.region="${LOCALSTACK_S3_REGION}" \
  --set web-ui.services.ui.hostname="" \
  --set service.services.service.hostname="" \
  --set router.services.service.hostname="" \
  --wait \
  --timeout 10m

print_status "OSMO installed successfully"

# Verify all pods are running
print_status "Verifying OSMO pods..."
kubectl get pods --namespace osmo

# ============================================
# Step 4: Restart KAI Scheduler
# ============================================
# MicroK8s service account tokens can be stale at initial pod creation, causing
# "Unauthorized" errors when KAI tries to list PodGroups. A rollout restart
# forces fresh tokens and resolves the issue.
print_status "Restarting KAI Scheduler to refresh service account tokens..."
kubectl rollout restart deployment/kai-scheduler-default -n kai-scheduler
kubectl -n kai-scheduler rollout status deployment/kai-scheduler-default --timeout=60s
print_status "KAI Scheduler restarted"

OSMO_GATEWAY_PORT=$(kubectl get svc -n osmo quick-start -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "30080")
OSMO_API="http://localhost:${OSMO_GATEWAY_PORT}"

# Wait for the API to be reachable
print_status "Waiting for OSMO API at ${OSMO_API}..."
until curl -sf "${OSMO_API}/api/configs/pod_template/default_compute" -H "x-osmo-user: testuser" >/dev/null 2>&1; do
    echo "  API not ready yet, waiting..."
    sleep 5
done
print_status "OSMO API is reachable"

# ============================================
# Step 5: Add shared_memory pod template
# ============================================
print_status "Adding shared_memory pod template for /dev/shm..."

curl -sf -X PUT "${OSMO_API}/api/configs/pod_template/shared_memory" \
  -H "Content-Type: application/json" \
  -H "x-osmo-user: testuser" \
  -d '{
    "configs": {
      "spec": {
        "volumes": [
          {
            "name": "shm",
            "emptyDir": {
              "medium": "Memory",
              "sizeLimit": "64Gi"
            }
          }
        ],
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "volumeMounts": [
              {
                "name": "shm",
                "mountPath": "/dev/shm"
              }
            ]
          }
        ]
      }
    },
    "description": "Add shared_memory pod template for /dev/shm mounting"
  }'

print_status "shared_memory pod template created"

# Add shared_memory to the default pool's common_pod_template list
print_status "Adding shared_memory to default pool..."

CURRENT_COMMON_POD_TEMPLATE=$(
  curl -sf "${OSMO_API}/api/configs/pool/default" \
    -H "x-osmo-user: testuser" \
  | python3 -c '
import json, sys
data = json.load(sys.stdin)
templates = data.get("common_pod_template") or []
if "shared_memory" not in templates:
    templates.append("shared_memory")
print(json.dumps(templates))
'
)

curl -sf -X PATCH "${OSMO_API}/api/configs/pool/default" \
  -H "Content-Type: application/json" \
  -H "x-osmo-user: testuser" \
  -d "{
    \"configs_dict\": {
      \"common_pod_template\": ${CURRENT_COMMON_POD_TEMPLATE}
    },
    \"description\": \"Add shared_memory pod template to default pool\"
  }"

print_status "Default pool updated with shared_memory pod template"

# ============================================
# Step 6: /etc/hosts
# ============================================
if ! grep -q "${LOCALSTACK_S3_HOST}" /etc/hosts; then
    print_status "Adding ${LOCALSTACK_S3_HOST} to /etc/hosts..."
    echo "127.0.0.1 ${LOCALSTACK_S3_HOST}" | sudo tee -a /etc/hosts
else
    print_status "${LOCALSTACK_S3_HOST} already in /etc/hosts"
fi

# ============================================
# Step 7: Install OSMO CLI
# ============================================
print_status "Installing OSMO CLI..."

curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh -o /tmp/install-osmo.sh
chmod +x /tmp/install-osmo.sh
sudo bash /tmp/install-osmo.sh

# Add OSMO to PATH if not already there
if [[ ":$PATH:" != *":$HOME/.osmo/bin:"* ]]; then
    export PATH="$HOME/.osmo/bin:$PATH"
    # shellcheck disable=SC2016
    echo 'export PATH="$HOME/.osmo/bin:$PATH"' >> ~/.bashrc
fi

# ============================================
# Step 8: Log In and Set Credential
# ============================================
print_status "Logging in to OSMO..."

osmo login "${OSMO_API}" --method=dev --username=testuser

print_status "Setting data credential for LocalStack S3..."

osmo credential set osmo --type DATA --payload \
  access_key_id="${LOCALSTACK_S3_ACCESS_KEY_ID}" \
  access_key="${LOCALSTACK_S3_ACCESS_KEY}" \
  endpoint="${LOCALSTACK_S3_ENDPOINT}" \
  override_url="${LOCALSTACK_S3_OVERRIDE_URL}" \
  region="${LOCALSTACK_S3_REGION}"

# Save the credential command for remote workstation setup
mkdir -p ~/osmo-deployment
cat > ~/osmo-deployment/set-credential.sh <<CRED_EOF
#!/bin/bash
osmo credential set osmo --type DATA --payload \\
  access_key_id="${LOCALSTACK_S3_ACCESS_KEY_ID}" \\
  access_key="${LOCALSTACK_S3_ACCESS_KEY}" \\
  endpoint="${LOCALSTACK_S3_ENDPOINT}" \\
  override_url="${LOCALSTACK_S3_OVERRIDE_URL}" \\
  region="${LOCALSTACK_S3_REGION}"
CRED_EOF
chmod +x ~/osmo-deployment/set-credential.sh

print_status "Data credential set successfully"

# ============================================
# Success Message
# ============================================
echo ""
echo "=================================================="
echo "OSMO Deployment Complete! (Single-node K8s)"
echo "=================================================="
echo ""
print_status "System Information:"
print_status "  • Storage Class: $STORAGE_CLASS"
print_status "  • OSMO API: $OSMO_API"
print_status "  • LocalStack S3: ${LOCALSTACK_S3_OVERRIDE_URL}"
echo ""
print_status "GPU status:"
kubectl get nodes -o json | python3 -c "
import json, sys
nodes = json.load(sys.stdin)['items']
for n in nodes:
    gpus = n.get('status', {}).get('capacity', {}).get('nvidia.com/gpu', '0')
    print(f'  Node {n[\"metadata\"][\"name\"]}: {gpus} GPU(s)')
" 2>/dev/null || print_warning "Could not check GPU status"
echo ""
print_status "Next Steps:"
print_status "  1. See deployment README: https://github.com/nvidia/osmo/tree/main/deployments/brev/README-k8s.md"
print_status "  2. Follow getting started guide: https://nvidia.github.io/OSMO/main/user_guide/getting_started/next_steps.html"
echo ""
echo "=================================================="
