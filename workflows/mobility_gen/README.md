<!--
SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.

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

# MobilityGen: Synthetic Data Generation for Mobile Robots

## Overview

This workflow leverages NVIDIA OSMO to generate occupancy maps and record trajectory data within Isaac Sim using MobilityGen. The pipeline includes optional Cosmos Transfer augmentation to generate photorealistic videos from synthetic robot data, reducing the sim-to-real gap and improving policy performance after deployment.

## Pipeline Steps

| Step | Workflow | Description |
|------|----------|-------------|
| 1 | `mobility_gen.yaml` | Generate occupancy maps and record trajectory data in Isaac Sim |
| 2 | `cosmos_augmentation.yaml` | Apply Cosmos Transfer for photorealistic augmentation |

## Prerequisites

- Access to an OSMO cluster with GPU resources
- [Isaac Sim environment](https://docs.isaacsim.omniverse.nvidia.com/latest/installation/install_workstation.html)

## Step 1: MobilityGen Data Generation

### Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/mobility_gen/mobility_gen.yaml
osmo workflow submit mobility_gen.yaml
```

When the task logs: `"Isaac Sim Full Streaming App is loaded."`, run these commands in **two separate terminals**:

```bash
# Terminal 1: TCP port forwarding
osmo workflow port-forward <workflow-id> mobilitygen_interactive --port 47995-48012,49000-49007,49100 --connect-timeout 300

# Terminal 2: UDP port forwarding
osmo workflow port-forward <workflow-id> mobilitygen_interactive --port 47995-48012,49000-49007 --udp
```

### Building an Occupancy Map

Follow the [MobilityGen documentation](https://docs.isaacsim.omniverse.nvidia.com/latest/synthetic_data_generation/tutorial_replicator_mobility_gen.html) to load the warehouse stage and create the occupancy map.

> **Note:** After completing the steps, verify that `~/MobilityGenData/maps/warehouse_multiple_shelves/` contains `map.yaml` and `map.png`.

### Recording a Trajectory

Follow the [Record a Trajectory documentation](https://docs.isaacsim.omniverse.nvidia.com/latest/synthetic_data_generation/tutorial_replicator_mobility_gen.html#record-a-trajectory) to enable the MobilityGen UI extension, build the scenario, and record trajectory data.

> **Note:** Data is recorded to `~/MobilityGenData/recordings` by default.

### Replay and Render

Follow the [Replay and Render documentation](https://docs.isaacsim.omniverse.nvidia.com/latest/synthetic_data_generation/tutorial_replicator_mobility_gen.html#replay-and-render) to replay the recorded trajectory using the `replay_directory.py` script.

> **Note:** After the script finishes, verify that `~/MobilityGenData/replays` contains the rendered sensor data.

> **Tip:** Visualize your recorded data using the [`visualize_data.py` script](https://github.com/NVIDIA-Omniverse/MobilityGen/blob/main/scripts/visualize_data.py) from the MobilityGen GitHub Repository.

## Step 2: Cosmos Transfer Augmentation

Once raw trajectories are recorded, use Cosmos Transfer to apply diffusion-based photorealistic augmentation for enhanced sim-to-real performance.

### Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/mobility_gen/cosmos_augmentation.yaml
osmo workflow submit cosmos_augmentation.yaml
```

**Example Prompt:**
```
A realistic warehouse environment with consistent lighting, perspective, and camera motion. 
Preserve the original structure, object positions, and layout from the input video. 
Ensure the output exactly matches the segmentation video frame-by-frame in timing and content. 
Camera movement must follow the original path precisely.
```
Please follow the Cosmos Transfer-2.5 [Documentation](https://github.com/nvidia-cosmos/cosmos-transfer2.5/blob/14d396cc94ea18e7f8f47b0fd385e3e438cf66c5/docs/inference.md) for configuring the prompt and other parameters.

### Scaling to Production

The workflow can be scaled to thousands of generations by customizing the workflows and Python scripts to leverage LLM pre-generated prompt variations.

## Monitoring

```bash
osmo workflow logs <workflow-id> -n 100
```
