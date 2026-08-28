#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# Run this only inside a newly created azure-sandbox assume subshell.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPOSITORY_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TERRAFORM_DIR="$REPOSITORY_ROOT/deployments/terraform/azure/example"
CHART="$REPOSITORY_ROOT/deployments/charts/osmo"
AZURE_VALUES="${TMPDIR:-/tmp}/split-plane-azure.yaml"
CONTROL_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-control-kubeconfig"
COMPUTE_ONE_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-compute-one-kubeconfig"
COMPUTE_TWO_KUBECONFIG="${TMPDIR:-/tmp}/osmo-split-compute-two-kubeconfig"
: "${TF_VAR_resource_group_name:?set the isolated sandbox resource group}"
: "${TF_VAR_cluster_name:?set a globally unique control AKS cluster name}"
: "${TF_VAR_postgres_password:?set the PostgreSQL administrator password}"
: "${COMPUTE_CLUSTER_ONE_NAME:?set a globally unique first compute AKS cluster name}"
: "${COMPUTE_CLUSTER_TWO_NAME:?set a globally unique second compute AKS cluster name}"
: "${OSMO_CONTROL_PLANE_URL:?set the externally routed unified gateway URL}"
OSMO_IMAGE_REPOSITORY="${OSMO_IMAGE_REPOSITORY:-nvidia/osmo}"
OSMO_IMAGE_TAG="${OSMO_IMAGE_TAG:-latest}"
IMAGE_PULL_SECRETS="[]"
[[ -z "${OSMO_IMAGE_PULL_SECRET:-}" ]] || IMAGE_PULL_SECRETS="[{name: \"$OSMO_IMAGE_PULL_SECRET\"}]"
CONTROL_PLANE_VALUES_ARGUMENTS=()
[[ -z "${OSMO_CONTROL_PLANE_VALUES:-}" ]] || CONTROL_PLANE_VALUES_ARGUMENTS=(--values "$OSMO_CONTROL_PLANE_VALUES")
for command in az terraform kubectl helm base64 curl jq osmo; do command -v "$command" >/dev/null; done
TF_VAR_subscription_id="$(az account show --query id --output tsv)"
export TF_VAR_subscription_id TF_VAR_storage_account_enabled=true TF_VAR_aks_private_cluster_enabled=false
export TF_VAR_node_instance_type="${TF_VAR_node_instance_type:-Standard_D4s_v3}"
terraform -chdir="$TERRAFORM_DIR" init
terraform -chdir="$TERRAFORM_DIR" apply -auto-approve
CONTROL_CLUSTER_NAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw aks_cluster_name)"
POSTGRES_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_server_fqdn)"
POSTGRES_DATABASE="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_database_name)"
POSTGRES_USERNAME="$(terraform -chdir="$TERRAFORM_DIR" output -raw postgres_admin_username)"
REDIS_HOST="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_hostname)"
REDIS_PORT="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_ssl_port)"
REDIS_PASSWORD="$(terraform -chdir="$TERRAFORM_DIR" output -raw redis_cache_primary_access_key)"
STORAGE_ACCOUNT="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_account)"
STORAGE_ACCOUNT_KEY="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_account_key)"
STORAGE_CONTAINER="$(terraform -chdir="$TERRAFORM_DIR" output -raw storage_container_name)"
az aks create --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_ONE_NAME" \
    --node-vm-size "$TF_VAR_node_instance_type" --node-count 2 --enable-cluster-autoscaler --min-count 2 --max-count 3 --no-ssh-key
