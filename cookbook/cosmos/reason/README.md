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

# Cosmos: Video Reasoning and Analysis

This workflow demonstrates how to use NVIDIA Cosmos Reason for advanced video understanding tasks including video captioning, question answering with reasoning, and temporal analysis.

## Overview

The Cosmos Reason workflow provides three main capabilities:
1. **Video Captioning**: Generate descriptive captions for video content
2. **Question Answering with Reasoning**: Ask questions about video content and receive reasoned answers
3. **Temporal Captioning**: Generate time-stamped captions with frame-by-frame analysis

## Prerequisites

- A valid Hugging Face token with access to NVIDIA Cosmos models
- GPU resources (1 GPU minimum as specified in the workflow)
- Sufficient storage (64Gi) and memory (64Gi) resources

## Configuration

The workflow requires a Hugging Face token to be configured as a credential. Make sure to set up your Hugging Face token in OSMO before running the workflow:

```bash
osmo credential set huggingface_token --type GENERIC --payload token=<your-hf-token>
```

In order for your workflow to pull the Cosmos model from HuggingFace, you will *need* to agree to the terms and conditions for pulling the model. The terms and conditions submission can be found [here](https://huggingface.co/nvidia/Cosmos-Predict2-2B-Video2World).

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/cosmos/reason/cosmos_reason.yaml
osmo workflow submit cosmos_reason.yaml
```

## Output

As the workflow runs, you can see the logs to see the model respond to the caption provided in the first command:

```bash
[reason] Assistant:
[reason]   The video captures a suburban street scene viewed from inside a moving
[reason] vehicle, likely equipped with a dashcam. The camera angle provides a clear view
[reason] of the road ahead, showcasing a residential area with well-maintained houses and
[reason] lush greenery. Several cars are parked along both sides of the street, including
[reason] a silver SUV on the left and a dark-colored sedan on the right. The houses
[reason] feature traditional architecture with stone accents and large windows,
[reason] surrounded by neatly trimmed lawns and mature trees.
[reason]
[reason]   As the vehicle progresses, it maintains a steady speed, passing by the parked
[reason] cars and approaching a crosswalk marked with white stripes. The road appears dry
[reason] and in good condition, with no visible obstructions. Overhead power lines run
[reason] parallel to the street, adding to the suburban ambiance. The sky is clear and
[reason] bright blue, indicating a sunny day with excellent visibility. The overall
[reason] environment suggests a peaceful neighborhood with minimal traffic activity.
```

The workflow will also answer the question asked in the workflow:

```bash
[reason] User:
[reason]   What are the potential safety hazards?

[reason]   <answer>
[reason]   The potential safety hazards in the scenario include:
[reason]   1. **Limited Visibility**: Parked vehicles along both sides of the street
[reason] could obstruct the driver's view of pedestrians, cyclists, or oncoming traffic,
[reason] especially near crosswalks.
[reason]   2. **Pedestrian Crossings**: The visible crosswalk suggests a risk of
[reason] pedestrians entering the roadway unexpectedly, particularly in a residential
[reason] area where children or pets might appear suddenly.
[reason]   3. **Blind Spots**: The ego vehicle's slow movement and parked cars may hide
[reason] hazards like opening car doors or vehicles approaching from the opposite
[reason] direction while turning.
[reason]   4. **Traffic Obstruction**: Parked cars might block emergency vehicle access
[reason] or create narrow pathways, increasing collision risks if the ego vehicle must
[reason] maneuver around them.
[reason]
[reason]   These factors emphasize the need for cautious driving, attentiveness to
[reason] surroundings, and adherence to traffic rules in a residential setting.
[reason]   </answer>
```

After the workflow completes successfully, you can access the generated temporal caption results and extracted frames through the `cosmos-reason-sample` dataset:

```bash
$ osmo dataset download cosmos-reason-sample ~/
```


## More Information

For more details about NVIDIA Cosmos Reason and its capabilities, visit:
- [NVIDIA Cosmos Reason GitHub repository](https://github.com/nvidia-cosmos/cosmos-reason1)
