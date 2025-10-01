//SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0
import { z } from "zod";

import { env } from "~/env.mjs";

export const WorkflowStatusValues = [
  "PENDING",
  "RUNNING",
  "WAITING",
  "COMPLETED",
  "FAILED",
  "FAILED_EXEC_TIMEOUT",
  "FAILED_CANCELED",
  "FAILED_QUEUE_TIMEOUT",
  "FAILED_SERVER_ERROR",
  "FAILED_SUBMISSION",
  "FAILED_BACKEND_ERROR",
  "FAILED_IMAGE_PULL",
  "FAILED_EVICTED",
  "FAILED_START_ERROR",
  "FAILED_START_TIMEOUT",
  "FAILED_PREEMPTED",
] as const;

export const TaskStatusValues = [
  "COMPLETED",
  "SUBMITTING",
  "SCHEDULING",
  "WAITING",
  "PROCESSING",
  "INITIALIZING",
  "RUNNING",
  "RESCHEDULED",
  "FAILED",
  "FAILED_EXEC_TIMEOUT",
  "FAILED_QUEUE_TIMEOUT",
  "FAILED_SERVER_ERROR",
  "FAILED_CANCELED",
  "FAILED_IMAGE_PULL",
  "FAILED_EVICTED",
  "FAILED_PREEMPTED",
  "FAILED_START_ERROR",
  "FAILED_UPSTREAM",
  "FAILED_BACKEND_ERROR",
  "FAILED_START_TIMEOUT",
] as const;

export const TaskSummaryStatusValues = [
  "SUBMITTING",
  "SCHEDULING",
  "WAITING",
  "PROCESSING",
  "INITIALIZING",
  "RUNNING",
] as const;

export const PriorityValues = ["LOW", "NORMAL", "HIGH"] as const;

export const OrderValues = ["DESC", "ASC"] as const;

/**
 * @see GET api/workflow
 * @example
 * {
 *   "workflows": [
 *     {
 *       "user": "albertos@nvidia.com",
 *       "name": "hello-osmo-yi76ywvscvg6hipvhieg4wzhgq",
 *       "submit_time": "2023-11-03T21:28:54.157866",
 *       "start_time": "2023-11-03T21:29:00.026839",
 *       "end_time": "2023-11-03T21:29:07.161254",
 *       "queued_time": 5.868973,
 *       "duration": 7.134415,
 *       "status": "COMPLETED",
 *       "logs":
 *   "https://stg2.osmo.nvidia.com:443/api/workflow/hello-osmo-yi76ywvscvg6hipvhieg4wzhgq/logs"
 *     },
 *     {
 *       "user": "albertos@nvidia.com",
 *       "name": "hello-osmo-ceryhaymvbextcb35g67uijxpq",
 *       "submit_time": "2023-11-03T21:29:20.954774",
 *       "start_time": "2023-11-03T21:29:27.320703",
 *       "end_time": "2023-11-03T21:29:34.662007",
 *       "queued_time": 6.365929,
 *       "duration": 7.341304,
 *       "status": "COMPLETED",
 *       "logs":
 *   "https://stg2.osmo.nvidia.com:443/api/workflow/hello-osmo-ceryhaymvbextcb35g67uijxpq/logs"
 *     },
 *   ]
 * }
 */

const WorkflowListItemSchema = z.object({
  user: z.string(),
  name: z.string(),
  node_name: z.string().nullable(),
  submit_time: z.string().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  queued_time: z.number(),
  duration: z.number().nullable(),
  status: z.enum(WorkflowStatusValues),
  logs: z.string(),
  parent_name: z.string().nullable().optional(),
  parent_job_id: z.number().nullable().optional(),
  grafana_url: z.string().nullable(),
  error_logs: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  workflow_uuid: z.string().optional(),
  dashboard_url: z.string().nullable(),
  pool: z.string().nullable(),
  priority: z.enum(PriorityValues),
});

export const WorkflowListRequestSchema = z.object({
  submitted_after: z.string().datetime().optional(),
  name: z.string().optional().default(""),
  limit: z.number().optional().default(1000),
  statuses: z.array(z.string()).optional().default([]),
  users: z.array(z.string()).optional().default([]),
  all_users: z.boolean().optional().default(false),
  offset: z.number().optional().default(0),
  pools: z.array(z.string()).optional().default([]),
  all_pools: z.boolean().default(true),
  order: z.enum(OrderValues).optional().default("DESC"),
  submitted_before: z.string().datetime().optional(),
  tags: z.array(z.string()).optional().default([]),
  priority: z.enum(PriorityValues).optional(),
});

