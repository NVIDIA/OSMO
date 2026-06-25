<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="cloud-cb"></a>

# Cloud Provider

Create a managed Kubernetes cluster in the cloud to be used as a backend for job execution. This guide provides links to setup instructions for various cloud providers.

## Prerequisites

You will need access to a cloud provider account (AWS, Azure, or GCP) with permissions to create and manage Kubernetes clusters.

> **Important**
>
> * **Kubernetes Version**: v1.30.0 or later
> * **Networking**: Ensure the nodes in the cluster have outbound internet access to container registries and access to the OSMO service

## Setup Guide

| Cloud Provider                  | Documentation                                                                                                                                                                                                                                                                                                                   | Recommended Instance Types                                                                                                                                                                                                                                                                                           |
|---------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Amazon Web Services (EKS)**   | * [Getting started with EKS](https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html)<br/>* [Creating an EKS cluster](https://docs.aws.amazon.com/eks/latest/userguide/create-cluster.html)<br/>* [EKS nodes](https://docs.aws.amazon.com/eks/latest/userguide/eks-compute.html)                                  | * **Backend-Operator**: m5.xlarge (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)<br/>* **Compute (CPU)**: m5.2xlarge<br/>* **Compute (GPU)**: p3.2xlarge, p4d.24xlarge (A100), p5.48xlarge (H100) - [GPU instances](https://docs.aws.amazon.com/dlami/latest/devguide/gpu.html)                                        |
| **Microsoft Azure (AKS)**       | * [Quickstart: Deploy AKS](https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-portal)<br/>* [Create an AKS cluster](https://learn.microsoft.com/en-us/azure/aks/tutorial-kubernetes-deploy-cluster)<br/>* [Use multiple node pools](https://learn.microsoft.com/en-us/azure/aks/use-multiple-node-pools) | * **Backend-Operator**: Standard_D4s_v3 (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)<br/>* **Compute (CPU)**: Standard_D8s_v3<br/>* **Compute (GPU)**: Standard_NC6s_v3, Standard_ND96asr_v4 (A100), Standard_ND96isr_H100_v5 (H100) - [GPU VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes-gpu) |
| **Google Cloud Platform (GKE)** | * [Quickstart: Deploy GKE](https://cloud.google.com/kubernetes-engine/docs/deploy-app-cluster)<br/>* [Creating a GKE cluster](https://cloud.google.com/kubernetes-engine/docs/how-to/creating-a-zonal-cluster)<br/>* [Node pools](https://cloud.google.com/kubernetes-engine/docs/concepts/node-pools)                          | * **Backend-Operator**: n1-standard-4 (4 vCPUs, 8 GB RAM, auto-scaling: 1-3 nodes)<br/>* **Compute (CPU)**: n1-standard-8<br/>* **Compute (GPU)**: n1-standard-4 with T4/A100, a2-highgpu-1g (A100), a3-highgpu-8g (H100) - [GPUs on Compute Engine](https://docs.cloud.google.com/compute/docs/gpus)                |

> **Note**
>
> Configure auto-scaling for compute nodes based on your expected workload patterns.
