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

Try OSMO on your local workstation — no cloud account, no infrastructure costs, no enterprise approval needed.

This Quickstart is the fastest way to try the complete OSMO platform locally.
It creates a multi-node Kubernetes-in-Docker cluster with KIND or ``nvkind``
and deploys the unified ``osmo`` Helm chart.

.. tip::
   **Perfect for evaluation** – Test your workflows, explore the platform, and assess fit for your robotics development needs before cloud deployment of OSMO.

.. warning::
   Local deployment is **not** recommended for production use as it lacks authentication and has limited features.

Why Deploy Locally?
===================

Local deployment provides the complete OSMO experience on your workstation:

✓ **Full workflow orchestration** – Task dependencies, parallel execution, state management

✓ **Real containerized execution** – Your Docker images running in local Kubernetes

✓ **Complete data management** – Local object storage for workflow inputs, outputs, and artifacts

✓ **The same YAML workflows** that scale to cloud environments

✓ **Zero cloud costs** – Everything runs on your workstation

.. admonition:: Seamless Scale to Cloud
   :class: info

   If OSMO works for your use case locally, it will scale to hundreds of GPUs in the cloud. You can use the **exact same workflows**; no code changes required.

Prerequisites
=============

Install the following tools on your workstation:

* `Docker <https://docs.docker.com/get-started/get-docker/>`_ - Container runtime (>=28.3.2)
* `KIND <https://kind.sigs.k8s.io/docs/user/quick-start/#installation>`_ - Kubernetes in Docker (>=0.29.0)
* `kubectl <https://kubernetes.io/docs/tasks/tools/>`_ - Kubernetes command-line tool (>=1.32.2)
* `helm <https://helm.sh/docs/intro/install/>`_ - Helm package manager (>=3.16.2)

The resulting cluster requires Kubernetes 1.30 or newer and a default dynamic
``StorageClass``.

.. important::

   **System Configuration**:

   1. `Raise inotify limits <https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files>`_ to prevent "too many open files" errors.
   2. `Ensure your user has Docker permissions <https://kind.sigs.k8s.io/docs/user/known-issues/#docker-permission-denied>`_.

Clone the repository and run the remaining commands from its root:

.. code-block:: bash

   git clone https://github.com/NVIDIA/OSMO.git
   cd OSMO

Step 1: Create KIND Cluster
===========================

Choose the appropriate setup based on whether your workstation has a GPU.

Option A: GPU Workstations (with nvkind)
-----------------------------------------

If your workstation has a supported NVIDIA GPU, install the NVIDIA driver and
NVIDIA Container Toolkit and confirm that they work with Docker. Install
``nvkind`` by following its `prerequisites
<https://github.com/NVIDIA/nvkind?tab=readme-ov-file#prerequisites>`_, `setup
<https://github.com/NVIDIA/nvkind?tab=readme-ov-file#setup>`_, and `installation
<https://github.com/NVIDIA/nvkind?tab=readme-ov-file#install-nvkind>`_ guides.

**Create Cluster Configuration**

Create the following multi-node configuration. The compute worker receives the
GPU from ``nvkind``. The other workers disable GPU Operator operands, and the
service worker maps gateway NodePort ``30080`` to host port ``80``.

.. dropdown:: ``kind-osmo-cluster-config.yaml`` (GPU version)
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

**Create the Cluster**

Create the cluster, select its context, and confirm that ``nvkind`` passes the
host GPU through:

.. code-block:: bash

   nvkind cluster create --config-template=kind-osmo-cluster-config.yaml
   nvkind cluster print-gpus
   kubectl config use-context kind-osmo

.. note::

   You can ignore ``umount`` errors from ``nvkind`` if ``nvkind cluster
   print-gpus`` lists the workstation GPUs.

**Install GPU Operator**

Install GPU Operator v25.10.1. The host driver and NVIDIA Container Toolkit
are already managed by the ``nvkind`` prerequisites, so disable their in-cluster
management. Version v25.10.1 includes the Kubernetes 1.33 schema-validation
fix required by this quickstart.

.. code-block:: bash

   helm repo add nvidia https://helm.ngc.nvidia.com/nvidia
   helm repo update nvidia
   helm upgrade --install gpu-operator nvidia/gpu-operator \
     --version v25.10.1 \
     --namespace gpu-operator \
     --create-namespace \
     --set driver.enabled=false \
     --set toolkit.enabled=false \
     --set nfd.enabled=true \
     --wait \
     --timeout 10m

Option B: CPU Workstations (with KIND)
---------------------------------------

If your workstation does not have a GPU, create a standard CPU-only cluster.

**Create Cluster Configuration**

.. dropdown:: ``kind-osmo-cluster-config.yaml`` (CPU-only version)
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
              node-labels: "node_group=kai-scheduler"
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=data"
        extraMounts:
          - hostPath: /tmp/localstack-s3
            containerPath: /var/lib/localstack
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=service"
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
              node-labels: "node_group=service"
      - role: worker
        kubeadmConfigPatches:
        - |
          kind: JoinConfiguration
          nodeRegistration:
            kubeletExtraArgs:
              node-labels: "node_group=compute"

**Create the Cluster**

