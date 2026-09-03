#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside an isolated azure-sandbox assume subshell.
# shellcheck disable=SC1091 # Script-relative sources are resolved at runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_SOURCE_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
TERRAFORM_VARS="$SCRIPT_DIR/azure/single-plane.tfvars"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES="$SCRIPT_DIR/single-plane-azure.yaml"
DYNAMIC_VALUES_FILTER="$SCRIPT_DIR/single-plane-values.jq"

TF_RESOURCE_GROUP="${TF_RESOURCE_GROUP:-${TF_VAR_resource_group_name:-}}"
TF_SUBSCRIPTION_ID="${TF_SUBSCRIPTION_ID:-${TF_VAR_subscription_id:-}}"
SINGLE_PLANE_CLUSTER_NAME="${TF_CLUSTER_NAME:-${TF_VAR_cluster_name:-}}"
TF_NODE_INSTANCE_TYPE="${TF_NODE_INSTANCE_TYPE:-${TF_VAR_node_instance_type:-Standard_D8s_v3}}"

source "$SCRIPT_DIR/common.sh"
source "$SCRIPT_DIR/azure/terraform.sh"

TEMPORARY_DIRECTORY=
PORT_FORWARD_PID=
cleanup() {
    [[ -z "$PORT_FORWARD_PID" ]] || kill "$PORT_FORWARD_PID" 2>/dev/null || true
    [[ -z "$TEMPORARY_DIRECTORY" ]] || rm -rf -- "$TEMPORARY_DIRECTORY"
}
trap cleanup EXIT

umask 077
: "${TF_RESOURCE_GROUP:?set TF_RESOURCE_GROUP or TF_VAR_resource_group_name to the isolated sandbox resource group}"
for command in az terraform kubectl helm openssl curl jq osmo; do
    check_command "$command"
done

TF_SUBSCRIPTION_ID="${TF_SUBSCRIPTION_ID:-$(azure_get_current_subscription)}"
: "${TF_SUBSCRIPTION_ID:?unable to determine the Azure subscription ID}"

