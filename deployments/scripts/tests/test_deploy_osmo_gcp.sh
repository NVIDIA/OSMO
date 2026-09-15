#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

repository="${TEST_SRCDIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
[[ ! -d "$repository/_main" ]] || repository="$repository/_main"
test_directory="$(mktemp -d)"
trap 'rm -rf -- "$test_directory"' EXIT
mkdir -p "$test_directory/deployments/scripts/gcp" "$test_directory/deployments/terraform/gcp/example" \
    "$test_directory/bin" "$test_directory/tmp"
cp "$repository/deployments/scripts/"{deploy-osmo-gcp.sh,common.sh,install-kai-scheduler.sh,verify.sh,single-plane-gcp.yaml} \
    "$test_directory/deployments/scripts/"
cp "$repository/deployments/scripts/gcp/values.jq" "$test_directory/deployments/scripts/gcp/"
cp "$repository/deployments/terraform/gcp/example/"*.tf "$test_directory/deployments/terraform/gcp/example/"
export TEST_DIRECTORY="$test_directory" TMPDIR="$test_directory/tmp"
export COMMAND_LOG="$test_directory/commands.log"
export TF_VAR_project_id=test-project TF_VAR_cluster_name=osmo-test
export TF_VAR_region=asia-southeast1 TF_VAR_zone=asia-southeast1-b
export OSMO_IMAGE_REGISTRY=asia-southeast1-docker.pkg.dev/test-project/osmo OSMO_IMAGE_TAG=test-tag
export OSMO_SYSTEM_CA_BUNDLE="$test_directory/public-ca"
printf 'public-ca-sentinel\n' >"$OSMO_SYSTEM_CA_BUNDLE"
export KUBECONFIG="$test_directory/original-kubeconfig"
printf 'original-context\n' >"$KUBECONFIG"
export TERRAFORM_BIN="$test_directory/bin/terraform"
script="$test_directory/deployments/scripts/deploy-osmo-gcp.sh"
state_dir="$test_directory/deployments/terraform/gcp/example/.osmo/test-project/asia-southeast1-b/osmo-test"

cat >"$test_directory/outputs.json" <<'EOF'
{
  "project_id":"test-project", "cluster_name":"osmo-test",
  "region":"asia-southeast1", "zone":"asia-southeast1-b",
  "postgres_host":"10.50.0.2", "postgres_database":"osmo", "postgres_username":"osmo",
  "postgres_password":"postgres-secret-sentinel", "redis_host":"10.50.1.2", "redis_port":6378,
  "redis_password":"redis-secret-sentinel", "redis_ca":"redis-ca-sentinel", "bucket":"test-bucket",
  "access_key_id":"hmac-id-sentinel", "access_key":"hmac-secret-sentinel"
}
EOF
cat >"$test_directory/bin/mock" <<'EOF'
#!/bin/bash
set -euo pipefail
tool="$(basename "$0")"
printf '%s %s\n' "$tool" "$*" >>"$COMMAND_LOG"
case "$tool" in
  terraform)
    case "$2" in
      apply) printf 'partial-state\n' >"${1#-chdir=}/terraform.tfstate"; exit "${FAIL_APPLY:-0}" ;;
      output) cat "$TEST_DIRECTORY/outputs.json" ;;
    esac ;;
  gcloud) printf 'isolated-context\n' >"$KUBECONFIG" ;;
  kubectl)
    if [[ "$*" == *port-forward* ]]; then exec /bin/sleep 60; fi
    if [[ "$1 $2" == 'get crd' ]]; then exit 1; fi
    if [[ "$1 $2" == 'get secret' ]]; then
      [[ "${FAIL_SECRET_READ:-0}" == 0 ]] || exit 23
      if [[ "$*" == *jsonpath* ]]; then printf 'existing-admin-token' | base64
      elif [[ "${REUSE_TOKENS:-0}" == 1 ]]; then echo "secret/$3"; fi
    fi
    if [[ "$1" == create ]]; then
      for arg in "$@"; do
        if [[ "$arg" == --from-file=* ]]; then
          spec="${arg#--from-file=}"
          cp "${spec#*=}" "$TEST_DIRECTORY/secret-${spec%%=*}"
        fi
      done
      echo 'mock manifest'
    fi
    if [[ "$1" == apply ]]; then cat >/dev/null; fi ;;
  helm)
    previous=
    for arg in "$@"; do
      if [[ "$previous" == -f && "$arg" == */values.json ]]; then
        cp "$arg" "$TEST_DIRECTORY/values.json"
      fi
      previous="$arg"
    done ;;
  osmo)
    case "$1 ${2:-}" in
      'resource list') echo '{"resources":[{"name":"cpu"}]}' ;;
      'workflow submit') echo '{"name":"test-workflow"}' ;;
      'workflow query') echo '{"status":"COMPLETED"}' ;;
    esac ;;
