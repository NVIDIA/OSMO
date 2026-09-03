#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# shellcheck disable=SC2016 # Mock bodies intentionally defer expansion to execution.

set -euo pipefail

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
    ! grep -Fq -- "$forbidden" "$file" || fail "found forbidden value $forbidden"
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

write_mock az '#!/bin/bash' 'set -euo pipefail' 'echo "az $*" >>"$COMMAND_LOG"' \
    'if [[ "$1 $2" == "account show" ]]; then echo test-subscription; fi' \
    'if [[ "$1 $2 ${3:-}" == "storage account show" ]]; then echo "${BLOB_PUBLIC_ACCESS:-false}"; fi' \
    'if [[ "$1" == "rest" ]]; then echo "${CONTAINER_PUBLIC_ACCESS:-None}"; fi' \
    'if [[ "$1 $2" == "aks get-credentials" ]]; then printf admin-kubeconfig-sentinel >"$KUBECONFIG"; fi' \
    'if [[ "$1 $2" == "postgres flexible-server" && "$*" == *"require_secure_transport"* ]]; then echo off; fi' \
    'if [[ "$1 $2" == "postgres flexible-server" && "$*" == *"azure.extensions"* ]]; then echo hstore; fi'

write_mock terraform '#!/bin/bash' 'set -euo pipefail' 'echo "terraform pwd=$PWD $*" >>"$COMMAND_LOG"' \
    '[[ -z "${TF_VAR_postgres_password+x}" ]] || exit 18' \
    'if [[ "$*" == *"apply -auto-approve"* ]]; then' \
    '  tfvars_path=' \
    '  for argument in "$@"; do [[ "$argument" == -var-file=* ]] && tfvars_path="${argument#-var-file=}"; done' \
    '  [[ -f "$tfvars_path" ]] || exit 19' \
    '  grep -Eq "^cluster_name *= *\"osmo-cluster\"$" "$tfvars_path" || exit 20' \
    '  grep -Eq "^postgres_password *= *null$" "$tfvars_path" || exit 21' \
    '  grep -Eq "^single_plane_workload_identity_enabled *= *true$" "$tfvars_path" || exit 22' \
    '  grep -Eq "^postgres_password_generation_enabled *= *true$" "$tfvars_path" || exit 23' \
    '  grep -Eq "^storage_account_enabled *= *false$" "$tfvars_path" || exit 24' \
    '  grep -Eq "^nfs_storage_account_enabled *= *false$" "$tfvars_path" || exit 25' \
    '  grep -Eq "^gpu_node_pool_enabled *= *false$" "$tfvars_path" || exit 26' \
    '  [[ "$*" == *"-var=subscription_id=test-subscription"* ]] || exit 27' \
    '  [[ "$*" == *"-var=resource_group_name=test-resource-group"* ]] || exit 28' \
    '  [[ "$*" == *"-var=node_instance_type=Standard_D8s_v3"* ]] || exit 29' \
    '  [[ -f "$PWD/example.tf" && -f "$PWD/single-plane-object-storage.tf" ]] || exit 30' \
    'fi' \
    'if [[ "$*" == *"output -raw"* ]]; then' \
    '  case "${!#}" in' \
    '    resource_group_name) echo test-resource-group ;;' \
    '    aks_cluster_name) echo test-aks ;;' \
    '    postgres_server_fqdn) echo test.postgres.database.azure.com ;;' \
    '    postgres_database_name) echo osmo ;;' \
    '    postgres_admin_username) echo osmo_admin ;;' \
    '    postgres_password) echo postgres-secret-sentinel ;;' \
    '    redis_cache_hostname) echo test.redis.cache.windows.net ;;' \
    '    redis_cache_ssl_port) echo 10000 ;;' \
    '    redis_cache_primary_access_key) echo redis-secret-sentinel ;;' \
    '    single_plane_storage_account) echo teststorage ;;' \
    '    single_plane_storage_account_id) echo /subscriptions/test-subscription/resourceGroups/test-resource-group/providers/Microsoft.Storage/storageAccounts/teststorage ;;' \
    '    single_plane_storage_container_name) echo osmo-workflows ;;' \
    '    single_plane_blob_identity_client_id) echo 11111111-2222-3333-4444-555555555555 ;;' \
    '    *) exit 1 ;;' \
    '  esac' \
    'fi'

