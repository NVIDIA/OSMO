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

# Isaac Groot: Imitation Learning using Groot Mimic

## Overview

This workflow allows you to generate additional robot demonstrations that can be used to train a visuomotor policy directly
using [Isaac Lab](https://isaac-sim.github.io/IsaacLab/main/index.html).
Afterwards, this workflow allows you to train an agent with the generated demonstrations.

The full tutorial from Isaac Lab can be found [here](https://isaac-sim.github.io/IsaacLab/release/2.3.0/source/overview/imitation-learning/teleop_imitation.html#generating-additional-demonstrations-with-isaac-lab-mimic).

## Running the Workflow
```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflows/groot/groot_mimic/groot_mimic.yaml
osmo workflow submit groot_mimic.yaml
```

You can find the generated demonstrations and agent checkpoints through the `mimic-dataset` dataset after the workflow completes:

```bash
osmo dataset download mimic-dataset
```
