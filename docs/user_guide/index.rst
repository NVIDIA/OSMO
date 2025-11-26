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

.. _user_guide_welcome:

================================
**User Guide**
================================

**OSMO** is an open-source workflow orchestration platform purpose-built for Physical AI and robotics development.

Write your entire development pipeline for physical AI (training, simulation, hardware-in-loop testing) in declarative **YAML**. OSMO automatically coordinates tasks across heterogeneous compute, managing dependencies and resource allocation for you.

.. figure:: overview.svg
	:width: 100%
	:align: center
	:class: transparent-bg no-scaled-link zoomable

.. admonition:: 🚀 From workstation to cloud in minutes
  :class: info

  Develop on your laptop. Deploy to EKS, AKS, GKE, on-premise, or air-gapped clusters. **Zero code changes.**

`Physical AI <https://www.nvidia.com/en-us/glossary/generative-physical-ai/>`_ development uniquely requires orchestrating three types of compute:

* 🧠 **Training GPUs** (GB200, H100) for deep learning and reinforcement learning

* 🌐 **Simulation Hardware** (RTX PRO 6000) for realistic physics and sensor rendering

* 🤖 **Edge Devices** (Jetson AGX Thor) for hardware-in-the-loop testing and validation



.. figure:: tutorials/hardware_in_the_loop/robot_simulation.svg
  :align: center
  :class: transparent-bg no-scaled-link
  :width: 85%


**OSMO** solves this `Three Computer Problem <https://blogs.nvidia.com/blog/three-computers-robotics/>`_ for robotics by orchestrating your entire robotics pipeline with simple YAML workflows—no custom scripts, no infrastructure expertise required. By solving this fundamental challenge, OSMO brings us one step closer to making Physical AI a reality.


Why Choose OSMO
----------------

.. grid:: 2
    :gutter: 3

    .. grid-item-card:: 🚀 Zero-Code Orchestration
        :class-card: sd-border-1

        Write workflows in **simple YAML** - no coding overhead. Define what you want to run, OSMO handles the rest.

    .. grid-item-card:: ⚡ Group Scheduling
        :class-card: sd-border-1

        Run training, simulation, and edge testing **simultaneously** across heterogeneous hardware in a single workflow.

    .. grid-item-card:: 🌐 Truly Portable
        :class-card: sd-border-1

        Same workflow runs on your **laptop, cloud, or on-premise**—no infrastructure rewrites as you scale.

    .. grid-item-card:: 💾 Smart Storage
        :class-card: sd-border-1

        Content-addressable datasets with **automatic deduplication** save 10-100x on storage costs.

    .. grid-item-card:: 🔧 Interactive Development
        :class-card: sd-border-1

        Launch **VSCode, Jupyter, or SSH** into running tasks for live debugging and development.

    .. grid-item-card:: 🎯 Infrastructure-Agnostic
        :class-card: sd-border-1

        Write workflows without knowing (or caring) about underlying infrastructure. **Focus on robotics, not DevOps.**


How It Works
----------------

.. grid:: 4
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Define** 📝
        ^^^

        Write your workflow in YAML

        +++

        Describe tasks, resources, and dependencies

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **2. Submit** 🚀
        ^^^

        Launch via CLI or web UI

        +++

        Submit workflow, notified on completion

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **3. Execute** ⚙️
        ^^^

        OSMO orchestrates tasks in workflow

        +++

        Schedule tasks, manage dependencies

    .. grid-item-card::
        :class-header: sd-bg-warning sd-text-white

        **4. Iterate** 🔄
        ^^^

        Access results and refine

        +++

        Versioned datasets, real-time monitoring

**Example Workflow:**

.. code-block:: yaml

   # Your entire physical AI pipeline in a YAML file
   workflow:
     tasks:
     - name: simulation
       image: nvcr.io/nvidia/isaac-sim
       platform: rtx-pro-6000          # Runs on NVIDIA RTX PRO 6000 GPUs

     - name: train-policy
       image: nvcr.io/nvidia/pytorch
       platform: gb200                 # Runs on NVIDIA GB200 GPUs
       resources:
         gpu: 8
       inputs:                         # Feed the output of simulation task into training
        - task: simulation

     - name: evaluate-thor
       image: my-robot:latest
       platform: jetson-agx-thor       # Runs on NVIDIA Jetson AGX Thor
       inputs:
        - task: train-policy           # Feed the output of the training task into eval
       outputs:
        - dataset:
            name: thor-benchmark       # Save the output benchmark into a dataset


Key Benefits
------------

.. list-table::
   :widths: 50 50
   :header-rows: 1

   * - **What You Can Do**
     - **Example Tutorial**
   * - **Interactively develop** on remote GPU nodes with VSCode, SSH, or Jupyter notebooks
     - :doc:`Interactive Workflows <workflows/interactive/index>`
   * - **Generate synthetic data** at scale using Isaac Sim or custom simulation environments
     - :doc:`Isaac Sim SDG <how_to/isaac_sim_sdg>`
   * - **Train models** with diverse datasets across distributed GPU clusters
     - :doc:`Model Training <how_to/training>`
   * - **Train policies** for robots using data-parallel reinforcement learning
     - :doc:`Reinforcement Learning <how_to/reinforcement_learning>`
   * - **Validate models** in simulation with hardware-in-the-loop testing
     - :doc:`Hardware In The Loop <tutorials/hardware_in_the_loop/index>`
   * - **Transform and post-process data** for iterative improvement
     - :doc:`Working with Data <tutorials/data/index>`
   * - **Benchmark system software** on actual robot hardware (NVIDIA Jetson, custom platforms)
     - :doc:`Hardware Testing <how_to/hil>`


Bring Your Own Infrastructure
------------------------------

**Flexible Compute**

Connect any Kubernetes cluster to OSMO—cloud (AWS EKS, Azure AKS, Google GKE), on-premise clusters, or embedded devices like NVIDIA Jetson. OSMO enables you to share resources efficiently, optimizing for GPU utilization across heterogeneous hardware.

**Flexible Storage**

Connect any S3-compatible object storage or Azure Blob Storage. Store datasets and models with automatic version control, content-addressable deduplication, and seamless access across all compute backends.

.. toctree::
  :hidden:
  :caption: Introduction

  Overview <self>
  architecture
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
  3. Template and Tokens <tutorials/template_and_tokens>
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
