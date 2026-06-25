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

<a id="deployment-guide-welcome"></a>

# **Deployment Guide**

This guide will walk you through deploying OSMO, a cloud-native platform designed for robotics developers to manage all aspects of AI and robotics development, from compute resources to data storage.

## What is OSMO?

OSMO is an open-source workflow orchestration platform that solves the complexity of scaling robotics and AI development across heterogeneous compute infrastructure.

### The Challenge

As AI and robotics workloads grow beyond single workstations, teams face critical scaling challenges:

* **Multi-robot simulations** requiring coordinated execution across distributed systems
* **Distributed training** across GPU clusters with complex dependencies
* **Hardware-in-the-loop testing** on edge devices (NVIDIA Jetson, AGX)
* **Synthetic data generation** at massive scale
* **Fragmented tooling** that doesn’t integrate across environments
* **Infrastructure complexity** that slows development cycles
* **Non-portable workflows** that need rewriting for different hardware

### The Solution

OSMO provides a unified platform with three core capabilities:

**Unified Control Plane**

A single interface for workflow submission, monitoring, and management across all your compute resources. Define your workflow once in YAML and execute anywhere.

**Bring Your Own Compute**

Connect any Kubernetes cluster as an execution backend for your workflow:

* **Cloud**: AWS (EKS), Azure (AKS), Google Cloud (GKE)
* **On-Premises**: Data centers with DGX or OVX systems
* **Edge**: NVIDIA Jetson devices for hardware-in-the-loop testing
* **Hybrid**: Mix and match across environments in a single workflow

**Bring Your Own Storage**

Integrate with your existing storage infrastructure:

* Any S3-compatible object storage (AWS S3, MinIO, etc.)
* Azure Blob Storage

#### SEE ALSO
Learn more about OSMO in the [Welcome to OSMO](../user_guide/index.md#user-guide-welcome) section of the User Guide.

## What You’ll Deploy

![image](deployment_guide/deployment_flow.svg)

An OSMO deployment consists of two main components:

**1. OSMO Service** (Control Plane)
: The central service that provides the API and UI for workflow submission, monitoring, and management. This includes:
  <br/>
  - API server for workflow operations
  - Web UI for visual workflow management
  - Data storage configuration
  - Workflow scheduling and lifecycle management

**2. OSMO Operators** (Compute Plane)
: An OSMO operator is an agent that you will deploy on your compute cluster to register it with the control plane similar to plug and play model.

> **Note**
>
> OSMO does **not** need network access to your compute cluster. Your compute clusters can run anywhere behind corporate firewalls, in restricted networks, or across geographically distributed locations. When you deploy our backend
> operator, it will initiate outbound connections to OSMO for registration and works like a plug and play model.

#### SEE ALSO
See [Architecture](introduction/architecture.md) for a detailed overview of the deployment architecture.

<!-- Optional appendix sections can be included -->
