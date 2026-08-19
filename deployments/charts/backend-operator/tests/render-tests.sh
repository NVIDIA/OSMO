#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEST_DIRECTORY=$(mktemp -d)
trap 'rm -rf "$TEST_DIRECTORY"' EXIT INT TERM

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
    if grep -Fq -- "$unexpected" "$file"; then
        fail "did not expect '$unexpected' in $file"
    fi
}

portable_render="$TEST_DIRECTORY/portable.yaml"
helm template portable "$CHART_DIRECTORY" \
    --namespace portable-system \
    --set-string global.agentNamespace= \
    --set-string global.backendNamespace= \
    --set global.serviceUrl=https://osmo.example.com \
    --set global.loginMethod=token \
    --set global.networkPolicy.enabled=true \
    --set podMonitor.enabled=true \
    --set extraConfigMaps.example.data.key=value \
    --api-versions monitoring.coreos.com/v1 \
    >"$portable_render"

require_contains "$portable_render" "namespace: portable-system"
require_contains "$portable_render" "- portable-system"
require_contains "$portable_render" \
    "kubernetes.io/metadata.name: portable-system"
require_not_contains "$portable_render" "namespace: osmo"
require_not_contains "$portable_render" "namespace: osmo-namespace"
require_not_contains "$portable_render" "namespace: null"
require_not_contains "$portable_render" "namespace: \"\""
require_contains "$portable_render" "- --test_runner_namespace"
require_contains "$portable_render" '- ""'
require_not_contains "$portable_render" 'resources: ["cronjobs"]'
require_not_contains "$portable_render" "  name: portable-test-runner"

explicit_render="$TEST_DIRECTORY/explicit.yaml"
helm template explicit "$CHART_DIRECTORY" \
    --namespace ignored-release-namespace \
    --set global.agentNamespace=agent-system \
    --set global.backendNamespace=workflow-system \
    --set global.backendTestNamespace=test-system \
    --set global.serviceUrl=https://osmo.example.com \
    --set global.loginMethod=token \
    --set global.networkPolicy.enabled=true \
    >"$explicit_render"

require_contains "$explicit_render" "namespace: agent-system"
require_contains "$explicit_render" "namespace: workflow-system"
require_contains "$explicit_render" "namespace: test-system"
require_contains "$explicit_render" "- workflow-system"
require_contains "$explicit_render" '- "test-system"'
require_contains "$explicit_render" 'resources: ["cronjobs"]'
require_contains "$explicit_render" "  name: explicit-test-runner"
require_contains "$explicit_render" \
    "kubernetes.io/metadata.name: workflow-system"
require_not_contains "$explicit_render" "namespace: ignored-release-namespace"

echo "PASS: backend-operator render tests"
