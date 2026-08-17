#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

# Fail before cloud provisioning when the latest stable public charts cannot
# consume the images and values produced by the current deployment scripts.

set -euo pipefail

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

service_render="$(helm template osmo-minimal "$HELM_REPO_NAME/service" \
    --version "$service_version" \
    --namespace osmo-minimal \
    -f deployments/values/service.yaml \
    -f ci/deployment-test/azure-overrides.yaml \
    --set global.osmoImageLocation=nvcr.io/nvstaging/osmo \
    --set global.osmoImageTag=contract-test \
    --set global.imagePullSecret=nvcr-pull \
    --set services.postgres.serviceName=example.postgres.database.azure.com \
    --set services.postgres.port=5432 \
    --set services.postgres.db=osmo \
    --set services.postgres.user=osmo \
    --set services.redis.serviceName=example.redis.azure.net \
    --set services.redis.port=10000 \
    --set services.backendApiTokens.enabled=true \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=osmo-operator-token' \
    --set services.ui.apiHostname=osmo-gateway.osmo-minimal.svc.cluster.local:80 \
    --set services.configs.service.service_base_url=http://osmo-gateway.osmo-minimal.svc.cluster.local \
    --set services.configs.backends.default.router_address=ws://osmo-gateway.osmo-minimal.svc.cluster.local \
    --set services.configs.workflow.backend_images.init=nvcr.io/nvstaging/osmo/init-container:contract-test \
    --set services.configs.workflow.backend_images.client=nvcr.io/nvstaging/osmo/client:contract-test)"

operator_render="$(helm template osmo-operator "$HELM_REPO_NAME/backend-operator" \
    --version "$operator_version" \
    --namespace osmo-operator \
    -f deployments/values/backend-operator.yaml \
    --set global.osmoImageLocation=nvcr.io/nvstaging/osmo \
    --set global.osmoImageTag=contract-test \
    --set global.imagePullSecret=nvcr-pull \
    --set global.serviceUrl=http://osmo-gateway.osmo-minimal.svc.cluster.local \
    --set global.agentNamespace=osmo-operator \
    --set global.backendNamespace=osmo-workflows \
    --set global.accountTokenSecret=osmo-operator-token)"

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
