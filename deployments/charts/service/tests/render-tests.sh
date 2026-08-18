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
            if (document_kind == kind && document_name == name) {
                printf "%s", document
                found = 1
            }
        }
        BEGIN { found = 0; reset() }
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
        END { finish(); if (!found) exit 1 }
    ' <<<"$rendered"
}

helm_args=(
    --namespace osmo
    --set 'services.backendApiTokens.enabled=true'
)

existing_render=$(helm template existing-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=existing-token')
grep -q 'secretName: "existing-token"' <<<"$existing_render"
if grep -qE 'backend-token-bootstrap|^kind: Secret$|resources: \["secrets"\]' \
        <<<"$existing_render"; then
    echo 'Consumer-only backend credential rendered a Secret mutator' >&2
    exit 1
fi

for unsupported_source in managedSecret secretName; do
    if helm template invalid "$CHART_DIR" "${helm_args[@]}" \
            --set 'services.backendApiTokens.credentials[0].name=default' \
            --set "services.backendApiTokens.credentials[0].${unsupported_source}.name=token" \
            >/dev/null 2>&1; then
        echo "Unsupported backend credential source ${unsupported_source} was accepted" >&2
        exit 1
    fi
done

sensitive_value='DO-NOT-STORE-IN-HELM-VALUES'

assert_rejected_without_sensitive_value() {
    local case_name=$1
    shift
    local output_file
    output_file=$(mktemp)
    if helm template "$case_name" "$CHART_DIR" "${helm_args[@]}" "$@" \
            >"$output_file" 2>&1; then
        echo "Unsafe backend credential value case ${case_name} was accepted" >&2
        rm -f "$output_file"
        exit 1
    fi
    if grep -q "$sensitive_value" "$output_file"; then
        echo "Backend credential value was exposed in validation case ${case_name}" >&2
        rm -f "$output_file"
        exit 1
    fi
    rm -f "$output_file"
}

for unsupported_field in \
        'services.backendApiTokens.token' \
        'services.backendApiTokens.credentials[0].token' \
        'services.backendApiTokens.credentials[0].existingSecret.token'; do
    assert_rejected_without_sensitive_value inline-token \
        --set 'services.backendApiTokens.credentials[0].name=default' \
        --set 'services.backendApiTokens.credentials[0].existingSecret.name=token' \
        --set-string "${unsupported_field}=${sensitive_value}"
done

assert_rejected_without_sensitive_value secret-name-map \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set-string \
    "services.backendApiTokens.credentials[0].existingSecret.name.token=${sensitive_value}"
assert_rejected_without_sensitive_value rollout-nonce-map \
    --set 'services.backendApiTokens.credentials[0].name=default' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=token' \
    --set-string "services.backendApiTokens.rolloutNonce.token=${sensitive_value}"
assert_rejected_without_sensitive_value credentials-string \
    --set-string "services.backendApiTokens.credentials=${sensitive_value}"
assert_rejected_without_sensitive_value enabled-string \
    --set-string "services.backendApiTokens.enabled=${sensitive_value}"
assert_rejected_without_sensitive_value credential-name-map \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=token' \
    --set-string "services.backendApiTokens.credentials[0].name.token=${sensitive_value}"

if helm template missing "$CHART_DIR" "${helm_args[@]}" \
        --set 'services.backendApiTokens.credentials[0].name=default' \
        >/dev/null 2>&1; then
    echo 'Backend credential without existingSecret was accepted' >&2
    exit 1
fi

multiple_render=$(helm template multiple-test "$CHART_DIR" "${helm_args[@]}" \
    --set 'services.backendApiTokens.credentials[0].name=one' \
    --set 'services.backendApiTokens.credentials[0].existingSecret.name=token-one' \
    --set 'services.backendApiTokens.credentials[1].name=two' \
    --set 'services.backendApiTokens.credentials[1].existingSecret.name=token-two')
grep -q 'secretName: "token-one"' <<<"$multiple_render"
grep -q 'secretName: "token-two"' <<<"$multiple_render"

mek_bootstrap_render=$(helm template mek-bootstrap "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
mek_bootstrap_list=$(resource_document "$mek_bootstrap_render" List \
    mek-bootstrap-mek-bootstrap)
mek_bootstrap_diagnostic=$(resource_document "$mek_bootstrap_render" ConfigMap \
    mek-bootstrap-mek-bootstrap-diagnostic)
grep -q 'image: "alpine/kubectl:1.33.4"' <<<"$mek_bootstrap_list"
grep -q -- '--from-file="$secret_key=$temporary_directory/mek.yaml"' \
    <<<"$mek_bootstrap_list"
grep -q -- '- "test-mek"' <<<"$mek_bootstrap_list"
grep -q -- '- "keyring.yaml"' <<<"$mek_bootstrap_list"
grep -q 'resourceNames: \["test-mek"\]' <<<"$mek_bootstrap_list"
grep -q 'verbs: \["get", "patch"\]' <<<"$mek_bootstrap_list"
if grep -q 'verbs: .*"create"' <<<"$mek_bootstrap_list"; then
    echo 'MEK bootstrap can create arbitrary Secrets' >&2
    exit 1
fi
grep -q 'kind: Job' <<<"$mek_bootstrap_list"
grep -q 'kind: RoleBinding' <<<"$mek_bootstrap_list"
role_binding_line=$(grep -n 'kind: RoleBinding' <<<"$mek_bootstrap_list" \
    | cut -d: -f1)
job_line=$(grep -n 'kind: Job' <<<"$mek_bootstrap_list" | cut -d: -f1)
if [[ "$role_binding_line" -ge "$job_line" ]]; then
    echo 'MEK bootstrap RoleBinding must precede the Job' >&2
    exit 1
fi
grep -q 'privileged resources were removed' <<<"$mek_bootstrap_diagnostic"
mek_bootstrap_placeholder=$(resource_document "$mek_bootstrap_render" Secret test-mek)
grep -q 'osmo.nvidia.com/mek-bootstrap-placeholder: "true"' \
    <<<"$mek_bootstrap_placeholder"
if grep -qE '^(data|stringData):' <<<"$mek_bootstrap_placeholder"; then
    echo 'MEK bootstrap rendered Secret material into Helm release state' >&2
    exit 1
fi

mek_bootstrap_upgrade_render=$(helm template mek-bootstrap-upgrade "$CHART_DIR" \
    --namespace osmo --is-upgrade \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true')
grep -q -- '--fail-if-missing' <<<"$mek_bootstrap_upgrade_render"
if [[ $(grep -c 'hook-failed' <<<"$mek_bootstrap_upgrade_render") -ne 1 ]]; then
    echo 'MEK bootstrap resource List does not clean up after failure' >&2
    exit 1
fi
if resource_document "$mek_bootstrap_upgrade_render" ConfigMap \
        mek-bootstrap-upgrade-mek-bootstrap-diagnostic | grep -q 'hook-failed'; then
    echo 'MEK bootstrap failure diagnostic would be deleted' >&2
    exit 1
fi
if [[ $(grep -c 'mek-bootstrap-placeholder' <<<"$mek_bootstrap_upgrade_render") -ne 1 ]]; then
    echo 'MEK bootstrap rendered a placeholder Secret during upgrade' >&2
    exit 1
fi

if helm template mek-bootstrap-disabled "$CHART_DIR" --namespace osmo \
        | grep -q 'app.kubernetes.io/component: mek-bootstrap'; then
    echo 'MEK bootstrap hook rendered while disabled' >&2
    exit 1
fi

assert_invalid_mek_bootstrap_value() {
    local description=$1
    shift
    if helm template invalid-mek-bootstrap "$CHART_DIR" --namespace osmo \
            "$@" >/dev/null 2>&1; then
        echo "Invalid MEK bootstrap $description was accepted" >&2
        exit 1
    fi
}

assert_invalid_mek_bootstrap_value object \
    --set-string 'services.masterEncryptionKey.bootstrap=invalid'
assert_invalid_mek_bootstrap_value enabled-type \
    --set-string 'services.masterEncryptionKey.bootstrap.enabled=false'
assert_invalid_mek_bootstrap_value image-type \
    --set 'services.masterEncryptionKey.bootstrap.image=123'
assert_invalid_mek_bootstrap_value empty-image \
    --set-string 'services.masterEncryptionKey.bootstrap.image='
assert_invalid_mek_bootstrap_value image-pull-policy-type \
    --set 'services.masterEncryptionKey.bootstrap.imagePullPolicy=123'
assert_invalid_mek_bootstrap_value image-pull-policy-value \
    --set-string 'services.masterEncryptionKey.bootstrap.imagePullPolicy=Sometimes'

quick_start_render=$(helm template quick-start "$CHART_DIR" --namespace osmo \
    -f "$CHART_DIR/quick-start-values.yaml")
resource_document "$quick_start_render" List quick-start-mek-bootstrap \
    >/dev/null

bash -n "$CHART_DIR/files/mek-bootstrap.sh"
bash "$CHART_DIR/tests/mek-bootstrap-tests.sh"

mek_render=$(helm template mek-test "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.existingSecret.name=customer-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml' \
    --set 'services.router.extraVolumeMounts[0].name=router-extra' \
    --set 'services.router.extraVolumeMounts[0].mountPath=/tmp/router-extra')
grep -q 'mountPath: /tmp/router-extra' <<<"$mek_render"
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
    if ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK adoption selector is incomplete on Deployment/$deployment" >&2
        exit 1
    fi
done
for hpa in osmo-service osmo-worker osmo-router osmo-logger osmo-agent; do
    document=$(resource_document "$mek_render" HorizontalPodAutoscaler "$hpa")
    if ! grep -q 'app.kubernetes.io/instance: "mek-test"' <<<"$document"; then
        echo "MEK adoption selector is incomplete on HorizontalPodAutoscaler/$hpa" >&2
        exit 1
    fi
done
if grep -q 'osmo.nvidia.com/mek-consumer' <<<"$mek_render"; then
    echo 'Product chart rendered the KIND-only MEK consumer label' >&2
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
