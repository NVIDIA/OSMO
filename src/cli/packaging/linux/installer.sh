#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

set -e  # Exit immediately if a command exits with a non-zero status

# Determine if we're doing a system or user install
if [ ! -w "/usr/local" ]; then
    echo "Error: You do not have permission to install OSMO for Linux system-wide."
    echo "Please run the installer via sudo or as root."
    exit 1
fi

OSMO_CLI_INSTALL_DIR="/usr/local"
OSMO_CLI_INSTALL_PATH="$OSMO_CLI_INSTALL_DIR/osmo"
OSMO_CLI_SYMLINK_PATH="/usr/local/bin/osmo"
OSMO_CLI_BASH_COMPLETION_DIR="/usr/share/bash-completion/completions"

OSMO_CLI_TMP_DIR="/tmp/osmo-install-$$"  # $$ = process ID
OSMO_CLI_PACKAGE_NAME="osmo-client-linux.tgz"

########################################################
# Extract the archive from the script
########################################################

# Find where the archive starts in this script
OSMO_CLI_ARCHIVE_LINE=$(awk '/^__ARCHIVE_BELOW__/ {print NR + 1; exit 0; }' "$0")

if [ -z "$OSMO_CLI_ARCHIVE_LINE" ]; then
    echo "Error: Archive marker not found in installer script."
    exit 1
fi

# Validate that ARCHIVE_LINE is a positive integer
if ! [[ "$OSMO_CLI_ARCHIVE_LINE" =~ ^[0-9]+$ ]] || [ "$OSMO_CLI_ARCHIVE_LINE" -le 0 ]; then
    echo "Error: Invalid archive line number detected."
    exit 1
fi

# Extract the embedded tarball (binary data after the marker)
echo "Extracting archive from script..."
mkdir -p "$OSMO_CLI_TMP_DIR"
tail -n +$OSMO_CLI_ARCHIVE_LINE "$0" > "$OSMO_CLI_TMP_DIR/$OSMO_CLI_PACKAGE_NAME"

# Verify the tarball was extracted
if [ ! -f "$OSMO_CLI_TMP_DIR/$OSMO_CLI_PACKAGE_NAME" ]; then
    echo "Error: Failed to extract package file."
    rm -rf "$OSMO_CLI_TMP_DIR"
    exit 1
fi

########################################################
# Install the package
########################################################

echo "Installing OSMO for Linux..."

if [ -e "$OSMO_CLI_INSTALL_PATH" ]; then
    # OSMO client already installed, delete previous installation
    rm -rf "$OSMO_CLI_INSTALL_PATH"
fi

tar -xzf "$OSMO_CLI_TMP_DIR/$OSMO_CLI_PACKAGE_NAME" -C "$OSMO_CLI_INSTALL_DIR"

if [ ! -d "$OSMO_CLI_INSTALL_PATH" ]; then
    echo "Installation unsuccessful, please try again."
    exit 1
fi

# Add symlink
ln -s -f "$OSMO_CLI_INSTALL_PATH/osmo" "$OSMO_CLI_SYMLINK_PATH"

# Setup bash autocomplete
if [ -f "$OSMO_CLI_INSTALL_PATH/autocomplete.bash" ]; then
    mkdir -p "$OSMO_CLI_BASH_COMPLETION_DIR"
    cp "$OSMO_CLI_INSTALL_PATH/autocomplete.bash" "$OSMO_CLI_BASH_COMPLETION_DIR/osmo"
    echo "Bash autocomplete installed"
fi

# Clean up temp directory
rm -rf "$OSMO_CLI_TMP_DIR"

exit 0