az aks create --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_TWO_NAME" \
    --node-vm-size "$TF_VAR_node_instance_type" --node-count 2 --enable-cluster-autoscaler --min-count 2 --max-count 3 --no-ssh-key
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$CONTROL_CLUSTER_NAME" --admin --overwrite-existing --file "$CONTROL_KUBECONFIG"
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_ONE_NAME" --admin --overwrite-existing --file "$COMPUTE_ONE_KUBECONFIG"
az aks get-credentials --resource-group "$TF_VAR_resource_group_name" --name "$COMPUTE_CLUSTER_TWO_NAME" --admin --overwrite-existing --file "$COMPUTE_TWO_KUBECONFIG"
helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace kai-scheduler --create-namespace --wait --timeout 10m
helm upgrade --install kai-scheduler https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
    --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace kai-scheduler --create-namespace --wait --timeout 10m
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create secret generic osmo-postgresql --namespace osmo --from-literal=username="$POSTGRES_USERNAME" \
    --from-literal=db-password="$TF_VAR_postgres_password" --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
kubectl --kubeconfig "$CONTROL_KUBECONFIG" create secret generic osmo-valkey --namespace osmo \
    --from-literal=redis-password="$REDIS_PASSWORD" --dry-run=client --output yaml | kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
AZURE_CONNECTION_STRING="DefaultEndpointsProtocol=https;AccountName=${STORAGE_ACCOUNT};AccountKey=${STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net"
printf 'access_key_id: %s\naccess_key: %s\n' "$STORAGE_ACCOUNT" "$AZURE_CONNECTION_STRING" | kubectl --kubeconfig "$CONTROL_KUBECONFIG" \
    create secret generic osmo-object-storage --namespace osmo --from-file=object-storage.yaml=/dev/stdin --dry-run=client --output yaml | \
    kubectl --kubeconfig "$CONTROL_KUBECONFIG" apply -f -
cat >"$AZURE_VALUES" <<EOF
externalUrl: "$OSMO_CONTROL_PLANE_URL"
imageTag: "$OSMO_IMAGE_TAG"
imagePullSecrets: $IMAGE_PULL_SECRETS
runtimeImage: {repository: "$OSMO_IMAGE_REPOSITORY", tag: "$OSMO_IMAGE_TAG", pullSecret: "${OSMO_IMAGE_PULL_SECRET:-}"}
services:
  ui: {image: {repository: "$OSMO_IMAGE_REPOSITORY/web-ui"}}
  api: {image: {repository: "$OSMO_IMAGE_REPOSITORY/service"}}
  worker: {image: {repository: "$OSMO_IMAGE_REPOSITORY/worker"}}
  router: {image: {repository: "$OSMO_IMAGE_REPOSITORY/router"}}
  logger: {image: {repository: "$OSMO_IMAGE_REPOSITORY/logger"}}
  agent: {image: {repository: "$OSMO_IMAGE_REPOSITORY/agent"}}
  delayedJobMonitor: {image: {repository: "$OSMO_IMAGE_REPOSITORY/delayed-job-monitor"}}
  backendListener: {image: {repository: "$OSMO_IMAGE_REPOSITORY/backend-listener"}}
  backendWorker: {image: {repository: "$OSMO_IMAGE_REPOSITORY/backend-worker"}}
externalDependencies:
  postgresql: {host: $POSTGRES_HOST, port: 5432, database: $POSTGRES_DATABASE, username: $POSTGRES_USERNAME, tls: {enabled: false}}
  valkey: {host: $REDIS_HOST, port: $REDIS_PORT, tls: {enabled: true}}
  objectStorage: {locations: {workflows: "azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/workflows", logs: "azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/logs", apps: "azure://$STORAGE_ACCOUNT/$STORAGE_CONTAINER/apps"}}
