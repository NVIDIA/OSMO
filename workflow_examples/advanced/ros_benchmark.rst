..
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

.. _ros_benchmark:

================================================
Benchmark Performance on Jetson
================================================

OSMO supports running workflows on Jetson machines, if the pool is configured to support them
in the cluster. It enables robotics developers to test the applications on the machine
architecture used to build the robot.

Example
-------

This workflow benchmarks the performance of ROS2 April Tag detection on Jetson hardware.
The workflow:

1. Sets up a ROS2 Humble container for ARM64 architecture
2. Installs dependencies and builds ROS2 packages
3. Downloads benchmarking assets
4. Runs launch tests to benchmark April Tag detection node performance

.. literalinclude:: ../../../samples/ros_benchmark_jetson/ros_benchmark.yaml
  :language: yaml

In the resources section of the workflow spec, update the ``platform`` field to target a Jetson
device that is available in the pool.

Create a scripts folder, if it has not been created and download the script
:download:`install_dependencies.sh <../../../samples/ros_benchmark_jetson/scripts/install_dependencies.sh>`
into the folder:

.. code-block:: bash

  $ mkdir -p <location of ros_benchmark.yaml>/scripts
