<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO chart profiles

Profiles are values-file overlays, not a `profile` value selected by the chart.
Layer environment-specific values after a base overlay so that the environment
values take precedence.

| File | Directly installable | Required environment input |
| --- | --- | --- |
| `quickstart.yaml` | Yes, on a development cluster | KAI Scheduler, the CloudNativePG operator, and a default dynamic StorageClass installed separately; `compute.backendName` set explicitly at install time |
| `kind-self-contained.yaml` | Yes, on kind | KAI Scheduler and the CloudNativePG operator installed separately; `compute.backendName` set explicitly at install time |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl`, a compute authentication Secret, and `compute.backendName` set explicitly at install time |

The quick-start profile is the smallest complete control-and-compute deployment
for browser, CLI, and CPU hello-world verification. It exposes the UI and API
through gateway NodePort `30080` while omitting other optional services. The kind
profile retains a broader local-development surface. Both profiles are
development-only and intentionally use `latest` OSMO images by default, one
replica per component, generated credentials, and embedded stateful dependencies.
The quick-start installation path uses the chart's default image settings and
does not require application Secrets or an image-pull Secret to be created
beforehand. Configure top-level `imagePullSecrets` only when using a registry
that requires credentials. The split
profiles contain example names and endpoints; copy them into an environment
values file before installation.

KAI Scheduler is a prerequisite for every profile that enables the compute
plane. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
