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

export const GROOT_WORKFLOW_FILE = `
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
  name: groot-tutorial
  resources:
    default:
      cpu: 4
      gpu: 1
      memory: 32Gi
      storage: 30Gi
  tasks:
  - args:
    - /tmp/entry.sh
    command:
    - /bin/bash
    environment:
      DEBIAN_FRONTEND: 'noninteractive'
    files:
    - contents: |-
        apt update && \
            apt install -y tzdata && \
            ln -fs /usr/share/zoneinfo/America/Los_Angeles /etc/localtime && \
            apt install -y netcat dnsutils && \
            apt-get update && \
            apt-get install -y libgl1-mesa-glx git libvulkan-dev \
            zip unzip wget curl git git-lfs build-essential cmake \
            vim less sudo htop ca-certificates man tmux ffmpeg tensorrt \
            # Add OpenCV system dependencies
            libglib2.0-0 libsm6 libxext6 libxrender-dev

        git clone https://github.com/NVIDIA/Isaac-GR00T.git && \
          cd Isaac-GR00T && \
          git checkout 796ca8d87360913c47e9f75e17c11d63f7805048

        pip install --upgrade setuptools && \
          pip install gpustat wandb==0.19.0 && \
          pip install -e .[base] && \
          pip install jupyterlab==4.0.10

        pip uninstall -y transformer-engine && \
          pip install flash_attn==2.7.1.post4 -U --force-reinstall && \
          pip uninstall -y opencv-python opencv-python-headless || true && \
          rm -rf /usr/local/lib/python3.10/dist-packages/cv2 || true && \
          pip install opencv-python==4.8.0.74 && \
          pip install --force-reinstall torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 numpy==1.26.4

        pip install -e . --no-deps && \
          pip install accelerate>=0.26.0

        jupyter lab --notebook-dir=$PWD/getting_started --no-browser --ip=0.0.0.0 --port=6060 --allow-root --ServerApp.allow_remote_access=True --FileContentsManager.delete_to_trash=False --IdentityProvider.token=''

      path: /tmp/entry.sh
    image: pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel
    name: tutorial
`;