configuration:
  podTemplates:
    default_user:
      spec:
        containers:
        - name: "{{USER_CONTAINER_NAME}}"
          resources:
            limits: {cpu: "{{USER_CPU}}", memory: "{{USER_MEMORY}}", ephemeral-storage: "{{USER_STORAGE}}"}
            requests: {cpu: "{{USER_CPU}}", memory: "{{USER_MEMORY}}", ephemeral-storage: "{{USER_STORAGE}}"}
  backends:
    compute-one: {description: First compute plane, scheduler_settings: {scheduler_type: kai, scheduler_name: kai-scheduler, scheduler_timeout: 30}}
    compute-two: {description: Second compute plane, scheduler_settings: {scheduler_type: kai, scheduler_name: kai-scheduler, scheduler_timeout: 30}}
  pools:
    compute-one:
      description: First compute plane
      backend: compute-one
      default_platform: default
      common_pod_template: [default_ctrl, default_user]
      common_resource_validations: [default_cpu, default_memory, default_storage, default_gpu]
      common_default_variables: {USER_CPU: 1, USER_GPU: 0, USER_MEMORY: 1Gi, USER_STORAGE: 1Gi}
      platforms: {default: {}}
    compute-two:
      description: Second compute plane
      backend: compute-two
      default_platform: default
      common_pod_template: [default_ctrl, default_user]
      common_resource_validations: [default_cpu, default_memory, default_storage, default_gpu]
      common_default_variables: {USER_CPU: 1, USER_GPU: 0, USER_MEMORY: 1Gi, USER_STORAGE: 1Gi}
      platforms: {default: {}}
secrets:
  postgresql: {existingSecret: osmo-postgresql}
  valkey: {existingSecret: osmo-valkey}
  objectStorage: {existingSecret: osmo-object-storage}
  backendApiTokens:
    enabled: true
    credentials:
    - {name: compute-one, managedSecret: {name: osmo-backend-token-compute-one}}
    - {name: compute-two, managedSecret: {name: osmo-backend-token-compute-two}}
  masterEncryptionKey: {managementMode: osmo}
EOF
helm dependency build "$CHART"
helm upgrade --install osmo "$CHART" --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo \
    --values "$CHART/profiles/split-plane-control.yaml" --values "$AZURE_VALUES" "${CONTROL_PLANE_VALUES_ARGUMENTS[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=true --wait --wait-for-jobs --timeout 25m
helm upgrade osmo "$CHART" --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo \
    --values "$CHART/profiles/split-plane-control.yaml" --values "$AZURE_VALUES" "${CONTROL_PLANE_VALUES_ARGUMENTS[@]}" \
    --set secrets.masterEncryptionKey.bootstrap.enabled=false --wait --wait-for-jobs --timeout 25m
kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo get secret osmo-backend-token-compute-one --output jsonpath='{.data.token}' | base64 --decode | \
    kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace osmo create secret generic osmo-backend-token-compute-one --from-file=token=/dev/stdin --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_ONE_KUBECONFIG" apply -f -
helm upgrade --install osmo "$CHART" --kubeconfig "$COMPUTE_ONE_KUBECONFIG" --namespace osmo --values "$CHART/profiles/split-plane-compute.yaml" \
    --values "$AZURE_VALUES" --set-string compute.backendName=compute-one --set-string compute.authentication.existingSecret=osmo-backend-token-compute-one --wait --timeout 10m
kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" create namespace osmo --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo get secret osmo-backend-token-compute-two --output jsonpath='{.data.token}' | base64 --decode | \
    kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace osmo create secret generic osmo-backend-token-compute-two --from-file=token=/dev/stdin --dry-run=client --output yaml | kubectl --kubeconfig "$COMPUTE_TWO_KUBECONFIG" apply -f -
helm upgrade --install osmo "$CHART" --kubeconfig "$COMPUTE_TWO_KUBECONFIG" --namespace osmo --values "$CHART/profiles/split-plane-compute.yaml" \
    --values "$AZURE_VALUES" --set-string compute.backendName=compute-two --set-string compute.authentication.existingSecret=osmo-backend-token-compute-two --wait --timeout 10m
kubectl --kubeconfig "$CONTROL_KUBECONFIG" --namespace osmo port-forward service/osmo-gateway 9000:80 &
PORT_FORWARD_PID=$!
trap 'kill "$PORT_FORWARD_PID" 2>/dev/null || true' EXIT
for attempt in {1..30}; do curl --fail --silent http://127.0.0.1:9000/api/version >/dev/null && break; [[ "$attempt" == 30 ]] && exit 1; sleep 1; done
POOL=compute-one OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
POOL=compute-two OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 bash "$SCRIPT_DIR/verify.sh"
