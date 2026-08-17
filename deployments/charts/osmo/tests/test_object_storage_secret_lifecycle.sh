#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

if [[ $# -ne 1 ]]; then
    fail "usage: $0 <explicit-kind-osmo-kubeconfig>"
fi

KUBECONFIG_FILE=$1
[[ -f "$KUBECONFIG_FILE" ]] || fail "kubeconfig not found: $KUBECONFIG_FILE"

for required_command in grep helm kubectl; do
    command -v "$required_command" >/dev/null || \
        fail "required command not found: $required_command"
done

KUBE_CONTEXT=$(kubectl --kubeconfig "$KUBECONFIG_FILE" config current-context)
[[ "$KUBE_CONTEXT" == kind-osmo ]] || \
    fail "lifecycle test requires an explicit kind-osmo kubeconfig, got: $KUBE_CONTEXT"
kubectl --kubeconfig "$KUBECONFIG_FILE" get --raw=/readyz >/dev/null

SCRIPT_DIRECTORY=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CHART_DIRECTORY=$(cd "$SCRIPT_DIRECTORY/.." && pwd)
bash "$CHART_DIRECTORY/tests/verify_rustfs_chart_archive.sh" >/dev/null

TEST_DIRECTORY=$(mktemp -d)
NAMESPACE="osmo-rustfs-lifecycle-${RANDOM}-${RANDOM}-$$"
NAMESPACE_OWNED=false
STANDALONE_RELEASE=lifecycle-standalone
STANDALONE_SECRET=lifecycle-standalone-credentials
DISTRIBUTED_RELEASE=lifecycle-distributed
DISTRIBUTED_SECRET=lifecycle-distributed-credentials

cleanup_resources() {
    helm --kubeconfig "$KUBECONFIG_FILE" uninstall "$DISTRIBUTED_RELEASE" \
        --namespace "$NAMESPACE" --no-hooks >/dev/null 2>&1
    helm --kubeconfig "$KUBECONFIG_FILE" uninstall "$STANDALONE_RELEASE" \
        --namespace "$NAMESPACE" --no-hooks >/dev/null 2>&1
    kubectl --kubeconfig "$KUBECONFIG_FILE" delete namespace "$NAMESPACE" \
        --ignore-not-found --wait=true --timeout=45s >/dev/null 2>&1
}

cleanup() {
    set +e
    if [[ "$NAMESPACE_OWNED" == true ]]; then
        cleanup_resources
    fi
    rm -rf "$TEST_DIRECTORY"
}
trap cleanup EXIT

kubectl --kubeconfig "$KUBECONFIG_FILE" create namespace "$NAMESPACE" >/dev/null
NAMESPACE_OWNED=true

helm_apply() {
    local release=$1
    local secret=$2
    shift 2
    helm --kubeconfig "$KUBECONFIG_FILE" upgrade --install "$release" \
        "$CHART_DIRECTORY" \
        --namespace "$NAMESPACE" \
        --no-hooks \
        -f "$CHART_DIRECTORY/profiles/split-plane-control.yaml" \
        -f "$CHART_DIRECTORY/tests/control-external-values.yaml" \
        -f "$CHART_DIRECTORY/tests/object-storage-lifecycle-values.yaml" \
        --set-string "rustfs.secret.existingSecret=$secret" \
        "$@"
}

secret_data_value() {
    local secret=$1
    local key=$2
    kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
        get secret "$secret" -o "go-template={{ index .data \"$key\" }}"
}

require_output() {
    local file=$1
    local expected=$2
    grep -Fq -- "$expected" "$file" || fail "expected '$expected' in $file"
}

helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get deployment lifecycle-standalone-rustfs >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get persistentvolumeclaim lifecycle-standalone-rustfs-data >/dev/null

standalone_access_key=$(secret_data_value "$STANDALONE_SECRET" RUSTFS_ACCESS_KEY)
standalone_secret_key=$(secret_data_value "$STANDALONE_SECRET" RUSTFS_SECRET_KEY)
standalone_credentials=$(secret_data_value "$STANDALONE_SECRET" object-storage.yaml)
[[ -n "$standalone_access_key" && -n "$standalone_secret_key" && \
    -n "$standalone_credentials" ]] || fail "generated Secret data must be non-empty"

helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" >/dev/null
[[ "$(secret_data_value "$STANDALONE_SECRET" RUSTFS_ACCESS_KEY)" == \
    "$standalone_access_key" ]] || fail "upgrade changed generated RustFS access key"
[[ "$(secret_data_value "$STANDALONE_SECRET" RUSTFS_SECRET_KEY)" == \
    "$standalone_secret_key" ]] || fail "upgrade changed generated RustFS secret key"
[[ "$(secret_data_value "$STANDALONE_SECRET" object-storage.yaml)" == \
    "$standalone_credentials" ]] || fail "upgrade changed generated OSMO credentials"

kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    patch secret "$STANDALONE_SECRET" --type=json \
    --patch='[{"op":"remove","path":"/data/RUSTFS_ACCESS_KEY"}]' >/dev/null
if helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" \
    >"$TEST_DIRECTORY/missing-key.out" 2>&1; then
    fail "upgrade accepted a generated Secret with a missing retained key"
fi
require_output "$TEST_DIRECTORY/missing-key.out" \
    "generated object-storage Secret $STANDALONE_SECRET is missing key RUSTFS_ACCESS_KEY"
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    patch secret "$STANDALONE_SECRET" --type=merge \
    --patch "{\"data\":{\"RUSTFS_ACCESS_KEY\":\"$standalone_access_key\"}}" \
    >/dev/null

kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    patch secret "$STANDALONE_SECRET" --type=json \
    --patch='[{"op":"replace","path":"/data/object-storage.yaml","value":""}]' \
    >/dev/null
if helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" \
    >"$TEST_DIRECTORY/empty-key.out" 2>&1; then
    fail "upgrade accepted a generated Secret with an empty retained key"
fi
require_output "$TEST_DIRECTORY/empty-key.out" \
    "generated object-storage Secret $STANDALONE_SECRET has an empty key object-storage.yaml"
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    patch secret "$STANDALONE_SECRET" --type=merge \
    --patch "{\"data\":{\"object-storage.yaml\":\"$standalone_credentials\"}}" \
    >/dev/null
helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" >/dev/null

kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    delete secret "$STANDALONE_SECRET" >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get deployment lifecycle-standalone-rustfs >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get persistentvolumeclaim lifecycle-standalone-rustfs-data >/dev/null
if helm_apply "$STANDALONE_RELEASE" "$STANDALONE_SECRET" \
    >"$TEST_DIRECTORY/missing-standalone-secret.out" 2>&1; then
    fail "upgrade regenerated a deleted Secret while standalone state survived"
fi
require_output "$TEST_DIRECTORY/missing-standalone-secret.out" \
    "generated object-storage Secret $STANDALONE_SECRET is missing; restore it"

helm_apply "$DISTRIBUTED_RELEASE" "$DISTRIBUTED_SECRET" \
    --set rustfs.mode.standalone.enabled=false \
    --set rustfs.mode.distributed.enabled=true \
    --set rustfs.replicaCount=2 \
    --set rustfs.drivesPerNode=1 \
    --set rustfs.localEndpointHost.autoInject=true >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get statefulset lifecycle-distributed-rustfs >/dev/null

distributed_pvc=data-lifecycle-distributed-rustfs-0
for _ in {1..30}; do
    if kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
        get persistentvolumeclaim "$distributed_pvc" >/dev/null 2>&1; then
        break
    fi
    sleep 1
done
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get persistentvolumeclaim "$distributed_pvc" >/dev/null || \
    fail "distributed StatefulSet did not create $distributed_pvc"

kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    delete secret "$DISTRIBUTED_SECRET" >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get statefulset lifecycle-distributed-rustfs >/dev/null
kubectl --kubeconfig "$KUBECONFIG_FILE" --namespace "$NAMESPACE" \
    get persistentvolumeclaim "$distributed_pvc" >/dev/null
if helm_apply "$DISTRIBUTED_RELEASE" "$DISTRIBUTED_SECRET" \
    --set rustfs.mode.standalone.enabled=false \
    --set rustfs.mode.distributed.enabled=true \
    --set rustfs.replicaCount=2 \
    --set rustfs.drivesPerNode=1 \
    --set rustfs.localEndpointHost.autoInject=true \
    >"$TEST_DIRECTORY/missing-distributed-secret.out" 2>&1; then
    fail "upgrade regenerated a deleted Secret while distributed state survived"
fi
require_output "$TEST_DIRECTORY/missing-distributed-secret.out" \
    "generated object-storage Secret $DISTRIBUTED_SECRET is missing; restore it"

cleanup_resources
NAMESPACE_OWNED=false
trap - EXIT
rm -rf "$TEST_DIRECTORY"
echo "PASS: object-storage Secret lifecycle tests ($KUBE_CONTEXT)"
