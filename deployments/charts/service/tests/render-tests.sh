#!/usr/bin/env bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

CHART_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

resource_document() {
    local rendered=$1
    local kind=$2
    local name=$3
    awk -v kind="$kind" -v name="$name" '
        function reset() { document = ""; document_kind = ""; document_name = ""; metadata = 0 }
        function finish() {
            if (document_kind == kind && document_name == name) printf "%s", document
        }
        BEGIN { reset() }
        /^---[[:space:]]*$/ { finish(); reset(); next }
        { document = document $0 ORS }
        /^kind: / { document_kind = $0; sub(/^kind: /, "", document_kind); next }
        /^metadata:$/ { metadata = 1; next }
        metadata && /^  name: / {
            document_name = $0
            sub(/^  name: /, "", document_name)
            gsub(/^"|"$/, "", document_name)
            metadata = 0
        }
        END { finish() }
    ' <<<"$rendered"
}

helm_args=(
    --namespace osmo
    --set 'services.backendApiTokens.enabled=true'
)

managed_render=$(helm template managed-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q '^kind: Job$' <<<"$managed_render"
grep -q 'image: "alpine/kubectl:1.33.4"' <<<"$managed_render"
grep -q -- '--from-file=token=/dev/stdin' <<<"$managed_render"
if grep -q 'backend_token_bootstrap' <<<"$managed_render"; then
    echo 'Managed backend credential still uses the service bootstrap binary' >&2
    exit 1
fi
if grep -q '^kind: Secret$' <<<"$managed_render"; then
    echo 'Managed backend credential rendered secret material' >&2
    exit 1
fi

existing_render=$(helm template existing-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=existing-token')
if grep -q 'backend_token_bootstrap' <<<"$existing_render"; then
    echo 'Existing backend credential unexpectedly rendered a bootstrap hook' >&2
    exit 1
fi
grep -q 'secretName: "existing-token"' <<<"$existing_render"

legacy_render=$(helm template legacy-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].secretName=legacy-token')
grep -q 'secretName: "legacy-token"' <<<"$legacy_render"

if helm template invalid "$CHART_DIR" "${helm_args[@]}" \
        --set 'services.backendApiTokens.credentials[0].name=default' \
        --set 'services.backendApiTokens.credentials[0].existingSecret.name=one' \
        --set 'services.backendApiTokens.credentials[0].managedSecret.name=two' \
        >/dev/null 2>&1; then
    echo 'Conflicting backend credential sources were accepted' >&2
    exit 1
fi

multiple_render=$(helm template multiple-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=one' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=token-one' \
    --set 'services.backendApiTokens.credentials[1].name=two' \
    --set 'services.backendApiTokens.credentials[1].managedSecret.name=token-two')
if [[ $(grep -c -- '^        - --secret-name$' <<<"$multiple_render") -ne 2 ]]; then
    echo 'Multiple managed backend credentials were not passed to the hook' >&2
    exit 1
fi

upgrade_render=$(helm template upgrade-test "$CHART_DIR" "${helm_args[@]}" \
    --is-upgrade \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].managedSecret.name=agent-token')
grep -q -- '--fail-if-missing' <<<"$upgrade_render"
if [[ $(grep -c 'hook-failed' <<<"$upgrade_render") -ne 3 ]]; then
    echo 'Bootstrap RBAC hooks do not clean up after failure' >&2
    exit 1
fi
if grep -A8 '^kind: Job$' <<<"$upgrade_render" | grep -q 'hook-failed'; then
    echo 'Failed bootstrap Job would be deleted before diagnosis' >&2
    exit 1
fi

bash -n "$CHART_DIR/files/backend-token-bootstrap.sh"
bash "$CHART_DIR/tests/backend-token-bootstrap-tests.sh"

mek_bootstrap_render=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
mek_bootstrap_job=$(resource_document "$mek_bootstrap_render" Job \
    mek-bootstrap-mek-bootstrap)
mek_bootstrap_role=$(resource_document "$mek_bootstrap_render" Role \
    mek-bootstrap-mek-bootstrap)
grep -q 'image: "alpine/kubectl:1.33.4"' <<<"$mek_bootstrap_job"
grep -q -- '--from-file="$secret_key=$temporary_directory/mek.yaml"' \
    <<<"$mek_bootstrap_job"
grep -q -- '- "test-mek"' <<<"$mek_bootstrap_job"
grep -q -- '- "keyring.yaml"' <<<"$mek_bootstrap_job"
grep -q 'resourceNames: \["test-mek"\]' <<<"$mek_bootstrap_role"
grep -q 'verbs: \["get"\]' <<<"$mek_bootstrap_role"
grep -q 'verbs: \["create"\]' <<<"$mek_bootstrap_role"
if grep -q '^kind: Secret$' <<<"$mek_bootstrap_render"; then
    echo 'MEK bootstrap rendered Secret material into Helm release state' >&2
    exit 1
fi

mek_bootstrap_upgrade_render=$(helm template mek-bootstrap-upgrade "$CHART_DIR" \
    --namespace osmo --is-upgrade \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true')
grep -q -- '--fail-if-missing' <<<"$mek_bootstrap_upgrade_render"
if [[ $(grep -c 'hook-failed' <<<"$mek_bootstrap_upgrade_render") -ne 3 ]]; then
    echo 'MEK bootstrap RBAC hooks do not clean up after failure' >&2
    exit 1
fi
if resource_document "$mek_bootstrap_upgrade_render" Job \
        mek-bootstrap-upgrade-mek-bootstrap | grep -q 'hook-failed'; then
    echo 'Failed MEK bootstrap Job would be deleted before diagnosis' >&2
    exit 1
fi

if helm template mek-bootstrap-disabled "$CHART_DIR" --namespace osmo \
        | grep -q 'app.kubernetes.io/component: mek-bootstrap'; then
    echo 'MEK bootstrap hook rendered while disabled' >&2
    exit 1
fi

quick_start_render=$(helm template quick-start "$CHART_DIR" --namespace osmo \
    -f "$CHART_DIR/quick-start-values.yaml")
resource_document "$quick_start_render" Job quick-start-mek-bootstrap \
    >/dev/null

bash -n "$CHART_DIR/files/mek-bootstrap.sh"
bash "$CHART_DIR/tests/mek-bootstrap-tests.sh"

mek_render=$(helm template mek-test "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.existingSecret.name=customer-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
if [[ $(grep -c -- '- --mek_file' <<<"$mek_render") -ne 6 ]]; then
    echo 'Not every MEK consumer receives --mek_file' >&2
    exit 1
fi
if [[ $(grep -c 'secretName: "customer-mek"' <<<"$mek_render") -ne 6 ]]; then
    echo 'Not every MEK consumer mounts the existing Secret' >&2
    exit 1
fi
if [[ $(grep -c -- '- "/opt/osmo/mek/mek.yaml"' <<<"$mek_render") -ne 6 ]] || \
   [[ $(grep -c 'mountPath: "/opt/osmo/mek"' <<<"$mek_render") -ne 6 ]]; then
    echo 'MEK consumers do not use the fixed chart-owned path' >&2
    exit 1
fi
if [[ $(grep -c 'name: OSMO_POD_UID' <<<"$mek_render") -ne 6 ]] || \
   [[ $(grep -c 'name: OSMO_MEK_CONSUMER' <<<"$mek_render") -ne 6 ]] || \
   [[ $(grep -c 'name: OSMO_ALLOW_EXISTING_MEK_ADOPTION' <<<"$mek_render") -ne 6 ]]; then
    echo 'Not every MEK consumer reports its projected keyring generation' >&2
    exit 1
fi
if grep -q 'subPath:.*mek' <<<"$mek_render"; then
    echo 'MEK is still mounted with subPath and cannot receive kubelet updates' >&2
    exit 1
fi
if grep -q 'name: mek-config' <<<"$mek_render"; then
    echo 'Legacy MEK ConfigMap support is still rendered' >&2
    exit 1
fi
if grep -q 'vault.hashicorp.com' <<<"$mek_render"; then
    echo 'Vault annotations are still rendered for the MEK' >&2
    exit 1
fi

mek_deployments=(
    osmo-service osmo-worker osmo-router osmo-logger osmo-agent
    osmo-delayed-job-monitor
)
for deployment in "${mek_deployments[@]}"; do
    document=$(resource_document "$mek_render" Deployment "$deployment")
    if [[ $(grep -c 'osmo.nvidia.com/mek-consumer: "true"' <<<"$document") -ne 2 ]] ||
       ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK adoption selector is incomplete on Deployment/$deployment" >&2
        exit 1
    fi
done
for hpa in osmo-service osmo-worker osmo-router osmo-logger osmo-agent; do
    document=$(resource_document "$mek_render" HorizontalPodAutoscaler "$hpa")
    if ! grep -q 'osmo.nvidia.com/mek-consumer: "true"' <<<"$document" ||
       ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK adoption selector is incomplete on HorizontalPodAutoscaler/$hpa" >&2
        exit 1
    fi
done
ui_document=$(resource_document "$mek_render" Deployment osmo-ui)
if grep -q 'osmo.nvidia.com/mek-consumer' <<<"$ui_document"; then
    echo 'Non-MEK UI Deployment received the adoption selector' >&2
    exit 1
fi
grep -q 'app in (osmo-service,osmo-worker,osmo-router,osmo-logger,osmo-agent,osmo-delayed-job-monitor)' \
    "$CHART_DIR/README.md"
grep -q 'kubectl delete horizontalpodautoscaler' "$CHART_DIR/README.md"
grep -q 'kubectl wait pod' "$CHART_DIR/README.md"
grep -q 'set -euo pipefail' "$CHART_DIR/README.md"
grep -q 'remaining=$(kubectl get pod' "$CHART_DIR/README.md"
if bash -c 'set -euo pipefail; kubectl() { return 1; }; remaining=$(kubectl get pod); test -z "$remaining"'; then
    echo 'MEK adoption runbook would ignore a kubectl get failure' >&2
    exit 1
fi
