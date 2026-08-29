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
    'if [[ "$1 $2" == "account show" ]]; then echo test-subscription; fi' \
    'if [[ "$1 $2 $3" == "storage account show" && "$*" == *"--query allowBlobPublicAccess"* ]]; then echo false; fi' \
    'if [[ "$1 $2 $3" == "storage account show" && "$*" == *"--query allowSharedKeyAccess"* ]]; then echo false; fi' \
    'if [[ "$1 $2 $3" == "storage container-rm show" && "$*" == *"--query publicAccess"* ]]; then echo None; fi' \
    'if [[ "$1 $2" == "aks show" && "$*" == *"--name compute-cluster-one"* ]]; then echo https://issuer.one/; fi' \
    'if [[ "$1 $2" == "aks show" && "$*" == *"--name compute-cluster-two"* ]]; then echo https://issuer.two/; fi'
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.
write_mock terraform '#!/bin/bash' 'set -euo pipefail' 'echo "terraform $*" >>"$COMMAND_LOG"' \
    '[[ "${TF_VAR_node_instance_type:-}" == "Standard_D8s_v3" ]] || exit 18' \
    '[[ "${TF_VAR_single_plane_workload_identity_enabled:-}" == "true" ]] || exit 19' \
    '[[ "${TF_VAR_storage_account_enabled:-}" == "false" ]] || exit 20' \
    'if [[ "$*" == *"output -raw"* ]]; then' \
    '  case "${!#}" in' \
    '    aks_cluster_name) echo control-aks ;;' \
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
    'if [[ "$*" == *"get secret osmo-backend-token-compute-one"* ]]; then printf Y29tcHV0ZS1vbmUtdG9rZW4=; fi' \
    'if [[ "$*" == *"get secret osmo-backend-token-compute-two"* ]]; then printf Y29tcHV0ZS10d28tdG9rZW4=; fi' \
    'if [[ "$*" == *"--from-file=token=/dev/stdin"* ]]; then cat >/dev/null; fi' \
    'if [[ "$*" == *"create namespace"* || "$*" == *"create serviceaccount"* || "$*" == *"create secret generic"* ]]; then' \
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
# shellcheck disable=SC2016 # Mock body intentionally defers expansion to execution.
write_mock envsubst '#!/bin/bash' 'set -euo pipefail' 'echo "envsubst $*" >>"$COMMAND_LOG"' \
    "python3 -c 'import os, string, sys; sys.stdout.write(string.Template(sys.stdin.read()).safe_substitute(os.environ))'"
write_mock osmo '#!/bin/bash' 'exit 0'

export COMMAND_LOG="$command_log"
export PORT_FORWARD_READY="$test_directory/port-forward-ready"
export PATH="$mock_directory:$PATH"
export TF_VAR_resource_group_name=test-resource-group
export COMPUTE_CLUSTER_ONE_NAME=compute-cluster-one
export COMPUTE_CLUSTER_TWO_NAME=compute-cluster-two
export OSMO_CONTROL_PLANE_URL=https://osmo.test.example.com
export TMPDIR="$test_directory/tmp"
export OSMO_IMAGE_REPOSITORY=nvstaging/osmo
export OSMO_IMAGE_TAG=123
export OSMO_IMAGE_PULL_SECRET=456
export OSMO_IMAGE_PULL_CONFIG="$test_directory/docker-config.json"
export OSMO_CONTROL_PLANE_VALUES="$test_directory/control-plane-ingress.yaml"
printf '{"auths":{"nvcr.io":{"auth":"registry-secret-sentinel"}}}\n' >"$OSMO_IMAGE_PULL_CONFIG"
printf 'gateway: external-test-sentinel\n' >"$OSMO_CONTROL_PLANE_VALUES"

script="${TEST_SRCDIR}/_main/deployments/scripts/deploy-osmo-umbrella-split-plane.sh"
[[ -x "$script" ]] || fail "deployment script is absent"
if ! "$script" >"$test_directory/output.log" 2>&1; then
    cat "$test_directory/output.log" >&2
    fail "deployment script failed"
fi

