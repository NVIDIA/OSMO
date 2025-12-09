#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
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
KAI_SCHEDULER_VERSION="v0.8.1"
OSMO_QUICKSTART_VERSION="1.0.0"

# ============================================
# Step 0: System Configuration
# ============================================
print_status "Configuring system settings..."

# Increase inotify limits to prevent "too many open files" errors
print_status "Setting inotify limits..."
echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf
echo "fs.inotify.max_user_instances=512" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p

# Ensure user has Docker permissions
print_status "Checking Docker permissions..."
if ! docker ps >/dev/null 2>&1; then
    print_warning "Docker permission denied. Adding user to docker group..."
    sudo usermod -aG docker $USER
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

# Install KIND
if ! command_exists kind; then
    print_status "Installing KIND..."
    curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.29.0/kind-linux-amd64
    chmod +x ./kind
    sudo mv ./kind /usr/local/bin/kind
else
    print_status "KIND already installed: $(kind --version)"
fi

# Install kubectl
if ! command_exists kubectl; then
    print_status "Installing kubectl..."
    curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
    chmod +x ./kubectl
    sudo mv ./kubectl /usr/local/bin/kubectl
else
    print_status "kubectl already installed: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"
fi

# Install helm
if ! command_exists helm; then
    print_status "Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
else
    print_status "Helm already installed: $(helm version --short)"
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

    distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
    curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | sudo apt-key add -
    curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
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
print_status "Restarting Docker..."
sudo systemctl restart docker

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

    # Check if Go is installed
    if ! command_exists go; then
        print_status "Installing Go (required for nvkind)..."
        GO_VERSION="1.23.4"
        wget https://go.dev/dl/go${GO_VERSION}.linux-amd64.tar.gz
        sudo rm -rf /usr/local/go
        sudo tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz
        export PATH=$PATH:/usr/local/go/bin
        echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
    fi

    print_status "Installing nvkind via go install..."
    go install github.com/NVIDIA/nvkind/cmd/nvkind@latest
    export PATH=$PATH:$(go env GOPATH)/bin
    echo 'export PATH=$PATH:$(go env GOPATH)/bin' >> ~/.bashrc
    cd ..
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

# Verify GPUs are available
print_status "Verifying GPU availability..."
nvkind cluster print-gpus || print_warning "Could not verify GPUs, but continuing..."

# ============================================
# Step 4: Install GPU Operator
# ============================================
print_status "Installing GPU Operator..."

cd ~/osmo-deployment
helm fetch https://helm.ngc.nvidia.com/nvidia/charts/gpu-operator-${GPU_OPERATOR_VERSION}.tgz

helm upgrade --install gpu-operator gpu-operator-${GPU_OPERATOR_VERSION}.tgz \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=false \
  --set toolkit.enabled=false \
  --set nfd.enabled=true \
  --wait

print_status "GPU Operator installed successfully"

# ============================================
# Step 5: Install KAI Scheduler
# ============================================
print_status "Installing KAI Scheduler..."

helm upgrade --install kai-scheduler \
  oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
  --version ${KAI_SCHEDULER_VERSION} \
  --create-namespace -n kai-scheduler \
  --set global.nodeSelector.node_group=kai-scheduler \
  --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
  --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
  --wait

print_status "KAI Scheduler installed successfully"

# ============================================
# Step 6: Install OSMO
# ============================================
print_status "Installing OSMO (this may take 5-10 minutes)..."

cd ~/osmo-deployment
helm fetch https://helm.ngc.nvidia.com/nvidia/osmo/charts/quick-start-${OSMO_QUICKSTART_VERSION}.tgz

helm upgrade --install osmo quick-start-${OSMO_QUICKSTART_VERSION}.tgz \
  --namespace osmo \
  --create-namespace \
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
    echo 'export PATH="$HOME/.osmo/bin:$PATH"' >> ~/.bashrc
fi

# ============================================
# Step 8: Log In to OSMO
# ============================================
print_status "Logging in to OSMO..."

osmo login http://localhost:8000 --method=dev --username=testuser

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
