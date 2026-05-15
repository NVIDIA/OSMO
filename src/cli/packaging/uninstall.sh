#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

OSMO_CLI_INSTALL_PATH="/usr/local/osmo"
OSMO_CLI_SYMLINK_PATH="/usr/local/bin/osmo"
OSMO_CLI_ZSH_COMPLETION="/usr/local/share/zsh/site-functions/_osmo"
OSMO_CLI_BASH_COMPLETION="/usr/share/bash-completion/completions/osmo"
OSMO_CLI_PKG_ID="com.nvidia.osmo"

OS_TYPE=$(uname)

if [ "$OS_TYPE" != "Darwin" ] && [ "$OS_TYPE" != "Linux" ]; then
    echo "OS is not supported. Eligible OS types: MacOS, Linux."
    exit 1
fi

if [ ! -d "$OSMO_CLI_INSTALL_PATH" ] && [ ! -L "$OSMO_CLI_SYMLINK_PATH" ]; then
    echo "OSMO does not appear to be installed."
    exit 0
fi

echo "The following will be removed:"
[ -d "$OSMO_CLI_INSTALL_PATH" ] && echo "  $OSMO_CLI_INSTALL_PATH/"
[ -L "$OSMO_CLI_SYMLINK_PATH" ] && echo "  $OSMO_CLI_SYMLINK_PATH"
if [ "$OS_TYPE" == "Darwin" ]; then
    [ -f "$OSMO_CLI_ZSH_COMPLETION" ] && echo "  $OSMO_CLI_ZSH_COMPLETION"
else
    [ -f "$OSMO_CLI_BASH_COMPLETION" ] && echo "  $OSMO_CLI_BASH_COMPLETION"
fi
echo ""

read -r -p "Proceed with uninstall? [y/N] " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Uninstall cancelled."
    exit 0
fi

NEED_SUDO=false
if [ "$(id -u)" -ne 0 ]; then
    NEED_SUDO=true
fi

run_privileged() {
    if [ "$NEED_SUDO" = true ]; then
        sudo "$@"
    else
        "$@"
    fi
}

echo "Uninstalling OSMO..."

run_privileged rm -rf "$OSMO_CLI_INSTALL_PATH"
[ -L "$OSMO_CLI_SYMLINK_PATH" ] && run_privileged rm -f "$OSMO_CLI_SYMLINK_PATH"

if [ "$OS_TYPE" == "Darwin" ]; then
    [ -f "$OSMO_CLI_ZSH_COMPLETION" ] && run_privileged rm -f "$OSMO_CLI_ZSH_COMPLETION"
    if pkgutil --pkgs 2>/dev/null | grep -q "^${OSMO_CLI_PKG_ID}$"; then
        run_privileged pkgutil --forget "$OSMO_CLI_PKG_ID" > /dev/null 2>&1
    fi
else
    [ -f "$OSMO_CLI_BASH_COMPLETION" ] && run_privileged rm -f "$OSMO_CLI_BASH_COMPLETION"
fi

echo "OSMO has been uninstalled successfully."