export const HIL_WORKFLOW_FILE = `
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
  groups:
  - name: hardware-in-loop
    tasks:
    - command:
      - bash
      - /tmp/entry.sh
      files:
      - contents: |-
          set -e
          # sleep 10000
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
          source /opt/ros/humble/setup.bash && \
            source install/setup.bash
          export LD_LIBRARY_PATH=/opt/hpcx/ucx/lib:$LD_LIBRARY_PATH
          export FASTRTPS_DEFAULT_PROFILES_FILE=/usr/local/share/middleware_profiles/rtps_udp_profile.xml
          source /tmp/setup_dds.sh
          ros2 launch h1_fullbody_controller h1_fullbody_controller.launch.py
        path: /tmp/entry.sh
      - contents: |-
          <?xml version="1.0" encoding="UTF-8" ?>
          <profiles xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles" >
              <transport_descriptors>
                  <transport_descriptor>
                      <transport_id>UdpTransport</transport_id>
                      <type>UDPv4</type>
                  </transport_descriptor>
              </transport_descriptors>

              <participant profile_name="udp_transport_profile" is_default_profile="true">
                  <rtps>
                      <userTransports>
                          <transport_id>UdpTransport</transport_id>
                      </userTransports>
                      <useBuiltinTransports>false</useBuiltinTransports>
                  </rtps>
              </participant>
          </profiles>
        path: /usr/local/share/middleware_profiles/rtps_udp_profile.xml
      - contents: |-
          <?xml version="1.0" encoding="UTF-8" ?>

          <dds>
              <profiles xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles">
                  <participant profile_name="super_client_profile" is_default_profile="true">
                      <rtps>
                          <builtin>
                              <discovery_config>
                                  <discoveryProtocol>CLIENT</discoveryProtocol>
                                  <discoveryServersList>
                                      <RemoteServer prefix="44.53.00.5f.45.50.52.4f.53.49.4d.41">
                                          <metatrafficUnicastLocatorList>
                                              <locator>
                                                  <udpv4>
                                                      <address>DISCOVERY_SERVER_IP</address>
                                                      <port>11811</port>
                                                  </udpv4>
                                              </locator>
                                          </metatrafficUnicastLocatorList>
                                      </RemoteServer>
                                  </discoveryServersList>
                              </discovery_config>
                              <metatrafficUnicastLocatorList>
                                  <locator>
                                      <udpv4>
                                          <address>CURRENT_MACHINE_PUBLIC_IP</address>
                                          <port>7778</port>
                                      </udpv4>
                                  </locator>
                              </metatrafficUnicastLocatorList>
                         </builtin>
                              <defaultUnicastLocatorList>
                                  <locator>
                                      <udpv4>
                                          <address>CURRENT_MACHINE_PUBLIC_IP</address>
                                          <port>7777</port>
                                      </udpv4>
                                  </locator>
                              </defaultUnicastLocatorList>
                      </rtps>
                  </participant>
              </profiles>
          </dds>
        path: /workspaces/config/mounted_discovery_server_config.xml
      - contents: |-
          #!/bin/bash
          set -x +e
          sudo apt update
          # set noninteractive installation
          export DEBIAN_FRONTEND=noninteractive
          # install tzdata package
          apt-get install -y tzdata
          # set timezone
          ln -fs /usr/share/zoneinfo/America/Los_Angeles /etc/localtime
          dpkg-reconfigure --frontend noninteractive tzdata
          sudo apt install -y net-tools netcat dnsutils

          NAT_INTERFACE=eth0
          NAT_IP=$(ifconfig "$NAT_INTERFACE" | grep -oP "inet \K\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")

          DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
              'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')

          while [[ $DISCOVERY_SERVER_IP == "" ]] ; do
              sleep 10
              DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
              'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')
          done

          # Add in IP information in discovery server config
          sudo cp /workspaces/config/mounted_discovery_server_config.xml \
              /workspaces/config/discovery_server_config.xml
          DDS_CONFIG_XML_PATH=/workspaces/config/discovery_server_config.xml
          sudo sed -i "s/DISCOVERY_SERVER_IP/$DISCOVERY_SERVER_IP/g" $DDS_CONFIG_XML_PATH
          sudo sed -i "s/CURRENT_MACHINE_PUBLIC_IP/$NAT_IP/g" $DDS_CONFIG_XML_PATH
          # Add env variables
          export ROS_DISCOVERY_SERVER=$DISCOVERY_SERVER_IP:11811
          export FASTRTPS_DEFAULT_PROFILES_FILE=$DDS_CONFIG_XML_PATH
        path: /tmp/setup_dds.sh
      image: arm64v8/ros:humble@sha256:584d92e06114bb0345ccd7c725675450bfce6858e2f84059d6f35cca600bbc60
      name: locomotion-policy
      resource: jetson
    - command:
      - bash
      - /tmp/entry.sh
      files:
      - contents: |-
          # sleep 10000
          export FASTRTPS_DEFAULT_PROFILES_FILE=/usr/local/share/middleware_profiles/rtps_udp_profile.xml
          apt update && apt install -y net-tools netcat dnsutils sudo
          source /tmp/setup_dds.sh
          cd /isaac-sim
          export ACCEPT_EULA=Y
          ./runheadless.sh --/app/livestream/enabled=true
        path: /tmp/entry.sh
      - contents: |-
          <?xml version="1.0" encoding="UTF-8" ?>
          <profiles xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles" >
              <transport_descriptors>
                  <transport_descriptor>
                      <transport_id>UdpTransport</transport_id>
                      <type>UDPv4</type>
                  </transport_descriptor>
              </transport_descriptors>

              <participant profile_name="udp_transport_profile" is_default_profile="true">
                  <rtps>
                      <userTransports>
                          <transport_id>UdpTransport</transport_id>
                      </userTransports>
                      <useBuiltinTransports>false</useBuiltinTransports>
                  </rtps>
              </participant>
          </profiles>
        path: /usr/local/share/middleware_profiles/rtps_udp_profile.xml
      - contents: |-
          <?xml version="1.0" encoding="UTF-8" ?>
          <dds>
              <profiles xmlns="http://www.eprosima.com/XMLSchemas/fastRTPS_Profiles">
                  <participant profile_name="super_client_profile" is_default_profile="true">
                      <rtps>
                          <builtin>
                              <discovery_config>
                                  <discoveryProtocol>CLIENT</discoveryProtocol>
                                  <discoveryServersList>
                                      <RemoteServer prefix="44.53.00.5f.45.50.52.4f.53.49.4d.41">
                                          <metatrafficUnicastLocatorList>
                                              <locator>
                                                  <udpv4>
                                                      <address>DISCOVERY_SERVER_IP</address>
                                                      <port>11811</port>
                                                  </udpv4>
                                              </locator>
                                          </metatrafficUnicastLocatorList>
                                      </RemoteServer>
                                  </discoveryServersList>
                              </discovery_config>
                              <metatrafficUnicastLocatorList>
                                  <locator>
                                      <udpv4>
                                          <address>CURRENT_MACHINE_PUBLIC_IP</address>
                                          <port>7778</port>
                                      </udpv4>
                                  </locator>
                              </metatrafficUnicastLocatorList>
                         </builtin>
                              <defaultUnicastLocatorList>
                                  <locator>
                                      <udpv4>
                                          <address>CURRENT_MACHINE_PUBLIC_IP</address>
                                          <port>7777</port>
                                      </udpv4>
                                  </locator>
                              </defaultUnicastLocatorList>
                      </rtps>
                  </participant>
              </profiles>
          </dds>
        path: /workspaces/config/mounted_discovery_server_config.xml
      - contents: |-
          #!/bin/bash

          set -x +e
          sudo apt update
          # set noninteractive installation
          export DEBIAN_FRONTEND=noninteractive
          # install tzdata package
          apt-get install -y tzdata
          # set timezone
          ln -fs /usr/share/zoneinfo/America/Los_Angeles /etc/localtime
          dpkg-reconfigure --frontend noninteractive tzdata
          sudo apt install -y net-tools netcat dnsutils

          NAT_INTERFACE=eth0
          NAT_IP=$(ifconfig "$NAT_INTERFACE" | grep -oP "inet \K\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")

          DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
              'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')

          while [[ $DISCOVERY_SERVER_IP == "" ]] ; do
              sleep 10
              DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
              'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')
          done

          # Add in IP information in discovery server config
          sudo cp /workspaces/config/mounted_discovery_server_config.xml \
              /workspaces/config/discovery_server_config.xml
          DDS_CONFIG_XML_PATH=/workspaces/config/discovery_server_config.xml
          sudo sed -i "s/DISCOVERY_SERVER_IP/$DISCOVERY_SERVER_IP/g" $DDS_CONFIG_XML_PATH
          sudo sed -i "s/CURRENT_MACHINE_PUBLIC_IP/$NAT_IP/g" $DDS_CONFIG_XML_PATH
          # Add env variables
          export ROS_DISCOVERY_SERVER=$DISCOVERY_SERVER_IP:11811
          export FASTRTPS_DEFAULT_PROFILES_FILE=$DDS_CONFIG_XML_PATH
        path: /tmp/setup_dds.sh
      image: nvcr.io/nvidia/isaac-lab:2.2.0@sha256:b4d8e96cbfb9a6c40067bec6cc5ee180e36d4c0164b25f7215c5f47e31897b94
      lead: true
      name: isaac-lab
      resource: sim
    - args:
      - /tmp/client.sh
      command:
      - /bin/bash
      files:
      - contents: |-
          #!/bin/bash
          set -x +e
          sudo apt update && sudo apt install -y net-tools dnsutils
          set -e
          NAT_INTERFACE=eth0
          NAT_IP=$(ifconfig "$NAT_INTERFACE" | grep -oP "inet \K\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}")
          source /opt/ros/humble/setup.bash

          fastdds discovery -i 0 -l 0.0.0.0 -p 11811
        path: /tmp/client.sh
      image: osrf/ros:humble-desktop-full@sha256:ddfee4353aa16235a8f87b00815d9f8c611cf42f1fb6a90e113e573bc466f9f1
      name: discovery-server
  name: hardware-in-loop-sim
  resources:
    default:
      cpu: 1
      memory: 2Gi
      platform: ovx-a40
      storage: 2Gi
    jetson:
      cpu: 8
      memory: 26Gi
      platform: agx-orin-jp7
      storage: 30Gi
    sim:
      cpu: 16
      gpu: 1
      memory: 20Gi
      platform: ovx-a40
      storage: 30Gi
`;
