#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail
umask 077
ci_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=azure-inputs.sh
source "$ci_dir/azure-inputs.sh"
ci_azure_inputs
: "${RUN_DIR:?}"
mkdir -p "$RUN_DIR"
private=$(mktemp -d)
export KUBECONFIG="$private/kubeconfig"
port_forward_pid=
token_name="nightly-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
token_created=false
# Use the existing overlay hook; do not rewrite the runner's user configuration.
export OETF_INTERNAL_YAML="$ci_dir/oetf-single-plane.yaml"
cleanup() {
    local status=$?
    trap - EXIT
    if [[ "$token_created" == true ]]; then
        timeout 15s osmo token delete "$token_name" >/dev/null 2>&1 || true
    fi
    if [[ -n "$port_forward_pid" ]]; then
        kill "$port_forward_pid" 2>/dev/null || true
        wait "$port_forward_pid" 2>/dev/null || true
    fi
    rm -rf -- "$private"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

az aks get-credentials --subscription "$TF_SUBSCRIPTION_ID" --resource-group "$TF_RESOURCE_GROUP" \
    --name "$TF_CLUSTER_NAME" --admin --overwrite-existing --file "$KUBECONFIG"
kubectl --namespace osmo port-forward svc/osmo-gateway 9100:80 > "$RUN_DIR/oetf-port-forward.log" 2>&1 &
port_forward_pid=$!
ready=false
for _ in {1..30}; do
    kill -0 "$port_forward_pid" || { echo "Gateway port-forward exited" >&2; exit 1; }
    if curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:9100/api/version >/dev/null; then
        ready=true
        break
    fi
    sleep 1
done
[[ "$ready" == true ]] || { echo "Gateway did not become ready" >&2; exit 1; }
kill -0 "$port_forward_pid" || { echo "Gateway port-forward exited during readiness" >&2; exit 1; }
kubectl get secret osmo-default-admin --namespace osmo --output jsonpath='{.data.password}' \
    | base64 --decode > "$private/bootstrap-token"
test -s "$private/bootstrap-token"
printf '::add-mask::%s\n' "$(cat "$private/bootstrap-token")"
osmo login http://127.0.0.1:9100 --method token --token-file "$private/bootstrap-token"
osmo profile set pool default
# Token expiry is a date at midnight UTC. Keep at least 24 hours even when a
# manual run starts just before midnight; normal cleanup revokes it immediately.
expiry=$(date -u -d '2 days' +%Y-%m-%d)
osmo token set "$token_name" --roles osmo-admin --expires-at "$expiry" --format-type json > "$private/token.json"
token_created=true
OETF_TOKEN=$(jq -er '.token | select(type == "string" and length > 0)' "$private/token.json")
printf '::add-mask::%s\n' "$OETF_TOKEN"
export OETF_TOKEN

set +e
bazel run //test/oetf:run -- --env azure-single-plane --pool default \
    --local-osmo "$(command -v osmo)" --tags api,websocket,logger,task-env,negative \
    --output-json "$RUN_DIR/oetf-result.json" 2>&1 | tee "$RUN_DIR/oetf.log"
status=${PIPESTATUS[0]}
set -e
[[ "$status" == 0 ]] || exit "$status"
kill -0 "$port_forward_pid" || { echo "Gateway port-forward exited during OETF" >&2; exit 1; }
# The runner already rejects empty selection; also reject missing/all-skipped results.
jq -e '.total > 0 and .passed > 0 and .failed == 0 and .errored == 0' \
    "$RUN_DIR/oetf-result.json" >/dev/null
