<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO chart profiles

The chart defaults provide the development quickstart. Profiles are values-file
overlays, not a `profile` value selected by the chart. Layer environment-specific
values after a base overlay so that the environment values take precedence.

| File | Directly installable | Required environment input |
| --- | --- | --- |
| Chart defaults (`values.yaml`) | Yes, on a development cluster | KAI Scheduler, the CloudNativePG operator, and a default dynamic StorageClass installed separately |
| `self-contained.yaml` | Yes, with production inputs | KAI Scheduler, the CloudNativePG operator, a default dynamic StorageClass, at least four platform nodes plus one compute node, a NetworkPolicy-enforcing CNI, an external OIDC client and Secret with role assignments for production, a TLS edge and public `externalUrl`, and IPv4 cluster CIDRs |
| `single-plane.yaml` | Base overlay | Site-specific external PostgreSQL, Valkey, and object-storage locations; required Kubernetes Secrets for static authentication; `externalUrl`; `compute.backendName`; and separate platform/compute node labels |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl`, a compute authentication Secret, and `compute.backendName` in environment-specific values |

The default values are the smallest complete control-and-compute deployment
for browser, CLI, and CPU hello-world verification. It exposes the UI and API
through gateway NodePort `30080` while omitting optional production behavior.
It intentionally uses `latest` OSMO images, one replica per component,
development authentication, bootstrapped service auth, and small
single-node stateful dependencies.
For maximum recovery robustness, keep each production credential's source of
truth in your organization's secret manager and provision its Kubernetes Secret
before installation. The chart's bootstrap mechanism remains available as a
convenience when external provisioning is not used. The single-plane and split
profiles default service auth to external management, while an environment
overlay can select OSMO-managed service auth for initial setup. The quickstart
generates its application credentials for evaluation.

The self-contained profile is the converged path for environments that host
OSMO and its stateful dependencies in Kubernetes. It uses chart-version OSMO
images, production service defaults, a synchronous three-instance PostgreSQL
Cluster, replicated fixed-primary Valkey, four-node distributed RustFS,
semantic authorization, and network isolation. The profile creates and retains
its workflow namespace. Embedded Dex uses volatile memory storage and is
intended for development and evaluation only. Dex restarts invalidate active
sessions and signing keys. Production deployments should use
`authentication.provider: externalOidc`; the complete endpoint and
existing-Secret contract belongs in an environment values file. Production
operators must also provide and test backup and restore for the stateful
volumes and retained Secrets.

`single-plane.yaml` enables both planes with externally managed dependencies.
It is not directly installable: layer it before a site-specific values file
that supplies the required dependency locations, connection details, and public
URL. It defaults to embedded Dex, or a site can deliberately select
`authentication.provider: externalOidc` and supply the external IdP contract.
Object storage defaults to static Secret authentication;
sites using a cloud SDK identity can set
`externalDependencies.objectStorage.authentication.type: sdkDefault` instead.
The gateway is a ClusterIP and the profile creates no Ingress or HTTPRoute.
Authentication and authorization are mandatory for its control plane; sites
configure public exposure and TLS through their environment-specific overlay.
The example uses Helm 4's `--wait=legacy`; with Helm 3, replace it with
`--wait`. For example:

```bash
helm repo add osmo-dex https://charts.dexidp.io
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm repo add osmo-rustfs https://charts.rustfs.com
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --values deployments/charts/osmo/profiles/single-plane.yaml \
  --values deployments/charts/osmo/examples/node-selectors.yaml \
  --values single-plane-azure.yaml \
  --wait=legacy --wait-for-jobs --timeout 30m
```

`split-plane-control.yaml` is the reusable HA control-plane base profile. It
uses the chart application version for OSMO images, disables the compute plane
and embedded stateful dependencies, and configures control-plane autoscaling,
disruption budgets, and topology spreading. Layer site-specific dependency,
identity-provider, public URL, and gateway values after it.

KAI Scheduler 0.15.3 is a prerequisite for every profile that enables the
compute plane. Install it with `examples/kai-values.yaml`; for converged
clusters with the documented node labels, layer `examples/kai-selectors.yaml`
after it. Layer `examples/node-selectors.yaml` after the chart defaults or a
converged profile and before site values to separate platform and workflow
Pods. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
