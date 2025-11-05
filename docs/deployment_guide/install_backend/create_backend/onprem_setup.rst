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
Create Backend (On-Premises)
================================================

Create a Kubernetes cluster to be used as a backend for job execution on your own infrastructure. This guide provides links to setup instructions for various on-premises Kubernetes distributions.

Prerequisites
=============

Before setting up your on-premises Kubernetes cluster, ensure you have the necessary hardware and software infrastructure available.

System Requirements
-------------------

Kubernetes Cluster
~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - Kubernetes Version
     - v1.30.0 or later
   * - Architecture
     - x86_64 or arm64
   * - CPU
     - 12 cores minimum
   * - Memory
     - 24 GB minimum
   * - Disk
     - 200 GB minimum
   * - High Availability
     - Recommended for production (3+ control plane nodes)
   * - Operating System
     - Ubuntu 22.04+ or equivalent enterprise Linux distribution

Backend-Operator Nodes
~~~~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - Purpose
     - Dedicated nodes for running the osmo-backend-operator
   * - Recommended For
     - Production deployments
   * - Architecture
     - x86_64 or arm64
   * - CPU
     - 4 cores minimum
   * - Memory
     - 8 GB minimum
   * - Disk
     - 50 GB minimum
   * - Auto-scaling
     - Configure as needed (1-3 nodes recommended)
   * - Taints
     - Optional, to ensure only operator workloads are scheduled and no osmo workflow pods are scheduled on these nodes
   * - GPU Requirements
     - None

Compute Nodes (User Workflows)
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - CPU Workloads
     - Size according to workload requirements
   * - GPU Workloads
     - x86_64 nodes (e.g., OVX/DGX) or Jetson nodes
   * - Operating System (GPU nodes)
     - Ubuntu 22.04+ (x86_64) or JetPack 6.2 (Jetson)
   * - NVIDIA Driver
     - 535.216.03+ (x86_64)
   * - CUDA
     - 12.6+ (x86_64) or included in JetPack 6.2 (Jetson)
   * - Container Runtime
     - containerd 1.7.27+
   * - Auto-scaling
     - Configure as needed
   * - Node Labels
     - ``node-type=compute``, ``node-type=gpu``, ``node-type=jetson`` (as appropriate)
   * - Taints
     - Optional, to ensure only osmo workflow pods are scheduled and no operator or system workloads are scheduled on these nodes

Container Runtime
~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - Runtime
     - containerd 1.7.27+
   * - Image Registry Access
     - Ensure nodes can pull from required registries

Networking
~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - Cluster Networking
     - All nodes must be routable with stable IP addresses and DNS resolution
   * - Internet Access
     - Required for image pulls and access to the osmo service
   * - Internal Communication
     - Ensure proper inter-node communication for Kubernetes networking

Security Considerations
~~~~~~~~~~~~~~~~~~~~~~~

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Requirements
   * - Encryption at Rest
     - Enable for etcd and persistent volumes. Refer to the `official documentation <https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/>`__ for more details
   * - Encryption in Transit
     - TLS for all communications
   * - Secrets Management
     - Secure handling of sensitive data and credentials

Kubernetes Distribution Options
================================

There are several Kubernetes distributions suitable for on-premises deployments. Choose one based on your infrastructure and requirements:

Kubeadm (Upstream Kubernetes)
------------------------------

Kubeadm is the official tool for bootstrapping Kubernetes clusters and provides full control over cluster configuration.

* `Installing kubeadm <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/install-kubeadm/>`__
* `Creating a cluster with kubeadm <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/>`__
* `High availability clusters <https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/high-availability/>`__

**Key Configuration Points:**

* Use Kubernetes version v1.30.0 or later
* Configure control plane nodes with minimum 12 cores, 24 GB RAM, 200 GB disk
* Install containerd 1.7.27+ as the container runtime
* Set up backend-operator nodes with ``node-type=operator`` label (4 cores, 8 GB RAM minimum)
* Set up compute nodes with appropriate labels (``node-type=compute``, ``node-type=gpu``, ``node-type=jetson``)
* For GPU nodes, install NVIDIA drivers 535.216.03+ and CUDA 12.6+


GPU Node Setup (x86_64)
========================

For GPU-enabled compute nodes on x86_64 architecture (e.g., DGX, OVX systems):

1. **Install NVIDIA Drivers**:

   * Follow the `NVIDIA Driver Installation Guide <https://docs.nvidia.com/datacenter/tesla/tesla-installation-notes/index.html>`__
   * Minimum version: 535.216.03

2. **Install CUDA Toolkit**:

   * Follow the `CUDA Installation Guide <https://docs.nvidia.com/cuda/cuda-installation-guide-linux/index.html>`__
   * Minimum version: 12.6

3. **Install NVIDIA Container Toolkit**:

   * Follow the `NVIDIA Container Toolkit Installation Guide <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html>`__
   * This enables GPU support in containers

4. **Configure containerd for NVIDIA runtime**:

   * Follow the `containerd configuration guide <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html#configuring-containerd>`__

GPU Node Setup (Jetson)
========================

For GPU-enabled compute nodes on Jetson devices:

1. **Install JetPack**:

   * Follow the `JetPack Installation Guide <https://developer.nvidia.com/embedded/jetpack>`__
   * Minimum version: JetPack 6.2 (includes CUDA 12.6)

2. **Install Container Runtime**:

   * JetPack includes NVIDIA container runtime support
   * Ensure containerd 1.7.27+ is installed

3. **Configure Kubernetes for Jetson**:

   * Apply ``node-type=jetson`` label to Jetson nodes


Networking Configuration
=========================

Ensure proper networking configuration:

1. **CNI Plugin**: Most Kubernetes distributions include a CNI (Calico, Flannel, Cilium)
2. **DNS Resolution**: Verify CoreDNS is running and nodes can resolve internal names
3. **Node Connectivity**: All nodes must be routable with stable IP addresses
4. **Firewall Rules**: Allow Kubernetes communication ports (see `Kubernetes Ports and Protocols <https://kubernetes.io/docs/reference/networking/ports-and-protocols/>`__)


Next Steps
==========

Once your on-premises Kubernetes cluster is set up and configured, proceed to :ref:`deploy_backend` to enable it as an OSMO backend.

