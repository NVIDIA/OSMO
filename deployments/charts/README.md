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
compute-only, and converged installations by composing the independent
`backend-operator` chart with the OSMO control services. The legacy `service`
and standalone `backend-operator` charts remain available for existing
deployments.

## Local kind example

The development flow assumes KAI Scheduler is already installed. Install the
CloudNativePG operator separately, then install one unified OSMO release:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo update cnpg
helm --kube-context kind-osmo upgrade --install cnpg cnpg/cloudnative-pg \
  --version 0.29.0 \
  --namespace cnpg-system \
  --create-namespace \
  --wait \
  --timeout 10m

helm dependency build deployments/charts/osmo
helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
  --namespace osmo \
  --create-namespace \
  --values deployments/charts/osmo/profiles/kind-self-contained.yaml \
  --wait \
  --timeout 20m
```

The profile deploys the control and compute planes, a CloudNativePG Cluster,
Valkey, and RustFS. It generates retained development credentials, creates the
workflow/log/app buckets, and connects the backend with no manual Secret copy.
It is not a production identity or high-availability profile.

Forward the gateway and submit the repository smoke workflow:

```bash
kubectl --context kind-osmo --namespace osmo \
  port-forward service/osmo-gateway 8080:80
osmo login http://127.0.0.1:8080 --method=dev --username=testuser
osmo workflow submit deployments/workflows/verify-hello.yaml --pool default
```

See [`osmo/README.md`](osmo/README.md) for readiness checks, workflow status,
credential recovery, uninstall behavior, and the split-compute external URL and
Secret interface.

## Production Shape

For production, use environment-specific unified chart values or the legacy
chart interfaces required by an existing deployment:

- Set `externalUrl` to the hostname served by the gateway.
- Provide managed PostgreSQL, Valkey, object storage, and Kubernetes Secrets.
- Enable OAuth2 and authorization when exposing OSMO to untrusted networks.
- Configure `computePlane.global.serviceUrl` to the gateway reachable from the
  compute cluster.
- Provision one backend bootstrap Secret per compute plane in both the control
  and compute clusters. Configure the unified chart's
  `services.backendApiTokens.credentials[].existingSecret.name`
  and `computePlane.global.accountTokenSecret` to consume the matching Secret.
  Managed backend-token and MEK generation is intended only for single-cluster
  development where both planes consume namespace-local Secrets.
