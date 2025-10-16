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

================================
**Welcome to NVIDIA OSMO**
================================

OSMO is a cloud native platform for Robotics developers that provides a single interface to manage all steps of AI and robotics development, from compute to data storage.

What you get
------------

You get access to GPU compute and storage, and you don’t have to worry about backend infrastructure setup complexity to develop your AI workflows. You can scale workflows to large-sized clusters. You can develop workflows, test them in simulation, and benchmark on the hardware used to build the robot.

How you work
------------

* You create a workflow specification (YAML) describing your tasks
* You submit workflows with either the CLI or the web UI
* OSMO runs multiple containers as defined in your workflow on the OSMO backend
* Each OSMO backend is a Kubernetes cluster of compute nodes


What you do
------------

* Interactively develop on remote nodes with VSCode or SSH or Jupyter notebooks
* Generate your synthetic Data
* Train your models using diverse datasets
* Train policies for your robots using data-parallel reinforcement learning
* Validate your models in simulation with hardware in the loop
* Transform and post process your data for iteration
* Validate your system software with robot hardware

Lifecycle at a glance
----------------------

* Define your workflow in YAML
* Submit workflows after authentication
* Scheduler assigns tasks to resources as defined in your workflow
* Tasks run on the compute nodes
* Results and data go to your preconfigured data storage
* Iterate as needed


Why choose OSMO
---------------

OSMO makes it easy for developers to scale from PC or workstations to large sized compute clusters in the cloud without any code change. Complex workflows that run across multiple compute nodes are reduced to YAML "recipes" that are:

* Easy to write and share with your team
* Templated to allow for easy reuse and scale/override on the fly
* Reproducible

OSMO provides a single interface of abstraction for managing your compute, data and enables you to iteratively run all of your workflows.


**Bring your own compute**

You can connect any Kubernetes cluster to OSMO. Scale with cloud clusters like AKS, EKS, or GKE. Include on-premise bare-metal clusters and embedded devices such as NVIDIA Jetson for hardware-in-the-loop testing and simulation.

OSMO uses NVIDIA Run:AI scheduler to share resources efficiently optimizing for GPU utilization.

**Bring your own storage**

You can connect any S3 API compatible object storage and Azure Blob Storage to OSMO. Store your data and models with version control. Use content-addressable storage to deduplicate data across dataset versions, reducing costs and speeding uploads/downloads.


High Level Architecture
-----------------------

.. image:: arch.png
	:width: 800

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

Quickstart
--------------

Visit our `Quick Start guide <https://github.com/NVIDIA/OSMO/blob/main/QUICK_START.md>`_ to try OSMO on your local machine

Scaling to Cloud
-----------------
For a full, production-ready deployment, see one the following guides:

* `Azure <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/azure/example>`_
* `AWS <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/aws/example>`_

What's Next?
------------

* Follow :doc:`Getting Started </getting_started/getting_started_ui>` to run your very first workflow
* Review :doc:`Tutorials </tutorials/osmo_in_20>` to run sample workflows
* Scan through the :doc:`FAQs </faq/index>` for answers to common questions
* Refer to :doc:`Troubleshooting </troubleshooting/index>` to debug issues

.. toctree::
  :hidden:
  :caption: Getting Started

  getting_started/getting_started_ui
  getting_started/getting_started_cli

.. toctree::
  :hidden:
  :caption: Concepts

  concepts/index
  concepts/resources_pools_platforms/index
  concepts/workflows_tasks/index
  concepts/apps/index
  concepts/datasets/index

.. toctree::
  :hidden:
  :caption: Settings

  settings/credentials/index
  settings/access_token
  settings/notifications/index

.. toctree::
  :hidden:
  :caption: Tutorials

  tutorials/osmo_in_20
  tutorials/sdg
  tutorials/training
  tutorials/hil
  tutorials/groot
  tutorials/workflow_examples

.. toctree::
  :hidden:

  faq/index
  troubleshooting/index

.. toctree::
  :hidden:
  :caption: Reference

  reference/cli/index
