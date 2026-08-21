#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Fail before cloud provisioning when the latest stable public charts cannot
# consume the images and values produced by the current deployment scripts.

set -euo pipefail

CHECK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$CHECK_DIR/../.." && pwd)"

HELM_REPO_NAME="${OSMO_HELM_REPO_NAME:-osmo-release-contract}"
HELM_REPO_URL="${OSMO_HELM_REPO_URL:-https://helm.ngc.nvidia.com/nvidia/osmo}"

helm repo add "$HELM_REPO_NAME" "$HELM_REPO_URL" --force-update >/dev/null
helm repo update "$HELM_REPO_NAME" >/dev/null

service_version="$(helm show chart "$HELM_REPO_NAME/service" \
    | awk '$1 == "version:" { print $2; exit }')"
operator_version="$(helm show chart "$HELM_REPO_NAME/backend-operator" \
    | awk '$1 == "version:" { print $2; exit }')"

if [[ -z "$service_version" || -z "$operator_version" ]]; then
    echo "Unable to resolve the latest stable released chart versions" >&2
    exit 1
fi
if [[ "$service_version" != "$operator_version" ]]; then
    echo "Released chart versions do not match: service=$service_version operator=$operator_version" >&2
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
OSMO_IMAGE_TAG=contract-test
OSMO_HELM_REPO_NAME="$HELM_REPO_NAME"
OSMO_HELM_REPO_URL="$HELM_REPO_URL"
OSMO_CHART_VERSION="$service_version"
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
OSMO_SERVICE_HELM_VALUES_FILES=("$CHECK_DIR/azure-overrides.yaml")

service_render="$(render_osmo_service_chart)"
operator_render="$(render_backend_operator_chart)"

missing_contracts=()
if ! grep -q 'k8s_namespace: osmo-minimal' <<<"$service_render"; then
    missing_contracts+=("backend namespace defaulting")
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

if [[ ${#missing_contracts[@]} -gt 0 ]]; then
    printf 'Latest stable released charts (%s) are incompatible with this checkout:\n' \
        "$service_version" >&2
    printf '  - missing %s\n' "${missing_contracts[@]}" >&2
    echo "Refusing to provision Azure for a deployment that cannot start." >&2
    exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "chart_version=$service_version" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
        echo "### Released chart compatibility passed"
        echo
        echo "- service: \`$service_version\`"
        echo "- backend-operator: \`$operator_version\`"
        echo "- repository: \`$HELM_REPO_URL\`"
    } >> "$GITHUB_STEP_SUMMARY"
fi

echo "Released charts $service_version satisfy the current deployment contract"
