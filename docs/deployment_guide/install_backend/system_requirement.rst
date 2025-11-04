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

.. _system_requirements:

================================================
System Requirements
================================================

OSMO backend requires a Kubernetes cluster to be used as a backend for job execution, this can be deployed on your own infrastructure or using a managed Kubernetes service. This guide provides the system requirements for creating a Kubernetes cluster to be used as an OSMO backend for job execution. Requirements are provided for both cloud-based managed Kubernetes services and on-premises deployments.

Kubernetes Cluster
===========================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - Service Type
     - Managed Kubernetes service (e.g., EKS, GKE, AKS)
     - Self-managed Kubernetes cluster
   * - Kubernetes Version
     - v1.30.0+
     - v1.30.0+
   * - Architecture
     - Managed by cloud provider
     - x86_64/arm64
   * - CPU
     - Managed by cloud provider
     - 12 cores minimum
   * - Memory
     - Managed by cloud provider
     - 24 GB minimum
   * - Disk
     - Managed by cloud provider
     - 200 GB minimum
   * - High Availability
     - Recommended for production
     - Recommended for production (3+ control plane nodes)
   * - Operating System
     - Managed by cloud provider
     - Ubuntu 22.04+ or equivalent enterprise Linux distribution

Backend-Operator Nodes
========================================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - Purpose
     - Dedicated nodes for running the osmo-backend-operator
     - Dedicated nodes for running the osmo-backend-operator
   * - Recommended For
     - Production deployments
     - Production deployments
   * - Instance Type
     - General purpose (e.g., m5.xlarge, n1-standard-4, Standard_D4s_v3)
     - Custom hardware
   * - Architecture
     - Managed by cloud provider
     - x86_64/arm64
   * - CPU
     - 4 vCPUs minimum
     - 4 cores minimum
   * - Memory
     - 8 GB minimum
     - 8 GB minimum
   * - Disk
     - 50 GB minimum
     - 50 GB minimum
   * - Auto-scaling
     - 1-3 nodes
     - Configure as needed
   * - Taints
     - Optional, to ensure only operator workloads are scheduled and no osmo workflow pods are scheduled on these nodes
     - Optional, to ensure only operator workloads are scheduled and no osmo workflow pods are scheduled on these nodes
   * - GPU Requirements
     - None
     - None

The following are the recommended instance types for user workflows, you may use different instance types depending on your user workflow requirements:

Compute Nodes (User Workflows)
===============================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - CPU Workloads
     - General purpose instances (e.g., m5.2xlarge, n1-standard-8, Standard_D8s_v3)
     - Size according to workload requirements
   * - GPU Workloads
     - GPU-optimized instances (e.g., p3.2xlarge, n1-standard-4-nvidia-t4, Standard_NC6s_v3)
     - x86_64 nodes (e.g., OVX/DGX) or Jetson nodes
   * - Operating System (GPU nodes)
     - Managed by cloud provider
     - Ubuntu 22.04+ (x86_64) or JetPack 6.2 (Jetson)
   * - NVIDIA Driver
     - Pre-configured by cloud provider
     - 535.216.03+ (x86_64)
   * - CUDA
     - Pre-configured by cloud provider
     - 12.6+ (x86_64) or included in JetPack 6.2 (Jetson)
   * - Container Runtime
     - containerd (managed by cloud provider)
     - containerd 1.7.27+
   * - Auto-scaling
     - Configure based on expected workload patterns
     - Configure as needed
   * - Node Labels
     - ``node-type=compute`` or ``node-type=gpu``
     - ``node-type=compute``, ``node-type=gpu``, ``node-type=jetson`` (as appropriate)
   * - Taints
     - Optional, to ensure only osmo workflow pods are scheduled and no operator or system workloads are scheduled on these nodes
     - Optional, to ensure only osmo workflow pods are scheduled and no operator or system workloads are scheduled on these nodes

Container Runtime
===============================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - Runtime
     - containerd 1.7.27+
     - containerd 1.7.27+
   * - Image Registry Access
     - Ensure nodes can pull from required registries
     - Ensure nodes can pull from required registries

Networking
=======================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - Cluster Networking
     - VPC/VNet with proper subnet configuration
     - All nodes must be routable with stable IP addresses and DNS resolution
   * - Internet Access
     - Required for image pulls and access to the osmo service
     - Required for image pulls and access to the osmo service
   * - Internal Communication
     - Managed by cloud provider
     - Ensure proper inter-node communication for Kubernetes networking


Security Considerations
=======================

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Component
     - Cloud
     - On-Premises
   * - Encryption at Rest
     - Enable for etcd and persistent volumes
     - Enable for etcd and persistent volumes. Refer to the `official documentation <https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/>`__ for more details
   * - Encryption in Transit
     - TLS for all communications
     - TLS for all communications
   * - Secrets Management
     - Managed by cloud provider or custom solution
     - Secure handling of sensitive data and credentials

Next Steps
==========

Once you have reviewed the system requirements and are ready to create your Kubernetes cluster, proceed to :ref:`create your on-premises Kubernetes cluster <onprem_cb>` or :ref:`create your cloud-based Kubernetes cluster <cloud_cb>`.