.. code-block:: bash

   kind create cluster --config kind-osmo-cluster-config.yaml
   kubectl config use-context kind-osmo

Install cluster dependencies
============================

Install KAI Scheduler v0.12.10 for OSMO workflow scheduling, then install the
CloudNativePG operator chart version 0.29.0 for the embedded PostgreSQL
cluster:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
     --version v0.12.10 \
     --create-namespace -n kai-scheduler \
     --set global.nodeSelector.node_group=kai-scheduler \
     --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
     --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
     --wait

   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo update cnpg
   helm upgrade --install cnpg cnpg/cloudnative-pg \
     --version 0.29.0 \
     --namespace cnpg-system \
     --create-namespace \
     --wait \
     --timeout 10m

Install OSMO
============

The chart defaults define a ``cpu`` platform and a ``gpu`` platform in the
default pool. CPU workflows use a pod template without a GPU resource key.
GPU workflows select the GPU platform, which requests ``nvidia.com/gpu`` in
both the user-container requests and limits. No values overlay is required.

Generate the shared development service-auth identity with the published OSMO
service image and create its Secret. The generator writes the private identity
only to a permission-restricted temporary file and never prints it:

.. code-block:: bash

   OSMO_SERVICE_AUTH_DIRECTORY="$(mktemp -d)"
   docker run --rm --user "$(id -u):$(id -g)" \
     --entrypoint service-auth-bootstrap \
     --volume "${OSMO_SERVICE_AUTH_DIRECTORY}:/output" \
     nvcr.io/nvidia/osmo/service:latest \
     generate --output /output/authentication-config.json
   kubectl create namespace osmo \
     --dry-run=client --output=yaml | kubectl apply -f -
   kubectl --namespace osmo create secret generic \
     osmo-service-auth \
     --from-file="authentication-config.json=${OSMO_SERVICE_AUTH_DIRECTORY}/authentication-config.json"
   rm -r "${OSMO_SERVICE_AUTH_DIRECTORY}"

The chart defaults are the development Quickstart. Build its dependencies and
install it without a profile or values overlay:

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --create-namespace \
     --wait \
     --wait-for-jobs \
     --timeout 20m

Log in and run a workflow
=========================

The cluster configuration maps the gateway to ``http://127.0.0.1``. Install the
CLI if necessary, log in as the development administrator, select the default
pool, and submit the canonical CPU verification workflow:

.. code-block:: bash

   curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash
   osmo login http://127.0.0.1 --method=dev --username=testuser
   osmo profile set pool default
   osmo workflow submit deployments/workflows/verify-hello.yaml
   osmo workflow query <workflow-id>

Query the returned workflow ID until its status is ``COMPLETED``. The workflow
uses the default ``cpu`` platform.

.. admonition:: Success!
   :class: tip

   You now have OSMO configured and running on your workstation. You're ready to start running robotics workflows!

If you used Option A, submit the GPU verification workflow too:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-gpu.yaml
   osmo workflow query <workflow-id>

The GPU workflow explicitly uses the ``gpu`` platform and runs ``nvidia-smi``
in a CUDA container, proving that OSMO and KAI scheduled it onto the GPU node
and that the NVIDIA driver and Container Toolkit are usable.

Troubleshooting
===============

If the GPU workflow remains pending or fails, first verify GPU capacity and
the GPU Operator:

.. code-block:: bash

   kubectl get nodes \
     -o custom-columns=NAME:.metadata.name,ALLOCATABLE_GPUS:.status.allocatable.nvidia\.com/gpu
   kubectl --namespace gpu-operator get pods
   kubectl --namespace osmo get events --sort-by=.lastTimestamp
   kubectl --namespace osmo get pods

An allocatable GPU count of zero means the host NVIDIA driver, Container
Toolkit, ``nvkind`` pass-through, or GPU Operator is not ready. Do not run
other GPU workloads until ``verify-gpu.yaml`` completes. For OSMO deployment
problems, inspect the listed pods and events; a pending PostgreSQL, Valkey, or
RustFS PVC usually means the cluster lacks a working default ``StorageClass``.

.. _quickstart_limits:

Capacity and limitations
========================

This Quickstart runs one replica of each required OSMO service and uses generated
development credentials, including the ``testuser`` identity with the
``osmo-admin`` role. It disables TLS, authorization, rate limiting, backups,
monitoring, PodDisruptionBudgets, and autoscaling. It also has no high
availability guarantees. The exposed development administrator identity and
NodePort are suitable only for a disposable local environment.

CloudNativePG, Valkey, and RustFS use persistent volumes supplied by the
cluster's default StorageClass. Those local volumes, generated
credentials, workflow state, and all other quickstart data disappear when the
cluster is deleted. Do not use this quickstart for production data or any
long-lived environment.

.. seealso::

   For a persistent, highly available local or edge installation, use the
   :ref:`Self-contained Deployment
   <deploy_self_contained>` guide.

Clean up resources
==================

Remove the OSMO release, then delete the disposable cluster using the command
for the option you selected:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait

   # Option A
   nvkind cluster delete --name osmo

   # Option B
   kind delete cluster --name osmo

Deleting the cluster removes all quickstart data, including its local
persistent volumes and generated credentials.
