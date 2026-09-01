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

.. _deploy_local:
.. _quickstart:

==========
Quickstart
==========

This development-only Quickstart is the fastest way to try the complete OSMO
control plane, compute plane, and a GPU workflow on a workstation with an
NVIDIA GPU. It creates a multi-node Kubernetes-in-Docker cluster with
``nvkind``, installs the required NVIDIA operators, and deploys the unified
``osmo`` Helm chart.

.. warning::

   This is not a production configuration. It exposes a development
   administrator identity and intentionally disables production security and
   availability features. See :ref:`Capacity and limitations <quickstart_limits>`
   before using it.

Prerequisites
=============

The workstation must have a supported NVIDIA GPU, NVIDIA driver, and NVIDIA
Container Toolkit installed and working with Docker. Follow the ``nvkind``
`prerequisites <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#prerequisites>`_,
`setup <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#setup>`_, and
`installation <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#install-nvkind>`_
instructions before continuing.

Install Docker, ``kind``, ``nvkind``, ``kubectl``, Helm, `Bazelisk
<https://github.com/bazelbuild/bazelisk>`_, and the OSMO CLI installer
dependencies. Bazelisk uses the repository's ``.bazelversion`` to select the
supported Bazel release. The cluster requires Kubernetes 1.30 or newer and a
default dynamic ``StorageClass``. If Docker reports permission errors, ensure
that your user can access the Docker daemon. On Linux, also raise the
`inotify limits <https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files>`_
when creating many containers.

Clone the repository and run the remaining commands from its root:

.. code-block:: bash

   git clone https://github.com/NVIDIA/OSMO.git
   cd OSMO

Create an nvkind cluster
========================

Create the following multi-node configuration. The compute worker receives the
GPU from ``nvkind``. The other workers disable GPU Operator operands, and the
service worker maps gateway NodePort ``30080`` to host port ``80``.

.. dropdown:: ``kind-osmo-cluster-config.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml

    kind: Cluster
    apiVersion: kind.x-k8s.io/v1alpha4
    name: osmo
    nodes:
      - role: control-plane
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=kai-scheduler,nvidia.com/gpu.deploy.operands=false"
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=data,nvidia.com/gpu.deploy.operands=false"
        extraMounts:
          - hostPath: /tmp/localstack-s3
            containerPath: /var/lib/localstack
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=service,nvidia.com/gpu.deploy.operands=false"
        extraPortMappings:
          - containerPort: 30080
            hostPort: 80
            protocol: TCP
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=service,nvidia.com/gpu.deploy.operands=false"
      - role: worker
        extraMounts:
          - hostPath: /dev/null
            containerPath: /var/run/nvidia-container-devices/all
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=compute"

Create the cluster and confirm that ``nvkind`` passes the host GPU through:

.. code-block:: bash

   nvkind cluster create --config-template=kind-osmo-cluster-config.yaml
   nvkind cluster print-gpus
   kubectl --context kind-osmo get storageclass

.. note::

   You can ignore ``umount`` errors from ``nvkind`` if ``nvkind cluster
   print-gpus`` lists the workstation GPUs.

Install cluster dependencies
============================

Install GPU Operator v25.10.1. The host driver and NVIDIA Container Toolkit
are already managed by the ``nvkind`` prerequisites, so disable their in-cluster
management. Version v25.10.1 includes the Kubernetes 1.33 schema-validation
fix required by this quickstart.

.. code-block:: bash

   helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
   helm repo update nvidia
   helm --kube-context kind-osmo upgrade --install gpu-operator nvidia/gpu-operator \
     --version v25.10.1 \
     --namespace gpu-operator \
     --create-namespace \
     --set driver.enabled=false \
     --set toolkit.enabled=false \
     --set nfd.enabled=true \
     --wait \
     --timeout 10m

Install KAI Scheduler v0.14.0 for OSMO workflow scheduling, then install the
CloudNativePG operator chart version 0.29.0 for the embedded PostgreSQL
cluster:

.. code-block:: bash

   helm --kube-context kind-osmo upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --wait \
     --timeout 10m

   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo update cnpg
   helm --kube-context kind-osmo upgrade --install cnpg cnpg/cloudnative-pg \
     --version 0.29.0 \
     --namespace cnpg-system \
     --create-namespace \
     --wait \
     --timeout 10m

Wait for the GPU Operator pods to become Ready and verify that the compute node
advertises one or more allocatable GPUs before installing OSMO:

.. code-block:: bash

   kubectl --context kind-osmo --namespace gpu-operator wait \
     --for=condition=Ready pod --all --timeout=10m
   kubectl --context kind-osmo get nodes -l node_group=compute \
     -o custom-columns=NAME:.metadata.name,ALLOCATABLE_GPUS:.status.allocatable.nvidia\.com/gpu

The ``compute`` node must show a positive ``ALLOCATABLE_GPUS`` value. If it
does not, resolve the NVIDIA driver, Container Toolkit, or GPU Operator problem
before proceeding.

Install OSMO
============

