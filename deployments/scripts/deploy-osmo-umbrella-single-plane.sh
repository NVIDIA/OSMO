#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside a newly created azure-sandbox assume subshell.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES="${TMPDIR:-/tmp}/single-plane-azure.yaml"
KUBECONFIG="${TMPDIR:-/tmp}/osmo-single-plane-kubeconfig"
export KUBECONFIG
: "${TF_VAR_resource_group_name:?set the isolated sandbox resource group}"
: "${TF_VAR_cluster_name:?set a globally unique AKS cluster name}"
: "${TF_VAR_postgres_password:?set the PostgreSQL administrator password}"
for command in az terraform kubectl helm openssl curl jq osmo; do
    command -v "$command" >/dev/null
done
TF_VAR_subscription_id="$(az account show --query id --output tsv)"
export TF_VAR_subscription_id TF_VAR_storage_account_enabled=true TF_VAR_aks_private_cluster_enabled=false
terraform -chdir="$TERRAFORM_DIR" init
terraform -chdir="$TERRAFORM_DIR" apply -auto-approve
AKS_CLUSTER_NAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw aks_cluster_name)"
POSTGRES_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_server_fqdn)"
POSTGRES_DATABASE="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_database_name)"
POSTGRES_USERNAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_admin_username)"
REDIS_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_hostname)"
REDIS_PORT="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_ssl_port)"
REDIS_PASSWORD="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_primary_access_key)"
STORAGE_ACCOUNT="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_account)"
STORAGE_ACCOUNT_KEY="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_account_key)"
STORAGE_CONTAINER="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_container_name)"
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$AKS_CLUSTER_NAME" \
    --admin --overwrite-existing --file "$KUBECONFIG"
helm upgrade --install kai-scheduler \
    https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --namespace kai-scheduler --create-namespace --wait --timeout 10m
kubectl create namespace osmo --dry-run=client --output yaml | kubectl apply -f -
kubectl create secret generic osmo-postgresql --namespace osmo \
    --from-literal=username="$POSTGRES_USERNAME" --from-literal=db-password="$TF_VAR_postgres_password" \
    --dry-run=client --output yaml | kubectl apply -f -
kubectl create secret generic osmo-valkey --namespace osmo \
    --from-literal=redis-password="$REDIS_PASSWORD" --dry-run=client --output yaml | kubectl apply -f -
AZURE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=${STORAGE_ACCOUNT};AccountKey=${STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net"
OBJECT_STORAGE_CREDENTIALS="access_key_id: ${STORAGE_ACCOUNT}
access_key: ${AZURE_CONNECTION_STRING}"
printf '%s\n' "$OBJECT_STORAGE_CREDENTIALS" | kubectl create secret generic osmo-object-storage --namespace osmo \
    --from-file=object-storage.yaml=/dev/stdin --dry-run=client --output yaml | kubectl apply -f -
BACKEND_TOKEN_SECRET="$(kubectl get secret osmo-backend-token --namespace osmo --ignore-not-found --output name)"
if [[ -z "$BACKEND_TOKEN_SECRET" ]]; then
    BACKEND_TOKEN="$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=')"
    kubectl create secret generic osmo-backend-token --namespace osmo \
        --from-literal=token="$BACKEND_TOKEN" --dry-run=client --output yaml | kubectl apply -f -
fi
cat >"$AZURE_VALUES" <<EOF
externalUrl: http://127.0.0.1:9000
compute:
  backendName: default
externalDependencies:
  postgresql:
    host: $POSTGRES_HOST
    port: 5432
    database: $POSTGRES_DATABASE
    username: $POSTGRES_USERNAME
    tls:
      enabled: false
  valkey:
    host: $REDIS_HOST
    port: $REDIS_PORT
    tls:
      enabled: true
  objectStorage:
    locations:
      workflows: azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/workflows
      logs: azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/logs
      apps: azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/apps
secrets:
  postgresql:
    existingSecret: osmo-postgresql
  valkey:
    existingSecret: osmo-valkey
  objectStorage:
    existingSecret: osmo-object-storage
EOF
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
