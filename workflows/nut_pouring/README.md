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

# Nut Pouring: End-to-End VLA Fine-tuning Pipeline

End-to-end data pipeline for fine-tuning GROOT-N1.5 Vision-Language-Action model using the Nut-Pouring task on GR1 humanoid robot.

## Pipeline Overview

```
Teleop Data → MimicGen → HDF5 → MP4 → Cosmos Augmentation → HDF5 → LeRobot → GROOT Fine-tuning
```

| Step | Workflow | Description | 
|------|----------|-------------|
| 1 | `01_mimic_generation.yaml` | Generate synthetic demos from teleoperation data |
| 2 | `02_hdf5_to_mp4.yaml` | Extract camera observations to MP4 format |
| 3 | `03_cosmos_augmentation.yaml` | Apply Cosmos Transfer 2.5 for visual augmentation |
| 4 | `04_mp4_to_hdf5.yaml` | Merge augmented videos back to HDF5 |
| 5 | `05_lerobot_conversion.yaml` | Convert to LeRobot dataset format |
| 6 | `06_groot_finetune.yaml` | Fine-tune GROOT-N1.5-3B model |

## Prerequisites

- OSMO CLI installed and authenticated
- Access to GPU pool (RTX 6000 recommended)

## Running the Pipeline

Execute each step sequentially:

```bash
# Step 1: MimicGen data generation
osmo workflow submit 01_mimic_generation.yaml --pool default

# Step 2: HDF5 to MP4 conversion
osmo workflow submit 02_hdf5_to_mp4.yaml --pool default

# Step 3: Cosmos Transfer augmentation
osmo workflow submit 03_cosmos_augmentation.yaml --pool default

# Step 4: MP4 to HDF5 conversion
osmo workflow submit 04_mp4_to_hdf5.yaml --pool default

# Step 5: LeRobot format conversion
osmo workflow submit 05_lerobot_conversion.yaml --pool default

# Step 6: GROOT fine-tuning
osmo workflow submit 06_groot_finetune.yaml --pool default
```

## Monitoring

```bash
osmo workflow logs <workflow-id> -n 100
osmo workflow list
```

## Configuration

Each workflow uses parameterized default values. Override as needed:

```bash
osmo workflow submit 06_groot_finetune.yaml --pool default \
  --set max_steps=20000 \
  --set batch_size=64
```

## Key Components

- **MimicGen**: Isaac Lab's data augmentation framework for generating synthetic demonstrations
- **Cosmos Transfer 2.5**: Depth-conditioned video generation for sim-to-real visual augmentation
- **LeRobot**: Hugging Face dataset format for robot learning
- **GROOT-N1.5**: NVIDIA's Vision-Language-Action foundation model

