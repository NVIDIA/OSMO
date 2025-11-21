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

# Cosmos: Video2World Generation

This workflow demonstrates how to use NVIDIA Cosmos to generate world models from video input using the video2world functionality. The workflow uses the Cosmos Predict2 container to process video data and generate corresponding world representations.

## Prerequisites

- A valid Hugging Face token with access to NVIDIA Cosmos models
- GPU resources (1 GPU minimum as specified in the workflow)
- Sufficient storage (40Gi) and memory (64Gi) resources

## Configuration

The workflow requires a Hugging Face token to be configured as a credential. Make sure to set up your Hugging Face token in OSMO before running the workflow:

```bash
osmo credential set huggingface_token --type GENERIC --payload token=<your-hf-token>
```

In order for your workflow to pull the Cosmos model from HuggingFace, you will *need* to agree to the terms and
conditions for pulling the model. The terms and conditions submission can be found [here](https://huggingface.co/nvidia/Cosmos-Predict2-2B-Video2World).

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/cosmos/cosmos_video2world.yaml
osmo workflow submit cosmos_video2world.yaml
```

The workflow will take this input image below, and create a video from this image.

![Example Input Image](example_image.png)


## Output

After the workflow completes successfully, you can access the generated video through the `cosmos_video2world` dataset:

```bash
osmo dataset download cosmos_video2world
```

## More Information

For more details about NVIDIA Cosmos and its capabilities, visit the [NVIDIA Cosmos GitHub repository](https://github.com/nvidia-cosmos/cosmos-predict2).
