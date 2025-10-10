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

Create a Kubernetes cluster to be used as a backend for job execution on your own infrastructure. This guide covers requirements for on-premise deployments with full control over hardware and networking.
Use the following as a baseline when creating a Kubernetes cluster to serve as an OSMO backend on-premise.

Control Plane
=============

* **Architecture**: x86_64/arm64
* **Minimum requirements**:

  * CPU: 12 cores
  * Memory: 24 GB
  * Disk: 200 GB

* **High availability**: Recommended for production deployments (3+ control plane nodes)
* **Operating System**: Ubuntu 22.04+ or equivalent enterprise Linux distribution

Node Pool Configuration
=======================

Backend-Operator Nodes
-----------------------

* **Purpose**: Dedicated nodes for running the osmo-backend-operator
* **Recommended for**: Production deployments
* **Node specifications**:

  * CPU: 4 cores minimum
  * Memory: 8 GB minimum
  * Disk: 50 GB minimum
  * Architecture: x86_64/arm64

* **Node configuration**:

  * Node labels: ``node-type=operator``
  * Taints: Optional, to ensure only operator workloads are scheduled and no osmo workflow pods are scheduled on these nodes


Compute Nodes
-------------

* **Purpose**: Execute Osmo workloads and jobs
* **Node specifications**: Size according to your workload requirements

  * **x86_64 nodes (e.g., OVX/DGX)**:

    * Operating System: Ubuntu 22.04+
    * NVIDIA Driver: 535.216.03+
    * CUDA: 12.6+
    * Container runtime: containerd 1.7.27

  * **Jetson nodes**:

    * JetPack: 6.2 (includes CUDA 12.6)
    * Container runtime: containerd 1.7.27

* **Node configuration**:

  * Node labels: ``node-type=compute``, ``node-type=gpu``, ``node-type=jetson`` (as appropriate)
  * Taints: Optional, to ensure only osmo workflow pods are scheduled and no operator or system workloads are scheduled on these nodes

* **GPU requirements**:

  * NVIDIA drivers: 535.216.03+
  * CUDA: 12.6+
  * Container runtime: containerd 1.7.27

Container Runtime
=================

* **Runtime**: containerd 1.7.27+
* **Image registry access**: Ensure nodes can pull from required registries

Networking Requirements
=======================

* **Node connectivity**: All nodes must be routable with stable IP addresses and DNS resolution
* **Internet access**: Required for image pulls and access to the osmo service
* **Internal communication**: Ensure proper inter-node communication for Kubernetes networking

Storage Requirements
====================

* **Control plane storage**: ≥200 GB free disk space
* **Default StorageClass**: Configure a default StorageClass or CSI driver
* **Persistent volumes**: Support for dynamic provisioning recommended
* **Backup**: Implement backup solutions for persistent data

Registry Access
===============

* **Required registries**:

  * ``nvcr.io`` (NVIDIA Container Registry)
  * ``ghcr.io`` (GitHub Container Registry)
  * ``docker.io`` (Docker Hub)

* **Network access**: Outbound access to required registries or configure mirrored internal registries
* **Authentication**: Configure image pull secrets and API keys as required
* **Private registries**: Configure access to internal/private registries if required

Security Considerations
=======================

* **Encryption**:

  * Encryption at rest: Enable for etcd and persistent volumes. Refer to the `official documentation <https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/>`__ for more details
  * Encryption in transit: TLS for all communications

* **Secrets management**: Secure handling of sensitive data and credentials

