#!/bin/sh
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -eu

: "${AWS_ENDPOINT_URL:?AWS_ENDPOINT_URL is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
: "${AWS_DEFAULT_REGION:?AWS_DEFAULT_REGION is required}"
: "${OSMO_WORKFLOW_BUCKET:?OSMO_WORKFLOW_BUCKET is required}"
: "${OSMO_LOG_BUCKET:?OSMO_LOG_BUCKET is required}"
: "${OSMO_APP_BUCKET:?OSMO_APP_BUCKET is required}"

attempts=${OSMO_STORAGE_BOOTSTRAP_ATTEMPTS:-30}
case "$attempts" in
    ''|*[!0-9]*)
        echo "OSMO_STORAGE_BOOTSTRAP_ATTEMPTS must be a positive integer" >&2
        exit 1
        ;;
esac
if [ "$attempts" -eq 0 ]; then
    echo "OSMO_STORAGE_BOOTSTRAP_ATTEMPTS must be a positive integer" >&2
    exit 1
fi

bootstrap_tmpdir=$(mktemp -d "${TMPDIR:-/tmp}/object-storage-bootstrap.XXXXXX")
trap 'rm -rf "$bootstrap_tmpdir"' EXIT HUP INT TERM
AWS_CONFIG_FILE="$bootstrap_tmpdir/config"
export AWS_CONFIG_FILE

cat >"$AWS_CONFIG_FILE" <<'EOF'
[default]
s3 =
    addressing_style = path
EOF

attempt=1
while ! aws s3api list-buckets >/dev/null 2>&1; do
    if [ "$attempt" -ge "$attempts" ]; then
        echo "object storage endpoint was not ready after $attempts attempts" >&2
        exit 1
    fi
    attempt=$((attempt + 1))
    sleep 1
done

seen_buckets=''
for bucket in "$OSMO_WORKFLOW_BUCKET" "$OSMO_LOG_BUCKET" "$OSMO_APP_BUCKET"; do
    case "
$seen_buckets" in
        *"
$bucket
"*)
            continue
            ;;
    esac
    seen_buckets="${seen_buckets}${bucket}
"

    if aws s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
        continue
    fi
    aws s3api create-bucket --bucket "$bucket"
done
