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
..

=======================
High Level Architecture
=======================

.. figure:: arch.svg
   :width: 1000
   :align: center
   :class: mb-4

OSMO follows a modular, cloud-native architecture designed to orchestrate complex AI and robotics workflows across heterogeneous compute resources. The platform consists of several key components working together:

**Control Plane**

The OSMO control plane manages the entire lifecycle of your workflows. It includes:

* **API Server**: Provides RESTful APIs for workflow submission, monitoring, and management. Accessible through both CLI and Web UI interfaces.
* **Scheduler**: Leverages NVIDIA Run:AI to intelligently allocate GPU and CPU resources across workflows, optimizing for utilization and fairness.
* **Workflow Engine**: Parses YAML workflow specifications, orchestrates task execution, handles dependencies, and manages the workflow state machine.
* **Authentication & Authorization**: Integrates with external identity providers (OIDC, SAML) to manage user access and permissions.

**Compute Layer**

OSMO connects to multiple Kubernetes clusters as compute backends:

* **Pools & Platforms**: Resources are organized into pools (logical groupings) and platforms (specific hardware types) allowing precise targeting of workloads.
* **Heterogeneous Support**: Connect cloud clusters (AKS, EKS, GKE), on-premise bare-metal clusters, and edge devices (NVIDIA Jetson) simultaneously.
* **Container Orchestration**: Each task in a workflow runs as a Kubernetes pod with specified container images, resource requirements, and environment configurations.

**Data Layer**

OSMO manages data through an abstraction layer:

* **Dataset Service**: Provides version-controlled storage for training data, models, and artifacts using content-addressable storage to deduplicate data.
* **Storage Backends**: Supports S3-compatible object storage and Azure Blob Storage with configurable credentials.
* **Data Injection**: Automatically mounts datasets into task containers at specified paths, enabling seamless access to inputs and outputs.

**How It Works**

1. **Workflow Submission**: Users submit YAML workflow specifications via CLI or Web UI after authentication.
2. **Workflow Parsing**: The workflow engine validates the specification and creates an execution graph based on task dependencies.
3. **Resource Allocation**: The scheduler evaluates resource requirements and assigns tasks to appropriate pools/platforms with available capacity.
4. **Task Execution**: Kubernetes spawns pods on compute nodes with the specified container images, mounted datasets, and environment variables.
5. **State Management**: The workflow engine monitors task states (pending, running, succeeded, failed) and triggers dependent tasks upon completion.
6. **Data Persistence**: Task outputs are automatically synced to configured datasets in object storage for downstream consumption.
7. **Interactive Access**: Users can connect to running tasks via SSH, VSCode Remote, or Jupyter for debugging and interactive development.

This architecture enables OSMO to scale from a single developer workstation to massive cloud deployments while maintaining a consistent interface and workflow experience. For detailed deployment procedures, refer to the deployment guide linked below.
