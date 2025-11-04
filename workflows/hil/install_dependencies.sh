#!/bin/bash
# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
# http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# SPDX-License-Identifier: Apache-2.0

set -e
apt update
git clone https://github.com/isaac-sim/IsaacSim-ros_workspaces.git && \
  cd IsaacSim-ros_workspaces && \
  git checkout 3beebfc2540486038f56a923effcea099aa49d3e && \
  git submodule update --init --recursive
cd humble_ws && \
  source /opt/ros/humble/setup.bash && \
  colcon build --symlink-install --packages-up-to h1_fullbody_controller
curl -s https://bootstrap.pypa.io/get-pip.py -o get-pip.py && \
  python3.10 get-pip.py --force-reinstall && \
  rm get-pip.py
pip3 install torch
