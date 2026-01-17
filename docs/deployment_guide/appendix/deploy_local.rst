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

============================
Local Deployment
============================

Try OSMO on your local workstation — no cloud account, no infrastructure costs, no enterprise approval needed.

This guide walks you through deploying the complete OSMO platform locally using KIND (Kubernetes in Docker) in about 10 minutes.

.. tip::
   **Perfect for evaluation** – Test your workflows, explore the platform, and assess fit for your robotics development needs before cloud deployment of OSMO.

.. warning::
   Local deployment is **not** recommended for production use as it lacks authentication and has limited features.

Why Deploy Locally?
===================

Local deployment provides the complete OSMO experience on your workstation:

✓ **Full workflow orchestration** – Task dependencies, parallel execution, state management

✓ **Real containerized execution** – Your Docker images running in local Kubernetes

✓ **Complete data management** – Local object storage for datasets and artifacts

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

.. important::

   **System Configuration**:

   1. `Raise inotify limits <https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files>`_ to prevent "too many open files" errors
   2. `Ensure your user has Docker permissions <https://kind.sigs.k8s.io/docs/user/known-issues/#docker-permission-denied>`_

Step 1: Create KIND Cluster
============================

Choose the appropriate setup based on whether your workstation has a GPU.

Option A: GPU Workstations (with nvkind)
-----------------------------------------

If your workstation has a GPU, follow these steps to create a cluster with GPU support.

**Prerequisites**

Install `nvkind <https://github.com/NVIDIA/nvkind>`_ by following the `prerequisites <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#prerequisites>`_, `setup <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#setup>`_, and `installation <https://github.com/NVIDIA/nvkind?tab=readme-ov-file#install-nvkind>`_ guides.

**Create Cluster Configuration**

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
              node-labels: "node_group=ingress,nvidia.com/gpu.deploy.operands=false"
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

.. code-block:: bash

   $ nvkind cluster create --config-template=kind-osmo-cluster-config.yaml

.. note::
   You can safely ignore any ``umount`` errors as long as ``nvkind cluster print-gpus`` shows your GPUs.

**Install GPU Operator**

After creating the cluster, install the GPU Operator to manage GPU resources:

.. code-block:: bash

   $ helm fetch https://helm.ngc.nvidia.com/nvidia/charts/gpu-operator-v25.10.0.tgz
   $ helm upgrade --install gpu-operator gpu-operator-v25.10.0.tgz \
     --namespace gpu-operator \
     --create-namespace \
     --set driver.enabled=false \
     --set toolkit.enabled=false \
     --set nfd.enabled=true \
     --wait

Option B: CPU Workstations (with KIND)
--------------------------------------------

If your workstation does not have a GPU, follow these steps for a standard CPU-only cluster.

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
              node-labels: "node_group=ingress"
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

   $ kind create cluster --config kind-osmo-cluster-config.yaml

Cluster Architecture
--------------------

Both commands create a Kubernetes cluster on your workstation with a control plane node and several worker nodes. The core OSMO components will be installed on those worker nodes:

**Control Plane**

* 2 worker nodes labeled ``node_group=service`` for API server and workflow engine
* 1 worker node labeled ``node_group=ingress`` for NGINX ingress
* 1 worker node labeled ``node_group=kai-scheduler`` for KAI scheduler

**Compute Layer**

* 1 worker node labeled ``node_group=compute``

**Data Layer**

* 1 worker node labeled ``node_group=data`` for PostgreSQL, Redis, LocalStack S3

Step 2: Install KAI Scheduler
==============================

KAI scheduler provides co-scheduling, priority, and preemption for workflows:

.. code-block:: bash

   $ helm upgrade --install kai-scheduler \
     oci://ghcr.io/nvidia/kai-scheduler/kai-scheduler \
     --version v0.8.1 \
     --create-namespace -n kai-scheduler \
     --set global.nodeSelector.node_group=kai-scheduler \
     --set "scheduler.additionalArgs[0]=--default-staleness-grace-period=-1s" \
     --set "scheduler.additionalArgs[1]=--update-pod-eviction-condition=true" \
     --wait

Step 3: Install OSMO
====================

Deploy the complete OSMO platform with a single Helm command:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
   $ helm repo update
   $ helm upgrade --install osmo osmo/quick-start \
     --namespace osmo \
     --create-namespace \
     --wait

.. tip::
   Installation takes about 5 minutes. Monitor progress with:

   .. code-block:: bash

      $ kubectl get pods --namespace osmo

Step 4: Configure Access
=========================

Add a host entry to access OSMO from your browser:

.. code-block:: bash

   $ echo "127.0.0.1 quick-start.osmo" | sudo tee -a /etc/hosts

This allows you to visit ``http://quick-start.osmo`` in your web browser.

Step 5: Install OSMO CLI
=========================

Download and install the OSMO command-line interface:

.. code-block:: bash

   $ curl -fsSL https://raw.githubusercontent.com/NVIDIA/OSMO/refs/heads/main/install.sh | bash

Step 6: Log In to OSMO
=======================

Authenticate with your local OSMO instance:

.. code-block:: bash

   $ osmo login http://quick-start.osmo --method=dev --username=testuser

.. admonition:: Success!
   :class: tip

   You now have OSMO configured and running on your workstation. You're ready to start running robotics workflows!

Next Steps
==========

Now that you have OSMO running locally, explore the platform:

1. **Run Your First Workflow**: Visit the :ref:`User Guide <getting_started_next_steps>` for tutorials on submitting workflows, interactive development, distributed training, and more.

2. **Explore the Web UI**: Visit ``http://quick-start.osmo`` to access the OSMO dashboard.

3. **Test Your Own Workflows**: Use your own Docker images and datasets to validate OSMO for your use case.

.. tip::
   **Ready to Scale?**

   Once you have validated OSMO locally, you can scale to cloud environments (EKS, AKS, GKE) or on-premise clusters without rewriting your workflows. Contact your cloud administrator to discuss production deployment options—see the :ref:`deploy_service` guide for full production deployment.

Cleanup
=======

Delete the local cluster and all associated resources:

.. code-block:: bash

   $ kind delete cluster --name osmo

This removes the entire Kubernetes cluster, including all persistent volumes and the PostgreSQL database.

Troubleshooting
===============

Too Many Files Open
-------------------

If you encounter "too many files open" errors or pods fail to start, increase the inotify limits:

.. code-block:: bash

   $ echo "fs.inotify.max_user_watches=1048576" | sudo tee -a /etc/sysctl.conf
   $ echo "fs.inotify.max_user_instances=512" | sudo tee -a /etc/sysctl.conf
   $ sudo sysctl -p

For more details, see: `Pod errors due to "too many open files" <https://kind.sigs.k8s.io/docs/user/known-issues/#pod-errors-due-to-too-many-open-files>`_

Docker Permission Denied
------------------------

If you see "permission denied" errors when running Docker or KIND commands, add your user to the docker group:

.. code-block:: bash

   $ sudo usermod -aG docker $USER && newgrp docker

.. note::
   If permission errors persist, log out and log back in for the group membership changes to take effect.

For more details, see: `Docker permission denied <https://kind.sigs.k8s.io/docs/user/known-issues/#docker-permission-denied>`_

Pods Not Starting
------------------

Check resource availability and logs:

.. code-block:: bash

   $ kubectl get pods --namespace osmo
   $ kubectl describe pod <pod-name> --namespace osmo
   $ kubectl logs <pod-name> --namespace osmo

