<!--
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
-->


<img src="./docs/front_cover.png" width="100%"/>

# Welcome to OSMO
### Workflow Orchestration Purpose-built for Physical AI

<a href="LICENSE"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License"></a>
<a href="https://nvidia.github.io/OSMO/main/user_guide"><img src="https://img.shields.io/badge/docs-latest-brightgreen.svg" alt="Documentation"></a>
<a href="https://kubernetes.io/"><img src="https://img.shields.io/badge/Kubernetes-Native-326ce5.svg" alt="Kubernetes"></a>
<a href="https://brev.nvidia.com/launchable/deploy?launchableID=env-36a6a7qnkOMOP2vgiBRaw2e3jpW"><img src="https://brev-assets.s3.us-west-1.amazonaws.com/nv-lb-dark.svg" alt="Brev deployment"></a>

<a href="#ready-to-begin">Get Started</a>
| <a href="#documentation">Documentation</a>
| <a href="#community--support">Community</a>
| <a href="#roadmap">Roadmap</a>


Use OSMO to manage your workflows, version your datasets and even remotely develop on a backend node. Using OSMO's backend configuration, run your workflows seamlessly on any cloud environment. Build a data factory to manage your synthetic and real robot data, train neural networks with experiment tracking, train robot policies with reinforcement learning, evaluate your models and publish the results, test the robot in simulation with software or hardware in loop (HIL) and automate your workflows on any CI/CD systems

<div align="center">
  <img src="./docs/user_guide/overview.svg" width="85%"/>
</div>


### For Robotics & AI Developers

**Write once, run anywhere.** Focus on building robots, not managing infrastructure.

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
    image: my-ros-app
    platform: jetson-agx-thor       # Runs on NVIDIA Jetson AGX Thor
    inputs:
    - task: train-policy            # Feed the output of the training task into eval
    outputs:
    - dataset:
        name: thor-benchmark        # Save the output benchmark into a dataset
