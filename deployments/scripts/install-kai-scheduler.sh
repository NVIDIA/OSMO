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
# Install KAI Scheduler
#
# OSMO workflows use gang scheduling via KAI; the chart does not ship it.
# Idempotent: detects existing installs via CRD (podgroups.scheduling.run.ai),
# not just helm release name, so this is safe to run on clusters where KAI was
# installed under a different namespace or release name.
###############################################################################

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

KAI_VERSION="${KAI_VERSION:-0.14.0}"
KAI_NAMESPACE="${KAI_NAMESPACE:-kai-scheduler}"
KAI_RELEASE="${KAI_RELEASE:-kai-scheduler}"
KAI_CHART_URL="https://github.com/NVIDIA/KAI-Scheduler/releases/download/v${KAI_VERSION}/kai-scheduler-v${KAI_VERSION}.tgz"

KUBECTL="${KUBECTL:-kubectl}"
HELM="${HELM:-helm}"

# Detect a *working* KAI install. We require BOTH the CRD AND an active helm
# release: bare CRDs left behind after `helm uninstall kai-scheduler` are
# orphans, not a working scheduler, and we should re-install rather than skip.
detect_kai() {
    $KUBECTL get crd podgroups.scheduling.run.ai &>/dev/null || return 1
    $HELM list -A -o json 2>/dev/null \
        | grep -qE '"chart":"kai-scheduler[^"]*"' || return 1
    return 0
}

main() {
    check_command "$KUBECTL"
    check_command "$HELM"

    if detect_kai; then
        log_warning "KAI Scheduler already installed (CRD podgroups.scheduling.run.ai present) — skipping"
        # Best-effort version log; release may be in a different namespace
        local existing
        existing=$($HELM list -A -o json 2>/dev/null \
            | grep -o '"chart":"kai-scheduler[^"]*"' \
            | head -1 || true)
        if [[ -n "$existing" ]]; then
            log_info "Detected existing release: $existing"
        fi
        return 0
    fi

    log_info "Installing KAI Scheduler v${KAI_VERSION} into namespace ${KAI_NAMESPACE}"
    $KUBECTL get namespace "$KAI_NAMESPACE" &>/dev/null \
        || $KUBECTL create namespace "$KAI_NAMESPACE"

    $HELM upgrade --install "$KAI_RELEASE" "$KAI_CHART_URL" \
        --namespace "$KAI_NAMESPACE" \
        --wait --timeout 5m

    log_success "KAI Scheduler v${KAI_VERSION} installed"
}

main "$@"
