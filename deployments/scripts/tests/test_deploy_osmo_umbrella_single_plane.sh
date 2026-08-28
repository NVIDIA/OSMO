#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.

test_directory="$(mktemp -d)"
mock_directory="$test_directory/mock-bin"
command_log="$test_directory/commands.log"
mkdir -p "$mock_directory" "$test_directory/tmp"
trap 'rm -rf "$test_directory"' EXIT

fail() {
    echo "assertion failed: $*" >&2
    exit 1
}

assert_contains() {
    local file="$1"
    local expected="$2"
    grep -Fq -- "$expected" "$file" || fail "expected $expected"
}

assert_not_contains() {
    local file="$1"
    local forbidden="$2"
    ! grep -Fq -- "$forbidden" "$file" || fail "found secret sentinel $forbidden"
}

assert_ordered() {
    local previous=0
    local expected
    for expected in "$@"; do
        local current
        current="$(grep -n -F -- "$expected" "$command_log" | head -n 1 | cut -d: -f1 || true)"
        [[ -n "$current" ]] || fail "missing command $expected"
        ((current > previous)) || fail "command out of order $expected"
        previous="$current"
    done
}

write_mock() {
    local name="$1"
    shift
    printf '%s\n' "$@" >"$mock_directory/$name"
    chmod +x "$mock_directory/$name"
}

# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock az '#!/bin/bash' 'set -euo pipefail' 'echo "az $*" >>"$COMMAND_LOG"' \
    'if [[ "$1 $2" == "account show" ]]; then echo test-subscription; fi'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock terraform '#!/bin/bash' 'set -euo pipefail' 'echo "terraform $*" >>"$COMMAND_LOG"' \
    '[[ "${TF_VAR_node_instance_type:-}" == "Standard_D8s_v3" ]] || exit 18' \
    '[[ "${TF_VAR_single_plane_workload_identity_enabled:-}" == "true" ]] || exit 19' \
    'if [[ "$*" == *"output -raw"* ]]; then' \
    '  case "${!#}" in' \
    '    aks_cluster_name) echo test-aks ;;' \
    '    postgres_server_fqdn) echo test.postgres.database.azure.com ;;' \
    '    postgres_database_name) echo osmo ;;' \
    '    postgres_admin_username) echo osmo_admin ;;' \
    '    postgres_password) echo postgres-secret-sentinel ;;' \
    '    redis_cache_hostname) echo test.redis.cache.windows.net ;;' \
    '    redis_cache_ssl_port) echo 10000 ;;' \
    '    redis_cache_primary_access_key) echo redis-secret-sentinel ;;' \
    '    single_plane_storage_account) echo teststorage ;;' \
    '    single_plane_storage_container_name) echo osmo-workflows ;;' \
    '    single_plane_blob_identity_client_id) echo 11111111-2222-3333-4444-555555555555 ;;' \
    '    *) exit 1 ;;' \
    '  esac' \
    'fi'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock kubectl '#!/bin/bash' 'set -euo pipefail' \
    'sanitized_args=()' \
    'for argument in "$@"; do' \
    '  [[ "$argument" == --from-literal=* ]] && argument="--from-literal=REDACTED"' \
    '  sanitized_args+=("$argument")' \
    'done' \
    'echo "kubectl ${sanitized_args[*]}" >>"$COMMAND_LOG"' \
    'if [[ "$1 $2" == "get secret" ]]; then' \
    '  case "$BACKEND_TOKEN_STATE" in' \
    '    absent) exit 0 ;;' \
    '    existing) echo secret/osmo-backend-token ;;' \
    '    error) exit 17 ;;' \
    '  esac' \
    'fi' \
    'if [[ "$*" == *"apply -f -"* || "$*" == *"--from-file=object-storage.yaml=/dev/stdin"* ]]; then cat >/dev/null; fi' \
    'if [[ "$*" == *"create secret generic"* ]]; then' \
    '  printf "apiVersion: v1\\nkind: Secret\\nmetadata:\\n  name: mock\\n"' \
    'fi' \
    'if [[ "$*" == *"port-forward"* ]]; then touch "$PORT_FORWARD_READY"; while true; do sleep 1; done; fi'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock helm '#!/bin/bash' 'set -euo pipefail' 'echo "helm $*" >>"$COMMAND_LOG"'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock openssl '#!/bin/bash' 'set -euo pipefail' 'echo "openssl $*" >>"$COMMAND_LOG"' 'echo backend-token-sentinel'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock curl '#!/bin/bash' 'set -euo pipefail' '[[ -f "$PORT_FORWARD_READY" ]] || exit 1' 'echo "curl $*" >>"$COMMAND_LOG"'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock bash '#!/bin/bash' 'set -euo pipefail' 'echo "bash $*" >>"$COMMAND_LOG"'
