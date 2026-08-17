#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

EXPECTED_SHA256=c26cb094bc9735d01548ee540d018c1d88e2038bfd27ddc330770f5d525e63eb
CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ARCHIVE=${1:-"$CHART_DIRECTORY/charts/rustfs-1.0.0-rc.2.tgz"}

command -v sha256sum >/dev/null || {
    echo "ERROR: sha256sum is required to verify the RustFS chart archive" >&2
    exit 1
}

if [[ ! -f "$ARCHIVE" ]]; then
    echo "ERROR: RustFS chart archive not found: $ARCHIVE" >&2
    exit 1
fi

read -r actual_sha256 _ < <(sha256sum "$ARCHIVE")
if [[ "$actual_sha256" != "$EXPECTED_SHA256" ]]; then
    echo "ERROR: RustFS chart archive SHA-256 mismatch: expected $EXPECTED_SHA256, got $actual_sha256 ($ARCHIVE)" >&2
    exit 1
fi

echo "Verified RustFS chart archive SHA-256: $EXPECTED_SHA256"