/**
 * @see GET api/workflow/{name}
 * @example
 * {
 *   "name": "hello-osmo-4yqjgwvlz5fqxk3k2lqvohgnii",
 *   "uuid": "4yqjgwvlz5fqxk3k2lqvohgnii",
 *   "submitted_by": "albertos@nvidia.com",
 *   "cancelled_by": null,
 *   "logs":
 *   "https://us-west-2-aws.osmo.nvidia.com/api/workflow/hello-osmo-4yqjgwvlz5fqxk3k2lqvohgnii/logs",
 *   "dashboard_url":
 *   "https://isaac-hil-control.nvidia.com/dashboard/#/search?namespace=_all&q=4yqjgwvlz5fqxk3k2lqvohgnii",
 *   "grafana_url":
 *   "https://isaac-hil-control.nvidia.com/grafana/d/HExS-0HVk/workflow-resources?var-namespace=default&var-uuid=4yqjgwvlz5fqxk3k2lqvohgnii&from=now-19h&to=now-18h",
 *   "submit_time": "2023-11-28T23:04:48.371720",
 *   "start_time": "2023-11-28T23:04:55.685924",
 *   "end_time": "2023-11-28T23:05:02.371288",
 *   "exec_timeout": 21600,
 *   "queue_timeout": 86400,
 *   "duration": 6.685364,
 *   "queued_time": 7.314204,
 *   "status": "COMPLETED",
 *   "outputs": "",
 *   "groups": [
 *     {
 *       "name": "hello-group",
 *       "status": "COMPLETED",
 *       "start_time": "2023-11-28T23:04:55.685924",
 *       "end_time": "2023-11-28T23:05:02.371288",
 *       "remaining_upstream_groups": [],
 *       "downstream_groups": [],
 *       "failure_message": null,
 *       "tasks": [
 *         {
 *           "name": "hello",
 *           "status": "COMPLETED",
 *           "failure_message": null,
 *           "exit_code": 0,
 *           "start_time": "2023-11-28T23:04:55.685924",
 *           "end_time": "2023-11-28T23:05:02.371288",
 *           "input_download_start_time": "2023-11-28T23:04:55.248000",
 *           "input_download_end_time": "2023-11-28T23:04:55.249000",
 *           "output_upload_start_time": "2023-11-28T23:04:55.264000",
 *           "output_upload_end_time": "2023-11-28T23:04:55.265000",
 *           "pod_name": "hello-4yqjgwvlz5fqxk3k2lqvohgnii",
 *           "node_name": "osmo-x86-rtx3090-01"
 *         }
 *       ]
 *     }
 *   ],
 *   "backend": "isaac"
 * }
 */

export const TaskSchema = z.object({
  name: z.string(),
  status: z.enum(TaskStatusValues),
  failure_message: z.string().nullable(),
  exit_code: z.number().nullable(),
  start_time: z.string().nullable(),
  end_time: z.string().nullable(),
  input_download_start_time: z.string().nullable(),
  input_download_end_time: z.string().nullable(),
  output_upload_start_time: z.string().nullable(),
  output_upload_end_time: z.string().nullable(),
  initializing_start_time: z.string().nullable(),
  scheduling_start_time: z.string().nullable(),
  processing_start_time: z.string().nullable(),
  dashboard_url: z.string().nullable(),
  pod_name: z.string(),
  pod_ip: z.string().nullable(),
  task_uuid: z.string(),
  node_name: z.string().nullable(),
  logs: z.string().nullable(),
  events: z.string().nullable(),
  error_logs: z.string().nullable(),
  lead: z.boolean().optional().default(false),
  retry_id: z.number().nullable(),
});

export const GroupSchema = z.object({
  name: z.string(),
  status: z.enum(WorkflowStatusValues),
  start_time: z.string(),
  end_time: z.string(),
  remaining_upstream_groups: z.array(z.unknown()),
  downstream_groups: z.array(z.unknown()),
  failure_message: z.string().nullable(),
  tasks: z.array(TaskSchema),
});

export const WorkflowRequestSchema = z.object({
  name: z.string(),
  verbose: z.boolean().optional().default(false),
});

