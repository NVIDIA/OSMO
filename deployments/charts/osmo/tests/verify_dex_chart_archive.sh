#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

EXPECTED_SHA256=14696b9511192549e9b65958ff49309df07cf670e083877996f3d16b8c12af65
EXPECTED_CHART_NAME=dex
EXPECTED_CHART_VERSION=0.24.1-osmo.1
EXPECTED_APP_VERSION=2.44.0
CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
ARCHIVE=${1:-"$CHART_DIRECTORY/charts/dex-${EXPECTED_CHART_VERSION}.tgz"}

for required_command in awk python3 tar; do
    command -v "$required_command" >/dev/null || {
        echo "ERROR: $required_command is required to verify the Dex chart archive" >&2
        exit 1
    }
done

if [[ ! -f "$ARCHIVE" ]]; then
    echo "ERROR: Dex chart archive not found: $ARCHIVE" >&2
    exit 1
fi

# Hash canonical member contents: Helm repackages local dependencies with varying
# archive timestamps. gzip.decompress also rejects appended non-gzip bytes.
actual_sha256=$(python3 - "$ARCHIVE" <<'PYDIGEST'
import gzip
import hashlib
import io
import sys
import tarfile
try:
    digest = hashlib.sha256()
    with tarfile.open(fileobj=io.BytesIO(gzip.decompress(open(sys.argv[1], 'rb').read())), mode='r:') as archive:
        for member in sorted(archive.getmembers(), key=lambda item: item.name):
            if member.isfile():
                digest.update(member.name.encode() + b'\0' + hashlib.sha256(archive.extractfile(member).read()).digest())
    print(digest.hexdigest())
except (OSError, EOFError, tarfile.TarError):
    print('invalid-archive')
PYDIGEST
)
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
