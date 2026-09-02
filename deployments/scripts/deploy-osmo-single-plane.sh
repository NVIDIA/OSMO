#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside an isolated azure-sandbox assume subshell.
# shellcheck disable=SC1091 # Script-relative sources are resolved at runtime.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_SOURCE_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
TERRAFORM_VARS="$SCRIPT_DIR/single-plane-azure.tfvars"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES="$SCRIPT_DIR/single-plane-azure.yaml"

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
for command in az terraform kubectl helm docker openssl curl jq osmo; do
    check_command "$command"
done

TF_SUBSCRIPTION_ID="${TF_SUBSCRIPTION_ID:-$(azure_get_current_subscription)}"
: "${TF_SUBSCRIPTION_ID:?unable to determine the Azure subscription ID}"

# Use a persistent, resource-group-specific working directory so this example
# cannot read or update terraform.tfvars or terraform.tfstate used by the
# legacy deploy-osmo-minimal.sh entry point.
resource_group_key="$(printf '%s' "$TF_RESOURCE_GROUP" | tr -c '[:alnum:]_-' '-')"
TERRAFORM_DIR="${SINGLE_PLANE_TERRAFORM_WORK_DIR:-$TERRAFORM_SOURCE_DIR/.single-plane/$resource_group_key}"
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
azure_get_terraform_outputs "$TERRAFORM_DIR" "$TERRAFORM_OUTPUTS" single-plane

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
docker run --rm --user "$(id -u):$(id -g)" \
    --entrypoint service-auth-bootstrap \
    --volume "$SECRETS_DIR:/output" \
    "nvcr.io/$OSMO_IMAGE_REPOSITORY/service:$OSMO_IMAGE_TAG" \
    generate --output /output/authentication-config.json
kubectl create secret generic osmo-service-auth --namespace osmo \
    --from-file=authentication-config.json="$SECRETS_DIR/authentication-config.json" \
    --dry-run=client --output yaml | kubectl apply -f -
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

# Generate a structured values file. JSON is valid Helm values input and lets
# jq quote every dynamic value without another template language.
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
    --arg workload_identity_client_id "$WORKLOAD_IDENTITY_CLIENT_ID" '
{
  imageRepository: $image_repository,
  imageTag: $image_tag,
  imagePullSecrets: (if $image_pull_secret == "" then [] else [{name: $image_pull_secret}] end),
  services: {
    api: {
      extraVolumeMounts: (if $image_pull_secret == "" then [] else [{
        name: "runtime-image-pull-secret",
        mountPath: ("/etc/osmo/secrets/" + $image_pull_secret),
        readOnly: true
      }] end),
      serviceAccount: {annotations: {"azure.workload.identity/client-id": $workload_identity_client_id}},
      pod: {extraVolumes: (if $image_pull_secret == "" then [] else [{
        name: "runtime-image-pull-secret",
        secret: {secretName: $image_pull_secret}
      }] end)}
    },
    worker: {serviceAccount: {annotations: {
      "azure.workload.identity/client-id": $workload_identity_client_id
    }}}
  },
  externalDependencies: {
    postgresql: {host: $postgres_host, database: $postgres_database, username: $postgres_username},
    valkey: {host: $redis_host, port: ($redis_port | tonumber)},
    objectStorage: {locations: {
      workflows: ("azure://" + $storage_account + "/" + $storage_container + "/workflows"),
      logs: ("azure://" + $storage_account + "/" + $storage_container + "/logs"),
      apps: ("azure://" + $storage_account + "/" + $storage_container + "/apps")
    }}
  },
  configuration: {workflow: {backend_images:
    (if $image_pull_secret == "" then {} else {credential: {
      secretName: $image_pull_secret,
      secretKey: ".dockerconfigjson"
    }} end)
  }}
}' >"$DYNAMIC_VALUES"

# Install OSMO.
helm dependency build "$CHART"
helm_values=(
    --namespace osmo
    --values "$CHART/profiles/single-plane.yaml"
    --values "$AZURE_VALUES"
    --values "$DYNAMIC_VALUES"
    --wait --wait-for-jobs --timeout 25m
)
helm upgrade --install osmo "$CHART" "${helm_values[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true
helm upgrade osmo "$CHART" "${helm_values[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=false

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
