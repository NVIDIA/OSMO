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

lease_name() {
    awk '
        /^kind: Lease$/ { lease = 1; metadata = 0; next }
        lease && /^metadata:$/ { metadata = 1; next }
        lease && metadata && /^  name: / {
            sub(/^  name: /, ""); gsub(/^"|"$/, ""); print; exit
        }
        /^---$/ { lease = 0; metadata = 0 }
    ' <<<"$1"
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
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.existingSecret.key=keyring.yaml')
grep -q '^kind: Lease$' <<<"$mek_bootstrap_render"
grep -q 'app.kubernetes.io/component: mek-bootstrap' <<<"$mek_bootstrap_render"
grep -q 'command: \["mek-lifecycle"\]' <<<"$mek_bootstrap_render"
grep -A1 -- '- --operation' <<<"$mek_bootstrap_render" | grep -q -- '- bootstrap'
grep -q 'resourceNames: \["test-mek"\]' <<<"$mek_bootstrap_render"
grep -q 'verbs: \["get", "patch"\]' <<<"$mek_bootstrap_render"
grep -q 'resources: \["rolebindings"\]' <<<"$mek_bootstrap_render"
grep -q 'verbs: \["delete"\]' <<<"$mek_bootstrap_render"
if grep -q 'resources: \["secrets"\].*create' <<<"$mek_bootstrap_render"; then
    echo 'MEK bootstrap can create arbitrary Secrets' >&2
    exit 1
fi
mek_bootstrap_placeholder=$(resource_document "$mek_bootstrap_render" Secret test-mek)
grep -q 'osmo.nvidia.com/mek-management: osmo' \
    <<<"$mek_bootstrap_placeholder"
if ! grep -A1 '^data:' <<<"$mek_bootstrap_placeholder" \
        | grep -q '  "keyring.yaml": ""'; then
    echo 'MEK bootstrap did not render the retained empty placeholder' >&2
    exit 1
fi

mek_bootstrap_upgrade_render=$(helm template mek-bootstrap-upgrade "$CHART_DIR" \
    --namespace osmo --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.bootstrap.enabled=true')
grep -A1 -- '- --operation' <<<"$mek_bootstrap_upgrade_render" | grep -q -- '- validate'
if grep -A4 'resources: \["secrets"\]' <<<"$mek_bootstrap_upgrade_render" \
        | grep -q patch; then
    echo 'Upgrade validation can patch the MEK Secret' >&2
    exit 1
fi
if grep -q '^kind: Secret$' <<<"$mek_bootstrap_upgrade_render"; then
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
assert_invalid_mek_bootstrap_value image-pull-policy-type \
    --set 'services.masterEncryptionKey.bootstrap.imagePullPolicy=123'
assert_invalid_mek_bootstrap_value image-pull-policy-value \
    --set-string 'services.masterEncryptionKey.bootstrap.imagePullPolicy=Sometimes'
assert_invalid_mek_bootstrap_value deadline-type \
    --set-string 'services.masterEncryptionKey.rotation.activeDeadlineSeconds=900'
assert_invalid_mek_bootstrap_value fractional-deadline \
    --set-json 'services.masterEncryptionKey.rotation.activeDeadlineSeconds=1.5'
assert_invalid_mek_bootstrap_value ownership-bool-type \
    --set-string 'services.masterEncryptionKey.ownershipRelease.enabled=false'

validation_marker='do-not-echo-mek-contract-sentinel'
validation_output=$(mktemp)
trap 'rm -f "$validation_output"' EXIT
if helm template invalid-mek-secret-name "$CHART_DIR" --namespace osmo \
        --set-json "services.masterEncryptionKey.existingSecret.name={\"token\":\"$validation_marker\"}" \
        >"$validation_output" 2>&1; then
    echo 'Object-valued MEK Secret name was accepted' >&2
    exit 1
fi
if grep -q "$validation_marker" "$validation_output"; then
    echo 'MEK contract validation echoed an untrusted value' >&2
    exit 1
fi

quick_start_render=$(helm template quick-start "$CHART_DIR" --namespace osmo \
    -f "$CHART_DIR/quick-start-values.yaml")
grep -q 'app.kubernetes.io/component: mek-bootstrap' <<<"$quick_start_render"

mek_rotation_render=$(helm template mek-rotate "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.rotation.requestId=rotate-2026-08' \
    --set 'services.masterEncryptionKey.rotation.activeDeadlineSeconds=321')
grep -q 'app.kubernetes.io/component: mek-rotation' <<<"$mek_rotation_render"
grep -A1 -- '- --operation' <<<"$mek_rotation_render" | grep -q -- '- rotate'
grep -q 'resources: \["pods"\]' <<<"$mek_rotation_render"
grep -q 'resources: \["deployments", "replicasets"\]' <<<"$mek_rotation_render"
grep -A1 -- '--active_deadline_seconds' <<<"$mek_rotation_render" \
    | grep -q -- '"321"'

mek_recovery_render=$(helm template mek-recover "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.existingSecret.name=test-mek' \
    --set 'services.masterEncryptionKey.recovery.enabled=true')
grep -q 'app.kubernetes.io/component: mek-recovery' <<<"$mek_recovery_render"
grep -q 'resources: \["localsubjectaccessreviews"\]' <<<"$mek_recovery_render"
grep -A1 'name: OSMO_SERVICE_ACCOUNT' <<<"$mek_recovery_render" \
    | grep -q 'mek-recover'
grep -q 'fieldPath: metadata.uid' <<<"$mek_recovery_render"
if grep -A20 'app.kubernetes.io/component: mek-recovery' <<<"$mek_recovery_render" \
        | grep -q 'resources: \["secrets"\]'; then
    echo 'MEK recovery unexpectedly has Secret access' >&2
    exit 1
fi

mek_release_render=$(helm template mek-release "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=external' \
    --set 'services.masterEncryptionKey.ownershipRelease.enabled=true')
grep -A1 -- '- --operation' <<<"$mek_release_render" | grep -q -- '- release'
grep -q 'verbs: \["get"\]' <<<"$mek_release_render"
if grep -A4 'resources: \["secrets"\]' <<<"$mek_release_render" | grep -q patch; then
    echo 'MEK ownership release can mutate the Secret' >&2
    exit 1
fi
mek_settled_external_render=$(helm template mek-release "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=external' \
    --set 'services.masterEncryptionKey.ownershipRelease.enabled=false')
if helm template invalid-mek-release "$CHART_DIR" --namespace osmo --is-upgrade \
        --set 'services.masterEncryptionKey.managementMode=external' \
        --set 'services.masterEncryptionKey.ownershipRelease.enabled=true' \
        --set 'services.masterEncryptionKey.rebind.enabled=true' >/dev/null 2>&1; then
    echo 'Conflicting MEK ownership operations were accepted' >&2
    exit 1
fi

mek_reacquire_render=$(helm template mek-release "$CHART_DIR" --namespace osmo \
    --is-upgrade \
    --set 'services.masterEncryptionKey.managementMode=osmo' \
    --set 'services.masterEncryptionKey.ownershipReacquire.enabled=true')
grep -A1 -- '- --operation' <<<"$mek_reacquire_render" | grep -q -- '- reacquire'
release_lease=$(lease_name "$mek_release_render")
settled_lease=$(lease_name "$mek_settled_external_render")
reacquire_lease=$(lease_name "$mek_reacquire_render")
if [[ -z "$release_lease" || "$release_lease" != "$settled_lease" || \
      "$release_lease" != "$reacquire_lease" ]]; then
    echo 'MEK ownership handoff did not preserve one release-scoped Lease' >&2
    exit 1
fi
if grep -q 'command: \["mek-lifecycle"\]' <<<"$mek_settled_external_render"; then
    echo 'Settled external mode unexpectedly rendered lifecycle RBAC or a Job' >&2
    exit 1
fi

shared_one=$(helm template release-one "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.existingSecret.name=shared-mek')
shared_two=$(helm template release-two "$CHART_DIR" --namespace osmo \
    --set 'services.masterEncryptionKey.existingSecret.name=shared-mek')
if [[ $(lease_name "$shared_one") == $(lease_name "$shared_two") ]]; then
    echo 'Two releases sharing a Secret rendered the same lifecycle Lease' >&2
    exit 1
fi
long_prefix=$(printf 'a%.0s' {1..100})
long_one=$(helm template lease-long "$CHART_DIR" --namespace osmo \
    --set-string "services.masterEncryptionKey.existingSecret.name=${long_prefix}one")
long_two=$(helm template lease-long "$CHART_DIR" --namespace osmo \
    --set-string "services.masterEncryptionKey.existingSecret.name=${long_prefix}two")
if [[ $(lease_name "$long_one") == $(lease_name "$long_two") ]]; then
    echo 'Long Secret names with one prefix rendered the same lifecycle Lease' >&2
    exit 1
fi

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
