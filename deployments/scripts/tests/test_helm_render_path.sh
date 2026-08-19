#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

REPO_ROOT="${TEST_SRCDIR}/_main"

# shellcheck source=/dev/null
source "$REPO_ROOT/deployments/scripts/deploy-k8s.sh"

PROVIDER=azure
OSMO_NAMESPACE=osmo-minimal
OSMO_OPERATOR_NAMESPACE=osmo-operator
OSMO_WORKFLOWS_NAMESPACE=osmo-workflows
OSMO_IMAGE_REGISTRY=nvcr.io/nvstaging/osmo
OSMO_IMAGE_TAG=contract-test
OSMO_HELM_REPO_NAME=osmo-release-contract
OSMO_CHART_VERSION=1.3.1
NGC_SECRET_NAME=nvcr-pull
NGC_API_KEY=contract-test-api-key
BACKEND_TOKEN_SECRET_NAME=osmo-operator-token
POSTGRES_HOST=example.postgres.database.azure.com
POSTGRES_PORT=5432
POSTGRES_DB_NAME=osmo
POSTGRES_USERNAME=osmo
REDIS_HOST=example.redis.azure.net
REDIS_PORT=10000
STATIC_VALUES_DIR="$REPO_ROOT/deployments/values"
STORAGE_VALUES_FILE="$REPO_ROOT/ci/deployment-test/fixtures/minio-storage-values.yaml"
OSMO_SERVICE_HELM_VALUES_FILES=("$REPO_ROOT/ci/deployment-test/azure-overrides.yaml")
OSMO_SERVICE_HELM_SET_VALUES=(services.ui.enabled=true)
OSMO_BACKEND_OPERATOR_HELM_SET_VALUES=(services.backendWorker.enabled=true)

CAPTURE_FILE="$(mktemp)"
trap 'rm -f "$CAPTURE_FILE"' EXIT

capture_helm() {
    printf '%s\n' "$1" >> "$CAPTURE_FILE"
    if [[ "$1" == template* ]]; then
        printf 'kind: List\n'
    fi
}
RUN_HELM=capture_helm

assert_contains() {
    local description="$1" value="$2" expected="$3"
    if [[ "$value" != *"$expected"* ]]; then
        echo "assertion failed: $description" >&2
        echo "expected: $expected" >&2
        exit 1
    fi
}

service_flags="$(service_helm_flags)"
operator_flags="$(backend_operator_helm_flags)"

assert_contains 'service namespace' "$service_flags" '--namespace osmo-minimal'
assert_contains 'service chart version' "$service_flags" '--version 1.3.1'
assert_contains 'service base values' "$service_flags" \
    "-f $REPO_ROOT/deployments/values/service.yaml"
assert_contains 'storage values' "$service_flags" \
    "-f $REPO_ROOT/ci/deployment-test/fixtures/minio-storage-values.yaml"
assert_contains 'Azure values' "$service_flags" \
    "-f $REPO_ROOT/ci/deployment-test/azure-overrides.yaml"
assert_contains 'private workflow image credential' "$service_flags" \
    '--set services.configs.workflow.backend_images.credential.username=$oauthtoken'
assert_contains 'service-specific caller override' "$service_flags" \
    '--set services.ui.enabled=true'

assert_contains 'operator namespace' "$operator_flags" '--namespace osmo-operator'
assert_contains 'operator base values' "$operator_flags" \
    "-f $REPO_ROOT/deployments/values/backend-operator.yaml"
assert_contains 'operator-specific caller override' "$operator_flags" \
    '--set services.backendWorker.enabled=true'

render_osmo_service_chart >/dev/null
deploy_osmo_service >/dev/null
render_backend_operator_chart >/dev/null
setup_backend_operator >/dev/null

mapfile -t commands < "$CAPTURE_FILE"
if [[ "${#commands[@]}" -ne 4 ]]; then
    echo "assertion failed: expected four Helm commands, got ${#commands[@]}" >&2
    exit 1
fi

assert_contains 'service render shares all flags' "${commands[0]}" "$service_flags"
assert_contains 'service install shares all flags' "${commands[1]}" "$service_flags"
assert_contains 'operator render shares all flags' "${commands[2]}" "$operator_flags"
assert_contains 'operator install shares all flags' "${commands[3]}" "$operator_flags"
