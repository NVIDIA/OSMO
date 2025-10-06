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

.. _cloud_cb:

================================================
Create Backend (Cloud)
================================================

Create a managed Kubernetes cluster in the cloud to be used as a backend for job execution. This guide covers requirements for cloud-based deployments using managed Kubernetes services.

Control Plane
=============

* Managed Kubernetes service (e.g., EKS, GKE, AKS)
* Kubernetes version: v1.30.0+
* High availability configuration recommended for production

Node Pool Configuration
=======================

Backend-Operator Node Pool
---------------------------

* **Purpose**: Dedicated nodes for running the osmo-backend-operator
* **Recommended for**: Production deployments
* **Node specifications**:

  * Instance type: General purpose (e.g., m5.xlarge, n1-standard-4, Standard_D4s_v3)
  * CPU: 4 vCPUs minimum
  * Memory: 8 GB minimum
  * Disk: 50 GB minimum

* **Node pool settings**:

  * Auto-scaling: 1-3 nodes
  * Node labels: ``node-type=operator``
  * Taints: Optional, to ensure only operator workloads are scheduled and no osmo workflow pods are scheduled on these nodes

* **GPU requirements**: None

Compute Node Pool(s)
--------------------

* **Purpose**: Execute Osmo workloads and jobs
* **Node specifications**: Size according to your workload requirements

  * **CPU workloads**: General purpose instances (e.g., m5.2xlarge, n1-standard-8, Standard_D8s_v3)
  * **GPU workloads**: GPU-optimized instances (e.g., p3.2xlarge, n1-standard-4-nvidia-t4, Standard_NC6s_v3)

* **Node pool settings**:

  * Auto-scaling: Configure based on expected workload patterns
  * Node labels: ``node-type=compute`` or specific labels like ``node-type=gpu``
  * Taints: Optional, to ensure only osmo workflow pods are scheduled and no operator or system workloads are scheduled on these nodes

Container Runtime
=================

* **Runtime**: containerd 1.7.27+
* **Image registry access**: Ensure nodes can pull from required registries

Networking Requirements
=======================

* **Cluster networking**: VPC/VNet with proper subnet configuration
* **Internet access**: Required for image pulls and access to the osmo service

Storage Requirements
====================

* **Default StorageClass**: Cloud-native storage class (e.g., gp3, pd-standard, managed-premium)
* **Persistent volumes**: Managed disk services for stateful workloads
* **Backup**: Cloud-native backup solutions recommended

Registry Access
===============

* **Required registries**:

  * ``nvcr.io`` (NVIDIA Container Registry)
  * ``ghcr.io`` (GitHub Container Registry)
  * ``docker.io`` (Docker Hub)

* **Authentication**: Configure image pull secrets as needed
* **Private registries**: Configure access to internal/private registries if required

Security Considerations
=======================

* **Encryption**:

  * Encryption at rest: Enable for etcd and persistent volumes
  * Encryption in transit: TLS for all communications
