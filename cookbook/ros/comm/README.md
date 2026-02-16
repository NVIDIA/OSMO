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

# ROS2: Multi-Node Communication

This workflow demonstrates ROS2 inter-node communication using a centralized Discovery Server architecture. It showcases how multiple ROS2 nodes on differemt machines can communicate across different containers in a distributed environment.

The workflow consists of three main tasks running simultaneously:

- **Discovery Server** - A centralized FastDDS Discovery Server that facilitates node discovery and communication routing
- **Talker Node** - A publisher node that sends messages using the demo_nodes_cpp talker
- **Listener Node** - A subscriber node that receives messages using the demo_nodes_cpp listener

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/cookbook/ros/comm/ros2_comm.yaml
osmo workflow submit ros2_comm.yaml
```
