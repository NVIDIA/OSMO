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
| `kind-self-contained.yaml` | Yes, on kind | KAI Scheduler and the CloudNativePG operator installed separately |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl` and a compute authentication Secret |

The kind profile is development-only and intentionally uses `latest` OSMO
images, one replica per component, retained generated credentials, and embedded
stateful dependencies. The split profiles contain example names and endpoints;
copy them into an environment values file before installation.

KAI Scheduler is a prerequisite for every profile that enables the compute
plane. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
