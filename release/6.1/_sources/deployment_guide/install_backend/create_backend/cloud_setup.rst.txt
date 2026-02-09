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
Cloud Provider
================================================

Create a managed Kubernetes cluster in the cloud to be used as a backend for job execution. This guide provides links to setup instructions for various cloud providers.

Prerequisites
=============

You will need access to a cloud provider account (AWS, Azure, or GCP) with permissions to create and manage Kubernetes clusters.

.. important::

    * **Kubernetes Version**: v1.30.0 or later
    * **Networking**: Ensure the nodes in the cluster have outbound internet access to container registries and access to the OSMO service

Setup Guide
===============

.. list-table::
   :header-rows: 1
   :widths: 20 35 45

   * - Cloud Provider
     - Documentation
     - Recommended Instance Types
   * - **Amazon Web Services (EKS)**
     - * `Getting started with EKS <https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html>`__
       * `Creating an EKS cluster <https://docs.aws.amazon.com/eks/latest/userguide/create-cluster.html>`__
       * `EKS nodes <https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html>`__
     - * **Backend-Operator**: m5.xlarge (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)
       * **Compute (CPU)**: m5.2xlarge
       * **Compute (GPU)**: p3.2xlarge, p4d.24xlarge (A100), p5.48xlarge (H100) - `GPU instances <https://docs.aws.amazon.com/dlami/latest/devguide/gpu.html>`__
   * - **Microsoft Azure (AKS)**
     - * `Quickstart: Deploy AKS <https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-portal>`__
       * `Create an AKS cluster <https://learn.microsoft.com/en-us/azure/aks/tutorial-kubernetes-deploy-cluster>`__
       * `Use multiple node pools <https://learn.microsoft.com/en-us/azure/aks/use-multiple-node-pools>`__
     - * **Backend-Operator**: Standard_D4s_v3 (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)
       * **Compute (CPU)**: Standard_D8s_v3
       * **Compute (GPU)**: Standard_NC6s_v3, Standard_ND96asr_v4 (A100), Standard_ND96isr_H100_v5 (H100) - `GPU VMs <https://learn.microsoft.com/en-us/azure/virtual-machines/sizes-gpu>`__
   * - **Google Cloud Platform (GKE)**
     - * `Quickstart: Deploy GKE <https://cloud.google.com/kubernetes-engine/docs/deploy-app-cluster>`__
       * `Creating a GKE cluster <https://cloud.google.com/kubernetes-engine/docs/how-to/creating-a-zonal-cluster>`__
       * `Node pools <https://cloud.google.com/kubernetes-engine/docs/concepts/node-pools>`__
     - * **Backend-Operator**: n1-standard-4 (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)
       * **Compute (CPU)**: n1-standard-8
       * **Compute (GPU)**: n1-standard-4 with T4/A100, a2-highgpu-1g (A100), a3-highgpu-8g (H100) - `GPUs on Compute Engine <https://docs.cloud.google.com/compute/docs/gpus>`__

.. note::

   Configure auto-scaling for compute nodes based on your expected workload patterns.

