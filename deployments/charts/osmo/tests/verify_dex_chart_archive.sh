#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

EXPECTED_SHA256=0940d77f3de5e03992d83281ba8923db1dc9eafff8d215a440bc49ddb2b8481c
EXPECTED_CHART_NAME=dex
EXPECTED_CHART_VERSION=0.24.1
EXPECTED_APP_VERSION=2.44.0
CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ARCHIVE=${1:-"$CHART_DIRECTORY/charts/dex-${EXPECTED_CHART_VERSION}.tgz"}

for required_command in awk sha256sum tar; do
    command -v "$required_command" >/dev/null || {
        echo "ERROR: $required_command is required to verify the Dex chart archive" >&2
        exit 1
    }
done

if [[ ! -f "$ARCHIVE" ]]; then
    echo "ERROR: Dex chart archive not found: $ARCHIVE" >&2
    exit 1
fi

read -r actual_sha256 _ < <(sha256sum "$ARCHIVE")
if [[ "$actual_sha256" != "$EXPECTED_SHA256" ]]; then
    echo "ERROR: Dex chart archive SHA-256 mismatch: expected $EXPECTED_SHA256, got $actual_sha256 ($ARCHIVE)" >&2
    exit 1
fi

chart_metadata=$(tar -xOf "$ARCHIVE" dex/Chart.yaml) || {
    echo "ERROR: Dex chart archive does not contain dex/Chart.yaml: $ARCHIVE" >&2
    exit 1
}

metadata_value() {
    local key=$1
    awk -F ': ' -v key="$key" '$1 == key { print $2; exit }' <<<"$chart_metadata"
}

if [[ $(metadata_value name) != "$EXPECTED_CHART_NAME" ]] || \
    [[ $(metadata_value version) != "$EXPECTED_CHART_VERSION" ]] || \
    [[ $(metadata_value appVersion) != "$EXPECTED_APP_VERSION" ]]; then
    echo "ERROR: Dex chart archive metadata mismatch: expected name=$EXPECTED_CHART_NAME version=$EXPECTED_CHART_VERSION appVersion=$EXPECTED_APP_VERSION" >&2
    exit 1
fi

echo "Verified Dex chart archive SHA-256 and metadata: $EXPECTED_CHART_NAME $EXPECTED_CHART_VERSION (appVersion $EXPECTED_APP_VERSION)"