esac
EOF
chmod +x "$test_directory/bin/mock"
for tool in terraform gcloud gke-gcloud-auth-plugin kubectl helm osmo curl; do
    ln -s mock "$test_directory/bin/$tool"
done
export PATH="$test_directory/bin:$PATH"

fail() { echo "FAIL: $*" >&2; exit 1; }
contains() { grep -Fq -- "$2" "$1" || fail "missing: $2"; }
absent() { ! grep -Fq -- "$2" "$1" || fail "unexpected: $2"; }
reset_log() { : >"$COMMAND_LOG"; }

reset_log
bash "$script" --help >"$test_directory/help"
[[ ! -s "$COMMAND_LOG" ]] || fail 'help invoked external tools'
if TF_VAR_project_id='' bash "$script" plan >"$test_directory/error" 2>&1; then fail 'missing project accepted'; fi
if TF_VAR_cluster_name=../wrong bash "$script" plan >"$test_directory/error" 2>&1; then fail 'unsafe cluster accepted'; fi
[[ ! -s "$COMMAND_LOG" ]] || fail 'invalid target invoked external tools'
bash "$script" plan >"$test_directory/plan.log" 2>&1
contains "$COMMAND_LOG" "terraform -chdir=$state_dir plan"
absent "$COMMAND_LOG" gcloud
reset_log
if FAIL_APPLY=42 bash "$script" apply >"$test_directory/error" 2>&1; then fail 'apply failure swallowed'; fi
contains "$state_dir/terraform.tfstate" partial-state
absent "$COMMAND_LOG" '-auto-approve'
absent "$COMMAND_LOG" 'apply -input=false'
absent "$COMMAND_LOG" gcloud

reset_log
if TF_VAR_region=us-central1 TF_VAR_zone=us-central1-a bash "$script" deploy >"$test_directory/error" 2>&1; then
    fail 'different target reused state'
fi
absent "$COMMAND_LOG" gcloud
cp "$test_directory/outputs.json" "$test_directory/good-outputs.json"
jq '.project_id = "wrong-project"' "$test_directory/good-outputs.json" >"$test_directory/outputs.json"
if bash "$script" deploy >"$test_directory/error" 2>&1; then fail 'mismatched output accepted'; fi
absent "$COMMAND_LOG" gcloud
cp "$test_directory/good-outputs.json" "$test_directory/outputs.json"

reset_log
bash "$script" deploy >"$test_directory/deploy.log" 2>&1
contains "$COMMAND_LOG" '--project test-project --zone asia-southeast1-b --dns-endpoint'
contains "$COMMAND_LOG" 'helm upgrade --install osmo'
contains "$COMMAND_LOG" 'verify-object-storage.yaml'
absent "$COMMAND_LOG" 'verify-gpu.yaml'
contains "$KUBECONFIG" original-context
contains "$test_directory/secret-ca-bundle.crt" public-ca-sentinel
contains "$test_directory/secret-ca-bundle.crt" redis-ca-sentinel
jq -e '.access_key_id == "hmac-id-sentinel" and .access_key == "hmac-secret-sentinel"' \
    "$test_directory/secret-object-storage.yaml" >/dev/null
jq -e '.imageTag == "test-tag" and .externalDependencies.valkey.port == 6378
    and .externalDependencies.objectStorage.locations.workflows == "gs://test-bucket/workflows"' \
    "$test_directory/values.json" >/dev/null
for secret in postgres-secret-sentinel redis-secret-sentinel hmac-secret-sentinel; do
    absent "$COMMAND_LOG" "$secret"
    absent "$test_directory/deploy.log" "$secret"
    absent "$test_directory/values.json" "$secret"
done
[[ -z "$(ls -A "$test_directory/tmp")" ]] || fail 'temporary credentials not removed'

reset_log
REUSE_TOKENS=1 bash "$script" deploy >"$test_directory/redeploy.log" 2>&1
absent "$COMMAND_LOG" 'create secret generic osmo-default-admin'
absent "$COMMAND_LOG" 'create secret generic osmo-backend-token'
reset_log
if FAIL_SECRET_READ=1 bash "$script" deploy >"$test_directory/error" 2>&1; then fail 'secret read failure swallowed'; fi
absent "$COMMAND_LOG" 'create secret generic osmo-default-admin'
absent "$COMMAND_LOG" 'helm upgrade'
reset_log
bash "$script" verify >"$test_directory/verify.log" 2>&1
contains "$COMMAND_LOG" 'workflow submit'
absent "$COMMAND_LOG" 'kubectl create'
absent "$COMMAND_LOG" 'helm upgrade'
echo 'PASS: GCP deployment target isolation, failure propagation, credentials, token reuse and verification'
