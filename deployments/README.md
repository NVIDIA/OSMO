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

# OSMO deployments

The deployment entry point is the Kubernetes-native
[`osmo` umbrella chart](charts/osmo/README.md). It installs OSMO into an
existing Kubernetes cluster without Terraform or cloud-provider-specific
bootstrap logic.

```bash
helm dependency build --skip-refresh charts/osmo
helm upgrade --install osmo charts/osmo \
  --namespace osmo-system \
  --create-namespace \
  --values charts/osmo/profiles/single-node.yaml \
  --wait
```

The chart includes validated reference values for a development single-node
cluster, a minimal production-shaped installation, and both sides of a
split-plane installation.

It defaults to the built-in Kubernetes scheduler. KAI is optional and its CRDs,
RBAC, and PriorityClasses are only required when explicitly selected. Secrets
are consumed through standard Kubernetes Secret references; production
profiles can render External Secrets against an NVault-backed SecretStore.

## Scope

Helm owns OSMO resources inside Kubernetes:

- OSMO services and backend operators;
- namespaces and Kubernetes RBAC;
- references to databases, Redis, object storage, identity, and image
  registries;
- ExternalSecret resources; and
- preflight, postflight, and `helm test` verification.

The chart does not create clusters, networks, managed databases, cloud IAM
principals, DNS zones, or secret stores. Those remain optional platform inputs
exposed through portable Kubernetes interfaces.

## Installation contract

OSMO does not ship a cluster provisioner or a provider-specific deployment
wrapper. Platform teams may use any infrastructure tooling that produces the
Kubernetes and external-service prerequisites described by the chart. New
installation behavior belongs in the chart, its profiles, or its verification
hooks.

## Design

The rationale, target architecture, workstreams, sequencing, and exit criteria
are in
[`projects/kubernetes-native-deployment-plan.md`](../projects/kubernetes-native-deployment-plan.md).