# Use a persistent, resource-group-specific working directory so this example
# cannot read or update terraform.tfvars or terraform.tfstate used by the
# legacy deploy-osmo-minimal.sh entry point. The hash prevents distinct Azure
# names that share the same filesystem-safe slug from sharing Terraform state.
normalized_resource_group="${TF_RESOURCE_GROUP,,}"
resource_group_key="$(printf '%s' "$normalized_resource_group" | tr -c '[:alnum:]_-' '-')"
resource_group_hash="$(printf '%s' "$normalized_resource_group" | openssl dgst -sha256 -r)"
resource_group_hash="${resource_group_hash%% *}"
terraform_state_key="${resource_group_key}-${resource_group_hash:0:12}"
TERRAFORM_DIR="${SINGLE_PLANE_TERRAFORM_WORK_DIR:-$TERRAFORM_SOURCE_DIR/.single-plane/$terraform_state_key}"
mkdir -p "$TERRAFORM_DIR"
cp "$TERRAFORM_SOURCE_DIR"/*.tf "$TERRAFORM_DIR/"
if [[ -f "$TERRAFORM_SOURCE_DIR/.terraform.lock.hcl" ]]; then
    cp "$TERRAFORM_SOURCE_DIR/.terraform.lock.hcl" "$TERRAFORM_DIR/"
fi

TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/osmo-single-plane.XXXXXX")"
KUBECONFIG="$TEMPORARY_DIRECTORY/kubeconfig"
TERRAFORM_OUTPUTS="$TEMPORARY_DIRECTORY/terraform-outputs.env"
DYNAMIC_VALUES="$TEMPORARY_DIRECTORY/single-plane-values.json"
SECRETS_DIR="$TEMPORARY_DIRECTORY/secrets"
mkdir -p "$SECRETS_DIR"
export KUBECONFIG TF_RESOURCE_GROUP TF_SUBSCRIPTION_ID

# Provision Azure infrastructure through the shared Azure Terraform driver.
unset TF_VAR_postgres_password TF_VAR_postgres_password_generation_enabled
azure_preflight_checks
azure_terraform_init "$TERRAFORM_DIR"
terraform_arguments=(
    "-var-file=$TERRAFORM_VARS"
    "-var=subscription_id=$TF_SUBSCRIPTION_ID"
    "-var=resource_group_name=$TF_RESOURCE_GROUP"
    "-var=node_instance_type=$TF_NODE_INSTANCE_TYPE"
)
if [[ -n "$SINGLE_PLANE_CLUSTER_NAME" ]]; then
    terraform_arguments+=("-var=cluster_name=$SINGLE_PLANE_CLUSTER_NAME")
fi
azure_terraform_apply "$TERRAFORM_DIR" false "${terraform_arguments[@]}"
azure_get_terraform_outputs "$TERRAFORM_DIR" "$TERRAFORM_OUTPUTS"
POSTGRES_PASSWORD="$(azure_get_terraform_output "$TERRAFORM_DIR" postgres_password)"
STORAGE_ACCOUNT="$(azure_get_terraform_output "$TERRAFORM_DIR" single_plane_storage_account)"
STORAGE_ACCOUNT_ID="$(azure_get_terraform_output "$TERRAFORM_DIR" single_plane_storage_account_id)"
STORAGE_CONTAINER="$(azure_get_terraform_output "$TERRAFORM_DIR" single_plane_storage_container_name)"
WORKLOAD_IDENTITY_CLIENT_ID="$(azure_get_terraform_output \
    "$TERRAFORM_DIR" single_plane_blob_identity_client_id)"

for required_value in RESOURCE_GROUP_NAME AKS_CLUSTER_NAME POSTGRES_HOST POSTGRES_DB_NAME POSTGRES_USERNAME \
        POSTGRES_PASSWORD REDIS_HOST REDIS_PORT REDIS_PASSWORD STORAGE_ACCOUNT STORAGE_ACCOUNT_ID \
        STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID; do
    [[ -n "${!required_value}" ]] || { echo "Terraform output $required_value is empty" >&2; exit 1; }
done

# Verify the deployed account and container instead of relying only on the
# Terraform configuration.
blob_public_access="$(az storage account show --ids "$STORAGE_ACCOUNT_ID" \
    --query allowBlobPublicAccess --output tsv)"
[[ "$blob_public_access" == "false" ]] || {
    log_error "Storage Account $STORAGE_ACCOUNT reports allowBlobPublicAccess=$blob_public_access"
    exit 1
}
container_public_access="$(az rest --method get \
    --url "https://management.azure.com${STORAGE_ACCOUNT_ID}/blobServices/default/containers/${STORAGE_CONTAINER}?api-version=2023-05-01" \
    --query properties.publicAccess --output tsv)"
[[ "$container_public_access" == "None" ]] || {
    log_error "Blob container $STORAGE_CONTAINER reports publicAccess=$container_public_access"
    exit 1
}

azure_verify_postgres_config
azure_configure_kubectl
KAI_HELM_TIMEOUT=10m bash "$SCRIPT_DIR/install-kai-scheduler.sh"

# Configure optional image overrides.
OSMO_IMAGE_REPOSITORY="${OSMO_IMAGE_REPOSITORY:-nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
OSMO_IMAGE_PULL_SECRET="${OSMO_IMAGE_PULL_SECRET:-}"
OSMO_IMAGE_PULL_CONFIG="${OSMO_IMAGE_PULL_CONFIG:-}"
OSMO_IMAGE_PULL_REGISTRY="${OSMO_IMAGE_PULL_REGISTRY:-nvcr.io}"

printf '%s' "$POSTGRES_USERNAME" >"$SECRETS_DIR/postgres-username"
printf '%s' "$POSTGRES_PASSWORD" >"$SECRETS_DIR/postgres-password"
printf '%s' "$REDIS_PASSWORD" >"$SECRETS_DIR/redis-password"
kubectl create namespace osmo --dry-run=client --output yaml | kubectl apply -f -
if [[ -n "$OSMO_IMAGE_PULL_SECRET" && -n "$OSMO_IMAGE_PULL_CONFIG" ]]; then
    jq --exit-status --arg registry "$OSMO_IMAGE_PULL_REGISTRY" \
        '.auths[$registry] as $auth | if $auth then {auths:{($registry):$auth}} else error("registry credentials not found") end' \
        "$OSMO_IMAGE_PULL_CONFIG" | kubectl create secret generic "$OSMO_IMAGE_PULL_SECRET" --namespace osmo \
        --from-file=.dockerconfigjson=/dev/stdin \
        --type=kubernetes.io/dockerconfigjson --dry-run=client --output yaml | kubectl apply -f -
fi
kubectl create secret generic osmo-postgresql --namespace osmo \
    --from-file=username="$SECRETS_DIR/postgres-username" \
    --from-file=db-password="$SECRETS_DIR/postgres-password" \
    --dry-run=client --output yaml | kubectl apply -f -
kubectl create secret generic osmo-valkey --namespace osmo \
    --from-file=redis-password="$SECRETS_DIR/redis-password" \
    --dry-run=client --output yaml | kubectl apply -f -
kubectl create serviceaccount osmo-workflow --namespace osmo --dry-run=client --output yaml | kubectl apply -f -
kubectl annotate serviceaccount osmo-workflow --namespace osmo \
    azure.workload.identity/client-id="$WORKLOAD_IDENTITY_CLIENT_ID" --overwrite
BACKEND_TOKEN_SECRET="$(kubectl get secret osmo-backend-token --namespace osmo --ignore-not-found --output name)"
if [[ -z "$BACKEND_TOKEN_SECRET" ]]; then
    BACKEND_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
    printf '%s' "$BACKEND_TOKEN" >"$SECRETS_DIR/backend-token"
    kubectl create secret generic osmo-backend-token --namespace osmo \
        --from-file=token="$SECRETS_DIR/backend-token" \
        --dry-run=client --output yaml | kubectl apply -f -
fi
rm -rf -- "$SECRETS_DIR"

jq --null-input \
    --arg image_repository "$OSMO_IMAGE_REPOSITORY" \
    --arg image_tag "$OSMO_IMAGE_TAG" \
    --arg image_pull_secret "$OSMO_IMAGE_PULL_SECRET" \
    --arg postgres_host "$POSTGRES_HOST" \
    --arg postgres_database "$POSTGRES_DB_NAME" \
    --arg postgres_username "$POSTGRES_USERNAME" \
    --arg redis_host "$REDIS_HOST" \
    --arg redis_port "$REDIS_PORT" \
    --arg storage_account "$STORAGE_ACCOUNT" \
    --arg storage_container "$STORAGE_CONTAINER" \
    --arg workload_identity_client_id "$WORKLOAD_IDENTITY_CLIENT_ID" \
    --from-file "$DYNAMIC_VALUES_FILTER" >"$DYNAMIC_VALUES"

# Install OSMO.
helm dependency build "$CHART"
helm upgrade --install osmo "$CHART" \
    --namespace osmo \
    --values "$CHART/profiles/single-plane.yaml" \
    --values "$AZURE_VALUES" \
    --values "$DYNAMIC_VALUES" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true \
    --wait --wait-for-jobs --timeout 25m

# Verify the deployment and representative workflow.
kubectl --namespace osmo port-forward service/osmo-gateway 9000:80 &
PORT_FORWARD_PID=$!
for attempt in {1..30}; do
    curl --fail --silent --connect-timeout 2 --max-time 5 \
        http://127.0.0.1:9000/api/version >/dev/null && break
    [[ "$attempt" == 30 ]] && exit 1
    sleep 1
done
OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
