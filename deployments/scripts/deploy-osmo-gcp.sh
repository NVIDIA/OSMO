#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0
# shellcheck disable=SC1091
set -euo pipefail
# Credentials must never enter shell tracing, including when invoked with bash -x.
set +x
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_SOURCE_DIR="$(cd "$SCRIPT_DIR/../terraform/gcp/example" && pwd)"
CHART="$SCRIPT_DIR/../charts/osmo"
source "$SCRIPT_DIR/common.sh"

usage() {
    cat <<'EOF'
Usage: deploy-osmo-gcp.sh {plan|apply|deploy|verify}

Required: TF_VAR_project_id, TF_VAR_cluster_name
Location: TF_VAR_region (asia-southeast1), TF_VAR_zone (asia-southeast1-b)
Deploy:   OSMO_IMAGE_TAG (explicit tag), OSMO_IMAGE_REGISTRY (nvcr.io/nvidia/osmo)
Tools:    TERRAFORM_BIN (terraform; can be an absolute OpenTofu path)

plan/apply manage a new, isolated GCP development environment. apply prompts for approval.
deploy reads existing Terraform outputs, installs OSMO, and runs CPU/storage smoke tests.
verify runs the smoke tests against the same Terraform-managed cluster.
State stays under deployments/terraform/gcp/example/.osmo/<project>/<zone>/<cluster>.
EOF
}

action="${1:---help}"
case "$action" in
    -h|--help) usage; exit 0 ;;
    plan|apply|deploy|verify) ;;
    *) usage >&2; exit 2 ;;
esac
[[ "$#" == 1 ]] || { usage >&2; exit 2; }
: "${TF_VAR_project_id:?set TF_VAR_project_id to an existing billed project}"
: "${TF_VAR_cluster_name:?set TF_VAR_cluster_name}"
export TF_VAR_region="${TF_VAR_region:-asia-southeast1}"
export TF_VAR_zone="${TF_VAR_zone:-asia-southeast1-b}"
[[ "$TF_VAR_project_id" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ &&
   "$TF_VAR_cluster_name" =~ ^[a-z][a-z0-9-]{0,18}[a-z0-9]$ &&
   "$TF_VAR_region" =~ ^[a-z]+-[a-z]+[0-9]+$ &&
   "$TF_VAR_zone" =~ ^${TF_VAR_region}-[a-z]$ ]] || {
    log_error "Invalid project, cluster, region or zone"; exit 2;
}
TERRAFORM_BIN="${TERRAFORM_BIN:-terraform}"
check_command "$TERRAFORM_BIN"
check_command jq

TERRAFORM_DIR="$TERRAFORM_SOURCE_DIR/.osmo/$TF_VAR_project_id/$TF_VAR_zone/$TF_VAR_cluster_name"
if [[ "$action" == plan || "$action" == apply ]]; then
    mkdir -p "$TERRAFORM_DIR"
    cp "$TERRAFORM_SOURCE_DIR"/*.tf "$TERRAFORM_DIR/"
    "$TERRAFORM_BIN" -chdir="$TERRAFORM_DIR" init -input=false
    "$TERRAFORM_BIN" -chdir="$TERRAFORM_DIR" "$action"
    exit 0
fi

for command in gcloud gke-gcloud-auth-plugin kubectl helm openssl curl osmo base64; do
    check_command "$command"
done
if [[ "$action" == deploy ]]; then
    : "${OSMO_IMAGE_TAG:?set OSMO_IMAGE_TAG to a tested image tag}"
    OSMO_IMAGE_REGISTRY="${OSMO_IMAGE_REGISTRY:-nvcr.io/nvidia/osmo}"
    [[ "$OSMO_IMAGE_REGISTRY" == */* && "$OSMO_IMAGE_REGISTRY" != */ ]] || {
        log_error "OSMO_IMAGE_REGISTRY must include a registry host and repository path"; exit 2;
    }
    OSMO_SYSTEM_CA_BUNDLE="${OSMO_SYSTEM_CA_BUNDLE:-/etc/ssl/certs/ca-certificates.crt}"
    [[ -s "$OSMO_SYSTEM_CA_BUNDLE" ]] || {
        log_error "Set OSMO_SYSTEM_CA_BUNDLE to a PEM bundle of public CA certificates"; exit 2;
    }
fi
[[ -d "$TERRAFORM_DIR" ]] || { log_error "Run plan/apply for this target first"; exit 1; }
temporary_directory="$(mktemp -d "${TMPDIR:-/tmp}/osmo-gcp.XXXXXX")"
port_forward_pid=
cleanup() {
    [[ -z "$port_forward_pid" ]] || kill "$port_forward_pid" 2>/dev/null || true
    rm -rf -- "$temporary_directory"
}
trap cleanup EXIT
export KUBECONFIG="$temporary_directory/kubeconfig"
outputs="$temporary_directory/outputs.json"
"$TERRAFORM_BIN" -chdir="$TERRAFORM_DIR" output -json deployment >"$outputs"
jq -e --arg project "$TF_VAR_project_id" --arg cluster "$TF_VAR_cluster_name" \
    --arg region "$TF_VAR_region" --arg zone "$TF_VAR_zone" '
    .project_id == $project and .cluster_name == $cluster and .region == $region and .zone == $zone
    and ([.postgres_host, .postgres_database, .postgres_username, .postgres_password,
          .redis_host, .redis_password, .redis_ca, .bucket, .access_key_id, .access_key]
         | all(.[]; type == "string" and length > 0))
    and (.redis_port | type == "number" and . > 0)