export const WorkflowResponseSchema = z.object({
  name: z.string(),
  uuid: z.string(),
  submitted_by: z.string(),
  cancelled_by: z.string().nullable(),
  logs: z.string().nullable(),
  events: z.string().nullable(),
  overview: z.string().nullable(),
  parent_name: z.string().nullable(),
  parent_job_id: z.number().nullable(),
  dashboard_url: z.string().nullable(),
  grafana_url: z.string().nullable(),
  submit_time: z.string(),
  start_time: z.string(),
  end_time: z.string(),
  exec_timeout: z.number(),
  queue_timeout: z.number(),
  duration: z.number(),
  queued_time: z.number(),
  status: z.enum(WorkflowStatusValues),
  outputs: z.string().nullable(),
  spec: z.string(),
  error_logs: z.string().nullable(),
  template_spec: z.string().nullable(),
  groups: z.array(GroupSchema),
  backend: z.string(),
  pool: z.string(),
  tags: z.array(z.string()),
  priority: z.enum(PriorityValues),
});

// Default error response type for unhandled failures
export const OSMOErrorResponseSchema = z.object({
  error_code: z.string().optional().default("UNKNOWN").nullable(),
  message: z.string().optional().default("No error message generated.").nullable(),
  workflow_id: z.string().nullable().optional(),
});

/**
 * @see GET api/workflow/{name}/logs
 * @example
 * 2023/11/28 23:04:55 [hello][osmo] Downloading Start
 * 2023/11/28 23:04:55 [hello][osmo] All Inputs Gathered
 * 2023/11/28 23:04:55 [hello] Hello from OSMO!
 * 2023/11/28 23:04:55 [hello] Error: read |0: file already closed
 * 2023/11/28 23:04:55 [hello][osmo] Upload Start
 * 2023/11/28 23:04:55 [hello][osmo] No Files in Output Folder
 * 2023/11/28 23:04:55 [hello][osmo] hello is running on osmo-x86-rtx3090-01
 */
export const WorkflowLogsRequestSchema = z.object({
  name: z.string(),
});

/**
 * @see GET api/workflow/{name}/spec
 * @example
 * workflow:
 *   name: hello-osmo
 *   tasks:
 *   - args:
 *     - /tmp/entry.sh
 *     command:
 *     - bash
 *     files:
 *     - contents: |-
 *         echo "Hello from OSMO!"
 *       path: /tmp/entry.sh
 *     image:
 *   ubuntu:22.04@sha256:2b7412e6465c3c7fc5bb21d3e6f1917c167358449fecac8176c6e496e5c1f05f
 *   name: hello
 */
export const WorkflowSpecRequestSchema = z.object({
  name: z.string(),
  use_template: z.boolean().optional().default(true),
});

/**
 * @see POST api/workflow/
 * @example
 * {
 *   "dashboard_url": "",
 *   "overview": ""
 *   "logs": "",
 *   "name": "",
 *   "spec": ""
 * }
 */

export const CreateWorkflowRequestSchema = z.object({
  file: z.string(),
  renderedSpec: z.string(),
  set_variables: z.array(z.string()),
  dry_run: z.boolean().optional().default(false),
  pool_name: z.string(),
  priority: z.enum(PriorityValues).optional().default("NORMAL"),
});

export const CreateWorkflowResponseSchema = z.object({
  dashboard_url: z.string().optional().nullable(),
  overview: z.string().optional().nullable(),
  logs: z.string().optional().nullable(),
  name: z.string(),
  spec: z.string().optional().nullable(),
});

/**
 * @see POST api/workflow/{name}/cancel
 * @example
 * {
 *   "name": "hello-osmo-yi76ywvscvg6hipvhieg4wzhgq"
 * }
 */
export const CancelWorkflowRequestSchema = z.object({
  name: z.string(),
  message: z.string().optional().nullable(),
  force: z.boolean().optional().default(false),
});

export const CancelWorkflowResponseSchema = z.object({
  name: z.string(),
});

/**
 * @see POST api/workflow/{name}/exec/task/{task_name}?entry_commnad=/bin/bash
 * @example
 * {
 *   "name": "hello-osmo-80",
 *    "task_name": "hello",
 *   "entry_command": "/bin/bash"
 * }
 */
