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

# Cosmos: Transfer2.5 with Isaac Sim Integration

This workflow demonstrates a data augmentation pipeline that combines NVIDIA Isaac Sim synthetic data generation with Cosmos Transfer2.5 for high-quality visual simulation.

## Overview

This integrated workflow provides two main capabilities:

1. **Synthetic Data Generation**: Uses Isaac Sim to generate warehouse simulation data with RGB, depth, and segmentation modalities
2. **Data Augmentation**: Uses Cosmos Transfer2.5 to transform the synthetic data into realistic variations with multiple control inputs

This approach minimizes the need for achieving high fidelity in 3D simulation while maximizing the diversity and realism of training data for Physical AI applications.

## Prerequisites

- A valid Hugging Face token with access to NVIDIA Cosmos models
- RTX-Enabled GPU for Isaac Sim Task
- H100 (or better) GPU for Cosmos Transfer Task

## Configuration

The workflow requires a Hugging Face token to be configured as a credential:

```bash
osmo credential set huggingface_token --type GENERIC --payload token=<your-hf-token>
```

You must agree to the terms and conditions for the Cosmos model on Hugging Face:
- [Cosmos-Predict2-2B-Video2World Terms](https://huggingface.co/nvidia/Cosmos-Predict2-2B-Video2World)

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/cosmos/transfer/cosmos_transfer.yaml
osmo workflow submit cosmos_transfer.yaml
```

## What the workflow does

### Phase 1: Synthetic Data Generation
1. **Isaac Sim Setup**: Launches Isaac Sim in headless mode
2. **Scene Generation**: Runs the warehouse scene generator with Cosmos writer
3. **Multi-modal Output**: Generates RGB video, depth maps, segmentation masks
4. **Data Export**: Packages all modalities into a structured dataset

### Phase 2: Data Augmentation
1. **Environment Setup**: Installs Cosmos Transfer2.5 and dependencies
2. **Model Authentication**: Authenticates with Hugging Face for model access
3. **Multi-control Processing**: Uses multiple control inputs (visual, edge, depth, segmentation)
4. **Realistic Transformation**: Generates high-quality realistic variations with the prompt:
   > "High-quality warehouse simulation..."

## Control Inputs and Weights

The workflow uses multiple control modalities with balanced weights:

- **Visual Control**: 25% weight - Overall visual appearance guidance
- **Edge Control**: 25% weight - Structural boundary preservation
- **Depth Control**: 25% weight - 3D spatial structure maintenance
- **Segmentation Control**: 25% weight - Object and semantic region consistency

## Output

After successful completion, you can access the results through two datasets:

### Isaac Sim Synthetic Data
```bash
osmo dataset download isaac-sim-cosmos-warehouse-sample
```

### Cosmos Transfer Augmented Data
```bash
osmo dataset download cosmos-transfer-sample
```

The final output includes:
- Augmented warehouse videos with realistic appearance
- Preserved spatial and semantic structure from original synthetic data

## More Information

For more details about the components used in this workflow:

- [NVIDIA Isaac Sim](https://developer.nvidia.com/isaac-sim)
- [Cosmos Transfer2.5 GitHub](https://github.com/nvidia-cosmos/cosmos-transfer2.5)
- [NVIDIA Cosmos Platform](https://research.nvidia.com/labs/dir/cosmos-transfer2.5)
