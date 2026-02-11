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

# Hardware-in-the-Loop: Deploying Policy on Jetson

## Overview

This is a Hardware-in-the-Loop (HIL) workflow that demonstrates how to run ROS2 on an embedded system (Jetson) while running Isaac Lab simulation on a separate machine with a desktop GPU. The workflow consists of three main tasks running simultaneously:

1. **Discovery Server** - A ROS2 Discovery Server that routes messages between the embedded system and simulation machine
2. **Isaac Lab** - A headless Isaac Lab instance running a humanoid robot simulation with livestreaming capability
3. **Locomotion Policy** - A robot controller running on the embedded system that determines the robot's movement by publishing commands and subscribing to robot state

The workflow uses ROS2 Discovery Server to enable communication across different networks/subnets, which is essential when the embedded device and simulation machine are not on the same LAN.

## Files

The workflow includes several configuration and script files:

1. **hil_isaac_lab.yaml** - The main OSMO workflow specification file
2. **setup_discovery_server.sh** - Script that resolves discovery server IP and populates the correct environment variable for the discovery server
3. **install_dependencies.sh** - Script that installs dependencies needed for locomotion policy task

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/hil/setup_discovery_server.sh
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/hil/install_dependencies.sh
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/hil/hil_isaac_lab.yaml
osmo workflow submit hil_isaac_lab.yaml
```
