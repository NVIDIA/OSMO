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
# Common Functions for OSMO Deployment Scripts
###############################################################################

# Colors for output
export RED='\033[0;31m'
export GREEN='\033[0;32m'
export YELLOW='\033[1;33m'
export BLUE='\033[0;34m'
export CYAN='\033[0;36m'
export NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if a command exists
check_command() {
    if ! command -v "$1" &> /dev/null; then
        log_error "$1 is not installed. Please install it and try again."
        exit 1
    fi
}

# Prompt for user input
prompt_value() {
    local prompt_text="$1"
    local default_value="${2:-}"
    local is_secret="${3:-false}"
    local result=""

    if [[ -n "$default_value" ]]; then
        echo -en "${CYAN}$prompt_text${NC} [${GREEN}$default_value${NC}]: " >&2
    else
        echo -en "${CYAN}$prompt_text${NC}: " >&2
    fi

    if [[ "$is_secret" == "true" ]]; then
        read -rs result
        echo "" >&2
    else
        read -r result
    fi

    if [[ -z "$result" && -n "$default_value" ]]; then
        result="$default_value"
    fi

    echo "$result"
}

# Validate password strength
validate_password() {
    local password="$1"
    local min_length=8

    if [[ ${#password} -lt $min_length ]]; then
        return 1
    fi

    if ! [[ "$password" =~ [A-Z] && "$password" =~ [a-z] && "$password" =~ [0-9] ]]; then
        return 1
    fi

    return 0
}

# Install the osmo CLI from GitHub if missing. Idempotent.
#
# Env knobs:
#   OSMO_CLI_REF     — pin to a release tag from github.com/NVIDIA/OSMO/releases.
#                      Discover available tags with
#                      `deploy-osmo.sh --list-chart-versions`.
#                      When set to a non-"main" value, download the matching
#                      Linux/macOS installer directly from
#                      github.com/NVIDIA/OSMO/releases/download/<ref>/ instead
#                      of piping the (mutable) main install.sh — the latter
#                      always resolves to the latest GA, which mismatches when
#                      deploying a different channel.
#   OSMO_CLI_TARGET  — install destination directory. Default:
#                      $HOME/.local/bin (no sudo). Override to /usr/local/bin
#                      for system-wide install (requires sudo).
install_osmo_cli_if_missing() {
    if command -v osmo &>/dev/null; then
        return 0
    fi
    log_info "Installing osmo CLI from GitHub"
    if ! command -v curl &>/dev/null; then
        log_error "curl is required to install the osmo CLI"
        return 1
    fi

    local osmo_cli_ref="${OSMO_CLI_REF:-main}"
    local osmo_cli_target="${OSMO_CLI_TARGET:-$HOME/.local/bin}"

    if [[ "$osmo_cli_ref" == "main" ]]; then
        log_info "  using install.sh from main (installs latest GA — may not match deployed chart/image)"
        curl -sL "https://raw.githubusercontent.com/NVIDIA/OSMO/main/install.sh" | bash
    else
        # Pinned ref → download the matching platform installer directly and
        # extract it to OSMO_CLI_TARGET. Bypasses install.sh's hard-coded
        # latest-GA resolution and its sudo /usr/local/bin requirement.
        local os_type cpu_arch installer_name
        os_type=$(uname)
        cpu_arch=$(uname -m)
        case "$os_type:$cpu_arch" in
            Linux:x86_64)        installer_name="osmo-client-installer-${osmo_cli_ref}-linux-x86_64.sh" ;;
            Linux:aarch64|Linux:arm64) installer_name="osmo-client-installer-${osmo_cli_ref}-linux-arm64.sh" ;;
            Darwin:arm64)        installer_name="osmo-client-installer-${osmo_cli_ref}-macos-arm64.pkg" ;;
            *)
                log_error "Unsupported OS/arch for pinned CLI install: $os_type/$cpu_arch"
                return 1
                ;;
        esac
        local installer_url="https://github.com/NVIDIA/OSMO/releases/download/${osmo_cli_ref}/${installer_name}"
        log_info "  pinned ref: $osmo_cli_ref → $installer_url"
        log_info "  target: $osmo_cli_target (set OSMO_CLI_TARGET to override)"
        mkdir -p "$osmo_cli_target"
        local tmpdir
        tmpdir=$(mktemp -d)
        trap "rm -rf '$tmpdir'" RETURN
        if ! curl -sfL --max-time 300 --retry 2 "$installer_url" -o "$tmpdir/$installer_name"; then
            log_error "Failed to download $installer_url"
            return 1
        fi
        if [[ "$installer_name" == *.sh ]]; then
            # Linux installers are self-extracting shell scripts with an
            # __ARCHIVE_BELOW__ marker; extract the embedded tarball directly.
            local marker_line
            marker_line=$(awk '/^__ARCHIVE_BELOW__$/{print NR; exit}' "$tmpdir/$installer_name")
            if [[ -z "$marker_line" ]]; then
                # Hard-fail rather than fall through to `./installer` (needs
                # sudo). If upstream changes the installer format, this hard
                # error surfaces immediately rather than silently regressing
                # to the exact failure mode this fix exists to avoid.
                log_error "Installer $installer_name has no __ARCHIVE_BELOW__ marker."
                log_error "Upstream installer format may have changed for ref '$osmo_cli_ref'."
                log_error "Pin OSMO_CLI_REF to a known-compatible release, or install manually."
                return 1
            fi
            tail -n +$((marker_line + 1)) "$tmpdir/$installer_name" | tar -xz -C "$tmpdir"
            # Prefer bin/osmo over a top-level osmo to avoid picking up any
            # secondary copies bundled in the tarball.
            local osmo_bin
            osmo_bin=$(find "$tmpdir" -type f -path '*/bin/osmo' -perm -u+x | head -1)
            if [[ -z "$osmo_bin" ]]; then
                osmo_bin=$(find "$tmpdir" -type f -name osmo -perm -u+x | head -1)
            fi
            if [[ -z "$osmo_bin" ]]; then
                log_error "Extracted tarball does not contain an 'osmo' binary"
                return 1
            fi
            cp "$osmo_bin" "$osmo_cli_target/osmo"
            chmod +x "$osmo_cli_target/osmo"
        else
            # macOS .pkg — needs sudo regardless; defer to system installer.
            log_warning "macOS .pkg requires sudo; running system installer"
            sudo installer -pkg "$tmpdir/$installer_name" -target / || return 1
        fi
        # Make the target dir visible for the rest of this script.
        case ":$PATH:" in
            *":$osmo_cli_target:"*) ;;
            *)
                export PATH="$osmo_cli_target:$PATH"
                # Warn so future shells without this PATH entry still find osmo.
                if ! grep -q -F "$osmo_cli_target" "$HOME/.bashrc" "$HOME/.zshrc" 2>/dev/null; then
                    log_warning "$osmo_cli_target is not on PATH in any shell rc."
                    log_warning "  Add to ~/.bashrc or ~/.zshrc: export PATH=\"$osmo_cli_target:\$PATH\""
                fi
                ;;
        esac
    fi

    if ! command -v osmo &>/dev/null; then
        log_error "osmo CLI installer ran but 'osmo' is still not on PATH"
        log_error "Check ${OSMO_CLI_TARGET:-$HOME/.local/bin} or the installer's install location and update PATH"
        return 1
    fi
    log_success "osmo CLI installed: $(osmo version 2>/dev/null | head -1 || echo 'unknown')"
}

# Detection helpers used by install-* scripts to skip on existing installs.
# All accept overrides via $KUBECTL / $HELM env so the wrappers compose with
# the caller may supply private-cluster kubectl/helm wrappers.

# Returns 0 if a CRD with the given name exists.
crd_present() {
    "${KUBECTL:-kubectl}" get crd "$1" &>/dev/null
}

# Returns 0 if any helm release in any namespace was installed from a chart
# whose name starts with the given prefix. Use a prefix like `kai-scheduler`
# or `gpu-operator` to match version-suffixed chart names.
helm_chart_installed() {
    "${HELM:-helm}" list -A -o json 2>/dev/null \
        | grep -qE "\"chart\":\"$1[^\"]*\""
}

# Echoes the first matching `chart:"<name-version>"` string for logging.
helm_chart_release_info() {
    "${HELM:-helm}" list -A -o json 2>/dev/null \
        | grep -oE "\"chart\":\"$1[^\"]*\"" \
        | head -1 || true
}
