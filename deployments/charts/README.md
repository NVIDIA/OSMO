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

The proposed installation entry point is the
[`osmo` umbrella chart](osmo/README.md). It composes compatible versions of the
`service` control-plane chart and the `backend-operator` compute-plane chart so
a converged deployment can be installed as one Helm release:

```bash
helm dependency build deployments/charts/osmo
helm upgrade --install osmo deployments/charts/osmo \
  --namespace osmo-system \
  --create-namespace \
  --values deployments/charts/osmo/profiles/single-node.yaml \
  --wait
```

The shipped profiles cover single-node, minimal, split-control, and
split-compute installations. Secrets are either supplied as existing
Kubernetes Secrets, reconciled by External Secrets from NVault, or generated
and retained for the development-only single-node profile. The MEK is always
stored in a Secret.

The component charts remain independently installable for split-plane
deployments and migration compatibility:

1. `service` deploys the OSMO control plane, gateway, UI, workers, and optional
   embedded stateful dependencies.
2. `backend-operator` connects a Kubernetes compute cluster to an OSMO control
   plane and manages workflow resources.

New installations should start with the umbrella chart and one of its
validated profiles. See its README for the Secret contract, scheduler choices,
verification hooks, and the boundary between Helm and platform
infrastructure.
