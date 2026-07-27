..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _deploy_backend:

===========================
Deploy a Split Compute Plane
===========================

Install the ``osmo`` umbrella chart with the ``split-compute`` profile in each
compute cluster. The profile enables only the backend operator and workflow
namespaces; it does not duplicate the control plane.

Prerequisites
=============

* A reachable OSMO control-plane gateway.
* A Kubernetes Secret containing the same backend token reconciled by the
  control-plane bootstrap principal.
* External Secrets Operator and an NVault-backed SecretStore when using the
  reference profile.
* Working cluster DNS, registry access, and compute-node capacity.
* NVIDIA GPU Operator for GPU pools.
* KAI CRDs only when selecting the optional KAI scheduler.

The backend user and token are declarative chart inputs. Do not create them
imperatively with the OSMO CLI.

Prepare Values
==============

.. code-block:: bash

   $ cp deployments/charts/osmo/profiles/split-compute.yaml osmo-compute.yaml

Set ``computePlane.global.serviceUrl`` to the externally reachable control
gateway. Configure the compute namespace, workflow namespace, backend name,
image versions, scheduler, and ExternalSecret mapping. Both planes must resolve
the same backend token without exposing it in values or command output.

Install
-------

Use the compute cluster's explicit kube context:

.. code-block:: bash

   $ helm dependency build --skip-refresh deployments/charts/osmo
   $ helm lint deployments/charts/osmo --values osmo-compute.yaml
   $ helm template osmo-compute deployments/charts/osmo \
       --kube-context <compute-context> \
       --namespace osmo-agent \
       --values osmo-compute.yaml > /tmp/osmo-compute-rendered.yaml
   $ helm upgrade --install osmo-compute deployments/charts/osmo \
       --kube-context <compute-context> \
       --namespace osmo-agent \
       --create-namespace \
       --values osmo-compute.yaml \
       --wait \
       --rollback-on-failure \
       --timeout 15m

Verify
======

.. code-block:: bash

   $ helm test osmo-compute \
       --kube-context <compute-context> \
       --namespace osmo-agent \
       --logs

The postflight check waits for the backend listener and worker and confirms
that the control plane reports the configured backend online. Submit the CPU
smoke workflow after the check passes. Use the GPU smoke workflow only when the
pool is expected to advertise GPUs.
