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

# OSMO Local Deployment Script
# This script automates the local deployment of OSMO using KIND (Kubernetes in Docker)
# Prerequisites: Docker, Python, GPU drivers/CUDA must be already installed

echo "=================================================="
echo "OSMO Local Deployment Script (GPU-enabled)"
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
# NVIDIA Driver minimum version
NVIDIA_MIN_DRIVER_VERSION="575"

# nvidia-container-toolkit versions
NVIDIA_CTK_MIN_VERSION="1.18.0"
NVIDIA_CTK_INSTALL_VERSION="1.18.1-1"

# Helm chart versions
GPU_OPERATOR_VERSION="v25.10.0"
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
# Step 0: System Configuration
# ============================================
print_status "Configuring system settings..."

# Increase inotify limits to prevent "too many open files" errors — only if not already set
if ! grep -q "fs.inotify.max_user_watches=1048576" /etc/sysctl.conf 2>/dev/null; then
    print_status "Setting inotify limits..."
    echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf
    echo "fs.inotify.max_user_instances=512" | sudo tee -a /etc/sysctl.conf
    sudo sysctl -p
else
    print_status "inotify limits already configured"
fi

# Ensure user has Docker permissions
print_status "Checking Docker permissions..."
if ! docker ps >/dev/null 2>&1; then
    print_warning "Docker permission denied. Adding user to docker group..."
    sudo usermod -aG docker "$USER"
    print_warning "Please log out and log back in, then run this script again."
    exit 1
fi

# Check NVIDIA driver version
print_status "Checking NVIDIA driver version..."
NVIDIA_DRIVER_FULL_VERSION=""
NVIDIA_DRIVER_VERSION=""
NVIDIA_DRIVER_SUFFICIENT="false"

if command_exists nvidia-smi; then
    NVIDIA_DRIVER_FULL_VERSION=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -n1)
    NVIDIA_DRIVER_VERSION=$(echo "$NVIDIA_DRIVER_FULL_VERSION" | cut -d'.' -f1)
    print_status "Detected NVIDIA driver version: $NVIDIA_DRIVER_FULL_VERSION"

    if [ -n "$NVIDIA_DRIVER_VERSION" ] && [ "$NVIDIA_DRIVER_VERSION" -lt "$NVIDIA_MIN_DRIVER_VERSION" ]; then
        print_warning "NVIDIA driver version $NVIDIA_DRIVER_VERSION is below the recommended minimum of $NVIDIA_MIN_DRIVER_VERSION"
        print_warning "Some OSMO features may not work correctly with older drivers"
        print_warning "Please consider upgrading your NVIDIA driver to version $NVIDIA_MIN_DRIVER_VERSION or higher"
        NVIDIA_DRIVER_SUFFICIENT="false"
    else
        NVIDIA_DRIVER_SUFFICIENT="true"
    fi
else
    print_warning "nvidia-smi not found - cannot verify NVIDIA driver version"
    print_warning "Please ensure NVIDIA drivers are installed and nvidia-smi is in your PATH"
    NVIDIA_DRIVER_FULL_VERSION="Not detected"
    NVIDIA_DRIVER_SUFFICIENT="false"
fi

# ============================================
# Step 1: Install Prerequisites
# ============================================
print_status "Installing prerequisites..."

# Create temporary directory for downloads
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"
print_status "Working in temporary directory: $TEMP_DIR"

# --- Launch parallel downloads for tools we need ---

PIDS=()

