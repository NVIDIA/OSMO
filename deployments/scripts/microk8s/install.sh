#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
#
# Single-node MicroK8s bootstrap for OSMO standalone installs.
#
# Used by deploy-osmo-minimal.sh --provider microk8s. Provisions the cluster +
# tooling needed before the cluster-agnostic OSMO install phases run:
#   - snapd (auto-installed if missing — cloud Ubuntu images often skip it)
#   - microk8s 1.31/stable
#   - kubectl, helm, helmfile
#   - Standard K8s addons: dns, hostpath-storage, helm3, rbac, minio
#   - Optional GPU addon (--gpu) with the host-driver symlink workaround
#   - Containerd Docker Hub creds patch (only if ~/.docker/config.json exists)
#   - kubeconfig export with proper ownership
#
# Usage:
#   sudo ./install.sh           # CPU-only
#   sudo ./install.sh --gpu     # GPU instance with NVIDIA driver >= 525

set -euo pipefail

CHANNEL="${MICROK8S_CHANNEL:-1.31/stable}"
ENABLE_GPU=false
REAL_USER="${SUDO_USER:-${USER:-ubuntu}}"
REAL_HOME=$(getent passwd "$REAL_USER" | cut -d: -f6)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for arg in "$@"; do [[ "$arg" == "--gpu" ]] && ENABLE_GPU=true; done

# ── Preflight ─────────────────────────────────────────────────────────────────
PASS=true

if [[ "$EUID" -ne 0 ]]; then
    echo "ERROR: must be run as root — use: sudo $0 $*"
    PASS=false
fi

need_snap=false
command -v microk8s &>/dev/null || need_snap=true
command -v kubectl  &>/dev/null || need_snap=true
command -v helm     &>/dev/null || need_snap=true
if [[ "$need_snap" == "true" ]] && ! command -v snap &>/dev/null; then
    # Many cloud Ubuntu images (incl. Brev NemoClaw) ship without snapd.
    # Install inline so the script runs end-to-end on a clean instance.
    echo "==> Installing snapd (required for microk8s/kubectl/helm)"
    apt-get update -qq
    apt-get install -y -qq snapd
    systemctl enable --now snapd.service snapd.socket
    snap wait system seed.loaded
fi

if [[ "$ENABLE_GPU" == "true" ]]; then
    if ! command -v nvidia-smi &>/dev/null; then
        echo "ERROR: --gpu passed but nvidia-smi not found — NVIDIA driver not installed"
        PASS=false
    else
        DRIVER_VER=$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null \
            | head -1 | cut -d. -f1)
        if [[ -n "$DRIVER_VER" && "$DRIVER_VER" -lt 525 ]]; then
            echo "ERROR: NVIDIA driver $DRIVER_VER < 525 — upgrade before enabling nvidia addon"
            PASS=false
        fi
    fi
fi

for port in 16443 10250 10255; do
    if ss -tlnp 2>/dev/null | grep -q ":${port} "; then
        echo "WARNING: port $port already in use — MicroK8s may conflict"
    fi
done

[[ "$PASS" == "false" ]] && exit 1

# ── 1. Install MicroK8s ───────────────────────────────────────────────────────
if command -v microk8s &>/dev/null; then
    echo "==> MicroK8s already installed — skipping snap install"
else
    echo "==> Installing MicroK8s $CHANNEL"
    snap install microk8s --classic --channel="$CHANNEL"
fi
usermod -aG microk8s "$REAL_USER"

# ── 2. Configure Docker Hub creds for containerd (rate-limit avoidance) ──────
# Only patches when the user has run `docker login` (i.e. config.json exists)
# and the template hasn't already been patched. Restarting microk8s on an
# already-patched, already-running install can leave it in a stuck state and
# hang the subsequent wait-ready, so the patch is gated.
DOCKER_CONFIG="$REAL_HOME/.docker/config.json"
if [[ -f "$DOCKER_CONFIG" ]]; then
    DOCKER_AUTH=$(python3 -c "import json,base64,sys; c=json.load(open('$DOCKER_CONFIG')); print(base64.b64decode(c.get('auths',{}).get('https://index.docker.io/v1/',{}).get('auth','')).decode())" 2>/dev/null || true)
    if [[ -n "$DOCKER_AUTH" ]]; then
        DOCKER_USER="${DOCKER_AUTH%%:*}"
        DOCKER_PASS="${DOCKER_AUTH#*:}"
        # Escape backslashes and double quotes for valid TOML basic strings.
        # Backslash must be escaped first to avoid double-escaping.
        DOCKER_USER_ESC="${DOCKER_USER//\\/\\\\}"; DOCKER_USER_ESC="${DOCKER_USER_ESC//\"/\\\"}"
        DOCKER_PASS_ESC="${DOCKER_PASS//\\/\\\\}"; DOCKER_PASS_ESC="${DOCKER_PASS_ESC//\"/\\\"}"
        SNAP_DATA=$(readlink -f /var/snap/microk8s/current)
        TEMPLATE="$SNAP_DATA/args/containerd-template.toml"
        if ! grep -q 'registry.configs."registry-1.docker.io".auth' "$TEMPLATE" 2>/dev/null; then
            echo "==> Patching containerd template with Docker Hub credentials"
            sed -i '/\[plugins."io.containerd.grpc.v1.cri".registry\]/a\
\    [plugins."io.containerd.grpc.v1.cri".registry.configs."registry-1.docker.io".auth]\
\      username = "'"$DOCKER_USER_ESC"'"\
\      password = "'"$DOCKER_PASS_ESC"'"' "$TEMPLATE"
            microk8s stop
            microk8s start
        fi
    fi
