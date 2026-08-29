#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside a newly created azure-sandbox assume subshell.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES_TEMPLATE="$SCRIPT_DIR/split-plane-azure.yaml.envsubst"
AZURE_VALUES="${TMPDIR:-/tmp}/split-plane-azure.yaml"
CONTROL_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-control-kubeconfig"
COMPUTE_ONE_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-compute-one-kubeconfig"
COMPUTE_TWO_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-compute-two-kubeconfig"
: "${TF_VAR_resource_group_name:?set the isolated sandbox resource group}"
: "${COMPUTE_CLUSTER_ONE_NAME:?set a globally unique first compute AKS cluster name}"
: "${COMPUTE_CLUSTER_TWO_NAME:?set a globally unique second compute AKS cluster name}"
: "${OSMO_CONTROL_PLANE_URL:?set the externally routed unified gateway URL}"
OSMO_IMAGE_REPOSITORY="${OSMO_IMAGE_REPOSITORY:-nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
OSMO_IMAGE_PULL_SECRET="${OSMO_IMAGE_PULL_SECRET:-}"
OSMO_IMAGE_PULL_CONFIG="${OSMO_IMAGE_PULL_CONFIG:-}"
IMAGE_PULL_SECRETS='[]'
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    : "${OSMO_IMAGE_PULL_CONFIG:?set the Docker config path for the image pull Secret}"
    [[ -r "$OSMO_IMAGE_PULL_CONFIG" ]] || { echo "image pull config is not readable: $OSMO_IMAGE_PULL_CONFIG" >&2; exit 1; }
    IMAGE_PULL_SECRETS="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" '[{name:$name}]')"
fi
CONTROL_PLANE_VALUES_ARGUMENTS=()
[[ -z "${OSMO_CONTROL_PLANE_VALUES:-}" ]] || CONTROL_PLANE_VALUES_ARGUMENTS=(--values "$OSMO_CONTROL_PLANE_VALUES")
for command in az terraform kubectl helm base64 curl jq osmo envsubst; do
    command -v "$command" >/dev/null || { echo "required command not found: $command" >&2; exit 1; }
done
TF_VAR_subscription_id="$(az account show --query id --output tsv)"
export TF_VAR_subscription_id TF_VAR_single_plane_workload_identity_enabled=true
export TF_VAR_storage_account_enabled=false TF_VAR_aks_private_cluster_enabled=false
export TF_VAR_node_instance_type="${TF_VAR_node_instance_type:-Standard_D8s_v3}"
terraform -chdir="$TERRAFORM_DIR" init
terraform -chdir="$TERRAFORM_DIR" apply -auto-approve
CONTROL_CLUSTER_NAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw aks_cluster_name)"
POSTGRES_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_server_fqdn)"
POSTGRES_DATABASE="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_database_name)"
POSTGRES_USERNAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_admin_username)"
POSTGRES_PASSWORD="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_password)"
REDIS_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_hostname)"
REDIS_PORT="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_ssl_port)"
REDIS_PASSWORD="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_primary_access_key)"
STORAGE_ACCOUNT="$(terraform -chdir="$TERRAFORM_DIR" output -raw single_plane_storage_account)"
STORAGE_CONTAINER="$(terraform -chdir="$TERRAFORM_DIR" output -raw single_plane_storage_container_name)"
WORKLOAD_IDENTITY_CLIENT_ID="$(terraform -chdir="$TERRAFORM_DIR" output -raw single_plane_blob_identity_client_id)"
[[ "$(az storage account show --resource-group "$TF_VAR_resource_group_name" --name "$STORAGE_ACCOUNT" --query allowBlobPublicAccess --output tsv)" == false ]] || \
    { echo "Blob public access is not disabled on $STORAGE_ACCOUNT" >&2; exit 1; }
