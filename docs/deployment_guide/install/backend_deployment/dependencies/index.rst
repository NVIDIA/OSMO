..
  SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _installing_required_dependencies:

================================
Install Required Dependencies
================================

Before the execution cluster can be registered to OSMO, its dependencies must be installed through Helm charts.
In addition, secrets must be installed to allow OSMO to download the necessary Docker images, to connect to
your organization's OIDC provider, and to allow OSMO to connect to the database.

Prerequisites
========================================
- A running Kubernetes cluster
- `Helm <https://helm.sh/docs/intro/install>`_ CLI installed
- `NVIDIA GPU-Operator <https://github.com/NVIDIA/gpu-operator>`_ installed in order to schedule workloads that request GPU resources


Install the Extended k8s Scheduler
===================================

Installing a Kubernetes scheduler that is extended with gang scheduling allows OSMO to efficiently
schedule groups.

For more information on the scheduler, see :ref:`scheduler`.

Create a file called ``kai-selectors.yaml`` with node selectors / tolerations to specify which
nodes the KAI scheduler should run on.

.. code-block:: yaml

  global:
    # Modify the node selectors and tolerations to match your cluster
    nodeSelector: {}
    tolerations: []

  scheduler:
    additionalArgs:
    - --default-staleness-grace-period=-1s  # Disable stalegangeviction

Next, install KAI using ``helm``

.. code-block:: bash

  helm fetch oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler --version v0.5.5
  helm upgrade --install kai-scheduler kai-scheduler-v0.5.5.tgz \
    --create-namespace -n kai-scheduler \
    --values kai-selectors.yaml
