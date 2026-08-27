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

The `osmo` chart is the unified deployment entry point. It supports control-only,
compute-only, and converged installations with directly owned control and
compute templates. The legacy `service` and standalone `backend-operator`
charts remain available for existing deployments; neither is a dependency of
the unified chart.

## Quick start

For an existing development cluster with KAI Scheduler, the CloudNativePG
operator, and a default dynamic StorageClass, install the complete browser,
CLI, API, and CPU workflow experience with one unified OSMO release:

```bash
helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/quickstart.yaml \
  --set-string compute.backendName=default \
  --wait \
  --timeout 20m
```

The profile deploys the UI, gateway, control and compute planes, a CloudNativePG
Cluster, persistent Valkey, and persistent RustFS. It generates development
credentials, creates the workflow/log/app buckets, and connects the backend
without a manual Secret copy. The UI and API are exposed through gateway
NodePort `30080`.

See the [`osmo` quick-start guide](osmo/README.md#quick-start) for prerequisite
installation, browser and CLI access, a hello-world workflow, capacity,
troubleshooting, cleanup, and the profile's non-production limitations.

## Self-contained production

Use `profiles/self-contained.yaml` to host the control plane, compute plane,
PostgreSQL, Valkey, and object storage in one production Kubernetes cluster.
The cluster must provide KAI Scheduler, the CloudNativePG operator, and a
default dynamic StorageClass. It must also provide a NetworkPolicy-enforcing
CNI, an OIDC client, a dedicated workflow namespace, the cluster network CIDRs,
and a TLS edge in front of the chart's ClusterIP gateway. The current workflow
policy requires IPv4 pod and Service CIDRs. The IdP must emit an array-valued
`roles` claim and assign `osmo-admin` to an initial operator. The chart runs
OAuth2 authentication and OSMO semantic authorization behind that edge.

```bash
kubectl create namespace osmo
kubectl create namespace osmo-workflows
kubectl --namespace osmo create secret generic osmo-oauth2-proxy \
  --from-literal=client_secret='<oidc-client-secret>' \
  --from-literal=cookie_secret='<32-byte-random-cookie-secret>'
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --values deployments/charts/osmo/profiles/self-contained.yaml \
  --set-string externalUrl=https://osmo.example.com \
  --set-string compute.backendName=default \
  --set-string gateway.oauth2Proxy.oidcIssuerUrl=https://idp.example.com \
  --set-string gateway.oauth2Proxy.clientId=osmo \
  --set-string gateway.envoy.idp.host=idp.example.com \
  --set-string 'gateway.envoy.jwt.providers[1].issuer=https://idp.example.com' \
  --set-string 'gateway.envoy.jwt.providers[1].audience=osmo' \
  --set-string 'gateway.envoy.jwt.providers[1].jwks_uri=https://idp.example.com/.well-known/jwks.json' \
  --set-string 'gateway.envoy.jwt.providers[1].cluster=idp' \
  --set-string 'gateway.envoy.jwt.providers[1].user_claim=preferred_username' \
  --set-string 'compute.workflowNetworkPolicy.clusterCIDRs[0]=10.0.0.0/8' \
  --wait \
  --timeout 30m
```

See the [`osmo` self-contained guide](osmo/README.md#self-contained-production)
for availability, storage, identity, network-isolation, backup, and edge details.

## Other production shapes

For production, use environment-specific unified chart values or the legacy
chart interfaces required by an existing deployment:

- Set `externalUrl` to the hostname served by the gateway.
- Provide managed PostgreSQL, Valkey, object storage, and Kubernetes Secrets.
- Enable OAuth2 and authorization when exposing OSMO to untrusted networks.
- Configure `externalUrl` to the gateway reachable from a compute-only cluster.
  Converged compute uses the release gateway Service DNS automatically.
- Provision one backend bootstrap Secret per compute plane in both the control
  and compute clusters. Configure the unified chart's
  `secrets.backendApiTokens.credentials[].existingSecret.name`
  and `compute.authentication.existingSecret` to consume the matching Secret.
  The self-contained profile can generate these namespace-local Secrets when
  both planes run in one cluster.
