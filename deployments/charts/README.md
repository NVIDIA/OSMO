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

Create the namespaces and the local backend-operator password secret:

```bash
kubectl create namespace osmo --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace osmo-test --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret generic backend-operator-password \
  --namespace osmo \
  --from-literal=password=osmo \
  --dry-run=client -o yaml | kubectl apply -f -
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

## Production Shape

For production, use your environment-specific values instead of the local quick-start values:

- Set `global.hostname` to the external hostname served by the gateway.
- Provide managed PostgreSQL, Redis, and object storage settings or enable the chart-managed development dependencies only for non-production use.
- Enable OAuth2/authz in the service chart when exposing OSMO to untrusted networks.
- Configure `backend-operator.global.serviceUrl` to the service gateway URL reachable from the backend cluster.
- Use `backend-operator.global.loginMethod` with either password or token credentials stored in Kubernetes Secrets.
