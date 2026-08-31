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
CLI, API, and CPU workflow experience with the chart defaults:

Before running Helm, generate the shared service-auth identity and create the
required `osmo-service-auth` Secret by following the
[`osmo` installation steps](osmo/README.md#install-osmo).

```bash
helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --wait \
  --wait-for-jobs \
  --timeout 20m
```

After the first installation bootstraps the retained master-encryption-key
Secret, disable its one-time bootstrap Job and Secret-creation permission:

```bash
helm --kube-context kind-osmo upgrade osmo deployments/charts/osmo \
  --namespace osmo \
  --reuse-values \
  --set secrets.masterEncryptionKey.bootstrap.enabled=false \
  --wait \
  --timeout 20m
```

The default values deploy the UI, gateway, control and compute planes, a
CloudNativePG Cluster, persistent Valkey, and persistent RustFS. They generate
development credentials, create the workflow/log/app buckets, and connect the
backend without a manual Secret copy. The UI and API are exposed through
gateway NodePort `30080`.

See the [`osmo` quick-start guide](osmo/README.md#quick-start) for prerequisite
installation, browser and CLI access, a hello-world workflow, capacity,
troubleshooting, cleanup, and the default quickstart's non-production
limitations.

## Self-contained production

Use `profiles/self-contained.yaml` to host the control plane, compute plane,
PostgreSQL, Valkey, and object storage in one production Kubernetes cluster.
The cluster must provide KAI Scheduler, the CloudNativePG operator, and a
default dynamic StorageClass. It must also provide a NetworkPolicy-enforcing
CNI, at least four schedulable nodes, the cluster network CIDRs, and a TLS edge
in front of the chart's ClusterIP gateway. The current workflow policy requires
IPv4 pod and Service CIDRs. Separately, register an OIDC client with an identity
provider reachable by users and OSMO gateway workloads. The provider may run
inside or outside Kubernetes. Its tokens must contain an array-valued `roles`
claim and assign `osmo-admin` to an initial operator. The chart creates and
retains the workflow namespace and runs OAuth2 authentication plus OSMO
semantic authorization behind the edge.

```bash
kubectl create namespace osmo
kubectl --namespace osmo create secret generic osmo-oauth2-proxy \
  --from-literal=client_secret='<oidc-client-secret>' \
  --from-literal=cookie_secret='<32-byte-random-cookie-secret>'
helm dependency build deployments/charts/osmo
cp deployments/charts/osmo/examples/self-contained-environment-values.yaml \
  self-contained-environment-values.yaml
# Edit self-contained-environment-values.yaml for the target environment.
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --values deployments/charts/osmo/profiles/self-contained.yaml \
  --values self-contained-environment-values.yaml \
  --wait \
  --wait-for-jobs \
  --timeout 30m
```

After the first installation bootstraps the retained master-encryption-key
Secret, persist `secrets.masterEncryptionKey.bootstrap.enabled: false` in the
environment overlay and apply it. The immediate Helm cleanup transaction is:

```bash
helm upgrade osmo deployments/charts/osmo \
  --namespace osmo \
  --reuse-values \
  --set secrets.masterEncryptionKey.bootstrap.enabled=false \
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
