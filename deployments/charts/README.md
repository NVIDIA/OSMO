<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0
-->

# NVIDIA OSMO Helm Charts

OSMO is deployed with two public charts:

1. `service` deploys the core OSMO control plane, gateway, UI, router, worker, logger, agent, and optional local PostgreSQL, Redis, and LocalStack S3 dependencies.
2. `backend-operator` connects a Kubernetes backend to the OSMO service and manages workflow workloads.

Install the service chart first, wait for it to become healthy, then install the backend operator with a service URL and credentials that point back to the service release.

## Local KIND Example

The former quick-start values are preserved as chart-specific values files:

- `service/quick-start-values.yaml`
- `backend-operator/quick-start-values.yaml`

Create the namespaces, the local admin password Secret, and the shared backend
token Secret used by the service and operator. The service quick-start values
create the MEK Secret inside Kubernetes through its chart-managed test mode:

```bash
kubectl create namespace osmo --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace osmo-test --dry-run=client -o yaml | kubectl apply -f -
LOCAL_ADMIN_PASSWORD=$(dd if=/dev/urandom bs=32 count=1 2>/dev/null | base64 | tr -d '\n=' | head -c 43)
kubectl create secret generic local-admin-password \
  --namespace osmo \
  --from-literal=password="$LOCAL_ADMIN_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -
BACKEND_TOKEN_FILE=$(mktemp)
BACKEND_PREVIOUS_TOKEN_FILE=$(mktemp)
BACKEND_INVALID_TOKEN_FILE=$(mktemp)
chmod 600 "$BACKEND_TOKEN_FILE" "$BACKEND_PREVIOUS_TOKEN_FILE" \
  "$BACKEND_INVALID_TOKEN_FILE"
trap 'rm -f "$BACKEND_TOKEN_FILE" "$BACKEND_PREVIOUS_TOKEN_FILE" \
  "$BACKEND_INVALID_TOKEN_FILE"' EXIT

validate_backend_token_file() {
  local token_file=$1
  local token_key=$2
  local token_length
  token_length=$(wc -c < "$token_file" | tr -d ' ')
  LC_ALL=C tr -d 'A-Za-z0-9_-' < "$token_file" > "$BACKEND_INVALID_TOKEN_FILE"
  if { [ "$token_length" -ne 43 ] && [ "$token_length" -ne 64 ]; } || \
      [ -s "$BACKEND_INVALID_TOKEN_FILE" ]; then
    echo "Secret backend-operator-token key $token_key must be 43 or 64 URL-safe base64 characters." >&2
    return 1
  fi
}

load_and_validate_backend_token_secret() {
  local secret_keys
  if ! kubectl get secret backend-operator-token --namespace osmo \
      -o 'go-template={{index .data "token" | base64decode}}' \
      > "$BACKEND_TOKEN_FILE"; then
    echo 'Failed to read Secret backend-operator-token key token.' >&2
    return 1
  fi
  if ! secret_keys=$(kubectl get secret backend-operator-token \
      --namespace osmo \
      -o 'go-template={{range $key, $_ := .data}}{{printf "%s\n" $key}}{{end}}'); then
    echo 'Failed to inspect Secret backend-operator-token.' >&2
    return 1
  fi
  validate_backend_token_file "$BACKEND_TOKEN_FILE" token || return 1
  if printf '%s\n' "$secret_keys" | grep -qx previous-token; then
    if ! kubectl get secret backend-operator-token --namespace osmo \
        -o 'go-template={{index .data "previous-token" | base64decode}}' \
        > "$BACKEND_PREVIOUS_TOKEN_FILE"; then
      echo 'Failed to read Secret backend-operator-token key previous-token.' >&2
      return 1
    fi
    validate_backend_token_file "$BACKEND_PREVIOUS_TOKEN_FILE" previous-token || return 1
    if cmp -s "$BACKEND_TOKEN_FILE" "$BACKEND_PREVIOUS_TOKEN_FILE"; then
      echo 'Secret backend-operator-token contains duplicate token values.' >&2
      return 1
    fi
  fi
}

if ! BACKEND_TOKEN_SECRET_MARKER=$(kubectl get secret backend-operator-token \
    --namespace osmo --ignore-not-found=true \
    -o 'go-template={{if .metadata.name}}present{{end}}'); then
  echo 'Failed to check Secret backend-operator-token.' >&2
  exit 1
fi

if [ "$BACKEND_TOKEN_SECRET_MARKER" = present ]; then
  load_and_validate_backend_token_secret || exit 1
else
  openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' > "$BACKEND_TOKEN_FILE"
  validate_backend_token_file "$BACKEND_TOKEN_FILE" token || exit 1
  if ! kubectl create secret generic backend-operator-token \
      --namespace osmo --from-file=token="$BACKEND_TOKEN_FILE"; then
    echo 'Secret creation failed; checking for a concurrent valid Secret.' >&2
    if ! load_and_validate_backend_token_secret; then
      echo 'Failed to create a valid Secret backend-operator-token.' >&2
      exit 1
    fi
  fi
fi

if ! kubectl get secret backend-operator-token --namespace osmo >/dev/null; then
  echo 'Secret backend-operator-token is unavailable after provisioning.' >&2
  exit 1
fi
rm -f "$BACKEND_TOKEN_FILE" "$BACKEND_PREVIOUS_TOKEN_FILE" \
  "$BACKEND_INVALID_TOKEN_FILE"
trap - EXIT
```