' "$outputs" >/dev/null || { log_error "Invalid or mismatched Terraform deployment outputs"; exit 1; }
gcloud container clusters get-credentials "$TF_VAR_cluster_name" \
    --project "$TF_VAR_project_id" --zone "$TF_VAR_zone" --dns-endpoint

admin_token_file="$temporary_directory/admin-token"
if [[ "$action" == deploy ]]; then
    kubectl create namespace osmo --dry-run=client -o yaml | kubectl apply -f -
    jq -jr '.postgres_username' "$outputs" >"$temporary_directory/username"
    jq -jr '.postgres_password' "$outputs" >"$temporary_directory/db-password"
    jq -jr '.redis_password' "$outputs" >"$temporary_directory/redis-password"
    jq '{access_key_id, access_key, addressing_style: "path"}' "$outputs" \
        >"$temporary_directory/object-storage.yaml"
    cat "$OSMO_SYSTEM_CA_BUNDLE" >"$temporary_directory/ca-bundle.crt"
    printf '\n' >>"$temporary_directory/ca-bundle.crt"
    jq -r '.redis_ca' "$outputs" >>"$temporary_directory/ca-bundle.crt"
    kubectl create secret generic osmo-postgresql -n osmo \
        --from-file=username="$temporary_directory/username" \
        --from-file=db-password="$temporary_directory/db-password" \
        --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret generic osmo-valkey -n osmo \
        --from-file=redis-password="$temporary_directory/redis-password" \
        --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret generic osmo-valkey-ca -n osmo \
        --from-file=ca-bundle.crt="$temporary_directory/ca-bundle.crt" \
        --dry-run=client -o yaml | kubectl apply -f -
    kubectl create secret generic osmo-object-storage -n osmo \
        --from-file=object-storage.yaml="$temporary_directory/object-storage.yaml" \
        --dry-run=client -o yaml | kubectl apply -f -
    # Preserve access tokens across upgrades. Kubernetes errors abort instead of rotating tokens.
    for entry in osmo-default-admin:password osmo-backend-token:token; do
        secret_name="${entry%:*}"
        secret_key="${entry#*:}"
        existing="$(kubectl get secret "$secret_name" -n osmo --ignore-not-found -o name)"
        if [[ -z "$existing" ]]; then
            openssl rand -base64 32 | tr '+/' '-_' | tr -d '\n=' >"$temporary_directory/token"
            kubectl create secret generic "$secret_name" -n osmo \
                --from-file="$secret_key=$temporary_directory/token" \
                --dry-run=client -o yaml | kubectl apply -f -
        fi
    done
    nonce="$(openssl dgst -sha256 -r "$outputs")"
    jq --arg image "$OSMO_IMAGE_REGISTRY" --arg tag "$OSMO_IMAGE_TAG" \
        --arg nonce "${nonce%% *}" -f "$SCRIPT_DIR/gcp/values.jq" "$outputs" \
        >"$temporary_directory/values.json"
    KAI_HELM_TIMEOUT=10m bash "$SCRIPT_DIR/install-kai-scheduler.sh"
    helm repo add osmo-postgresql https://cloudnative-pg.github.io/charts --force-update
    helm repo add osmo-rustfs https://charts.rustfs.com --force-update
    helm dependency build "$CHART"
    helm upgrade --install osmo "$CHART" -n osmo \
        -f "$CHART/profiles/single-plane.yaml" -f "$SCRIPT_DIR/single-plane-gcp.yaml" \
        -f "$temporary_directory/values.json" --set secrets.masterEncryptionKey.bootstrap.enabled=true \
        --wait --wait-for-jobs --timeout 25m
fi
kubectl get secret osmo-default-admin -n osmo -o jsonpath='{.data.password}' \
    | base64 --decode >"$admin_token_file"
[[ -s "$admin_token_file" ]] || { log_error "Admin token is empty"; exit 1; }
kubectl -n osmo port-forward service/osmo-gateway 9000:80 >"$temporary_directory/port-forward.log" 2>&1 &
port_forward_pid=$!
for attempt in {1..30}; do
    kill -0 "$port_forward_pid" 2>/dev/null || {
        cat "$temporary_directory/port-forward.log" >&2; exit 1;
    }
    curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:9000/api/version >/dev/null && break
    [[ "$attempt" != 30 ]] || { log_error "Gateway did not become reachable"; exit 1; }
    sleep 1
done
OSMO_URL=http://127.0.0.1:9000 SKIP_GPU=1 OSMO_LOGIN_METHOD=token \
    OSMO_TOKEN_FILE="$admin_token_file" bash "$SCRIPT_DIR/verify.sh"
