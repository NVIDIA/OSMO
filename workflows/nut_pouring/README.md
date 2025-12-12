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

## Overview

End-to-end (E2E) pipeline implementation is essential for developers seeking to utilize collected teleoperation (Teleop) data to train modern robotic policies. This workflow presents a robust, six-step data preparation and augmentation pipeline designed to transform raw Teleop data into a training-ready format for the powerful **GROOT-N1.5 Vision-Language-Action (VLA)** model, leveraging **NVIDIA OSMO** for workflow orchestration.

Using the **Nut-Pouring Task Dataset**—a multi-step industrial manipulation task—as a concrete example, we showcase the entire data lifecycle necessary to effectively leverage a foundation VLA model. The critical data pipeline steps demonstrated are:

- **MimicGen** - Synthetic demonstration generation
- **Data Format Conversion** - HDF5 ↔ MP4 transformations
- **Cosmos Transfer** - Visual augmentation for sim-to-real
- **LeRobot Format Conversion** - Training-ready dataset preparation

The pipeline culminates in a successful GROOT-N1.5 fine-tuning run, validating its ability to prepare data for this complex, cross-embodiment architecture. This provides a clear, actionable roadmap for constructing reliable E2E data pipelines using NVIDIA OSMO, allowing rapid fine-tuning of state-of-the-art VLA models from collected Teleop data.

## Data Flow

```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   Teleop     │    │   Synthetic  │    │   Augmented  │    │   LeRobot    │
│    HDF5      │───▶│   Demos      │───▶│    Videos    │───▶│   Dataset    │
│              │    │   (HDF5)     │    │   (MP4)      │    │   (Parquet)  │
└──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘
                           │                   │                   │
                           │                   │                   │
                     MimicGen            Cosmos Transfer      GROOT Training
                     (100x demos)        (Sim-to-Real)        (Fine-tune)
```

## Pipeline Steps

| Step | Workflow | Description | Input | Output |
|------|----------|-------------|-------|--------|
| 1 | `01_mimic_generation.yaml` | Generate synthetic demos from teleoperation data | Teleop HDF5 | Augmented HDF5 |
| 2 | `02_hdf5_to_mp4.yaml` | Extract camera observations to MP4 format | HDF5 | MP4 videos |
| 3 | `03_cosmos_augmentation.yaml` | Apply Cosmos Transfer 2.5 for visual augmentation | MP4 | Augmented MP4 |
| 4 | `04_mp4_to_hdf5.yaml` | Merge augmented videos back to HDF5 | MP4 | HDF5 |
| 5 | `05_lerobot_conversion.yaml` | Convert to LeRobot dataset format | HDF5 | LeRobot Dataset |
| 6 | `06_groot_finetune.yaml` | Fine-tune GROOT-N1.5-3B model | LeRobot Dataset | Fine-tuned Model |

## Prerequisites

- OSMO CLI installed and authenticated
- Access to GPU pool (RTX 6000 recommended)
- NGC API key for GROOT model access

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

## References

- [GROOT-N1.5 Documentation](https://developer.nvidia.com/groot)
- [NVIDIA OSMO](https://developer.nvidia.com/osmo)
- [Cosmos Transfer](https://developer.nvidia.com/cosmos)
- [LeRobot](https://huggingface.co/lerobot)