# Download KIND
if ! command_exists kind; then
    print_status "Downloading KIND..."
    (curl -sLo "$TEMP_DIR/kind" https://kind.sigs.k8s.io/dl/v0.29.0/kind-linux-amd64) &
    PIDS+=($!)
fi

# Download kubectl
if ! command_exists kubectl; then
    print_status "Downloading kubectl..."
    (KUBECTL_VERSION=$(curl -sL https://dl.k8s.io/release/stable.txt) && \
     curl -sLo "$TEMP_DIR/kubectl" "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/amd64/kubectl") &
    PIDS+=($!)
fi

# Download helm
if ! command_exists helm; then
    print_status "Downloading Helm..."
    (curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 -o "$TEMP_DIR/get-helm.sh") &
    PIDS+=($!)
fi

# Download Go (needed for nvkind)
if ! command_exists nvkind && ! command_exists go; then
    print_status "Downloading Go..."
    GO_VERSION="1.23.4"
    (wget -q -O "$TEMP_DIR/go.tar.gz" https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz) &
    PIDS+=($!)
fi

# Wait for all parallel downloads
if [ ${#PIDS[@]} -gt 0 ]; then
    print_status "Waiting for ${#PIDS[@]} parallel downloads..."
    for pid in "${PIDS[@]}"; do
        wait "$pid" || { print_error "A download failed (PID $pid)"; exit 1; }
    done
    print_status "All downloads complete"
fi

# --- Install downloaded tools ---

if ! command_exists kind && [ -f "$TEMP_DIR/kind" ]; then
    chmod +x "$TEMP_DIR/kind"
    sudo mv "$TEMP_DIR/kind" /usr/local/bin/kind
    print_status "KIND installed: $(kind --version)"
else
    command_exists kind && print_status "KIND already installed: $(kind --version)"
fi

if ! command_exists kubectl && [ -f "$TEMP_DIR/kubectl" ]; then
    chmod +x "$TEMP_DIR/kubectl"
    sudo mv "$TEMP_DIR/kubectl" /usr/local/bin/kubectl
    print_status "kubectl installed"
else
    command_exists kubectl && print_status "kubectl already installed"
fi

if ! command_exists helm && [ -f "$TEMP_DIR/get-helm.sh" ]; then
    bash "$TEMP_DIR/get-helm.sh"
    print_status "Helm installed: $(helm version --short)"
else
    command_exists helm && print_status "Helm already installed: $(helm version --short)"
fi

# Install Go if needed
if ! command_exists nvkind && ! command_exists go && [ -f "$TEMP_DIR/go.tar.gz" ]; then
    print_status "Installing Go..."
    sudo rm -rf /usr/local/go
    sudo tar -C /usr/local -xzf "$TEMP_DIR/go.tar.gz"
    export PATH=$PATH:/usr/local/go/bin
    # shellcheck disable=SC2016
    echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
fi

# Install or upgrade nvidia-container-toolkit to version 1.18+
# Check current version
if command_exists nvidia-ctk; then
    current_version=$(nvidia-ctk --version 2>&1 | grep -oP 'version \K[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")
    print_status "Current nvidia-ctk version: ${current_version}"
else
    current_version="0.0.0"
    print_status "nvidia-ctk not found"
fi

# Install or upgrade if not installed or version is too old
if [ "$current_version" = "0.0.0" ] || [ "$(printf '%s\n' "$NVIDIA_CTK_MIN_VERSION" "$current_version" | sort -V | head -n1)" != "$NVIDIA_CTK_MIN_VERSION" ]; then
    if [ "$current_version" = "0.0.0" ]; then
        print_status "Installing nvidia-ctk version ${NVIDIA_CTK_INSTALL_VERSION}..."
    else
        print_warning "nvidia-ctk version ${current_version} is below minimum ${NVIDIA_CTK_MIN_VERSION}, upgrading..."
    fi

    # shellcheck source=/dev/null
    distribution=$(. /etc/os-release;echo "$ID$VERSION_ID")
    curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
    curl -s -L "https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list" | \
        sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
    sudo apt-get update

    # Install specific version to ensure compatibility
    sudo apt-get install -y --allow-change-held-packages \
        -o Dpkg::Options::="--force-confdef" \
        -o Dpkg::Options::="--force-confnew" \
        nvidia-container-toolkit=${NVIDIA_CTK_INSTALL_VERSION} \
        nvidia-container-toolkit-base=${NVIDIA_CTK_INSTALL_VERSION} \
        libnvidia-container-tools=${NVIDIA_CTK_INSTALL_VERSION} \
        libnvidia-container1=${NVIDIA_CTK_INSTALL_VERSION}
else
    print_status "nvidia-ctk version ${current_version} meets minimum requirements"
fi

print_status "Configuring nvidia-ctk runtime..."
sudo nvidia-ctk runtime configure --runtime=docker --set-as-default --cdi.enabled
sudo nvidia-ctk config --set accept-nvidia-visible-devices-as-volume-mounts=true --in-place
sudo nvidia-ctk config --set accept-nvidia-visible-devices-envvar-when-unprivileged=false --in-place

# Relocate Docker data-root to the largest available filesystem to prevent /var/lib/docker
# from filling the root partition when large workflow container images are pulled.
# Different providers mount storage at different paths (e.g. /ephemeral on Crusoe, /data after
# an upcoming Brev rename), so we detect the largest disk at runtime rather than hardcoding.
print_status "Detecting largest mounted filesystem for Docker data-root..."

DOCKER_DATA_ROOT_MOUNT=""
DOCKER_DATA_ROOT_AVAIL=0

while IFS= read -r line; do
    MNT=$(echo "$line" | awk '{print $6}')
    AVAIL=$(echo "$line" | awk '{print $4}')
    # Skip virtual/system filesystems
    case "$MNT" in
        /dev|/dev/*|/proc|/sys|/sys/*|/run|/run/*|/boot|/boot/*|/snap/*) continue ;;
    esac
    # Skip read-only filesystems (e.g. /mnt/cloud-metadata on Nebius)
    if ! sudo mkdir -p "$MNT/.docker_write_test" 2>/dev/null; then
        continue
    fi
    sudo rmdir "$MNT/.docker_write_test" 2>/dev/null || true
    if [ "$AVAIL" -gt "$DOCKER_DATA_ROOT_AVAIL" ] 2>/dev/null; then
        DOCKER_DATA_ROOT_AVAIL=$AVAIL
        DOCKER_DATA_ROOT_MOUNT=$MNT
    fi
done < <(df -B1 --output=source,fstype,size,avail,used,target 2>/dev/null | tail -n +2)

DOCKER_DATA_ROOT_AVAIL_GB=$((DOCKER_DATA_ROOT_AVAIL / 1073741824))
print_status "Largest filesystem: $DOCKER_DATA_ROOT_MOUNT (${DOCKER_DATA_ROOT_AVAIL_GB} GiB available)"

DAEMON_JSON="/etc/docker/daemon.json"
if [ -n "$DOCKER_DATA_ROOT_MOUNT" ] && [ "$DOCKER_DATA_ROOT_MOUNT" != "/" ]; then
    DOCKER_DATA_ROOT="$DOCKER_DATA_ROOT_MOUNT/docker"
    print_status "Relocating Docker data-root to $DOCKER_DATA_ROOT..."
    sudo mkdir -p "$DOCKER_DATA_ROOT"
    if [ -f "$DAEMON_JSON" ]; then
        # Merge data-root into the existing daemon.json written by nvidia-ctk above
        sudo python3 -c "
import json
with open('$DAEMON_JSON') as f:
    cfg = json.load(f)
cfg['data-root'] = '$DOCKER_DATA_ROOT'
with open('$DAEMON_JSON', 'w') as f:
    json.dump(cfg, f, indent=2)
"
    else
        printf '{\n  "data-root": "%s"\n}\n' "$DOCKER_DATA_ROOT" | sudo tee "$DAEMON_JSON" > /dev/null
    fi
    print_status "Docker data-root set to $DOCKER_DATA_ROOT (${DOCKER_DATA_ROOT_AVAIL_GB} GiB available)"
else
    print_warning "No larger filesystem found — Docker will use default /var/lib/docker on root (${DOCKER_DATA_ROOT_AVAIL_GB} GiB available)"
fi

print_status "Restarting Docker..."
sudo systemctl restart docker
print_status "Docker root dir: $(sudo docker info 2>/dev/null | awk '/Docker Root Dir/{print $NF}')"

# Capture final nvidia-ctk version
NVIDIA_CTK_VERSION=$(nvidia-ctk --version 2>&1 | grep -oP 'version \K[0-9]+\.[0-9]+\.[0-9]+' || echo "Not detected")
NVIDIA_CTK_SUFFICIENT="true"
if [ "$NVIDIA_CTK_VERSION" = "Not detected" ] || [ "$(printf '%s\n' "$NVIDIA_CTK_MIN_VERSION" "$NVIDIA_CTK_VERSION" | sort -V | head -n1)" != "$NVIDIA_CTK_MIN_VERSION" ]; then
    NVIDIA_CTK_SUFFICIENT="false"
fi
print_status "nvidia-ctk version: $NVIDIA_CTK_VERSION"

# Install nvkind
if ! command_exists nvkind; then
    print_status "Installing nvkind..."

    if ! command_exists go; then
        print_error "Go is required for nvkind but was not installed"
        exit 1
    fi

    go install github.com/NVIDIA/nvkind/cmd/nvkind@latest
    GOPATH_BIN=$(go env GOPATH)/bin
    export PATH="$PATH:$GOPATH_BIN"
    # shellcheck disable=SC2016
    echo 'export PATH=$PATH:$(go env GOPATH)/bin' >> ~/.bashrc
else
    print_status "nvkind already installed"
fi

# Validate GPU access via Docker after all installations
print_status "Validating GPU access via Docker..."
if docker run --rm -v /dev/null:/var/run/nvidia-container-devices/all ubuntu:20.04 nvidia-smi -L 2>&1 | grep -q "GPU"; then
    print_status "✓ GPU validation successful - at least one GPU detected"
else
    print_error "GPU validation failed - no GPUs detected via docker run"
    print_warning "Continuing anyway, but GPU functionality may not work properly"
fi

# ============================================
# Step 2: Create KIND Cluster Configuration
# ============================================
print_status "Creating KIND cluster configuration..."

mkdir -p ~/osmo-deployment
cd ~/osmo-deployment

cat > kind-osmo-cluster-config.yaml <<'EOF'
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: osmo
nodes:
  - role: control-plane
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=ingress,nvidia.com/gpu.deploy.operands=false"
    extraPortMappings:
      - containerPort: 30080
        hostPort: 8000
        protocol: TCP
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=kai-scheduler,nvidia.com/gpu.deploy.operands=false"
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=data,nvidia.com/gpu.deploy.operands=false"
    extraPortMappings:
      - containerPort: 30035
        hostPort: 4566
        protocol: TCP
    extraMounts:
      - hostPath: /tmp/localstack-s3
        containerPath: /var/lib/localstack
  - role: worker
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=service,nvidia.com/gpu.deploy.operands=false"
  - role: worker
    extraMounts:
      - hostPath: /dev/null
        containerPath: /var/run/nvidia-container-devices/all
    kubeadmConfigPatches:
    - |
      kind: JoinConfiguration
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "node_group=compute"
EOF

print_status "Cluster configuration saved to ~/osmo-deployment/kind-osmo-cluster-config.yaml"

# ============================================
# Step 3: Create KIND Cluster with GPU Support
# ============================================
print_status "Creating KIND cluster with GPU support..."

# Create the cluster using nvkind
nvkind cluster create --config-template=kind-osmo-cluster-config.yaml || print_warning "Ignoring umount errors during cluster creation"

print_status "Waiting for cluster to be ready..."
kubectl wait --for=condition=Ready nodes --all --timeout=300s

# Grant cluster-admin to kubernetes-admin so Helm can manage all resources.
# nvkind may not bind this automatically on all providers (e.g. Shadecloud).
print_status "Granting cluster-admin to kubernetes-admin..."
kubectl create clusterrolebinding kubernetes-admin-cluster-admin \
  --clusterrole=cluster-admin \
  --user=kubernetes-admin \
  2>/dev/null || print_warning "ClusterRoleBinding already exists, continuing..."

# Verify GPUs are available
print_status "Verifying GPU availability..."
nvkind cluster print-gpus || print_warning "Could not verify GPUs, but continuing..."

# Add LocalStack hostname to /etc/hosts so the same override URL works both
# inside the cluster (resolved via K8s DNS) and outside (resolved via /etc/hosts
# to localhost, forwarded to the NodePort via KIND port mapping).
if ! grep -q "${LOCALSTACK_S3_HOST}" /etc/hosts; then
    print_status "Adding ${LOCALSTACK_S3_HOST} to /etc/hosts..."
    echo "127.0.0.1 ${LOCALSTACK_S3_HOST}" | sudo tee -a /etc/hosts
else
    print_status "${LOCALSTACK_S3_HOST} already in /etc/hosts"
fi

# ============================================
# Step 4+5: Install GPU Operator and KAI Scheduler
# ============================================
print_status "Installing GPU Operator and KAI Scheduler concurrently..."

cd ~/osmo-deployment
helm fetch https://helm.ngc.nvidia.com/nvidia/charts/gpu-operator-${GPU_OPERATOR_VERSION}.tgz

# GPU Operator (background, no --wait)
helm upgrade --install gpu-operator gpu-operator-${GPU_OPERATOR_VERSION}.tgz \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --set nfd.enabled=true &
GPU_OP_PID=$!

# KAI Scheduler (background, no --wait)
helm upgrade --install kai-scheduler \
  oci://ghcr.io/kai-scheduler/kai-scheduler/kai-scheduler \
  --version ${KAI_SCHEDULER_VERSION} \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" &
KAI_PID=$!

# Wait for both helm install commands to finish (not pods, just the helm CLI)
wait $GPU_OP_PID || { print_error "GPU Operator helm install failed"; exit 1; }
print_status "GPU Operator helm install submitted"

wait $KAI_PID || { print_error "KAI Scheduler helm install failed"; exit 1; }
print_status "KAI Scheduler helm install submitted"

# Now wait for pods to be ready (in parallel with the wait)
print_status "Waiting for GPU Operator and KAI Scheduler pods..."
kubectl -n gpu-operator wait --for=condition=Available deployment --all --timeout=300s &
GPU_WAIT_PID=$!
kubectl -n kai-scheduler wait --for=condition=Available deployment --all --timeout=300s &
KAI_WAIT_PID=$!

wait $GPU_WAIT_PID || { print_error "GPU Operator pods failed to become ready"; exit 1; }
print_status "GPU Operator ready"

wait $KAI_WAIT_PID || { print_error "KAI Scheduler pods failed to become ready"; exit 1; }
print_status "KAI Scheduler ready"

# ============================================
# Step 6: Install OSMO
# ============================================
print_status "Installing OSMO (this may take 5-10 minutes)..."

helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update

helm upgrade --install osmo osmo/quick-start \
  --namespace osmo \
  --create-namespace \
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
# Step 7: Install OSMO CLI
# ============================================
print_status "Installing OSMO CLI..."

curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh -o install.sh
chmod +x install.sh
sudo bash install.sh

# Add OSMO to PATH if not already there
if [[ ":$PATH:" != *":$HOME/.osmo/bin:"* ]]; then
    export PATH="$HOME/.osmo/bin:$PATH"
    # shellcheck disable=SC2016
    echo 'export PATH="$HOME/.osmo/bin:$PATH"' >> ~/.bashrc
fi

# ============================================
# Step 8: Log In to OSMO
# ============================================
print_status "Logging in to OSMO..."

OSMO_API="http://localhost:8000"
osmo login "${OSMO_API}" --method=dev --username=testuser

# ============================================
# Step 9: Configure Shared Memory Pod Template
# ============================================
print_status "Adding shared_memory pod template for /dev/shm..."

# Create the shared_memory pod template
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
# Step 9: Set Data Credential
# ============================================
print_status "Setting data credential for LocalStack S3..."

# The config-setup Helm job registers the credential server-side, but the CLI also
# needs it stored locally in ~/.osmo/config.yaml to authenticate directly with S3.
osmo credential set osmo --type DATA --payload \
  access_key_id="${LOCALSTACK_S3_ACCESS_KEY_ID}" \
  access_key="${LOCALSTACK_S3_ACCESS_KEY}" \
  endpoint="${LOCALSTACK_S3_ENDPOINT}" \
  override_url="${LOCALSTACK_S3_OVERRIDE_URL}" \
  region="${LOCALSTACK_S3_REGION}"

# Save the credential command for remote workstation setup.
# Users connecting from a remote machine need to run this after osmo login.
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
# Cleanup
# ============================================
print_status "Cleaning up temporary files..."
cd ~
rm -rf "$TEMP_DIR"

# ============================================
# Success Message
# ============================================
echo ""
echo "=================================================="
echo "✓ OSMO Deployment Complete!"
echo "=================================================="
echo ""

# Display version information
CURRENT_USER=$(whoami)
print_status "System Information:"
print_status "  • Current User: $CURRENT_USER"
print_status "  • NVIDIA Driver Version: $NVIDIA_DRIVER_FULL_VERSION (minimum: $NVIDIA_MIN_DRIVER_VERSION)"
print_status "  • nvidia-ctk Version: $NVIDIA_CTK_VERSION (minimum: $NVIDIA_CTK_MIN_VERSION)"
print_status "  • Docker Data Root: $(sudo docker info 2>/dev/null | awk '/Docker Root Dir/{print $NF}') (${DOCKER_DATA_ROOT_AVAIL_GB} GiB available)"
print_status "  • LocalStack S3: ${LOCALSTACK_S3_OVERRIDE_URL}"
echo ""

# Display warnings if versions are insufficient
if [ "$NVIDIA_DRIVER_SUFFICIENT" = "false" ] || [ "$NVIDIA_CTK_SUFFICIENT" = "false" ]; then
    print_warning "⚠ Version Requirements Not Met"
    if [ "$NVIDIA_DRIVER_SUFFICIENT" = "false" ]; then
        print_warning "  • NVIDIA driver version is insufficient (detected: $NVIDIA_DRIVER_FULL_VERSION, minimum: $NVIDIA_MIN_DRIVER_VERSION)"
    fi
    if [ "$NVIDIA_CTK_SUFFICIENT" = "false" ]; then
        print_warning "  • nvidia-ctk version is insufficient (detected: $NVIDIA_CTK_VERSION, minimum: $NVIDIA_CTK_MIN_VERSION)"
    fi
    print_warning "  GPU functionality may not work properly due to insufficient versions."
    print_warning "  Please choose a Brev Instance with the minimum required versions for full GPU support."
    echo ""
fi

print_status "Next Steps:"
print_status "  1. See deployment README: https://github.com/nvidia/osmo/tree/main/deployments/brev/README.md"
print_status "  2. Follow getting started guide: https://nvidia.github.io/OSMO/main/user_guide/getting_started/next_steps.html"
echo ""
echo "=================================================="
