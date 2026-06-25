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

<a id="user-guide-welcome"></a>

# **User Guide**

**OSMO** is an open-source workflow orchestration platform purpose-built for Physical AI and robotics development.

Write your entire development pipeline for physical AI (training, simulation, hardware-in-loop testing) in declarative **YAML**. OSMO automatically coordinates tasks across heterogeneous compute, managing dependencies and resource allocation for you.

![image](user_guide/overview.svg)

> **🚀 From workstation to cloud in minutes**
>
> # 🚀 From workstation to cloud in minutes

> Develop on your laptop. Deploy to EKS, AKS, GKE, on-premise, or air-gapped clusters. **Zero code changes.**

[Physical AI](https://www.nvidia.com/en-us/glossary/generative-physical-ai/) development uniquely requires orchestrating three types of compute:

* 🧠 **Training GPUs** (GB200, H100) for deep learning and reinforcement learning
* 🌐 **Simulation Hardware** (RTX PRO 6000) for realistic physics and sensor rendering
* 🤖 **Edge Devices** (Jetson AGX Thor) for hardware-in-the-loop testing and validation

![image](user_guide/tutorials/hardware_in_the_loop/robot_simulation.svg)

**OSMO** solves this [Three Computer Problem](https://blogs.nvidia.com/blog/three-computers-robotics/) for robotics by orchestrating your entire robotics pipeline with simple YAML workflows—no custom scripts, no infrastructure expertise required. By solving this fundamental challenge, OSMO brings us one step closer to making Physical AI a reality.

## Why Choose OSMO

🚀 Zero-Code Orchestration

Write workflows in **simple YAML** - no coding overhead. Define what you want to run, OSMO handles the rest.

⚡ Group Scheduling

Run training, simulation, and edge testing **simultaneously** across heterogeneous hardware in a single workflow.

🌐 Truly Portable

Same workflow runs on your **laptop, cloud, or on-premise**—no infrastructure rewrites as you scale.

💾 Smart Storage

Content-addressable datasets with **automatic deduplication** save 10-100x on storage costs.

🔧 Interactive Development

Launch **VSCode, Jupyter, or SSH** into running tasks for live debugging and development.

🎯 Infrastructure-Agnostic

Write workflows without knowing (or caring) about underlying infrastructure. **Focus on robotics, not DevOps.**

## How It Works

**1. Define** 📝

Write your workflow in YAML

Describe tasks, resources, and dependencies

**2. Submit** 🚀

Launch via CLI or web UI

Submit workflow, notified on completion

**3. Execute** ⚙️

OSMO orchestrates tasks in workflow

Schedule tasks, manage dependencies

**4. Iterate** 🔄

Access results and refine

Versioned datasets, real-time monitoring

**Example Workflow:**

```yaml
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
```

## Key Benefits

| **What You Can Do**                                                                      | **Example Tutorial**                                            |
|------------------------------------------------------------------------------------------|-----------------------------------------------------------------|
| **Interactively develop** on remote GPU nodes with VSCode, SSH, or Jupyter notebooks     | [Interactive Workflows](workflows/interactive/index.md)         |
| **Generate synthetic data** at scale using Isaac Sim or custom simulation environments   | [Isaac Sim SDG](how_to/isaac_sim_sdg.md)                        |
| **Train models** with diverse datasets across distributed GPU clusters                   | [Model Training](how_to/training.md)                            |
| **Train policies** for robots using data-parallel reinforcement learning                 | [Reinforcement Learning](how_to/reinforcement_learning.md)      |
| **Validate models** in simulation with hardware-in-the-loop testing                      | [Hardware In The Loop](tutorials/hardware_in_the_loop/index.md) |
| **Transform and post-process data** for iterative improvement                            | [Working with Data](tutorials/data/index.md)                    |
| **Benchmark system software** on actual robot hardware (NVIDIA Jetson, custom platforms) | [Hardware Testing](how_to/hil.md)                               |

## Bring Your Own Infrastructure

**Flexible Compute**

Connect any Kubernetes cluster to OSMO—cloud (AWS EKS, Azure AKS, Google GKE), on-premise clusters, or embedded devices like NVIDIA Jetson. OSMO enables you to share resources efficiently, optimizing for GPU utilization across heterogeneous hardware.

**Flexible Storage**

Connect any S3-compatible object storage or Azure Blob Storage. Store datasets and models with automatic version control, content-addressable deduplication, and seamless access across all compute backends.

<!-- Optional how-to guides section can be included -->
<!-- Optional appendix section can be included -->
