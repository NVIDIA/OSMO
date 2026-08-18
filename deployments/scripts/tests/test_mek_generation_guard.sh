#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck source=/dev/null
source "${TEST_SRCDIR}/_main/deployments/scripts/deploy-k8s.sh"

export OSMO_NAMESPACE="test-control"
export POSTGRES_HOST="postgres.test"
export POSTGRES_USERNAME="postgres"
export POSTGRES_DB_NAME="osmo"
export POSTGRES_PASSWORD="password"

create_backend_token_secrets() {
    return 0
}

fake_kubectl() {
    case "$1" in
        *"get secret osmo-mek"*) return 1 ;;
        *"get secret default-admin-secret"*) return 0 ;;
        *"get pvc"*) printf '%s' "${PVC_OUTPUT:-}" ;;
        *) return 0 ;;
    esac
}

capture_manifest() {
    printf '%s' "$1" > "$manifest_file"
}

RUN_KUBECTL=fake_kubectl
RUN_KUBECTL_APPLY_STDIN=capture_manifest

OSMO_IN_CLUSTER_DB=true
PVC_OUTPUT=""
DB_TABLE_COUNT=""
create_database >/dev/null
[[ "$DB_TABLE_COUNT" == "0" ]]
PVC_OUTPUT="persistentvolumeclaim/postgres-data"
create_database >/dev/null
[[ "$DB_TABLE_COUNT" == "UNKNOWN" ]]
OSMO_IN_CLUSTER_DB=false

for table_count in "" UNKNOWN invalid 1; do
    DB_TABLE_COUNT="$table_count"
    manifest_file=$(mktemp)
    if output=$(create_secrets 2>&1); then
        echo "MEK generation unexpectedly accepted DB_TABLE_COUNT=$table_count" >&2
        exit 1
    fi
    if [[ -s "$manifest_file" ]]; then
        echo "MEK manifest was created for unverified DB_TABLE_COUNT=$table_count" >&2
        exit 1
    fi
    rm -f "$manifest_file"
done

DB_TABLE_COUNT=0
manifest_file=$(mktemp)
trap 'rm -f "$manifest_file"' EXIT INT TERM
create_secrets >/dev/null
grep -q '^  name: osmo-mek$' "$manifest_file"
grep -q '^    currentMek: key1$' "$manifest_file"