write_mock docker '#!/bin/bash' 'exit 31'

write_mock kubectl '#!/bin/bash' 'set -euo pipefail' \
    'for argument in "$@"; do' \
    '  case "$argument" in *postgres-secret-sentinel*|*redis-secret-sentinel*|*backend-token-sentinel*) exit 32 ;; esac' \
    'done' \
    'echo "kubectl $*" >>"$COMMAND_LOG"' \
    'if [[ "$1 $2" == "get secret" ]]; then' \
    '  case "$BACKEND_TOKEN_STATE" in absent) exit 0 ;; existing) echo secret/osmo-backend-token ;; error) exit 17 ;; esac' \
    'fi' \
    'if [[ "$*" == *"--from-file=.dockerconfigjson=/dev/stdin"* ]]; then cat >"$PULL_SECRET_INPUT"; fi' \
    'if [[ "$*" == *"apply -f -"* ]]; then cat >/dev/null; fi' \
    'if [[ "$*" == *"create secret generic osmo-postgresql"* ]]; then' \
    '  for argument in "$@"; do' \
    '    [[ "$argument" == --from-file=username=* ]] && username_file="${argument#--from-file=username=}"' \
    '    [[ "$argument" == --from-file=db-password=* ]] && password_file="${argument#--from-file=db-password=}"' \
    '  done' \
    '  [[ "$(<"$username_file")" == osmo_admin ]] || exit 33' \
    '  [[ "$(<"$password_file")" == postgres-secret-sentinel ]] || exit 34' \
    '  printf "%s\n" "$username_file" "$password_file" >>"$SECRET_PATHS_LOG"' \
    'fi' \
    'if [[ "$*" == *"create secret generic osmo-valkey"* ]]; then' \
    '  for argument in "$@"; do [[ "$argument" == --from-file=redis-password=* ]] && password_file="${argument#--from-file=redis-password=}"; done' \
    '  [[ "$(<"$password_file")" == redis-secret-sentinel ]] || exit 35' \
    '  printf "%s\n" "$password_file" >>"$SECRET_PATHS_LOG"' \
    'fi' \
    'if [[ "$*" == *"create secret generic osmo-backend-token"* ]]; then' \
    '  for argument in "$@"; do [[ "$argument" == --from-file=token=* ]] && token_file="${argument#--from-file=token=}"; done' \
    '  [[ "$(<"$token_file")" == backend-token-sentinel ]] || exit 36' \
    '  printf "%s\n" "$token_file" >>"$SECRET_PATHS_LOG"' \
    'fi' \
    'if [[ "$*" == *"create secret generic"* ]]; then printf "apiVersion: v1\nkind: Secret\nmetadata:\n  name: mock\n"; fi' \
    'if [[ "$*" == *"port-forward"* ]]; then touch "$PORT_FORWARD_READY"; while true; do sleep 1; done; fi'

write_mock helm '#!/bin/bash' 'set -euo pipefail' 'echo "helm $*" >>"$COMMAND_LOG"' \
    'previous=' \
    'for argument in "$@"; do' \
    '  if [[ "$previous" == --values && "$argument" == *single-plane-values.json ]]; then cp "$argument" "$CAPTURED_VALUES"; fi' \
    '  previous="$argument"' \
    'done'
write_mock openssl '#!/bin/bash' 'set -euo pipefail' 'echo "openssl $*" >>"$COMMAND_LOG"' 'echo backend-token-sentinel'
write_mock curl '#!/bin/bash' 'set -euo pipefail' '[[ -f "$PORT_FORWARD_READY" ]] || exit 1' 'echo "curl $*" >>"$COMMAND_LOG"'
write_mock bash '#!/bin/bash' 'set -euo pipefail' 'echo "bash $*" >>"$COMMAND_LOG"'
write_mock osmo '#!/bin/bash' 'exit 0'