The ``quickstart.yaml`` profile is CPU-only by default. Override its
``default_user`` pod template so OSMO requests the GPU resource in both the
user-container requests and limits. Helm replaces lists instead of merging
them, so the override repeats the complete container resource configuration,
including CPU, memory, GPU, and ephemeral-storage requests and limits.

The unified chart on ``main`` also requires the API image from the same source
revision for master-encryption-key lifecycle operations. The overlay selects
the repository-built image for both the API and its bootstrap Job instead of a
mutable registry image.

.. dropdown:: ``osmo-gpu-pod-template.yaml``
  :color: info
  :icon: file

  .. code-block:: yaml

    configuration:
      podTemplates:
        default_user:
          spec:
            containers:
            - name: '{{USER_CONTAINER_NAME}}'
              resources:
                limits:
                  cpu: '{{USER_CPU}}'
                  memory: '{{USER_MEMORY}}'
                  nvidia.com/gpu: '{{USER_GPU}}'
                  ephemeral-storage: '{{USER_STORAGE}}'
                requests:
                  cpu: '{{USER_CPU}}'
                  memory: '{{USER_MEMORY}}'
                  nvidia.com/gpu: '{{USER_GPU}}'
                  ephemeral-storage: '{{USER_STORAGE}}'
    services:
      api:
        image:
          registry: osmo.local
          repository: service
          tag: latest-x86_64

Save the overlay, build and load the current API image, build the chart
dependencies, and install the unified chart. ``kind load`` copies the image to
every cluster node, and the Quickstart's ``IfNotPresent`` pull policy uses that
local image without contacting a registry:

.. code-block:: bash

   bazel run //src/service/core:service_image_load_x86_64
   kind load docker-image --name osmo osmo.local/service:latest-x86_64
   helm dependency build deployments/charts/osmo
   helm --kube-context kind-osmo upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --create-namespace \
     --values deployments/charts/osmo/profiles/quickstart.yaml \
     --values osmo-gpu-pod-template.yaml \
     --set-string compute.backendName=default \
     --wait \
     --timeout 20m

Confirm that the release, embedded dependencies, and gateway are Ready:

.. code-block:: bash

   kubectl --context kind-osmo --namespace osmo wait \
     --for=condition=Ready cluster/osmo-pg --timeout=10m
   kubectl --context kind-osmo --namespace osmo get pods,pvc,services,jobs
   kubectl --context kind-osmo --namespace osmo get service osmo-gateway

Log in and run a GPU workflow
=============================

The cluster configuration maps the gateway to ``http://127.0.0.1``. Install the
CLI if necessary, log in as the development administrator, select the default
pool, and submit the canonical GPU verification workflow:

.. code-block:: bash

   curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
   osmo login http://127.0.0.1 --method=dev --username=testuser
   osmo profile set pool default
   osmo workflow submit deployments/workflows/verify-gpu.yaml \
     --pool default \
     --format-type json
   osmo workflow query <workflow-id> --format-type json

Repeat the query until the workflow status is ``COMPLETED``. The workflow runs
``nvidia-smi`` in a CUDA container, proving that OSMO and KAI scheduled it onto
the GPU node and that the NVIDIA driver and Container Toolkit are usable.

Troubleshooting
===============

If the GPU workflow remains pending or fails, first verify GPU capacity and
the GPU Operator:

.. code-block:: bash

   kubectl --context kind-osmo get nodes \
     -o custom-columns=NAME:.metadata.name,ALLOCATABLE_GPUS:.status.allocatable.nvidia\.com/gpu
   kubectl --context kind-osmo --namespace gpu-operator get pods
   kubectl --context kind-osmo --namespace osmo get events --sort-by=.lastTimestamp
   kubectl --context kind-osmo --namespace osmo get pods

An allocatable GPU count of zero means the host NVIDIA driver, Container
Toolkit, ``nvkind`` pass-through, or GPU Operator is not ready. Do not run
other GPU workloads until ``verify-gpu.yaml`` completes. For OSMO deployment
problems, inspect the listed pods and events; a pending PostgreSQL, Valkey, or
RustFS PVC usually means the cluster lacks a working default ``StorageClass``.

.. _quickstart_limits:

Capacity and limitations
========================

This profile runs one replica of each required OSMO service and uses generated
development credentials, including the ``testuser`` identity with the
``osmo-admin`` role. It disables TLS, authorization, rate limiting, backups,
monitoring, PodDisruptionBudgets, and autoscaling. It also has no high
availability guarantees. The exposed development administrator identity and
NodePort are suitable only for a disposable local environment.

CloudNativePG, Valkey, and RustFS use persistent volumes supplied by the
``nvkind`` cluster's default StorageClass. Those local volumes, generated
credentials, workflow state, and all other quickstart data disappear when the
cluster is deleted. Do not use this quickstart for production data or any
long-lived environment.

Clean up resources
==================

Remove the OSMO release and the disposable ``nvkind`` cluster:

.. code-block:: bash

   helm --kube-context kind-osmo uninstall osmo --namespace osmo --wait
   nvkind cluster delete --name osmo

Deleting the cluster removes all quickstart data, including its local
persistent volumes and generated credentials.
