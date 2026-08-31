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
| `self-contained.yaml` | Yes, with production inputs | KAI Scheduler, the CloudNativePG operator, a default dynamic StorageClass, at least four schedulable nodes, a NetworkPolicy-enforcing CNI, an OIDC client and Secret with role assignments, an `osmo-service-auth` Secret generated as documented, a TLS edge and public `externalUrl`, and IPv4 cluster CIDRs |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl`, a compute authentication Secret, and `compute.backendName` set explicitly at install time |

The default values are the smallest complete control-and-compute deployment
for browser, CLI, and CPU hello-world verification. It exposes the UI and API
through gateway NodePort `30080` while omitting optional production behavior.
It intentionally uses `latest` OSMO images, one replica per component,
development authentication, explicitly generated service auth, and small
single-node stateful dependencies.
The quick-start installation path requires the documented pre-created
`osmo-service-auth` Secret. It generates its other application credentials and
does not require an image-pull Secret beforehand. Configure top-level
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

KAI Scheduler is a prerequisite for every profile that enables the compute
plane. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