export COMMAND_LOG="$command_log"
export PORT_FORWARD_READY="$test_directory/port-forward-ready"
export PULL_SECRET_INPUT="$test_directory/pull-secret-input.json"
export SECRET_PATHS_LOG="$test_directory/secret-paths.log"
export CAPTURED_VALUES="$test_directory/captured-values.json"
export PATH="$mock_directory:$PATH"
export TF_VAR_resource_group_name=test-resource-group
export TF_VAR_postgres_password=provided-postgres-secret-sentinel
export SINGLE_PLANE_TERRAFORM_WORK_DIR="$test_directory/terraform-work"
export TMPDIR="$test_directory/tmp"
export OSMO_IMAGE_REPOSITORY=nvstaging/osmo
export OSMO_IMAGE_TAG=123
export OSMO_IMAGE_PULL_SECRET=456
export OSMO_IMAGE_PULL_CONFIG="$test_directory/docker-config.json"
export OSMO_IMAGE_PULL_REGISTRY=nvcr.io
printf '%s\n' '{"auths":{"artifactory.build.nvda.ai":{"auth":"wrong-auth"},"nvcr.io":{"auth":"docker-auth-sentinel"}}}' \
    >"$OSMO_IMAGE_PULL_CONFIG"

script="${TEST_SRCDIR}/_main/deployments/scripts/deploy-osmo-single-plane.sh"
static_values="${TEST_SRCDIR}/_main/deployments/scripts/single-plane-azure.yaml"
terraform_vars="${TEST_SRCDIR}/_main/deployments/scripts/azure/single-plane.tfvars"
[[ -x "$script" ]] || fail "deployment script is absent"

export BACKEND_TOKEN_STATE=absent
if ! "$script" >"$test_directory/output.log" 2>&1; then
    cat "$test_directory/output.log" >&2
    fail "initial deployment-script run failed"
fi

while read -r secret_path; do
    [[ ! -e "$secret_path" ]] || fail "temporary secret file was not removed: $secret_path"
done <"$SECRET_PATHS_LOG"
[[ -f "$SINGLE_PLANE_TERRAFORM_WORK_DIR/example.tf" ]] || fail "Terraform configuration was not isolated"
[[ -f "$CAPTURED_VALUES" ]] || fail "dynamic values were not passed to Helm"

jq -e '
  .imageRepository == "nvstaging/osmo" and
  .imageTag == "123" and
  .imagePullSecrets == [{"name":"456"}] and
  .services.api.serviceAccount.annotations["azure.workload.identity/client-id"] == "11111111-2222-3333-4444-555555555555" and
  .services.worker.serviceAccount.annotations["azure.workload.identity/client-id"] == "11111111-2222-3333-4444-555555555555" and
  .services as $services |
  (["api", "worker", "agent", "logger"] | all(.[];
    $services[.].extraVolumeMounts[0].mountPath == "/etc/osmo/secrets/456" and
    $services[.].pod.extraVolumes[0].secret.secretName == "456")) and
  .configuration.workflow.backend_images.credential.secretName == "456" and
  .externalDependencies.postgresql.host == "test.postgres.database.azure.com" and
  .externalDependencies.valkey.port == 10000 and
  .externalDependencies.objectStorage.locations.workflows == "azure://teststorage/osmo-workflows/workflows" and
  .externalDependencies.objectStorage.locations.logs == "azure://teststorage/osmo-workflows/logs" and
  .externalDependencies.objectStorage.locations.apps == "azure://teststorage/osmo-workflows/apps"
' "$CAPTURED_VALUES" >/dev/null || fail "unexpected dynamic Helm values"

assert_contains "$static_values" 'externalUrl: http://osmo-gateway'
assert_contains "$static_values" 'type: sdkDefault'
assert_contains "$static_values" 'serviceAccountName: osmo-workflow'
assert_contains "$static_values" 'serviceAuth:'
assert_contains "$static_values" 'managementMode: osmo'
assert_contains "$static_values" 'bootstrap:'
assert_contains "$static_values" '      enabled: true'
assert_not_contains "$static_values" '${'

for secret in postgres-secret-sentinel redis-secret-sentinel storage-key-sentinel \
        backend-token-sentinel docker-auth-sentinel \
        provided-postgres-secret-sentinel; do
    assert_not_contains "$test_directory/output.log" "$secret"
    assert_not_contains "$command_log" "$secret"
    assert_not_contains "$CAPTURED_VALUES" "$secret"
done
assert_not_contains "$command_log" 'storage_account_key'
assert_not_contains "$command_log" 'kubectl create secret generic osmo-object-storage'
assert_not_contains "$command_log" 'kubectl create secret generic osmo-service-auth'

