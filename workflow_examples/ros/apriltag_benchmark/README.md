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

# NVIDIA OSMO - ROS2 AprilTag Detection Benchmark on Jetson

This example demonstrates how to run a ROS2 AprilTag detection benchmark workflow on Jetson hardware using OSMO.

OSMO supports running workflows on Jetson machines, enabling robotics developers to test applications on the same machine architecture used to build robots.
This workflow benchmarks the performance of ROS2 AprilTag detection on ARM64 Jetson hardware.

## Files

- `ros_benchmark.yaml`: Workflow configuration that defines the ROS2 benchmark task
- `install_dependencies.sh`: Script that sets up the ROS2 environment, installs dependencies, builds packages, and downloads benchmarking assets from the [NVIDIA ISAAC ROS2 Benchmark](https://github.com/NVIDIA-ISAAC-ROS/ros2_benchmark) repository

## Prerequisites

- Access to an OSMO cluster with Jetson (ARM64) hardware

## Running this workflow

```bash
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/ros/apriltag_benchmark/ros_benchmark.yaml
curl -O https://raw.githubusercontent.com/NVIDIA/OSMO/main/workflow_examples/ros/apriltag_benchmark/install_dependencies.sh
osmo workflow submit ros_benchmark.yaml --set platform=<platform>
```

> **Note:** You must update the `<platform>` field in the workflow's resources section to match a Jetson device available in your pool. Check with your cluster administrator for the correct platform identifier (e.g., `jetson-agx-orin`, `jetson-orin-nano`, etc.).
