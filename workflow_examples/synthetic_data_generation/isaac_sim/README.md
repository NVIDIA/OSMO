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

# NVIDIA OSMO - Synthetic Data Generation

## Overview

This workflow uses Isaac Sim, a robotics simulator, to generate synthetic data that can be used to train deep neural
networks. The workflow consists of one main task that launches Isaac Sim.

## Prerequisites

- Access to an OSMO cluster with GPU resources

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/synthetic_data_generation/isaac_sim/isaac_sim_sdg.yaml

osmo workflow submit isaac_sim_sdg.yaml
```
