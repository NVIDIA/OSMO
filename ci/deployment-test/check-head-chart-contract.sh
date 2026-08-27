#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Fail before cloud provisioning when charts from this checkout cannot consume
# the images and values produced by the current deployment scripts.

set -euo pipefail

CHECK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CHECK_DIR/../.." && pwd)"
SERVICE_CHART="$REPO_ROOT/deployments/charts/service"
OPERATOR_CHART="$REPO_ROOT/deployments/charts/backend-operator"

helm lint "$SERVICE_CHART"
helm lint "$OPERATOR_CHART"

service_version="$(helm show chart "$SERVICE_CHART" \
    | awk '$1 == "version:" { print $2; exit }')"
operator_version="$(helm show chart "$OPERATOR_CHART" \
    | awk '$1 == "version:" { print $2; exit }')"

if [[ -z "$service_version" || -z "$operator_version" ]]; then
    echo "Unable to resolve HEAD chart versions" >&2
    exit 1
fi
if [[ "$service_version" != "$operator_version" ]]; then
    echo "HEAD chart versions do not match: service=$service_version operator=$operator_version" >&2
    exit 1
fi

# Seed inert connection details, then render through the exact flag builders
# used by deploy_osmo_service and setup_backend_operator. The storage fixture
# represents configure-storage.sh's generated MinIO fragment without requiring
# Kubernetes access.
PROVIDER=azure
OSMO_NAMESPACE=osmo-minimal
OSMO_OPERATOR_NAMESPACE=osmo-operator
OSMO_WORKFLOWS_NAMESPACE=osmo-workflows
OSMO_IMAGE_REGISTRY=nvcr.io/nvstaging/osmo
OSMO_IMAGE_TAG=head-contract
OSMO_HELM_REPO_NAME="$REPO_ROOT/deployments/charts"
OSMO_CHART_VERSION=""
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
STORAGE_VALUES_FILE="$CHECK_DIR/fixtures/minio-storage-values.yaml"

# shellcheck source=../../deployments/scripts/deploy-k8s.sh
source "$REPO_ROOT/deployments/scripts/deploy-k8s.sh"
OSMO_HELM_VALUES_FILES=("$CHECK_DIR/azure-overrides.yaml")
OSMO_HELM_SET_VALUES=(
    services.logger.scaling.minReplicas=1
    services.logger.resources.requests.cpu=100m
    services.service.resources.requests.cpu=100m
    services.worker.resources.requests.cpu=100m
    services.agent.resources.requests.cpu=100m
    services.router.resources.requests.cpu=100m
    services.configs.workflow.backend_images.credential.registry=nvcr.io
    'services.configs.workflow.backend_images.credential.username=$oauthtoken'
    "services.configs.workflow.backend_images.credential.auth=$NGC_API_KEY"
)

service_render="$(render_osmo_service_chart)"
operator_render="$(render_backend_operator_chart)"

missing_contracts=()
if ! grep -q 'k8s_namespace: osmo-minimal' <<<"$service_render"; then
    missing_contracts+=("backend namespace")
fi
if ! grep -q -- '- --backend_token_directory' <<<"$service_render"; then
    missing_contracts+=("control-plane backend token argument")
fi
if ! grep -Eq 'secretName: ["]?osmo-operator-token["]?' <<<"$service_render"; then
    missing_contracts+=("control-plane backend token Secret mount")
fi
if ! grep -Eq 'secretName: ["]?osmo-operator-token["]?' <<<"$operator_render"; then
    missing_contracts+=("operator backend token Secret mount")
fi
if ! grep -q 'nvcr.io/nvstaging/osmo/service:head-contract' <<<"$service_render"; then
    missing_contracts+=("HEAD service image")
fi
if ! grep -q 'nvcr.io/nvstaging/osmo/init-container:head-contract' <<<"$service_render"; then
    missing_contracts+=("HEAD workflow init image")
fi
if ! grep -q 'nvcr.io/nvstaging/osmo/backend-listener:head-contract' <<<"$operator_render"; then
    missing_contracts+=("HEAD backend-listener image")
fi
if ! grep -q 'nvcr.io/nvstaging/osmo/backend-worker:head-contract' <<<"$operator_render"; then
    missing_contracts+=("HEAD backend-worker image")
fi

if [[ ${#missing_contracts[@]} -gt 0 ]]; then
    printf 'HEAD charts (%s) are incompatible with this checkout:\\n' \
        "$service_version" >&2
    printf '  - missing %s\\n' "${missing_contracts[@]}" >&2
    echo "Refusing to provision Azure for a deployment that cannot start." >&2
    exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "chart_version=$service_version" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
        echo "### HEAD chart contract passed"
        echo
        echo "- service: \`$service_version\`"
        echo "- backend-operator: \`$operator_version\`"
        echo "- source SHA: \`${GITHUB_SHA:-local-checkout}\`"
        echo "- rendered through: \`deployments/scripts/deploy-k8s.sh\`"
    } >> "$GITHUB_STEP_SUMMARY"
fi

echo "HEAD charts $service_version satisfy the current deployment contract"