write_mock osmo '#!/bin/bash' 'exit 0'

export COMMAND_LOG="$command_log"
export PORT_FORWARD_READY="$test_directory/port-forward-ready"
export PATH="$mock_directory:$PATH"
export TF_VAR_resource_group_name=test-resource-group
export TMPDIR="$test_directory/tmp"
export OSMO_IMAGE_REPOSITORY=nvstaging/osmo
export OSMO_IMAGE_TAG=123
export OSMO_IMAGE_PULL_SECRET=456

script="${TEST_SRCDIR}/_main/deployments/scripts/deploy-osmo-umbrella-single-plane.sh"
[[ -x "$script" ]] || fail "deployment script is absent"
export BACKEND_TOKEN_STATE=absent
"$script" >"$test_directory/output.log" 2>&1

values_file="$TMPDIR/single-plane-azure.yaml"
[[ -f "$values_file" ]] || fail "Azure values file was not generated"
assert_contains "$values_file" 'externalUrl: http://osmo-gateway'
assert_contains "$values_file" 'host: test.postgres.database.azure.com'
assert_contains "$values_file" 'port: 5432'
assert_contains "$values_file" 'port: 10000'
assert_contains "$values_file" 'enabled: false'
assert_contains "$values_file" 'enabled: true'
assert_contains "$values_file" 'workflows: azure://teststorage/osmo-workflows/workflows'
assert_contains "$values_file" 'logs: azure://teststorage/osmo-workflows/logs'
assert_contains "$values_file" 'apps: azure://teststorage/osmo-workflows/apps'
assert_contains "$values_file" 'type: sdkDefault'
assert_contains "$values_file" 'existingSecret: osmo-postgresql'
assert_contains "$values_file" 'existingSecret: osmo-valkey'
assert_not_contains "$values_file" 'existingSecret: osmo-object-storage'
assert_contains "$values_file" '      create: true'
assert_contains "$values_file" 'azure.workload.identity/client-id: "11111111-2222-3333-4444-555555555555"'
assert_contains "$values_file" 'azure.workload.identity/use: "true"'
assert_contains "$values_file" 'serviceAccountName: osmo-workflow'
assert_contains "$values_file" 'azure_workload_identity:'
assert_contains "$values_file" '      - default_ctrl'
assert_contains "$values_file" '      - default_user'
assert_contains "$values_file" '      - kind_dev_auth'
assert_contains "$values_file" '      - azure_workload_identity'
assert_contains "$values_file" 'imageTag: "123"'
assert_contains "$values_file" 'repository: "nvstaging/osmo"'
for image in agent backend-listener backend-worker delayed-job-monitor logger router service web-ui worker; do
    assert_contains "$values_file" "repository: \"nvstaging/osmo/$image\""
