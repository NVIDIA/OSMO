# SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
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

# These instructions are from the ROS2 Benchmark Quickstart section:
# https://github.com/NVIDIA-ISAAC-ROS/ros2_benchmark

export R2B_WS_HOME=/workspaces/isaac_ros-dev && \
    export ROS2_BENCHMARK_OVERRIDE_ASSETS_ROOT=$R2B_WS_HOME/src/ros2_benchmark/assets && \
    apt update && apt install -y git wget git-lfs ros-humble-ament-cmake-ros

mkdir -p $R2B_WS_HOME/src && cd $R2B_WS_HOME/src && \
    git clone https://github.com/NVIDIA-ISAAC-ROS/ros2_benchmark.git && cd ros2_benchmark && \
    git checkout d16541bd055b91a7e9bf9b61bce3f64431006485 && \
cd $R2B_WS_HOME/src && \
    git clone https://github.com/christianrauch/apriltag_ros.git && cd apriltag_ros && \
    git checkout e109dea361900bdb2fd36d7ce49088eecce04196 && \
cd $R2B_WS_HOME && \
    apt update && \
    rosdep install -i -r --from-paths src --rosdistro humble -y

cd $R2B_WS_HOME/src && \
    git clone https://github.com/ros-perception/vision_opencv.git && cd vision_opencv && \
    git checkout 066793a23e5d06d76c78ca3d69824a501c3554fd && \
cd $R2B_WS_HOME/src && \
    git clone https://github.com/ros-perception/image_pipeline.git && cd image_pipeline && \
    git checkout 975548a97abf5de7cdebfd0c8be6712fe128bcee && \
    git config user.email "benchmarking@ros2_benchmark.com" && git config user.name "ROS 2 Developer" && \
    wget https://raw.githubusercontent.com/NVIDIA-ISAAC-ROS/ros2_benchmark/main/resources/patch/resize_qos_profile.patch && \
    git apply resize_qos_profile.patch && \
cd $R2B_WS_HOME && \
    apt update && \
    rosdep install -i -r --from-paths src --rosdistro humble -y && \
    source /opt/ros/humble/setup.bash
    colcon build --packages-up-to image_proc

mkdir -p $R2B_WS_HOME/src/ros2_benchmark/assets/datasets/r2b_dataset/r2b_storage && \
cd $R2B_WS_HOME/src/ros2_benchmark/assets/datasets/r2b_dataset/r2b_storage && \
    wget --content-disposition -O metadata.yaml 'https://api.ngc.nvidia.com/v2/resources/nvidia/isaac/r2bdataset2023/versions/1/files/r2b_storage/metadata.yaml' && \
    wget --content-disposition -O r2b_storage_0.db3 'https://api.ngc.nvidia.com/v2/resources/nvidia/isaac/r2bdataset2023/versions/1/files/r2b_storage/r2b_storage_0.db3'

cd $R2B_WS_HOME && \
    source /opt/ros/humble/setup.bash && \
    colcon build --packages-up-to ros2_benchmark apriltag_ros && \
    source install/setup.bash
