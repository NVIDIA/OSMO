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
| Chart defaults (`values.yaml`) | Yes, on a development cluster | KAI Scheduler, the CloudNativePG operator, and a default dynamic StorageClass installed separately; pre-created service auth or the one-time fresh-install overlay |
| `self-contained.yaml` | Yes, with production inputs | KAI Scheduler, the CloudNativePG operator, a default dynamic StorageClass, at least four schedulable nodes, a NetworkPolicy-enforcing CNI, an OIDC client and Secret with role assignments, pre-created service auth or the one-time fresh-install overlay, a TLS edge and public `externalUrl`, and IPv4 cluster CIDRs |
| `fresh-install-service-auth.yaml` | No; one-time overlay | A new installation backed by a fresh database; never use for upgrade, recovery, or a retained database |
| `single-plane.yaml` | Base overlay | Site-specific external PostgreSQL, Valkey, and object-storage locations; required Kubernetes Secrets for static authentication; `externalUrl`; and `compute.backendName` |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl`, a compute authentication Secret, and `compute.backendName` set explicitly at install time |

The default values are the smallest complete control-and-compute deployment
for browser, CLI, and CPU hello-world verification. It exposes the UI and API
through gateway NodePort `30080` while omitting optional production behavior.
It intentionally uses `latest` OSMO images, one replica per component,
development authentication, explicitly generated service auth, and small
single-node stateful dependencies.
The documented first-install quick-start path layers the one-time service-auth
overlay to bootstrap the identity in-cluster. The chart defaults themselves
remain external/bootstrap-off so they are safe to reuse for upgrades. The path
generates its other application credentials and does not require an image-pull
Secret to be created beforehand. Configure top-level
`imagePullSecrets` only when using a registry that requires credentials.

The self-contained profile is the production-converged path for environments
that host OSMO and its stateful dependencies in Kubernetes. It uses chart-version
OSMO images, production service defaults, a synchronous three-instance
PostgreSQL Cluster, replicated fixed-primary Valkey, four-node distributed
RustFS, OAuth2 authentication, semantic authorization, and network isolation.
The profile creates and retains its workflow namespace. Register an OIDC client
with an identity provider reachable by users and the OSMO gateway; the provider
may run inside or outside Kubernetes. Its tokens must contain an array-valued
`roles` claim; assign at least one trusted operator the external `osmo-admin`
role before exposing the service. The split profiles contain example names and
endpoints; copy them into an environment values file before installation.
Production operators must also provide and test backup and restore for the
stateful volumes.

`single-plane.yaml` enables both planes with externally managed dependencies.
It is provider-neutral and is not directly installable: layer it before a
site-specific values file that supplies the required dependency locations and
connection details. Object storage defaults to static Secret authentication;
sites using a cloud SDK identity can set
`externalDependencies.objectStorage.authentication.type: sdkDefault` instead.
The profile requires JWT authentication and configures the OSMO service's local
JWKS endpoint as its provider. Its gateway is a ClusterIP and it creates no
Ingress or HTTPRoute. Sites can replace or extend the local provider and enable
authorization and TLS through their environment-specific authentication
overlay before exposing the gateway.
For example:

```bash
helm upgrade --install osmo deployments/charts/osmo \
  --values deployments/charts/osmo/profiles/single-plane.yaml \
  --values single-plane-azure.yaml
```

KAI Scheduler is a prerequisite for every profile that enables the compute
plane. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
