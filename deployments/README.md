<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO deployments

The [unified osmo chart](charts/osmo/README.md) owns control-plane and compute-plane
services, configuration, credentials and optional embedded dependencies. Choose its
[profiles](charts/osmo/profiles/README.md) for development, converged production or
split-plane installations.

For scripted development deployment, use [deploy-osmo.sh](scripts/README.md). It
supports Azure/AWS infrastructure and existing Kubernetes clusters.
Use `deploy-osmo-single-plane.sh --provider azure|aws` for an authenticated
single-plane cloud deployment. The [Azure path](scripts/README.md#azure-single-plane-deployment)
uses workload identity and is exercised by Azure CI; the
[AWS path](scripts/README.md#aws-single-plane-deployment) uses managed RDS/ElastiCache
and private S3 storage. The minimal wrapper and MicroK8s bootstrap were removed.

```bash
# From the repository root, against an existing development cluster
bash deployments/scripts/deploy-osmo.sh --provider byo --no-gpu
```

The [Terraform modules](terraform/) provision cloud infrastructure. Scheduler/GPU
prerequisites remain separate from the OSMO chart. Workflow verification scripts and
sample workflows live in [scripts](scripts/) and [workflows](workflows/).

Existing installations using the standalone [service](charts/service/README.md) and
[backend-operator](charts/backend-operator/README.md) charts retain those charts and
their migration procedures. The new installer does not adopt legacy releases or
convert their data and Secrets automatically. See the [script migration notes](scripts/README.md#existing-releases-and-teardown).
