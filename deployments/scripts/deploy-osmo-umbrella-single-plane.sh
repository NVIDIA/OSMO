#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside a newly created azure-sandbox assume subshell.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES_TEMPLATE="$SCRIPT_DIR/single-plane-azure.yaml.envsubst"
AZURE_VALUES="${TMPDIR:-/tmp}/single-plane-azure.yaml"
KUBECONFIG="${TMPDIR:-/tmp}/osmo-single-plane-kubeconfig"
export KUBECONFIG
: "${TF_VAR_resource_group_name:?set the isolated sandbox resource group}"
OSMO_IMAGE_REPOSITORY="${OSMO_IMAGE_REPOSITORY:-nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
OSMO_IMAGE_PULL_SECRET="${OSMO_IMAGE_PULL_SECRET:-}"
IMAGE_PULL_SECRETS='[]'
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    IMAGE_PULL_SECRETS="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" '[{name:$name}]')"
fi
for command in az terraform kubectl helm openssl curl jq osmo envsubst; do
    command -v "$command" >/dev/null || { echo "required command not found: $command" >&2; exit 1; }
done
TF_VAR_subscription_id="$(az account show --query id --output tsv)"
export TF_VAR_subscription_id TF_VAR_single_plane_workload_identity_enabled=true
export TF_VAR_storage_account_enabled=false TF_VAR_aks_private_cluster_enabled=false
export TF_VAR_node_instance_type="${TF_VAR_node_instance_type:-Standard_D8s_v3}"
terraform -chdir="$TERRAFORM_DIR" init
terraform -chdir="$TERRAFORM_DIR" apply -auto-approve
AKS_CLUSTER_NAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw aks_cluster_name)"
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
for required_value in AKS_CLUSTER_NAME POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME POSTGRES_PASSWORD \
        REDIS_HOST REDIS_PORT REDIS_PASSWORD STORAGE_ACCOUNT STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID; do
    [[ -n "${!required_value}" ]] || { echo "Terraform output $required_value is empty" >&2; exit 1; }
done
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$AKS_CLUSTER_NAME" \
    --admin --overwrite-existing --file "$KUBECONFIG"
helm upgrade --install kai-scheduler \
    https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --namespace kai-scheduler --create-namespace --wait --timeout 10m
kubectl create namespace osmo --dry-run=client --output yaml | kubectl apply -f -
kubectl create secret generic osmo-postgresql --namespace osmo \
    --from-literal=username="$POSTGRES_USERNAME" --from-literal=db-password="$POSTGRES_PASSWORD" \
    --dry-run=client --output yaml | kubectl apply -f -
kubectl create secret generic osmo-valkey --namespace osmo \
    --from-literal=redis-password="$REDIS_PASSWORD" --dry-run=client --output yaml | kubectl apply -f -
kubectl create serviceaccount osmo-workflow --namespace osmo --dry-run=client --output yaml | kubectl apply -f -
kubectl annotate serviceaccount osmo-workflow --namespace osmo \
    azure.workload.identity/client-id="$WORKLOAD_IDENTITY_CLIENT_ID" --overwrite
BACKEND_TOKEN_SECRET="$(kubectl get secret osmo-backend-token --namespace osmo --ignore-not-found --output name)"
if [[ -z "$BACKEND_TOKEN_SECRET" ]]; then
    BACKEND_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
    kubectl create secret generic osmo-backend-token --namespace osmo \
        --from-literal=token="$BACKEND_TOKEN" --dry-run=client --output yaml | kubectl apply -f -
fi
export POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME REDIS_HOST REDIS_PORT
export STORAGE_ACCOUNT STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID
export OSMO_IMAGE_REPOSITORY OSMO_IMAGE_TAG OSMO_IMAGE_PULL_SECRET IMAGE_PULL_SECRETS
# shellcheck disable=SC2016 # envsubst requires literal variable names in its allowlist.
envsubst '${POSTGRES_HOST} ${POSTGRES_DATABASE} ${POSTGRES_USERNAME} ${REDIS_HOST} ${REDIS_PORT} ${STORAGE_ACCOUNT} ${STORAGE_CONTAINER} ${WORKLOAD_IDENTITY_CLIENT_ID} ${OSMO_IMAGE_REPOSITORY} ${OSMO_IMAGE_TAG} ${OSMO_IMAGE_PULL_SECRET} ${IMAGE_PULL_SECRETS}' \
    <"$AZURE_VALUES_TEMPLATE" >"$AZURE_VALUES"
helm dependency build "$CHART"
helm upgrade --install osmo "$CHART" --namespace osmo \
    --values "$CHART/profiles/single-plane.yaml" --values "$AZURE_VALUES" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true --wait --wait-for-jobs --timeout 25m
helm upgrade osmo "$CHART" --namespace osmo \
    --values "$CHART/profiles/single-plane.yaml" --values "$AZURE_VALUES" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=false --wait --wait-for-jobs --timeout 25m
kubectl --namespace osmo port-forward service/osmo-gateway 9000:80 &
PORT_FORWARD_PID=$!
trap 'kill "$PORT_FORWARD_PID" 2>/dev/null || true' EXIT
for attempt in {1..30}; do
    curl --fail --silent http://127.0.0.1:9000/api/version >/dev/null && break
    [[ "$attempt" == 30 ]] && exit 1
    sleep 1
done
OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
