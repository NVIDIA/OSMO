#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside a newly created azure-sandbox assume subshell.
set -euo pipefail

# Set up paths and required environment variables.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
TERRAFORM_VARS="$SCRIPT_DIR/single-plane-azure.tfvars"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES_TEMPLATE="$SCRIPT_DIR/single-plane-azure.yaml.envsubst"
AZURE_VALUES="${TMPDIR:-/tmp}/single-plane-azure.yaml"
KUBECONFIG="${TMPDIR:-/tmp}/osmo-single-plane-kubeconfig"
export KUBECONFIG
PORT_FORWARD_PID=
SECRETS_DIR=
cleanup() {
    [[ -z "$PORT_FORWARD_PID" ]] || kill "$PORT_FORWARD_PID" 2>/dev/null || true
    rm -f -- "$KUBECONFIG"
    [[ -z "$SECRETS_DIR" ]] || rm -rf -- "$SECRETS_DIR"
}
trap cleanup EXIT
umask 077
: "${TF_VAR_resource_group_name:?set the isolated sandbox resource group}"
for command in az terraform kubectl helm docker openssl curl jq osmo envsubst mktemp; do
    command -v "$command" >/dev/null || { echo "required command not found: $command" >&2; exit 1; }
done

# Provision Azure infrastructure.
unset TF_VAR_postgres_password TF_VAR_postgres_password_generation_enabled
TF_VAR_subscription_id="$(az account show --query id --output tsv)"
export TF_VAR_subscription_id
pushd "$TERRAFORM_DIR" >/dev/null
terraform init
terraform apply -auto-approve -var-file="$TERRAFORM_VARS"

# Read Terraform outputs.
AKS_CLUSTER_NAME="$(terraform output -raw aks_cluster_name)"
POSTGRES_HOST="$(terraform output -raw postgres_server_fqdn)"
POSTGRES_DATABASE="$(terraform output -raw postgres_database_name)"
POSTGRES_USERNAME="$(terraform output -raw postgres_admin_username)"
POSTGRES_PASSWORD="$(terraform output -raw postgres_password)"
REDIS_HOST="$(terraform output -raw redis_cache_hostname)"
REDIS_PORT="$(terraform output -raw redis_cache_ssl_port)"
REDIS_PASSWORD="$(terraform output -raw redis_cache_primary_access_key)"
STORAGE_ACCOUNT="$(terraform output -raw single_plane_storage_account)"
STORAGE_CONTAINER="$(terraform output -raw single_plane_storage_container_name)"
WORKLOAD_IDENTITY_CLIENT_ID="$(terraform output -raw single_plane_blob_identity_client_id)"
popd >/dev/null
for required_value in AKS_CLUSTER_NAME POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME POSTGRES_PASSWORD \
        REDIS_HOST REDIS_PORT REDIS_PASSWORD STORAGE_ACCOUNT STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID; do
    [[ -n "${!required_value}" ]] || { echo "Terraform output $required_value is empty" >&2; exit 1; }
done

# Configure cluster access and install dependencies.
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$AKS_CLUSTER_NAME" \
    --admin --overwrite-existing --file "$KUBECONFIG"
helm upgrade --install kai-scheduler \
    https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --namespace kai-scheduler --create-namespace --wait --timeout 10m

# Configure optional image overrides.
OSMO_IMAGE_REPOSITORY="${OSMO_IMAGE_REPOSITORY:-nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
OSMO_IMAGE_PULL_SECRET="${OSMO_IMAGE_PULL_SECRET:-}"
OSMO_IMAGE_PULL_CONFIG="${OSMO_IMAGE_PULL_CONFIG:-}"
OSMO_IMAGE_PULL_REGISTRY="${OSMO_IMAGE_PULL_REGISTRY:-nvcr.io}"

# Create Secrets and configure workload identity.
SECRETS_DIR="$(mktemp -d "${TMPDIR:-/tmp}/osmo-single-plane-secrets.XXXXXX")"
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
SECRETS_DIR=

# Prepare the site values file.
IMAGE_PULL_SECRETS='[]'
API_IMAGE_PULL_VOLUME_MOUNTS='[]'
API_IMAGE_PULL_VOLUMES='[]'
BACKEND_IMAGES='{}'
if [[ -n "$OSMO_IMAGE_PULL_SECRET" ]]; then
    IMAGE_PULL_SECRETS="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" '[{name:$name}]')"
    API_IMAGE_PULL_VOLUME_MOUNTS="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" \
        '[{name:"runtime-image-pull-secret",mountPath:("/etc/osmo/secrets/"+$name),readOnly:true}]')"
    API_IMAGE_PULL_VOLUMES="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" \
        '[{name:"runtime-image-pull-secret",secret:{secretName:$name}}]')"
    BACKEND_IMAGES="$(jq --compact-output --null-input --arg name "$OSMO_IMAGE_PULL_SECRET" \
        '{credential:{secretName:$name,secretKey:".dockerconfigjson"}}')"
fi
export POSTGRES_HOST POSTGRES_DATABASE POSTGRES_USERNAME REDIS_HOST REDIS_PORT
export STORAGE_ACCOUNT STORAGE_CONTAINER WORKLOAD_IDENTITY_CLIENT_ID
export OSMO_IMAGE_REPOSITORY OSMO_IMAGE_TAG IMAGE_PULL_SECRETS
export API_IMAGE_PULL_VOLUME_MOUNTS API_IMAGE_PULL_VOLUMES BACKEND_IMAGES
# shellcheck disable=SC2016 # envsubst requires literal variable names in its allowlist.
envsubst '${POSTGRES_HOST} ${POSTGRES_DATABASE} ${POSTGRES_USERNAME} ${REDIS_HOST} ${REDIS_PORT} ${STORAGE_ACCOUNT} ${STORAGE_CONTAINER} ${WORKLOAD_IDENTITY_CLIENT_ID} ${OSMO_IMAGE_REPOSITORY} ${OSMO_IMAGE_TAG} ${IMAGE_PULL_SECRETS} ${API_IMAGE_PULL_VOLUME_MOUNTS} ${API_IMAGE_PULL_VOLUMES} ${BACKEND_IMAGES}' \
    <"$AZURE_VALUES_TEMPLATE" >"$AZURE_VALUES"

# Install OSMO.
helm dependency build "$CHART"
helm upgrade --install osmo "$CHART" --namespace osmo \
    --values "$CHART/profiles/single-plane.yaml" --values "$AZURE_VALUES" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true --wait --wait-for-jobs --timeout 25m
helm upgrade osmo "$CHART" --namespace osmo \
    --values "$CHART/profiles/single-plane.yaml" --values "$AZURE_VALUES" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=false --wait --wait-for-jobs --timeout 25m

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
