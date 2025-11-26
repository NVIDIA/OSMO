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
Install Dependencies
================================


.. admonition:: Prerequisites
  :class: important

  - An operational Kubernetes cluster with recommended instance types (see :ref:`create_backend`)
  - `Helm <https://helm.sh/docs/intro/install>`_ CLI installed


.. _installing_kai:

Install KAI Scheduler
======================

OSMO uses `KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_ to run AI workflows at very large scale with `Workflow Groups <https://nvidia.github.io/OSMO/user_guide/main/tutorials/parallel_workflows/index.html#groups>`_.

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
    - --update-pod-eviction-condition=true  # Enable OSMO to read preemption conditions

Next, install KAI using ``helm``

.. code-block:: bash

  helm fetch oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler --version <insert-chart-version>
  helm upgrade --install kai-scheduler kai-scheduler-<insert-chart-version>.tgz \
    --create-namespace -n kai-scheduler \
    --values kai-selectors.yaml

.. note::
   Replace ``<insert-chart-version>`` with the actual chart version.
   OSMO supports up to date chart versions.
   For more information on the chart version, refer to the `official KAI scheduler release notes <https://github.com/NVIDIA/kai-scheduler/releases>`__.

Install the GPU Operator
=========================

The `NVIDIA GPU-Operator <https://github.com/NVIDIA/gpu-operator>`_ is required for GPU workloads to be discovered and scheduled on the Kubernetes cluster.

.. code-block:: bash

  helm repo add nvidia https://nvidia.github.io/gpu-operator
  helm repo update
  helm install gpu-operator nvidia/gpu-operator --namespace gpu-operator --create-namespace

.. note::

   For optional observability components such as Grafana, Prometheus, and Kubernetes Dashboard, see :ref:`adding_observability`.

