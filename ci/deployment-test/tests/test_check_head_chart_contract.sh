#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
repo="${TEST_SRCDIR:?}/_main"
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
mkdir "$temporary/bin"
export PATH="$temporary/bin:$PATH"
export GITHUB_OUTPUT="$temporary/output" GITHUB_STEP_SUMMARY="$temporary/summary"
cat > "$temporary/bin/helm" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail
case "$1" in
    repo|dependency|lint) exit 0 ;;
    show) echo 'version: 0.1.0' ;;
    template)
        [[ "$*" == *'osmo/profiles/single-plane.yaml'* ]]
        [[ "$*" == *'scripts/single-plane-azure.yaml'* ]]
        [[ "$*" == *'secrets.masterEncryptionKey.bootstrap.enabled=true'* ]]
        dynamic=
        for argument in "$@"; do
            if [[ "$argument" == */dynamic.json ]]; then dynamic="$argument"; fi
        done
        if [[ "$*" == *'--show-only'* ]]; then
            echo '  mountPath: /etc/osmo/secrets/nvcr-pull'
            echo '  secretName: "nvcr-pull"'
            echo '  key: ".dockerconfigjson"'
            if [[ "${BROKEN:-}" == mounts ]]; then
                echo '- mountPath: /etc/osmo/secrets/nvcr-pull'
            fi
            exit 0
        fi
        tag=$(jq -r '.imageTag' "$dynamic")
        runtime_tag=$(jq -r '.runtimeImage.tag // "latest"' "$dynamic")
        [[ "${BROKEN:-}" != runtime ]] || runtime_tag=latest
        for component in service logger agent router worker delayed-job-monitor web-ui backend-listener backend-worker; do
            echo "image: nvcr.io/nvstaging/osmo/$component:$tag"
        done
        if [[ "${BROKEN:-}" != authz ]]; then
            echo "image: nvcr.io/nvstaging/osmo/authz-sidecar:$tag"
            echo 'name: envoy.filters.http.ext_authz'
            echo '--roles-file=/etc/osmo/configs/config.yaml'
        fi
        if [[ "${BROKEN:-}" == identity-bypass ]]; then echo 'key: x-osmo-allowed-pools'; fi
        if [[ "${BROKEN:-}" == missing-jwt ]]; then echo 'allow_missing: {}'; fi
        echo "init: nvcr.io/nvstaging/osmo/init-container:$runtime_tag"
        echo "client: nvcr.io/nvstaging/osmo/client:$runtime_tag"
        cat <<'RENDERED'
namespace: osmo
name: osmo-gateway
k8s_namespace: osmo
osmo-postgresql osmo-valkey osmo-default-admin osmo-backend-token
example.postgres.database.azure.com example.redis.azure.net
azure://contractstorage/workflows/workflows
azure://contractstorage/workflows/logs
azure://contractstorage/workflows/apps
sdkDefault osmo-workflow nvcr-pull
RENDERED
        if [[ "${BROKEN:-}" != identity ]]; then
            echo 'azure.workload.identity/use azure.workload.identity/client-id'
            jq -r '.services.api.serviceAccount.annotations["azure.workload.identity/client-id"]' "$dynamic"
        fi ;;
    *) exit 9 ;;
esac
MOCK
chmod +x "$temporary/bin/helm"
bash "$repo/ci/deployment-test/check-head-chart-contract.sh"
grep -q 'chart_version=0.1.0' "$GITHUB_OUTPUT"
for broken in runtime identity mounts authz identity-bypass missing-jwt; do
    if BROKEN="$broken" bash "$repo/ci/deployment-test/check-head-chart-contract.sh" > "$temporary/failure.log" 2>&1; then
        echo "Broken $broken chart contract passed" >&2; exit 1
    fi
    grep -q 'HEAD single-plane chart' "$temporary/failure.log"
done
echo 'Unified HEAD contract and mismatched runtime/identity/registry-mount/authorization checks passed'
