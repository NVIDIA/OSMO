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
| `single-plane.yaml` | Base overlay | Site-specific external PostgreSQL, Valkey, and object-storage locations; Kubernetes Secrets; `externalUrl`; and `compute.backendName` |
| `split-plane-control.yaml` | Base overlay | PostgreSQL, Valkey, and object-storage endpoints; Kubernetes Secrets; and `externalUrl` |
| `split-plane-compute.yaml` | Base overlay | A control-plane `externalUrl`, a compute authentication Secret, and `compute.backendName` set explicitly at install time |

The quick-start profile is the smallest complete control-and-compute deployment
for browser, CLI, and CPU hello-world verification. It exposes the UI and API
through gateway NodePort `30080` while omitting other optional services. The kind
profile retains a broader local-development surface. Both profiles are
development-only and intentionally use `latest` OSMO images, one replica per
component, generated credentials, and embedded stateful dependencies. The split
profiles contain example names and endpoints; copy them into an environment
values file before installation.

`single-plane.yaml` enables both planes with externally managed dependencies.
It is provider-neutral and is not directly installable: layer it before a
site-specific values file that supplies the required dependency locations and
connection details. For example:

```bash
helm upgrade --install osmo deployments/charts/osmo \
  --values deployments/charts/osmo/profiles/single-plane.yaml \
  --values single-plane-azure.yaml
```

KAI Scheduler is a prerequisite for every profile that enables the compute
plane. The unified chart does not install or manage KAI. CloudNativePG must also
be installed before enabling the embedded PostgreSQL Cluster.
