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

# NVIDIA OSMO - Hardware-In-The-Loop using Isaac Lab

## Overview

This is a Hardware-in-the-Loop (HIL) workflow that demonstrates how to run ROS2 on an embedded system (Jetson Orin) while running Isaac Lab simulation on a separate machine with a desktop GPU. The workflow consists of three main tasks running simultaneously:

1. **Discovery Server** - A ROS2 Discovery Server that routes messages between the embedded system and simulation machine
2. **Isaac Lab** - A headless Isaac Lab instance running a humanoid robot simulation with livestreaming capability
3. **Locomotion Policy** - A robot controller running on the embedded system that determines the robot's movement by publishing commands and subscribing to robot state

The workflow uses ROS2 Discovery Server to enable communication across different networks/subnets, which is essential when the embedded device and simulation machine are not on the same LAN.

## Files

The workflow includes several configuration and script files:

1. **hil_isaac_lab.yaml** - The main OSMO workflow specification file
2. **rtps_udp_profile.xml** - DDS transport profile that configures UDP communication for ROS2 nodes using RTPS protocol
3. **discovery_server_config.xml** - Configuration file for DDS participant to act as a client connecting to the centralized discovery server
4. **setup_dds.sh** - Script that resolves discovery server IP and populates the IPs in the discovery server config file

## Required Hardware

- **Embedded System**: Jetson Orin (or similar ARM64 embedded system) for running the robot policy
- **Simulation Machine**: Machine with desktop GPU (e.g., L40) for running Isaac Lab simulation
- **Discovery Server Machine**: Any x86_64 machine (GPU not required) for running the ROS2 Discovery Server
- **Local Machine**: Machine with Isaac Sim Streaming Client installed for viewing the simulation

## Link to the full tutorial

TODO: Add link
The complete tutorial can be found [here](ADD LINK).