[[ "$(az storage account show --resource-group "$TF_VAR_resource_group_name" --name "$STORAGE_ACCOUNT" --query allowSharedKeyAccess --output tsv)" == false ]] || \
    { echo "Shared Key access is not disabled on $STORAGE_ACCOUNT" >&2; exit 1; }
[[ "$(az storage container-rm show --resource-group "$TF_VAR_resource_group_name" --storage-account "$STORAGE_ACCOUNT" \
        --name "$STORAGE_CONTAINER" --query publicAccess --output tsv)" == None ]] || \
    { echo "Blob container $STORAGE_CONTAINER is not private" >&2; exit 1; }
for required_value in CONTROL_CLUSTER_NAME POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME POSTGRES_PASSWORD \
        REDIS_HOST REDIS_PORT REDIS_PASSWORD STORAGE_ACCOUNT STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID; do
    [[ -n "${!required_value}" ]] || { echo "Terraform output $required_value is empty" >&2; exit 1; }
done
BLOB_IDENTITY_NAME="${CONTROL_CLUSTER_NAME}-blob"
az aks create --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_ONE_NAME" \
    --node-vm-size "$TF_VAR_node_instance_type" --node-count 2 --enable-cluster-autoscaler --min-count 2 --max-count 3 \
    --no-ssh-key --enable-oidc-issuer --enable-workload-identity
az aks create --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_TWO_NAME" \
    --node-vm-size "$TF_VAR_node_instance_type" --node-count 2 --enable-cluster-autoscaler --min-count 2 --max-count 3 \
    --no-ssh-key --enable-oidc-issuer --enable-workload-identity
COMPUTE_ONE_ISSUER="$(az aks show --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_ONE_NAME" --query oidcIssuerProfile.issuerUrl --output tsv)"
COMPUTE_TWO_ISSUER="$(az aks show --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_TWO_NAME" --query oidcIssuerProfile.issuerUrl --output tsv)"
az identity federated-credential create --name compute-one-osmo-workflow --identity-name "$BLOB_IDENTITY_NAME" \
    --resource-group "$TF_VAR_resource_group_name" --issuer "$COMPUTE_ONE_ISSUER" \
    --subject system:serviceaccount:osmo:osmo-workflow --audiences api://AzureADTokenExchange
az identity federated-credential create --name compute-two-osmo-workflow --identity-name "$BLOB_IDENTITY_NAME" \
    --resource-group "$TF_VAR_resource_group_name" --issuer "$COMPUTE_TWO_ISSUER" \
    --subject system:serviceaccount:osmo:osmo-workflow --audiences api://AzureADTokenExchange
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$CONTROL_CLUSTER_NAME" --admin --overwrite-existing --file "$CONTROL_KUBECONFIG"
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_ONE_NAME" --admin --overwrite-existing --file "$COMPUTE_ONE_KUBECONFIG"
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_TWO_NAME" --admin --overwrite-existing --file "$COMPUTE_TWO_KUBECONFIG"
helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace kai-scheduler --create-namespace --wait --timeout 10m
helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace kai-scheduler --create-namespace --wait --timeout 10m
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    kubectl --kubeconfig "$CONTROL_KUBECONFIG" create secret generic "$OSMO_IMAGE_PULL_SECRET" --namespace osmo \
        --from-file=.dockerconfigjson="$OSMO_IMAGE_PULL_CONFIG" --type=kubernetes.io/dockerconfigjson \
        --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
fi
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create secret generic osmo-postgresql --namespace osmo --from-literal=username="$POSTGRES_USERNAME" \
    --from-literal=db-password="$POSTGRES_PASSWORD" --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create secret generic osmo-valkey --namespace osmo \
    --from-literal=redis-password="$REDIS_PASSWORD" --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
export POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME REDIS_HOST REDIS_PORT STORAGE_ACCOUNT STORAGE_CONTAINER
export WORKLOAD_IDENTITY_CLIENT_ID OSMO_CONTROL_PLANE_URL OSMO_IMAGE_REPOSITORY OSMO_IMAGE_TAG OSMO_IMAGE_PULL_SECRET IMAGE_PULL_SECRETS
# shellcheck disable=SC2016 # envsubst requires literal variable names in its allowlist.
envsubst '${POSTGRES_HOST} ${POSTGRES_DATABASE} ${POSTGRES_USERNAME} ${REDIS_HOST} ${REDIS_PORT} ${STORAGE_ACCOUNT} ${STORAGE_CONTAINER} ${WORKLOAD_IDENTITY_CLIENT_ID} ${OSMO_CONTROL_PLANE_URL} ${OSMO_IMAGE_REPOSITORY} ${OSMO_IMAGE_TAG} ${OSMO_IMAGE_PULL_SECRET} ${IMAGE_PULL_SECRETS}' \
    <"$AZURE_VALUES_TEMPLATE" >"$AZURE_VALUES"
helm dependency build "$CHART"
helm upgrade --install osmo "$CHART" --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo \
    --values "$CHART/profiles/split-plane-control.yaml" --values "$AZURE_VALUES" "${CONTROL_PLANE_VALUES_ARGUMENTS[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true --wait --wait-for-jobs --timeout 25m
helm upgrade osmo "$CHART" --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo \
    --values "$CHART/profiles/split-plane-control.yaml" --values "$AZURE_VALUES" "${CONTROL_PLANE_VALUES_ARGUMENTS[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=false --wait --wait-for-jobs --timeout 25m
kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" create secret generic "$OSMO_IMAGE_PULL_SECRET" --namespace osmo \
        --from-file=.dockerconfigjson="$OSMO_IMAGE_PULL_CONFIG" --type=kubernetes.io/dockerconfigjson \
        --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
fi
kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" create serviceaccount osmo-workflow --namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" annotate serviceaccount osmo-workflow --namespace osmo azure.workload.identity/client-id="$WORKLOAD_IDENTITY_CLIENT_ID" --overwrite
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo get secret osmo-backend-token-compute-one --output jsonpath='{.data.token}' | base64 --decode | \
    kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace osmo create secret generic osmo-backend-token-compute-one --from-file=token=/dev/stdin --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
helm upgrade --install osmo "$CHART" --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace osmo --values "$CHART/profiles/split-plane-compute.yaml" \
    --values "$AZURE_VALUES" --set-string compute.backendName=compute-one --set-string compute.authentication.existingSecret=osmo-backend-token-compute-one --wait --timeout 10m
kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" create secret generic "$OSMO_IMAGE_PULL_SECRET" --namespace osmo \
        --from-file=.dockerconfigjson="$OSMO_IMAGE_PULL_CONFIG" --type=kubernetes.io/dockerconfigjson \
        --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
fi
kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" create serviceaccount osmo-workflow --namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" annotate serviceaccount osmo-workflow --namespace osmo azure.workload.identity/client-id="$WORKLOAD_IDENTITY_CLIENT_ID" --overwrite
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo get secret osmo-backend-token-compute-two --output jsonpath='{.data.token}' | base64 --decode | \
    kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace osmo create secret generic osmo-backend-token-compute-two --from-file=token=/dev/stdin --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
helm upgrade --install osmo "$CHART" --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace osmo --values "$CHART/profiles/split-plane-compute.yaml" \
    --values "$AZURE_VALUES" --set-string compute.backendName=compute-two --set-string compute.authentication.existingSecret=osmo-backend-token-compute-two --wait --timeout 10m
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo port-forward service/osmo-gateway 9000:http &
PORT_FORWARD_PID=$!
trap 'kill "$PORT_FORWARD_PID" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
    curl --fail --silent http://127.0.0.1:9000/api/version >/dev/null && break
    [[ "$attempt" == 30 ]] && exit 1
    sleep 1
done
POOL=compute-one OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
POOL=compute-two OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
