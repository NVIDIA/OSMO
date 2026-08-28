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
    ! grep -Fq -- "$forbidden" "$file" || fail "found $forbidden"
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
    'if [[ "$*" == *"output -raw"* ]]; then' \
    '  case "${!#}" in' \
    '    aks_cluster_name) echo control-aks ;;' \
    '    postgres_server_fqdn) echo test.postgres.database.azure.com ;;' \
    '    postgres_database_name) echo osmo ;;' \
    '    postgres_admin_username) echo osmo_admin ;;' \
    '    redis_cache_hostname) echo test.redis.cache.windows.net ;;' \
    '    redis_cache_ssl_port) echo 10000 ;;' \
    '    redis_cache_primary_access_key) echo redis-secret-sentinel ;;' \
    '    storage_account) echo teststorage ;;' \
    '    storage_account_key) echo storage-key-sentinel ;;' \
    '    storage_container_name) echo osmo-workflows ;;' \
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
    'if [[ "$*" == *"get secret osmo-backend-token-compute-one"* ]]; then printf Y29tcHV0ZS1vbmUtdG9rZW4=; fi' \
    'if [[ "$*" == *"get secret osmo-backend-token-compute-two"* ]]; then printf Y29tcHV0ZS10d28tdG9rZW4=; fi' \
    'if [[ "$*" == *"--from-file=token=/dev/stdin"* ]]; then cat >/dev/null; fi' \
    'if [[ "$*" == *"create namespace"* || "$*" == *"create secret generic"* ]]; then' \
    '  printf "apiVersion: v1\nkind: Secret\nmetadata:\n  name: mock\n"' \
    'fi' \
    'if [[ "$*" == *"apply -f -"* ]]; then cat >/dev/null; fi' \
    'if [[ "$*" == *"port-forward service/osmo-gateway"* ]]; then touch "$PORT_FORWARD_READY"; while true; do sleep 1; done; fi'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock helm '#!/bin/bash' 'set -euo pipefail' 'echo "helm $*" >>"$COMMAND_LOG"'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock curl '#!/bin/bash' 'set -euo pipefail' '[[ -f "$PORT_FORWARD_READY" ]] || exit 1' 'echo "curl $*" >>"$COMMAND_LOG"'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock bash '#!/bin/bash' 'set -euo pipefail' \
    'echo "POOL=${POOL:-} OSMO_URL=${OSMO_URL:-} SKIP_GPU=${SKIP_GPU:-} bash $*" >>"$COMMAND_LOG"'
write_mock jq '#!/bin/bash' 'exit 0'
write_mock osmo '#!/bin/bash' 'exit 0'

export COMMAND_LOG="$command_log"
export PORT_FORWARD_READY="$test_directory/port-forward-ready"
export PATH="$mock_directory:$PATH"
export TF_VAR_resource_group_name=test-resource-group
export TF_VAR_cluster_name=control-cluster
export TF_VAR_postgres_password=postgres-secret-sentinel
export COMPUTE_CLUSTER_ONE_NAME=compute-cluster-one
export COMPUTE_CLUSTER_TWO_NAME=compute-cluster-two
export OSMO_CONTROL_PLANE_URL=https://osmo.test.example.com
export TMPDIR="$test_directory/tmp"
export OSMO_IMAGE_REPOSITORY=nvstaging/osmo
export OSMO_IMAGE_TAG=123
export OSMO_CONTROL_PLANE_VALUES="$test_directory/control-plane-ingress.yaml"
printf 'gateway: external-test-sentinel\n' >"$OSMO_CONTROL_PLANE_VALUES"

script="${TEST_SRCDIR}/_main/deployments/scripts/deploy-osmo-umbrella-split-plane.sh"
[[ -x "$script" ]] || fail "deployment script is absent"
"$script" >"$test_directory/output.log" 2>&1

values_file="$TMPDIR/split-plane-azure.yaml"
[[ -f "$values_file" ]] || fail "Azure values file was not generated"
assert_contains "$values_file" 'externalUrl: "https://osmo.test.example.com"'
assert_contains "$values_file" 'host: test.postgres.database.azure.com'
assert_contains "$values_file" 'name: compute-one'
assert_contains "$values_file" 'name: compute-two'
assert_contains "$values_file" 'name: osmo-backend-token-compute-one'
assert_contains "$values_file" 'name: osmo-backend-token-compute-two'
assert_contains "$values_file" '      backend: compute-one'
assert_contains "$values_file" '      backend: compute-two'
assert_contains "$values_file" '  podTemplates:'
assert_contains "$values_file" '    default_user:'
assert_not_contains "$values_file" 'nvidia.com/gpu'
[[ "$(grep -c '^    compute-one:' "$values_file")" == 2 ]] || fail 'compute-one backend and pool were not configured'
[[ "$(grep -c '^    compute-two:' "$values_file")" == 2 ]] || fail 'compute-two backend and pool were not configured'
assert_contains "$values_file" 'repository: "nvstaging/osmo/backend-listener"'
assert_contains "$values_file" 'repository: "nvstaging/osmo/backend-worker"'
assert_not_contains "$values_file" postgres-secret-sentinel
assert_not_contains "$values_file" redis-secret-sentinel
assert_not_contains "$values_file" storage-key-sentinel
assert_not_contains "$values_file" 'ingress:'

terraform_directory="${TEST_SRCDIR}/_main/deployments/terraform/azure/example"
assert_contains "$command_log" "terraform -chdir=$terraform_directory init"
assert_contains "$command_log" "terraform -chdir=$terraform_directory apply -auto-approve"
assert_contains "$command_log" 'az aks create --resource-group test-resource-group --name compute-cluster-one'
assert_contains "$command_log" 'az aks create --resource-group test-resource-group --name compute-cluster-two'
[[ "$(grep -c 'az aks create .* --no-ssh-key' "$command_log")" == 2 ]] || fail 'compute clusters did not disable local SSH keys'
[[ "$(grep -c 'az aks create .* --node-count 2 .* --min-count 2' "$command_log")" == 2 ]] || fail 'compute clusters did not reserve workflow capacity'
assert_not_contains "$command_log" '--generate-ssh-keys'
[[ "$(grep -c 'helm .*upgrade --install kai-scheduler' "$command_log")" == 2 ]] || fail 'KAI was not installed twice'
[[ "$(grep -c 'helm .*upgrade --install osmo ' "$command_log")" == 3 ]] || fail 'OSMO was not installed three times'
assert_contains "$command_log" "--values ${TEST_SRCDIR}/_main/deployments/charts/osmo/profiles/split-plane-control.yaml"
[[ "$(grep -c -- "--values $OSMO_CONTROL_PLANE_VALUES" "$command_log")" == 2 ]] || fail 'external control values were not used for both control transactions'
[[ "$(grep -c -- '--values .*profiles/split-plane-compute.yaml' "$command_log")" == 2 ]] || fail 'compute profile was not installed twice'
assert_contains "$command_log" '--set-string compute.backendName=compute-one'
assert_contains "$command_log" '--set-string compute.backendName=compute-two'
assert_contains "$command_log" '--set-string compute.authentication.existingSecret=osmo-backend-token-compute-one'
assert_contains "$command_log" '--set-string compute.authentication.existingSecret=osmo-backend-token-compute-two'
assert_contains "$command_log" 'POOL=compute-one OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash'
assert_contains "$command_log" 'POOL=compute-two OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash'
assert_not_contains "$command_log" 'gateway-envoy'
assert_not_contains "$command_log" postgres-secret-sentinel
assert_not_contains "$command_log" redis-secret-sentinel
assert_not_contains "$command_log" storage-key-sentinel