fi

# Bounded wait — without --timeout microk8s blocks indefinitely when a prior
# partial install left the service in a degraded state.
if ! microk8s status --wait-ready --timeout 300; then
    echo "ERROR: microk8s did not become ready within 5 min" >&2
    microk8s status >&2 || echo "(microk8s status failed)" >&2
    journalctl -u snap.microk8s.daemon-kubelite --no-pager -n 100 >&2 \
        || echo "(journalctl for microk8s kubelite failed)" >&2
    exit 1
fi

# ── 3. Install kubectl, helm, helmfile ───────────────────────────────────────
if ! command -v kubectl &>/dev/null; then
    echo "==> Installing kubectl"
    snap install kubectl --classic
fi
if ! command -v helm &>/dev/null; then
    echo "==> Installing helm"
    snap install helm --classic
fi
if ! command -v helmfile &>/dev/null; then
    echo "==> Installing helmfile"
    HELMFILE_VERSION="${HELMFILE_VERSION:-1.4.4}"
    curl -sL "https://github.com/helmfile/helmfile/releases/download/v${HELMFILE_VERSION}/helmfile_${HELMFILE_VERSION}_linux_amd64.tar.gz" \
        | tar xz -C /usr/local/bin helmfile
fi

# ── 4. Enable addons ─────────────────────────────────────────────────────────
# Note: `registry` is intentionally NOT enabled — OSMO doesn't use a local
# image registry. Add it if your workflow needs `localhost:32000`.
echo "==> Enabling addons"
microk8s enable dns hostpath-storage helm3 rbac minio

# ── 5. GPU addon ─────────────────────────────────────────────────────────────
# Symlink workaround needed when host driver is pre-installed (vs container-
# managed driver). Ref: https://github.com/NVIDIA/gpu-operator/issues/430
if [[ "$ENABLE_GPU" == "true" ]]; then
    echo "==> Enabling nvidia addon (host driver)"
    GPU_VALUES="$SCRIPT_DIR/gpu-operator-values.yaml"
    microk8s enable nvidia \
        --gpu-operator-driver host \
        --gpu-operator-values "$GPU_VALUES"
fi

# ── 6. Wait for MicroK8s to be fully ready ───────────────────────────────────
echo "==> Waiting for MicroK8s to be ready"
if ! microk8s status --wait-ready --timeout 300; then
    echo "ERROR: microk8s did not become ready within 5 min after addon enable" >&2
    microk8s status >&2 || echo "(microk8s status failed)" >&2
    journalctl -u snap.microk8s.daemon-kubelite --no-pager -n 100 >&2 \
        || echo "(journalctl for microk8s kubelite failed)" >&2
    exit 1
fi

# ── 7. Export kubeconfig ─────────────────────────────────────────────────────
echo "==> Exporting kubeconfig to $REAL_HOME/.kube/config"
mkdir -p "$REAL_HOME/.kube"
microk8s config > "$REAL_HOME/.kube/config"
chmod 600 "$REAL_HOME/.kube/config"
chown "$REAL_USER:$REAL_USER" "$REAL_HOME/.kube/config"

# ── 8. Reclaim ownership of dirs that root-owned tools populated ─────────────
# snap-wrapped kubectl/helm invoked as root during addon enablement create
# $REAL_HOME/{.cache,.config,.helm,.kube} as root:root. Subsequent non-sudo
# usage then fails with "permission denied" on lock/index files.
for dir in .cache .config .kube .helm .local; do
    path="$REAL_HOME/$dir"
    [[ -e "$path" ]] && chown -R "$REAL_USER:$REAL_USER" "$path"
done

echo ""
echo "==> MicroK8s ready. Verify with:"
echo "    kubectl get nodes"
echo "    kubectl get pods -A"
