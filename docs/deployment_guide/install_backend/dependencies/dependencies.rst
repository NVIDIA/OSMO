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

OSMO uses `KAI scheduler <https://github.com/NVIDIA/kai-scheduler>`_ to run AI workflows at very large scale with :ref:`Workflow Groups <tutorials_parallel_workflows_groups>`.

For more information on the scheduler, see :ref:`scheduler`.

Run these commands from the root of an OSMO repository clone. The checked
``deployments/charts/osmo/examples/kai-values.yaml`` file defines the scheduler
and admission behavior tested with OSMO.

The converged Quickstart, Self-contained, and Single-plane guides layer the
checked ``deployments/charts/osmo/examples/kai-selectors.yaml`` file to place
KAI components on nodes labeled ``osmo.nvidia.com/node-pool=control-plane``:

.. code-block:: yaml

  global:
    nodeSelector:
      osmo.nvidia.com/node-pool: control-plane

Install the tested KAI Scheduler release with the common values:

.. code-block:: bash

  helm upgrade --install kai-scheduler \
    https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.3/kai-scheduler-v0.15.3.tgz \
    --namespace kai-scheduler \
    --create-namespace \
    --values deployments/charts/osmo/examples/kai-values.yaml \
    --wait \
    --timeout 10m
  kubectl --namespace kai-scheduler wait \
    --for=condition=Available=True \
    --timeout=10m config.kai.scheduler/kai-config
  kubectl wait --for=condition=Available \
    --timeout=10m schedulingshard/default
  kubectl --namespace kai-scheduler wait \
    --for=condition=Available \
    --timeout=10m deployment --all

Add that selector file after the common ``--values`` option only for clusters
that use the documented converged node labels. Split compute clusters use their
own KAI placement policy. Copy and edit the selector file when a cluster uses a
different label.

.. note::
   For newer compatible versions, refer to the
   `official KAI Scheduler release notes <https://github.com/NVIDIA/kai-scheduler/releases>`__.

Install the GPU Operator
=========================

The `NVIDIA GPU Operator <https://github.com/NVIDIA/gpu-operator>`_ is required
for GPU workloads to be discovered and scheduled.

.. code-block:: bash

  helm repo add nvidia https://nvidia.github.io/gpu-operator
  helm repo update
  helm install gpu-operator nvidia/gpu-operator --namespace gpu-operator --create-namespace

.. note::

   For optional observability components such as Grafana, Prometheus, and Kubernetes Dashboard, see :ref:`adding_observability`.