values_file="$TMPDIR/split-plane-azure.yaml"
[[ -f "$values_file" ]] || fail "Azure values file was not generated"
assert_contains "$values_file" 'externalUrl: "https://osmo.test.example.com"'
assert_contains "$values_file" 'host: test.postgres.database.azure.com'
assert_contains "$values_file" 'type: sdkDefault'
assert_contains "$values_file" "existingSecret: ''"
assert_contains "$values_file" 'azure.workload.identity/client-id: "11111111-2222-3333-4444-555555555555"'
assert_contains "$values_file" 'azure.workload.identity/use: "true"'
assert_contains "$values_file" 'serviceAccountName: osmo-workflow'
assert_contains "$values_file" 'azure_workload_identity:'
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
assert_contains "$values_file" 'pullSecret: "456"'
assert_contains "$values_file" 'name":"456"'
[[ "$(grep -Fc 'imagePullSecrets: [{"name":"456"}]' "$values_file")" == 2 ]] || \
    fail 'image pull Secret was not configured for workflow pods'
assert_not_contains "$values_file" postgres-secret-sentinel
assert_not_contains "$values_file" redis-secret-sentinel
assert_not_contains "$values_file" storage-key-sentinel
assert_not_contains "$values_file" registry-secret-sentinel
assert_not_contains "$values_file" DefaultEndpointsProtocol
assert_not_contains "$values_file" 'ingress:'
assert_not_contains "$test_directory/output.log" registry-secret-sentinel

terraform_directory="${TEST_SRCDIR}/_main/deployments/terraform/azure/example"
assert_contains "$command_log" "terraform -chdir=$terraform_directory init"
assert_contains "$command_log" "terraform -chdir=$terraform_directory apply -auto-approve"
assert_contains "$command_log" 'az storage account show --resource-group test-resource-group --name teststorage --query allowBlobPublicAccess --output tsv'
assert_contains "$command_log" 'az storage account show --resource-group test-resource-group --name teststorage --query allowSharedKeyAccess --output tsv'
assert_contains "$command_log" 'az storage container-rm show --resource-group test-resource-group --storage-account teststorage --name osmo-workflows --query publicAccess --output tsv'
assert_contains "$command_log" 'az aks create --resource-group test-resource-group --name compute-cluster-one'
assert_contains "$command_log" 'az aks create --resource-group test-resource-group --name compute-cluster-two'
[[ "$(grep -c 'az aks create .* --enable-oidc-issuer --enable-workload-identity' "$command_log")" == 2 ]] || fail 'compute clusters did not enable workload identity'
assert_contains "$command_log" 'az identity federated-credential create --name compute-one-osmo-workflow --identity-name control-aks-blob --resource-group test-resource-group --issuer https://issuer.one/ --subject system:serviceaccount:osmo:osmo-workflow --audiences api://AzureADTokenExchange'
assert_contains "$command_log" 'az identity federated-credential create --name compute-two-osmo-workflow --identity-name control-aks-blob --resource-group test-resource-group --issuer https://issuer.two/ --subject system:serviceaccount:osmo:osmo-workflow --audiences api://AzureADTokenExchange'
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
[[ "$(grep -c 'kubectl --kubeconfig .* create serviceaccount osmo-workflow --namespace osmo' "$command_log")" == 2 ]] || fail 'workflow service account was not created on both compute clusters'
[[ "$(grep -c 'kubectl --kubeconfig .* annotate serviceaccount osmo-workflow --namespace osmo azure.workload.identity/client-id=11111111-2222-3333-4444-555555555555 --overwrite' "$command_log")" == 2 ]] || fail 'workflow service account was not annotated on both compute clusters'
assert_contains "$command_log" 'POOL=compute-one OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash'
assert_contains "$command_log" 'POOL=compute-two OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash'
assert_contains "$command_log" 'port-forward service/osmo-gateway 9000:http'
assert_not_contains "$command_log" 'gateway-envoy'
assert_not_contains "$command_log" postgres-secret-sentinel
assert_not_contains "$command_log" redis-secret-sentinel
assert_not_contains "$command_log" storage-key-sentinel
assert_not_contains "$command_log" registry-secret-sentinel
assert_not_contains "$command_log" 'storage_account_key'
assert_contains "$command_log" 'kubectl --kubeconfig '
assert_not_contains "$command_log" 'create secret generic osmo-object-storage'
[[ "$(grep -c 'create secret generic 456 --namespace osmo --from-file=.dockerconfigjson=' "$command_log")" == 3 ]] || fail 'image pull Secret was not created on all three clusters'
[[ "$(grep -c -- '--type=kubernetes.io/dockerconfigjson' "$command_log")" == 3 ]] || fail 'image pull Secrets had the wrong type'

assert_ordered \
    'az aks create --resource-group test-resource-group --name compute-cluster-one' \
    'az aks show --resource-group test-resource-group --name compute-cluster-one' \
    'az identity federated-credential create --name compute-one-osmo-workflow' \
    'kubectl --kubeconfig ' \
    'helm upgrade --install osmo '
