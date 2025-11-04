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

Create a managed Kubernetes cluster in the cloud to be used as a backend for job execution. This guide provides links to setup instructions for various cloud providers.

Prerequisites
=============

Before setting up your cloud-based Kubernetes cluster, review the :ref:`system_requirements` to understand the requirements for control plane, node pools, networking, storage, and security.

Setup Guides by Cloud Provider
================================

Amazon Web Services (EKS)
--------------------------

Follow the official AWS documentation to create an Amazon EKS cluster:

* `Getting started with Amazon EKS <https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html>`__
* `Creating an Amazon EKS cluster <https://docs.aws.amazon.com/eks/latest/userguide/create-cluster.html>`__
* `Amazon EKS nodes <https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html>`__

**Key Configuration Points:**

* Use Kubernetes version v1.30.0 or later
* Create node groups for backend-operator nodes (general purpose instances like m5.xlarge)
* Create node groups for compute workloads (CPU: m5.2xlarge or GPU: p3.2xlarge, p4d.24xlarge)
* Configure appropriate node labels (``node-type=operator``, ``node-type=compute``, ``node-type=gpu``)
* Ensure nodes have outbound internet access for image pulls

Microsoft Azure (AKS)
----------------------

Follow the official Azure documentation to create an Azure Kubernetes Service cluster:

* `Quickstart: Deploy an AKS cluster <https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-portal>`__
* `Create an AKS cluster <https://learn.microsoft.com/en-us/azure/aks/tutorial-kubernetes-deploy-cluster>`__
* `Use multiple node pools in AKS <https://learn.microsoft.com/en-us/azure/aks/use-multiple-node-pools>`__

**Key Configuration Points:**

* Use Kubernetes version v1.30.0 or later
* Create node pools for backend-operator nodes (general purpose VMs like Standard_D4s_v3)
* Create node pools for compute workloads (CPU: Standard_D8s_v3 or GPU: Standard_NC6s_v3, Standard_ND96asr_v4)
* Configure appropriate node labels (``node-type=operator``, ``node-type=compute``, ``node-type=gpu``)
* Ensure nodes have outbound internet access for image pulls

Google Cloud Platform (GKE)
----------------------------

Follow the official Google Cloud documentation to create a Google Kubernetes Engine cluster:

* `Quickstart: Deploy a GKE cluster <https://cloud.google.com/kubernetes-engine/docs/deploy-app-cluster>`__
* `Creating a GKE cluster <https://cloud.google.com/kubernetes-engine/docs/how-to/creating-a-zonal-cluster>`__
* `Node pools <https://cloud.google.com/kubernetes-engine/docs/concepts/node-pools>`__

**Key Configuration Points:**

* Use Kubernetes version v1.30.0 or later
* Create node pools for backend-operator nodes (general purpose machines like n1-standard-4)
* Create node pools for compute workloads (CPU: n1-standard-8 or GPU: n1-standard-4 with NVIDIA T4, A100)
* Configure appropriate node labels (``node-type=operator``, ``node-type=compute``, ``node-type=gpu``)
* Ensure nodes have outbound internet access for image pulls


Next Steps
==========

Once your cloud-based Kubernetes cluster is set up and configured, proceed to :ref:`deploy_backend` to enable it as an OSMO backend.
