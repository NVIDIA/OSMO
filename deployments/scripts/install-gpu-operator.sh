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
# Install NVIDIA GPU Operator
#
# Managed K8s clusters (AKS, EKS) don't ship NVIDIA drivers/toolkit by default.
# This installs the GPU Operator so GPU node pools can run GPU workloads.
#
# Skips when any working GPU stack is already present:
#  - microk8s `nvidia` addon (covers single-node K8s)
#  - existing helm release of any nvidia gpu-operator chart
#  - clusterpolicies.nvidia.com CR (covers NVAIE)
#  - working nvidia-device-plugin DaemonSet
#
# Honors --no-gpu / NO_GPU=1 to skip entirely.
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

GPU_OPERATOR_VERSION="${GPU_OPERATOR_VERSION:-v25.3.4}"
GPU_OPERATOR_NAMESPACE="${GPU_OPERATOR_NAMESPACE:-gpu-operator}"
GPU_OPERATOR_RELEASE="${GPU_OPERATOR_RELEASE:-gpu-operator}"
NO_GPU="${NO_GPU:-0}"

KUBECTL="${KUBECTL:-kubectl}"
HELM="${HELM:-helm}"

for arg in "$@"; do
    [[ "$arg" == "--no-gpu" ]] && NO_GPU=1
done

detect_existing_gpu_stack() {
    # microk8s nvidia addon — emits a clusterpolicy + the operator
    if command -v microk8s &>/dev/null && microk8s status --addon nvidia 2>/dev/null | grep -q "enabled"; then
        echo "microk8s nvidia addon"
        return 0
    fi
    # Existing clusterpolicy backed by an active controller — bare CRDs left
    # over from a previous `helm uninstall` are orphans, not a working stack.
    if $KUBECTL get clusterpolicies.nvidia.com -A &>/dev/null \
        && [[ -n "$($KUBECTL get clusterpolicies.nvidia.com -A -o name 2>/dev/null)" ]] \
        && $HELM list -A -o json 2>/dev/null | grep -qE '"chart":"gpu-operator[^"]*"'; then
        echo "clusterpolicies.nvidia.com present + helm release active"
        return 0
    fi
    # Existing helm release for any gpu-operator chart in any namespace
    local existing_release
    existing_release=$($HELM list -A -o json 2>/dev/null \
        | grep -oE '"chart":"gpu-operator[^"]*"' \
        | head -1 || true)
    if [[ -n "$existing_release" ]]; then
        echo "helm release: $existing_release"
        return 0
    fi
    # nvidia-device-plugin DaemonSet (covers manual installs and some distros)
    if $KUBECTL get daemonset -A 2>/dev/null \
        | grep -qE "nvidia-device-plugin"; then
        echo "nvidia-device-plugin DaemonSet"
        return 0
    fi
    return 1
}

main() {
    if [[ "$NO_GPU" == "1" ]]; then
        log_info "NO_GPU=1 — skipping GPU Operator install"
        return 0
    fi

    check_command "$KUBECTL"
    check_command "$HELM"

    local detection
    if detection=$(detect_existing_gpu_stack); then
        log_warning "GPU Operator already provided by: $detection — skipping"
        return 0
    fi

    log_info "Installing NVIDIA GPU Operator ${GPU_OPERATOR_VERSION} into ${GPU_OPERATOR_NAMESPACE}"

    # Always (idempotently) add/refresh the helm repo so version pins resolve
    $HELM repo add nvidia https://helm.ngc.nvidia.com/nvidia >/dev/null 2>&1 || true
    $HELM repo update nvidia >/dev/null

    $KUBECTL get namespace "$GPU_OPERATOR_NAMESPACE" &>/dev/null \
        || $KUBECTL create namespace "$GPU_OPERATOR_NAMESPACE"

    $HELM upgrade --install "$GPU_OPERATOR_RELEASE" nvidia/gpu-operator \
        --namespace "$GPU_OPERATOR_NAMESPACE" \
        --version "$GPU_OPERATOR_VERSION" \
        --wait --timeout 10m

    log_success "GPU Operator ${GPU_OPERATOR_VERSION} installed"
}

main "$@"
