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

.. image:: overview.svg
	:width: 800

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


.. toctree::
  :hidden:
  :caption: Introduction

  Overview <self>
  high_level_architecture
  whats_next

.. toctree::
  :hidden:
  :caption: Getting Started

  getting_started/system_requirements
  getting_started/install/index
  getting_started/profile
  getting_started/credentials
  getting_started/next_steps

.. toctree::
  :hidden:
  :caption: Tutorials

  tutorials/overview
  1. Hello World <tutorials/hello_world/index>
  2. Requesting Resources <tutorials/requesting_resources>
  3. Template and Tokens <tutorials/template_and_token/index>
  4. Working with Data <tutorials/data/index>
  5. Serial Workflows <tutorials/serial_workflows/index>
  6. Parallel Workflows <tutorials/parallel_workflows/index>
  7. Combination Workflows <tutorials/combination_workflows/index>
  8. Hardware In The Loop <tutorials/hardware_in_the_loop/index>
  9. Advanced Patterns <tutorials/advanced_patterns>

.. toctree::
  :hidden:
  :caption: How-to Guides

  how_to/isaac_sim_sdg
  how_to/reinforcement_learning
  how_to/ros2_comm
  how_to/training
  how_to/isaac_groot_notebook
  how_to/hil

..
  Optional how-to guides section can be included
..
.. auto-include:: how_to/*.in.rst

.. toctree::
  :hidden:

  More Examples <https://github.com/NVIDIA/OSMO/tree/main/workflows>

.. toctree::
  :hidden:
  :caption: Workflows

  workflows/index
  workflows/specification/index
  workflows/submission
  workflows/lifecycle/index
  workflows/interactive/index
  workflows/exit_codes
  workflows/apps

.. toctree::
  :hidden:
  :caption: Resource Pools

  resource_pools/index
  resource_pools/scheduling/index

.. toctree::
  :hidden:
  :caption: Help

  faq/index
  troubleshooting/index

.. toctree::
  :hidden:
  :caption: Appendix

  appendix/cli/index

..
  Optional appendix section can be included
..
.. auto-include:: appendix/index.in.rst
