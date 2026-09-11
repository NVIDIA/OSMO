#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
ci_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo=$(cd "$ci_dir/../.." && pwd)
chart="$repo/deployments/charts/osmo"
private=$(mktemp -d)
trap 'rm -rf -- "$private"' EXIT

# Render through the same profile and dynamic-values filter as the public script.
# All connection details are inert. Never render real credentials for this check.
jq -n --arg image_registry nvcr.io --arg image_repository nvstaging/osmo \
    --arg image_tag head-contract --arg image_pull_secret nvcr-pull \
    --arg postgres_host example.postgres.database.azure.com --arg postgres_database osmo \
    --arg postgres_username osmo --arg redis_host example.redis.azure.net --arg redis_port 10000 \
    --arg storage_account contractstorage --arg storage_container workflows \
    --arg workload_identity_client_id 11111111-2222-3333-4444-555555555555 \
    -f "$repo/deployments/scripts/single-plane-values.jq" > "$private/dynamic.json"
values=(--namespace osmo -f "$chart/profiles/single-plane.yaml"
    -f "$repo/deployments/scripts/single-plane-azure.yaml" -f "$private/dynamic.json"
    --set secrets.masterEncryptionKey.bootstrap.enabled=true)
# Register URL-based dependencies on fresh Helm installations as well.
helm repo add osmo-postgresql https://cloudnative-pg.github.io/charts --force-update
helm repo add osmo-rustfs https://charts.rustfs.com --force-update
helm dependency build "$chart"
helm lint "$chart" "${values[@]}"
helm template osmo "$chart" "${values[@]}" > "$private/rendered.yaml"
# The chart mounts backend_images.credential automatically. A second manual
# mount can pass Helm lint/render but Kubernetes rejects the Deployment.
for template in api-service worker agent-service logger-service; do
    helm template osmo "$chart" "${values[@]}" --show-only "templates/$template.yaml" \
        > "$private/deployment.yaml"
    mounts=$(grep -Ec '^[[:space:]]*(-[[:space:]]+)?mountPath: /etc/osmo/secrets/nvcr-pull[[:space:]]*$' \
        "$private/deployment.yaml" || true)
    volumes=$(grep -Ec '^[[:space:]]*secretName: "?nvcr-pull"?[[:space:]]*$' \
        "$private/deployment.yaml" || true)
    if [[ "$mounts" != 1 || "$volumes" != 1 ]] || \
        ! grep -Fq 'key: ".dockerconfigjson"' "$private/deployment.yaml"; then
        echo "HEAD single-plane chart must mount the registry credential exactly once: $template" >&2
        exit 1
    fi
done
version=$(helm show chart "$chart" | awk '$1 == "version:" {print $2; exit}')
[[ -n "$version" ]]

require() {
    if ! grep -Fq -- "$1" "$private/rendered.yaml"; then
        echo "HEAD single-plane chart contract missing: $1" >&2
        exit 1
    fi
}
for component in service logger agent authz-sidecar router worker delayed-job-monitor web-ui \
    backend-listener backend-worker init-container client; do
    require "nvcr.io/nvstaging/osmo/$component:head-contract"
done
for contract in 'namespace: osmo' 'name: osmo-gateway' 'k8s_namespace: osmo' \
    'osmo-postgresql' 'osmo-valkey' 'osmo-default-admin' 'osmo-backend-token' \
    'example.postgres.database.azure.com' 'example.redis.azure.net' \
    'azure://contractstorage/workflows/workflows' 'azure://contractstorage/workflows/logs' \
    'azure://contractstorage/workflows/apps' 'osmo-workflow' \
    'azure.workload.identity/use' 'azure.workload.identity/client-id' \
    '11111111-2222-3333-4444-555555555555' 'nvcr-pull' \
    'name: envoy.filters.http.ext_authz' '--roles-file=/etc/osmo/configs/config.yaml'; do
    require "$contract"
done
# Azure uses verified JWT identities and policy-derived pool permissions.
if grep -Eq 'allow_missing:|key: x-osmo-(user|roles|allowed-pools)' "$private/rendered.yaml"; then
    echo 'HEAD single-plane chart unexpectedly permits development identity bypass' >&2
    exit 1
fi
# sdkDefault deliberately emits no static object-storage Secret reference.
if grep -Fq 'secretName: osmo-object-storage' "$private/rendered.yaml"; then
    echo 'HEAD single-plane chart unexpectedly uses static object-storage credentials' >&2
    exit 1
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "chart_version=$version" >> "$GITHUB_OUTPUT"
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
        echo '### HEAD single-plane chart contract passed'
        echo "- Unified chart version: $version"
        echo "- Source SHA: ${GITHUB_SHA:-local-checkout}"
        echo '- Service, compute and workflow runtime images use the CI registry/tag.'
    } >> "$GITHUB_STEP_SUMMARY"
fi
