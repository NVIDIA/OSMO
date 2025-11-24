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

.. _onprem_cb:

================================================
On-Premise
================================================

Create a Kubernetes cluster to be used as a backend for job execution on your own infrastructure.

Prerequisites
=============

Before setting up your on-premises Kubernetes cluster, ensure you have the necessary hardware and software infrastructure available.

.. important::

    * **Kubernetes Version**: v1.30.0 or later
    * **Architecture**: x86_64 or arm64
    * **Container Runtime**: containerd 1.7.27+
    * **Networking**: All nodes must be routable with stable IP addresses, DNS resolution, and outbound internet access to container registries and the OSMO service
    * **Security**: Enable encryption at rest for etcd and persistent volumes, TLS for communications - `Encrypt Data <https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/>`__

Node Requirements
=================

.. list-table::
   :header-rows: 1
   :widths: 25 25 50

   * - Node Type
     - Specification
     - Configuration
   * - **Control Plane**
     - * 12 cores minimum
       * 24 GB RAM minimum
       * 200 GB disk minimum
     - * High availability recommended for production (3+ control plane nodes)
       * Ubuntu 22.04+ or equivalent enterprise Linux
   * - **Backend-Operator**
     - * 4 cores minimum
       * 8 GB RAM minimum
       * 50 GB disk minimum
     - * Dedicated nodes for osmo-backend-operator
       * Auto-scaling: 1-3 nodes recommended
       * Label: ``node-type=operator``
       * Optional taints to isolate operator workloads
   * - **Compute (CPU)**
     - * Size per workload needs
       * Configure auto-scaling
     - * Label: ``node-type=compute``
       * Optional taints to isolate workflow pods
   * - **Compute (GPU x86_64)**
     - * Size per workload needs
       * NVIDIA Driver 535.216.03+
       * CUDA 12.6+
     - * DGX/OVX systems
       * Ubuntu 22.04+
       * Label: ``node-type=gpu``
       * Install `NVIDIA Container Toolkit <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html>`__
   * - **Compute (GPU Jetson)**
     - * JetPack 6.2+
       * Includes CUDA 12.6
     - * Label: ``node-type=jetson``
       * Follow `JetPack Installation Guide <https://developer.nvidia.com/embedded/jetpack>`__

Setup Guide
===========

**Kubeadm (Upstream Kubernetes)**

Kubeadm is the official tool for bootstrapping Kubernetes clusters and provides full control over cluster configuration.

**Documentation:**

* `Installing kubeadm <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/>`__
* `Creating a cluster with kubeadm <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/>`__
* `High availability clusters <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/>`__

**Key Steps:**

1. Install containerd 1.7.27+ as the container runtime
2. Configure control plane and worker nodes per specifications above
3. Apply appropriate node labels (``node-type=operator``, ``node-type=compute``, ``node-type=gpu``, ``node-type=jetson``)
4. For GPU nodes (x86_64): Install `NVIDIA drivers <https://docs.nvidia.com/cuda/cuda-installation-guide-linux/>`__ (535.216.03+), `CUDA <https://docs.nvidia.com/cuda/cuda-installation-guide-linux/index.html>`__ (12.6+), and `NVIDIA Container Toolkit <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html>`__
5. For GPU nodes (Jetson): Install `JetPack 6.2+ <https://developer.nvidia.com/embedded/jetpack>`__ (includes CUDA and container runtime)
6. Configure CNI plugin and verify CoreDNS is operational
7. Configure firewall rules per `Kubernetes Ports and Protocols <https://kubernetes.io/docs/reference/networking/ports-and-protocols/>`__

.. note::

   For production deployments, configure high availability with 3+ control plane nodes and enable encryption at rest for etcd.