```

- ✅ **Zero-Code Workflows** – Write workflows in YAML and iterate, not Python scripts
- ✅ **Truly Portable** – Same workflow runs on laptop (Docker/KIND) or cloud (EKS/AKS/GKE)
- ✅ **Interactive Development** – Launch VSCode, Jupyter, or SSH & develop remotely on cloud
- ✅ **Smart Storage** – Content-addressable datasets with deduplication save 10-100x on storage
- ✅ **Infrastructure-Agnostic** – Workflows never reference specific infrastructure—scale transparently

### For Platform & Infrastructure Engineers

Scale infrastructure independently. Add compute backends without disrupting developers.

- ✅ **Centralized Control Plane** – Single pane of glass for heterogeneous compute across clouds and regions
- ✅ **Plug-and-Play Backends** – Register new Kubernetes clusters dynamically via CLI
- ✅ **Geographic Distribution** – Deploy compute wherever it's available—cloud, on-prem, edge
- ✅ **Zero-Downtime Changes** – Scale GPU compute clusters without affecting users or their workflows


## Solving Physical AI

[Physical AI](https://www.nvidia.com/en-us/glossary/generative-physical-ai/) development uniquely requires orchestrating **three types of compute** working together:


| 🧠 **Training** | 🌐 **Simulation** | 🤖 **Edge** |
|:---:|:---:|:---:|
| GB200, H100 | L40, RTX Pro | Jetson AGX Thor |
| Deep learning & RL | Physics & Sensor Rendering | Hardware-in-the-Loop |
| Cloud  | Cloud | On Premise |



Traditionally, orchestrating workflows across these heterogeneous systems requires custom scripts, infrastructure expertise, and separate tooling for each environment.



OSMO solves this [Three Computer Problem](https://blogs.nvidia.com/blog/three-computers-robotics/) for robotics by orchestrating your entire Physical AI pipeline — from training to simulation to hardware testing all in a simple YAML. No custom scripts, no infrastructure expertise required. OSMO orchestrates tasks across heterogeneous Kubernetes clusters, managing dependencies and resource allocation. By solving this fundamental problem, OSMO brings us one step closer towards making Physical AI a reality.

<div align="center">
  <img src="./docs/user_guide/tutorials/hardware_in_the_loop/robot_simulation.svg" width="70%"/>
</div>




## Key Benefits


| **What You Can Do** | **Example** |
|---------------------|----------------------|
| **Interactively develop** on remote GPU nodes with VSCode, SSH, or Jupyter notebooks | [Interactive Workflows](https://nvidia.github.io/OSMO/main/user_guide/workflows/interactive/index.html) |
| **Generate synthetic data** at scale using Isaac Sim or custom simulation environments | [Isaac Sim SDG](https://nvidia.github.io/OSMO/main/user_guide/how_to/isaac_sim_sdg.html) |
| **Train models** with diverse datasets across distributed GPU clusters | [Model Training](https://nvidia.github.io/OSMO/main/user_guide/how_to/training.html) |
| **Train policies** for robots using data-parallel reinforcement learning | [Reinforcement Learning](https://nvidia.github.io/OSMO/main/user_guide/how_to/reinforcement_learning.html) |
| **Validate models** in simulation with hardware-in-the-loop testing | [Hardware In The Loop](https://nvidia.github.io/OSMO/main/user_guide/tutorials/hardware_in_the_loop/index.html) |
| **Transform and post-process data** for iterative improvement | [Working with Data](https://nvidia.github.io/OSMO/main/user_guide/tutorials/data/index.html) |
| **Benchmark system software** on actual robot hardware (NVIDIA Jetson, custom platforms) | [Hardware Testing](https://nvidia.github.io/OSMO/main/user_guide/how_to/hil.html) |

### Battle-Tested in Production

OSMO is production-grade and proven at scale. Originally developed to power Physical AI workloads at NVIDIA—including [Project GR00T](https://developer.nvidia.com/isaac/gr00t), [Isaac Lab](https://research.nvidia.com/publication/2025-09_isaac-lab-gpu-accelerated-simulation-framework-multi-modal-robot-learning), [Isaac Dexterity](https://developer.nvidia.com/blog/r2d2-adapting-dexterous-robots-with-nvidia-research-workflows-and-models/), [Isaac Sim](https://developer.nvidia.com/blog/build-synthetic-data-pipelines-to-train-smarter-robots-with-nvidia-isaac-sim), and [Isaac ROS](https://developer.nvidia.com/isaac/ros)—it orchestrates thousands of GPU-hours daily across heterogeneous compute spanning cloud training clusters to edge devices.

**Now open-source and ready for your robotics workflows.** Whether you're building humanoid robots, autonomous vehicles, or warehouse automation systems, OSMO provides the same enterprise-grade orchestration used in production at scale.

## Ready to Begin?

Select one of the deployment options below depending on your needs and environment to get started

<div align="center">
  <a href="https://nvidia.github.io/OSMO/main/deployment_guide/introduction/whats_next.html">
    <img src="./docs/deployment_options.svg" width="85%"/>
  </a>
</div>



## Documentation

| Resource | Description |
|:---------|:------------|
| 🚀 [**Local Deployment**](https://nvidia.github.io/OSMO/main/deployment_guide/appendix/deploy_local.html) | Run it locally on your workstation in 10 minutes |
| ⚡ [**Brev Deployment**](https://brev.nvidia.com/launchable/deploy?launchableID=env-36a6a7qnkOMOP2vgiBRaw2e3jpW) | Run it on a Brev instance with a GPU in 10 minutes |
| 🛠️ [**Cloud Deployment**](https://nvidia.github.io/OSMO/main/deployment_guide/) | Deploy production grade on cloud providers  |
| 📘 [**User Guide**](https://nvidia.github.io/OSMO/main/user_guide/) | Tutorials, workflows, and how-to guides for developers |
| 💡 [**Workflow Examples**](./workflows/) | Robotics workflow examples
| 💻 [**Getting Started**](https://nvidia.github.io/OSMO/main/user_guide/getting_started/install/index.html) | Install command-line interface to get started |

## Community & Support

**Join the community.** We welcome contributions, feedback, and collaboration from AI teams worldwide.

🐛 **[Report Issues](https://github.com/NVIDIA/OSMO/issues)** – Bugs, feature requests or technical help


## Roadmap
### Short term (Q1 2026)

| **Capability** | **How It Works** |
|:---------------|:-----------------|
| **Simplified Authentication & Authorization** | Use your existing identity provider without additional infrastructure. Connect directly to Azure AD, Okta, Google Workspace, or any OAuth 2.0 provider. Manage teams and permissions through simple CLI commands (`osmo group ...`). Share credentials at the pool level—eliminate repetitive individual user configuration. |
| **One-Click Cloud Deployment** | Deploy production-grade OSMO in minutes. Launch from Azure Marketplace or AWS Marketplace with pre-configured templates. Skip complex Kubernetes setup with automated infrastructure provisioning—no deep cloud or Kubernetes expertise required. |
| **Native Cloud Integration** | Simplify credential management when running in the cloud. Automatic IAM integration for Azure and AWS environments provides seamless access to cloud storage (S3, Azure Blob) and container registries—no manual credential configuration needed. |

### Long term (2026+)

| **Feature** | **What It Enables** |
|:------------|:--------------------|
| **Python-Native Workflows** | Define workflows programmatically for developers who prefer code over YAML. Use Python APIs to build dynamic workflows with loops, conditionals, and complex logic that integrate seamlessly with existing Python ML/robotics frameworks. |
| **Load-Aware Multi-Backend Scheduling** | Automatically optimize cost and performance across compute backends. OSMO selects the best cluster/pool for each workflow based on current utilization, reducing wait times and maximizing cluster efficiency without manual routing. |
| **High-Performance Data Caching** | Faster data access and broader storage compatibility. Transparent cluster-local caching reduces data transfer time for frequently used datasets, with support for high-performance filesystems (Lustre, NFS) alongside object storage (S3, GCS, Azure). |
| **Dynamically Changing Workflows** | Adjust workflow scale on-the-fly without restarts or interruptions. Scale running workflows up or down based on changing resource needs, modify parameters without rescheduling tasks, and respond to real-time requirements (e.g., add more GPUs mid-training, reduce simulation parallelism). |


---

**Built with 💚 by NVIDIA Robotics Team**

_Making Physical AI a reality, one workflow at a time._