jq -e '.auths | keys == ["nvcr.io"]' "$PULL_SECRET_INPUT" >/dev/null || fail "pull Secret included another registry"
jq -e '.auths["nvcr.io"].auth == "docker-auth-sentinel"' "$PULL_SECRET_INPUT" >/dev/null || fail "registry credentials changed"

assert_ordered \
    'az account show' \
    'terraform pwd=' \
    "apply -auto-approve -var-file=$terraform_vars -var=subscription_id=test-subscription -var=resource_group_name=test-resource-group -var=node_instance_type=Standard_D8s_v3" \
    'az storage account show --ids /subscriptions/test-subscription/resourceGroups/test-resource-group/providers/Microsoft.Storage/storageAccounts/teststorage --query allowBlobPublicAccess --output tsv' \
    'az rest --method get' \
    'az aks get-credentials' \
    'bash ' \
    'kubectl create namespace osmo' \
    'kubectl create secret generic 456' \
    'kubectl create secret generic osmo-postgresql' \
    'kubectl create secret generic osmo-valkey' \
    'kubectl create serviceaccount osmo-workflow' \
    'kubectl annotate serviceaccount osmo-workflow' \
    'kubectl create secret generic osmo-backend-token' \
    'helm dependency build' \
    'helm upgrade --install osmo' \
    'kubectl --namespace osmo port-forward service/osmo-gateway 9000:80' \
    'curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:9000/api/version'

assert_contains "$command_log" "bash ${TEST_SRCDIR}/_main/deployments/scripts/install-kai-scheduler.sh"
assert_contains "$command_log" "bash ${TEST_SRCDIR}/_main/deployments/scripts/verify.sh"
assert_contains "$command_log" "openssl dgst -sha256 -r"
[[ "$(grep -c '^helm upgrade .*osmo ' "$command_log")" == 1 ]] || fail "expected one OSMO Helm transaction"
assert_contains "$command_log" '--set secrets.masterEncryptionKey.bootstrap.enabled=true'

: >"$command_log"
rm -f "$PORT_FORWARD_READY"
export BACKEND_TOKEN_STATE=existing
if ! "$script" >"$test_directory/existing-token-output.log" 2>&1; then
    cat "$test_directory/existing-token-output.log" >&2
    fail "existing-token deployment-script run failed"
fi
assert_contains "$command_log" 'kubectl get secret osmo-backend-token --namespace osmo --ignore-not-found --output name'
assert_not_contains "$command_log" 'kubectl create secret generic osmo-backend-token'
assert_not_contains "$command_log" 'openssl rand -base64 32'

: >"$command_log"
rm -f "$PORT_FORWARD_READY"
unset OSMO_IMAGE_PULL_SECRET OSMO_IMAGE_PULL_CONFIG
export BACKEND_TOKEN_STATE=existing
if ! "$script" >"$test_directory/no-pull-secret-output.log" 2>&1; then
    cat "$test_directory/no-pull-secret-output.log" >&2
    fail "no-pull-secret deployment-script run failed"
fi
jq -e '
  .imagePullSecrets == [] and
  .services.api.extraVolumeMounts == [] and
  .services.api.pod.extraVolumes == [] and
  .configuration.workflow.backend_images == {}
' "$CAPTURED_VALUES" >/dev/null || fail "empty pull-secret configuration was not preserved"
assert_not_contains "$command_log" 'kubectl create secret generic 456'

: >"$command_log"
rm -f "$PORT_FORWARD_READY"
export BACKEND_TOKEN_STATE=error
if "$script" >"$test_directory/lookup-error-output.log" 2>&1; then
    fail "backend-token lookup error unexpectedly succeeded"
fi
assert_not_contains "$command_log" 'kubectl create secret generic osmo-backend-token'
assert_not_contains "$command_log" 'openssl rand -base64 32'

: >"$command_log"
export BACKEND_TOKEN_STATE=existing BLOB_PUBLIC_ACCESS=true
if "$script" >"$test_directory/public-access-output.log" 2>&1; then
    fail "public Blob access unexpectedly passed verification"
fi
assert_contains "$test_directory/public-access-output.log" 'allowBlobPublicAccess=true'
assert_not_contains "$command_log" 'az aks get-credentials'