Install the service chart:

```bash
helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
helm repo update osmo

helm upgrade --install osmo osmo/service \
  --namespace osmo \
  -f service/quick-start-values.yaml \
  --wait \
  --timeout 25m
```

Install the backend operator after the service deployment is available:

```bash
helm upgrade --install osmo-backend-operator osmo/backend-operator \
  --namespace osmo \
  -f backend-operator/quick-start-values.yaml \
  --wait \
  --timeout 10m
```

For local browser and CLI access, point `quick-start.osmo` and `localstack-s3.osmo` at your local machine:

```bash
echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts
echo "127.0.0.1 localstack-s3.osmo" | sudo tee -a /etc/hosts
```

The service chart exposes the gateway through NodePort `30080` in these values. A KIND cluster must map host port `80` to that NodePort for `http://quick-start.osmo` access without port forwarding.

After installing the CLI and logging in, set the local demo defaults:

```bash
osmo login http://quick-start.osmo --method=dev --username=testuser
osmo profile set pool default
osmo credential set osmo --type DATA --payload \
  access_key_id=test \
  access_key=test \
  endpoint=s3://osmo \
  override_url=http://localstack-s3.osmo:4566 \
  region=us-east-1
```

The quick-start values use the chart-managed LocalStack S3 service and already
include OSMO's workflow, log, and app storage config. Do not run
`deployments/scripts/configure-storage.sh` for this local flow. If you replace
LocalStack with an external S3, Azure Blob, or BYO storage backend, run
`deployments/scripts/configure-storage.sh` before the service Helm install and
pass its generated values file after your base values file.

MEK bootstrap is safe only for this disposable flow's new, empty PostgreSQL
data. A Helm reinstall or a different release name can still target retained
data; restore its original MEK Secret rather than asking the hook to generate a
new key.

These values assume the OSMO images are pullable without a registry Secret. If
your registry requires credentials, create a Kubernetes image pull Secret and
pass `--set global.imagePullSecret=<secret-name>` to both chart installs.

## Production Shape

For production, use your environment-specific values instead of the local quick-start values:

- Set `global.hostname` to the external hostname served by the gateway.
- Provide managed PostgreSQL, Redis, and object storage settings or enable the chart-managed development dependencies only for non-production use.
- Enable OAuth2/authz in the service chart when exposing OSMO to untrusted networks.
- Configure `backend-operator.global.serviceUrl` to the service gateway URL reachable from the backend cluster.
- Provision one backend bootstrap Secret per compute plane in both the control
  and compute clusters. Configure the service chart's
  `services.backendApiTokens.credentials[].existingSecret.name`
  and `backend-operator.global.accountTokenSecret` to consume the matching Secret.
  Helm only consumes these Secrets and never creates or modifies credential data.
