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

- OSMO CLI installed and authenticated
- Access to GPU pool
- Isaac Sim environment

## Step 1: MobilityGen Data Generation

### Submit and Connect

Submit the workflow and enter the container's interactive shell to perform manual recording:

```bash
# Submit the YAML definition
osmo workflow submit workflows/mobility_gen/mobility_gen.yaml --pool <pool-name>
```

When the task logs: `"Isaac Sim Full Streaming App is loaded."`, run these commands in **two separate terminals**:

```bash
# Terminal 1: TCP port forwarding
osmo workflow port-forward <workflow-id> isaac-lab --port 47995-48012,49000-49007,49100 --connect-timeout 300

# Terminal 2: UDP port forwarding
osmo workflow port-forward <workflow-id> isaac-lab --port 47995-48012,49000-49007 --udp
```

### Building an Occupancy Map
Follow the [documentation](!https://docs.isaacsim.omniverse.nvidia.com/latest/synthetic_data_generation/tutorial_replicator_mobility_gen.html) to complete the below steps.

#### Load the Warehouse Stage

1. Open Content Browser: `Window > Browsers > Content`
2. Load the warehouse USD file: `Isaac Sim/Environments/Simple_Warehouse/warehouse_multiple_shelves.usd`

#### Create the Occupancy Map

1. Select `Tools > Robotics > Occupancy Map` to open the extension
2. Click **Calculate** to generate the occupancy map
3. Click **Visualize Image** to view the occupancy map
4. Save the file

**Verify:** You should now have `~/MobilityGenData/maps/warehouse_multiple_shelves/` containing `map.yaml` and `map.png`.

### Recording a Trajectory

#### Enable the MobilityGen UI Extension

1. Navigate to `Window > Extensions` and search for `MobilityGen UI`
2. Click the toggle switch to enable the extension

> **Note:** Two windows will appear - MobilityGen UI and Occupancy Map visualization. Drag them into view if one is hiding behind the other.

#### Build the Scenario

1. In the MobilityGen window under **Stage**, paste:
   ```
   http://omniverse-content-production.s3-us-west-2.amazonaws.com/Assets/Isaac/5.0/Isaac/Environments/Simple_Warehouse/warehouse_multiple_shelves.usd
   ```

2. Under **Occupancy Map**, enter the path:
   ```
   ~/MobilityGenData/maps/warehouse_multiple_shelves/map.yaml
   ```

3. Under **Robot** dropdown, select `H1Robot`
4. Under **Scenario** dropdown, select `KeyboardTeleoperationScenario`
5. Click **Build**

#### Test Drive and Record

Test drive the robot using keyboard controls:
- `W` - Move forward
- `A` - Turn left
- `S` - Move backwards
- `D` - Turn right

**Start Recording:**
1. Click **Start recording** to begin
2. Move the robot around
3. Click **Stop recording** to finish

Data is recorded to `~/MobilityGenData/recordings` by default.

### Replay and Render

After recording a trajectory (including robot poses), replay the scenario using the `replay_directory.py` script that ships with Isaac Sim.

**Verify:** After the script finishes, check `~/MobilityGenData/replays` for rendered sensor data.

> **Tip:** Visualize your recorded data using the [Gradio Visualization Script](https://github.com/NVIDIA-Omniverse/MobilityGen) from the MobilityGen GitHub Repository.

## Step 2: Cosmos Transfer Augmentation

Once raw trajectories are recorded, use Cosmos Transfer to apply diffusion-based photorealistic augmentation for enhanced sim-to-real performance.

### Submit the Augmentation Workflow

```bash
osmo workflow submit workflows/mobility_gen/cosmos_augmentation.yaml --pool <pool-name>
```

**Example Prompt:**
```
A realistic warehouse environment with consistent lighting, perspective, and camera motion. 
Preserve the original structure, object positions, and layout from the input video. 
Ensure the output exactly matches the segmentation video frame-by-frame in timing and content. 
Camera movement must follow the original path precisely.
```

### Scaling to Production

The workflow can be scaled to thousands of generations by customizing the workflows and Python scripts to leverage LLM pre-generated prompt variations.

## Monitoring

```bash
osmo workflow logs <workflow-id> -n 100
osmo workflow list
```

## Troubleshooting

For typical OSMO issues, follow the [official documentation](https://developer.nvidia.com/osmo).

## References

- [NVIDIA OSMO](https://developer.nvidia.com/osmo)
- [MobilityGen GitHub Repository](https://github.com/NVIDIA-Omniverse/MobilityGen)
- [Cosmos Transfer](https://developer.nvidia.com/cosmos)
- [Data Generation with MobilityGen Tutorial](https://docs.omniverse.nvidia.com/isaacsim/latest/features/warehouse_logistics/ext_omni_isaac_mobility_gen.html)
