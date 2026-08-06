#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

MODE="${1:-all}"
if [[ -n "${TEST_SRCDIR:-}" && -n "${TEST_WORKSPACE:-}" ]]; then
    CHARTS_ROOT="$TEST_SRCDIR/$TEST_WORKSPACE/deployments/charts"
else
    CHARTS_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fi
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

require_contains() {
    local file=$1
    local expected=$2
    grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

require_not_contains() {
    local file=$1
    local unexpected=$2
    if grep -Fiq -- "$unexpected" "$file"; then
        fail "did not expect '$unexpected' in $file"
    fi
}

deployment_names() {
    awk '
        /^kind: Deployment$/ { deployment = 1; metadata = 0; next }
        deployment && /^metadata:$/ { metadata = 1; next }
        deployment && metadata && /^  name: / {
            sub(/^  name: /, "")
            print
            deployment = 0
            metadata = 0
        }
        /^---$/ { deployment = 0; metadata = 0 }
    ' "$1"
}

require_deployment() {
    local file=$1
    local name=$2
    deployment_names "$file" | grep -Fxq -- "$name" || fail "expected Deployment/$name"
}

require_no_deployment() {
    local file=$1
    local name=$2
    if deployment_names "$file" | grep -Fxq -- "$name"; then
        fail "did not expect Deployment/$name"
    fi
}

test_service_secret_references() {
    local rendered="$TEST_DIRECTORY/service.yaml"
    helm template service-secret-test "$CHARTS_ROOT/service" \
        --set services.configFile.enabled=true \
        --set services.configFile.secretName=custom-mek-secret \
        --set services.configFile.secretKey=custom-mek.yaml \
        --set services.postgres.passwordSecretName=custom-postgresql-secret \
        --set services.postgres.passwordSecretKey=custom-postgresql-password \
        --set services.redis.passwordSecretName=custom-valkey-secret \
        --set services.redis.passwordSecretKey=custom-valkey-password \
        >"$rendered"

    require_contains "$rendered" "name: custom-postgresql-secret"
    require_contains "$rendered" "key: custom-postgresql-password"
    require_contains "$rendered" "name: custom-valkey-secret"
    require_contains "$rendered" "key: custom-valkey-password"
    require_contains "$rendered" "secretName: custom-mek-secret"
    require_contains "$rendered" "key: custom-mek.yaml"
    require_not_contains "$rendered" "name: db-secret"
    require_not_contains "$rendered" "name: redis-secret"
}

test_dependency_chart() {
    local rendered="$TEST_DIRECTORY/osmo-deps.yaml"
    helm template osmo-deps "$CHARTS_ROOT/osmo-deps" >"$rendered"

    require_deployment "$rendered" "osmo-deps-postgresql"
    require_deployment "$rendered" "osmo-deps-valkey"
    require_deployment "$rendered" "osmo-deps-rustfs"
    require_contains "$rendered" "name: osmo-deps-credentials"
    require_contains "$rendered" "db-password:"
    require_contains "$rendered" "redis-password:"
    require_contains "$rendered" "access_key_id:"
    require_contains "$rendered" "access_key:"
    require_contains "$rendered" 'admin-password: "0123456789012345678901234567890123456789012"'
    require_contains "$rendered" "mek.yaml:"
    require_contains "$rendered" "name: osmo-deps-buckets"
}

test_control_umbrella() {
    local charts_copy="$TEST_DIRECTORY/charts"
    local rendered="$TEST_DIRECTORY/osmo.yaml"
    mkdir -p "$charts_copy"
    cp -R "$CHARTS_ROOT/service" "$charts_copy/service"
    cp -R "$CHARTS_ROOT/osmo" "$charts_copy/osmo"
    helm dependency build "$charts_copy/osmo" >/dev/null

    helm template osmo "$charts_copy/osmo" \
        -f "$charts_copy/osmo/profiles/split-plane-control.yaml" \
        -f "$charts_copy/osmo/profiles/kind.yaml" \
        >"$rendered"

    require_deployment "$rendered" "osmo-service"
    require_deployment "$rendered" "osmo-worker"
    require_deployment "$rendered" "osmo-router"
    require_deployment "$rendered" "osmo-logger"
    require_deployment "$rendered" "osmo-agent"
    require_deployment "$rendered" "osmo-delayed-job-monitor"
    require_deployment "$rendered" "osmo-ui"
    require_deployment "$rendered" "osmo-gateway-envoy"
    require_no_deployment "$rendered" "postgres"
    require_no_deployment "$rendered" "redis"
    require_no_deployment "$rendered" "localstack-s3"
    require_no_deployment "$rendered" "osmo-backend-listener"
    require_no_deployment "$rendered" "osmo-backend-worker"
    require_contains "$rendered" "osmo-deps-postgresql"
    require_contains "$rendered" "osmo-deps-valkey"
    require_contains "$rendered" "secretName: osmo-deps-credentials"
    require_contains "$rendered" "http://osmo-deps-rustfs:9000"
    require_contains "$rendered" "nvcr.io/nvidia/osmo/service:6.3.1"
    require_not_contains "$rendered" "service_base_url: http://osmo-gateway-envoy"
    require_not_contains "$rendered" "vault.hashicorp.com"
    require_not_contains "$rendered" "labels_config:"

    if helm template unsupported-compute "$charts_copy/osmo" \
        --set planes.compute.enabled=true \
        >"$TEST_DIRECTORY/unsupported-compute.out" 2>&1; then
        fail "expected planes.compute.enabled=true to fail"
    fi
    require_contains "$TEST_DIRECTORY/unsupported-compute.out" \
        "compute plane is not implemented"
}

case "$MODE" in
    service)
        test_service_secret_references
        ;;
    deps)
        test_dependency_chart
        ;;
    osmo)
        test_control_umbrella
        ;;
    all)
        test_service_secret_references
        test_dependency_chart
        test_control_umbrella
        ;;
    *)
        fail "unknown test mode: $MODE"
        ;;
esac

echo "PASS: OSMO Helm chart tests ($MODE)"