done
assert_contains "$values_file" 'tag: "123"'
assert_contains "$values_file" 'pullSecret: "456"'
assert_contains "$values_file" 'name":"456"'
assert_not_contains "$values_file" postgres-secret-sentinel
assert_not_contains "$values_file" redis-secret-sentinel
assert_not_contains "$values_file" storage-key-sentinel
assert_not_contains "$values_file" backend-token-sentinel
assert_not_contains "$values_file" DefaultEndpointsProtocol
assert_not_contains "$values_file" 's3:'
assert_not_contains "$test_directory/output.log" postgres-secret-sentinel
assert_not_contains "$test_directory/output.log" redis-secret-sentinel
assert_not_contains "$test_directory/output.log" storage-key-sentinel
assert_not_contains "$test_directory/output.log" backend-token-sentinel
assert_not_contains "$command_log" postgres-secret-sentinel
assert_not_contains "$command_log" redis-secret-sentinel
assert_not_contains "$command_log" storage-key-sentinel
assert_not_contains "$command_log" backend-token-sentinel
assert_not_contains "$command_log" 'storage_account_key'
assert_not_contains "$command_log" 'kubectl create secret generic osmo-object-storage'

terraform_directory="${TEST_SRCDIR}/_main/deployments/terraform/azure/example"

assert_ordered \
    'az account show' \
    "terraform -chdir=$terraform_directory init" \
    "terraform -chdir=$terraform_directory apply -auto-approve" \
    'az aks get-credentials' \
    'helm upgrade --install kai-scheduler' \
    'kubectl create namespace osmo' \
    'kubectl create secret generic osmo-postgresql' \
    'kubectl create secret generic osmo-valkey' \
    'kubectl create serviceaccount osmo-workflow' \
    'kubectl annotate serviceaccount osmo-workflow' \
    'kubectl create secret generic osmo-backend-token' \
    'helm dependency build' \
    'helm upgrade --install osmo' \
    'helm upgrade osmo' \
    'kubectl --namespace osmo port-forward service/osmo-gateway 9000:80' \
    'curl --fail --silent http://127.0.0.1:9000/api/version' \
    'bash '

helm_commands="$test_directory/helm-commands"
expected_helm_commands="$test_directory/expected-helm-commands"
grep '^helm ' "$command_log" >"$helm_commands"
cat >"$expected_helm_commands" <<EOF
helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz --namespace kai-scheduler --create-namespace --wait --timeout 10m
helm dependency build ${TEST_SRCDIR}/_main/deployments/charts/osmo
helm upgrade --install osmo ${TEST_SRCDIR}/_main/deployments/charts/osmo --namespace osmo --values ${TEST_SRCDIR}/_main/deployments/charts/osmo/profiles/single-plane.yaml --values $values_file --set secrets.masterEncryptionKey.bootstrap.enabled=true --wait --wait-for-jobs --timeout 25m
helm upgrade osmo ${TEST_SRCDIR}/_main/deployments/charts/osmo --namespace osmo --values ${TEST_SRCDIR}/_main/deployments/charts/osmo/profiles/single-plane.yaml --values $values_file --set secrets.masterEncryptionKey.bootstrap.enabled=false --wait --wait-for-jobs --timeout 25m
EOF
cmp -s "$helm_commands" "$expected_helm_commands" || fail 'unexpected Helm command or gateway release'
assert_contains "$command_log" "bash ${TEST_SRCDIR}/_main/deployments/scripts/verify.sh"

: >"$command_log"
rm -f "$PORT_FORWARD_READY"
export BACKEND_TOKEN_STATE=existing
"$script" >"$test_directory/existing-token-output.log" 2>&1
assert_contains "$command_log" 'kubectl get secret osmo-backend-token --namespace osmo --ignore-not-found --output name'
assert_not_contains "$command_log" 'kubectl create secret generic osmo-backend-token'
assert_not_contains "$command_log" 'openssl rand -base64 32'

: >"$command_log"
rm -f "$PORT_FORWARD_READY"
export BACKEND_TOKEN_STATE=error
if "$script" >"$test_directory/lookup-error-output.log" 2>&1; then
    fail 'backend-token lookup error unexpectedly succeeded'
fi
assert_not_contains "$command_log" 'kubectl create secret generic osmo-backend-token'
assert_not_contains "$command_log" 'openssl rand -base64 32'