export const ExecWorkflowRequestSchema = z.object({
  name: z.string(),
  task: z.string(),
  entry_command: z.string().optional().default("/bin/bash"),
});

export const ExecWorkflowResponseSchema = z.object({
  router_address: z.string(),
  key: z.string(),
  cookie: z.string(),
});

/**
 * @see POST api/workflow/{name}/webserver/{task_name}?port={port}
 * @example
 * {
 *   "name": "hello-osmo-80",
 *    "task_name": "hello",
 *   "port": "6006"
 * }
 */
export const WebServerWorkflowRequestSchema = z.object({
  name: z.string(),
  task: z.string(),
  port: z.number(),
});

export const WorkflowTagsRequestSchema = z.undefined();

export const WorkflowTagsResponseSchema = z.object({
  tags: z.array(z.string()),
});

export const WorkflowSetTagsRequestSchema = z.object({
  name: z.string(),
  add: z.array(z.string()).optional().default([]),
  remove: z.array(z.string()).optional().default([]),
});

export const CanceledWorkflowPayloadSchema = z.string();

export const WorkflowSpecResponseSchema = z.string();

export const WorkflowLogsResponseSchema = z.string();

export type WorkflowSlugParams = {
  params: {
    name: string;
  };
};

export type WorkflowListResponse = {
  workflows: WorkflowListItem[];
};

export type WorkflowStatusType = (typeof WorkflowStatusValues)[number];
export type TaskStatusType = (typeof TaskStatusValues)[number];
export type TaskSummaryStatusType = (typeof TaskSummaryStatusValues)[number];
export type PriorityType = (typeof PriorityValues)[number];

export type CanceledWorkflowPayload = z.infer<typeof CanceledWorkflowPayloadSchema>;
export type WorkflowSpecResponse = z.infer<typeof WorkflowSpecResponseSchema>;
export type WorkflowLogsResponse = z.infer<typeof WorkflowLogsResponseSchema>;
export type WorkflowResponse = z.infer<typeof WorkflowResponseSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type OSMOErrorResponse = z.infer<typeof OSMOErrorResponseSchema>;
export type WorkflowListItem = z.infer<typeof WorkflowListItemSchema>;
export type CreateWorkflowResponse = z.infer<typeof CreateWorkflowResponseSchema>;
export type WorkflowTagsResponse = z.infer<typeof WorkflowTagsResponseSchema>;
export type WorkflowTagsRequest = z.infer<typeof WorkflowTagsRequestSchema>;
export type CancelWorkflowResponse = z.infer<typeof CancelWorkflowResponseSchema>;
export type ExecWorkflowResponse = z.infer<typeof ExecWorkflowResponseSchema>;

export const ISAAC_SIM_SDG_WORKFLOW_FILE = `
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

workflow:
  name: isaac-sim-sdg
  tasks:
  - name: isaac-sim-sdg
    image: nvcr.io/nvidia/isaac-sim:4.0.0
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    environment:
      ACCEPT_EULA: Y
      NO_NUCLEUS: Y
    files:
    - contents: |
        set -e
        # Hide conflicting Vulkan files, if needed
        if [ -e "/usr/share/vulkan" ] && [ -e "/etc/vulkan" ]; then
          mv /usr/share/vulkan /usr/share/vulkan_hidden
        fi

        /isaac-sim/python.sh /isaac-sim/standalone_examples/replicator/scene_based_sdg/scene_based_sdg.py --config /tmp/config.json
        cp -r /isaac-sim/_out_scene_based_sdg/. {{output}}
      path: /tmp/entry.sh
    - contents: |
        {
            "launch_config": {
                "headless": true
            }
        }
      path: /tmp/config.json
    outputs:
    - dataset:
        name: isaac-sim-sdg-sample
  resources:
    default:
      cpu: 4
      gpu: 1
      memory: 16Gi
      storage: 10Gi
`;

