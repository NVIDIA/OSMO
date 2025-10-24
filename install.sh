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

LATEST_RELEASE_URL="https://github.com/NVIDIA/osmo/releases/latest/download"
PACKAGE_BASE_URL="https://github.com/NVIDIA/OSMO/releases/download"

# Determine OS type and CPU architecture eligibility
OS_TYPE=$(uname)
CPU_ARCH=$(uname -m)

if [ "$OS_TYPE" != "Darwin" ] && [ "$OS_TYPE" != "Linux" ]; then
    echo "OS is not supported. Eligible OS types: MacOS, Linux."
    exit 1
fi

if [ "$OS_TYPE" == "Linux" ]; then
    if [ "$CPU_ARCH" != "x86_64" ] && [ "$CPU_ARCH" != "arm64" ] && [ "$CPU_ARCH" != "aarch64" ]; then
        echo "CPU architecture is not supported. Eligible architectures: x86_64, arm64, aarch64."
        exit 1
    fi
fi

if [ "$OS_TYPE" == "Darwin" ]; then
    if [ "$CPU_ARCH" != "arm64" ]; then
        echo "CPU architecture is not supported. Eligible architectures: arm64."
        exit 1
    fi
fi

TEMP_DIR=$(mktemp -d) || { echo "Failed to create temp directory"; exit 1; }
trap "rm -rf '$TEMP_DIR'" EXIT

# Download version.txt to determine the package version
echo "Checking latest version..."
VERSION_FILE="$TEMP_DIR/version.txt"
if ! curl --silent --fail -L --max-time 10 --retry 2 \
    "$LATEST_RELEASE_URL/version.txt" -o "$VERSION_FILE"; then
    echo "ERROR: Failed to retrieve version information from $LATEST_RELEASE_URL/version.txt"
    exit 1
fi

# Read and validate version
VERSION=$(cat "$VERSION_FILE" | tr -d '[:space:]')
if [ -z "$VERSION" ]; then
    echo "ERROR: Version file is empty or invalid"
    exit 1
fi

PACKAGE_HOST_URL="$PACKAGE_BASE_URL/$VERSION"

if [[ "$OS_TYPE" == "Darwin" ]]; then
    PACKAGE_NAME="osmo-client-installer-$VERSION-macos-arm64.pkg"

    echo "Starting installation of OSMO for MacOS"
    echo "Downloading $PACKAGE_NAME from $PACKAGE_HOST_URL..."

    # Download package with timeout and proper error checking
    if ! curl --progress-bar -fL --max-time 300 --retry 2 --retry-delay 5 \
        "$PACKAGE_HOST_URL/$PACKAGE_NAME" -o "$TEMP_DIR/$PACKAGE_NAME"; then
        echo "ERROR: Failed to download $PACKAGE_NAME. Please check your internet connection and try again."
        exit 1
    fi

    # Verify the downloaded file exists and is not empty
    if [ ! -s "$TEMP_DIR/$PACKAGE_NAME" ]; then
        echo "ERROR: Downloaded package is empty or does not exist."
        exit 1
    fi

    echo "Opening installer package..."
    if ! sudo installer -pkg "$TEMP_DIR/$PACKAGE_NAME" -target /; then
        echo "ERROR: Failed to install OSMO for MacOS."
        exit 1
    fi

    echo "OSMO for MacOS installed successfully."
    echo "Run 'osmo login <service_url>' to get started!"

elif [[ "$OS_TYPE" == "Linux" ]]; then
    if [[ "$CPU_ARCH" == "x86_64" ]]; then
        PACKAGE_NAME="osmo-client-installer-$VERSION-linux-x86_64.sh"
    elif [[ "$CPU_ARCH" == "arm64" ]] || [[ "$CPU_ARCH" == "aarch64" ]]; then
        PACKAGE_NAME="osmo-client-installer-$VERSION-linux-arm64.sh"
    fi

    echo "Starting installation of OSMO for Linux..."
    echo "Downloading $PACKAGE_NAME from $PACKAGE_HOST_URL..."

    # Download package with timeout and proper error checking
    if ! curl --progress-bar -fL --max-time 300 --retry 3 --retry-delay 5 \
        "$PACKAGE_HOST_URL/$PACKAGE_NAME" -o "$TEMP_DIR/$PACKAGE_NAME"; then
        echo "ERROR: Failed to download $PACKAGE_NAME. Please check your internet connection and try again."
        exit 1
    fi

    # Verify the downloaded file exists and is not empty
    if [ ! -s "$TEMP_DIR/$PACKAGE_NAME" ]; then
        echo "ERROR: Downloaded package is empty or does not exist."
        exit 1
    fi

    chmod +x "$TEMP_DIR/$PACKAGE_NAME"

    echo "Running installer script..."
    if ! "$TEMP_DIR/$PACKAGE_NAME"; then
        echo "ERROR: Failed to install OSMO for Linux."
        exit 1
    fi

    echo "OSMO for Linux installed successfully."
    echo "Run 'osmo login <service_url>' to get started!"
fi