export const MNIST_TRAINING_WORKFLOW_FILE = `
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

workflow:
  name: train-mnist
  tasks:
  - name: train
    image: nvcr.io/nvidia/pytorch:24.03-py3
    command: ["/bin/bash"]
    args: ["/tmp/entry.sh"]
    files:
      - path: /tmp/entry.sh
        contents: |
          set -ex

          # Directory to store best model + metadata as a ${env.NEXT_PUBLIC_APP_NAME} dataset
          MODEL_STORE_DIR="{{output}}/model/"
          # Directory to store metadata of this experiment as a OSMO dataset
          METADATA_FOLDER="{{output}}/metadata"
          # Internal directory for model checkpoints that will be stored in the metadata dataset
          CHECKPOINT_DIR="$METADATA_FOLDER/checkpoint/"

          # Create folders
          mkdir -p $METADATA_FOLDER
          mkdir -p $MODEL_STORE_DIR
          mkdir -p $CHECKPOINT_DIR

          wget -O /train.py https://raw.githubusercontent.com/pytorch/examples/37a1866d0e0118875d52071756f76b9b3e46c565/mnist/main.py

          # Train model
          python3 /train.py --save-model --no-mps || exit 0

          # Move model to output folder where the model will be uploaded
          mv mnist_cnn.pt $MODEL_STORE_DIR

    outputs:
      - dataset:
          name: mnist-model
          path: model
  resources:
    default:
      cpu: 4
      gpu: 1
      memory: 10Gi
      storage: 30Gi
`;

export const ROS_BENCHMARK_WORKFLOW_FILE = `
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

workflow:
  name: ros-benchmark-arm64
  tasks:
  # Run Apriltag Detection with ROS2 Benchmark
  - name: ros-benchmark-sample
    image: arm64v8/ros:humble
    lead: true
    command: ["bash"]
    args: ["/tmp/entry.sh"]
    files:
    - path: /tmp/entry.sh
      contents: |
        # Install dependencies, build ROS2 packages, and download benchmarking assets
        bash /install_dependencies.sh
        export R2B_WS_HOME=/workspaces/isaac_ros-dev

        source /opt/ros/humble/setup.bash
        source $R2B_WS_HOME/install/setup.bash
        launch_test $R2B_WS_HOME/src/ros2_benchmark/scripts/apriltag_ros_apriltag_node.py
    - path: /install_dependencies.sh
      contents: |
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

  # Define a resource that uses a Jetson (ARM64 machine)
  resources:
    default:
      cpu: 7
      memory: 16Gi
      storage: 20Gi
      # Uncomment this to target specific platform
      # platform: <ARM64 Jetson>
`;

export const TURTLEBOT_WORKFLOW_FILE = `
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

workflow:
  name: turtlebot-demo
  groups:
  - name: turtlebot
    tasks:
    # Task 1: Run Turtlebot, the navigation stack (Nav2), Gazebo, and foxglove_bridge.
    # foxglove_bridge can transmit ROS messages to a foxglove instance over a websocket
    # connection, on port 9090.
    - name: turtlebot-gazebo
      image: nvcr.io/nvidian/osmo/osrf_ros:latest
      lead: true
      command: ["bash"]
      args: ["/tmp/entry.sh"]
      files:
      - path: /tmp/entry.sh
        contents: |
          # Install dependencies
          apt update
          curl -sSL https://raw.githubusercontent.com/ros/rosdistro/master/ros.key -o /usr/share/keyrings/ros-archive-keyring.gpg
          echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/ros-archive-keyring.gpg] http://packages.ros.org/ros2/ubuntu $(. /etc/os-release && echo jammy) main" | sudo tee /etc/apt/sources.list.d/ros2.list > /dev/null
          apt -y install ros-humble-navigation2 ros-humble-nav2-bringup ros-humble-turtlebot3-gazebo ros-humble-foxglove-bridge

          # Set up environment variables
          source /opt/ros/humble/setup.bash
          export TURTLEBOT3_MODEL=waffle
          export GAZEBO_MODEL_PATH=$GAZEBO_MODEL_PATH:/opt/ros/humble/share/turtlebot3_gazebo/models

          # Launch Turtlebot, Nav2, Gazebo, and foxglove_bridge
          ros2 launch nav2_bringup tb3_simulation_launch.py use_simulator:=True headless:=False use_rviz:=False &
          ros2 launch foxglove_bridge foxglove_bridge_launch.xml port:=9090

    # Task 2: Run foxglove to see robot messages, listening at port 8080.
    - name: foxglove
      image: nvcr.io/nvidian/osmo/foxglove:latest
      command: ['/bin/sh', '/entrypoint.sh']
      args: ["caddy", "file-server", "--listen", ":8080"]

  resources:
    default:
      cpu: 1
      storage: 2Gi
      memory: 2Gi
`;
