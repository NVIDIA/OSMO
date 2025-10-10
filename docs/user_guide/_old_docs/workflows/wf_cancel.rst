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

.. _wf_cancel:

================================================
Cancel
================================================

Use cancel to stop a running workflow or a list of workflows.

.. code-block:: bash

  $ osmo workflow cancel -h
  usage: osmo workflow cancel [-h] [--message MESSAGE] [--force] [--format-type {json,text}] workflow_ids [workflow_ids ...]

  positional arguments:
    workflow_ids          The workflow IDs or UUIDs to cancel. Multiple IDs or UUIDs can be passed.

  options:
    -h, --help            show this help message and exit
    --message MESSAGE, -m MESSAGE
                          Additional message describing reasion for cancelation.
    --force, -f           Force cancel task group pods in the cluster.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

When a workflow is canceled, workflow status is recorded as FAILED with detailed status that captures the individual task that was canceled by a user. Sample shown below

.. code-block:: bash

  $ osmo workflow cancel <workflow_id> -m "Formatted Incorrectly."
  Cancel job for workflow <workflow_id> is submitted!

.. code-block:: bash
  :substitutions:

  $ osmo workflow query <workflow_id> --format-type json
  {
      "name": "<workflow_id>",
      "submitted_by": "osmo@nvidia.com",
      "cancelled_by": "osmo@nvidia.com",
      "logs": "|osmo_url|/api/workflow/<workflow_id>/logs",
      "submit_time": "2023-04-20T06:06:10.894317",
      "start_time": "2023-04-20T06:22:15.965690",
      "end_time": "2023-04-20T07:22:34.962973",
      "exec_timeout": null,
      "queue_timeout": null,
      "duration": "1:00:18.997283",
      "status": "FAILED",
      "groups": [
          {
              "name": "task1-group",
              "status": "FAILED_CANCELED",
              "start_time": "2023-04-20T06:22:15.965690",
              "end_time": "2023-04-20T07:22:34.962973",
              "remaining_upstream_groups": [],
              "downstream_groups": [],
              "failure_message": "Task was canceled by user: osmo@nvidia.com. Formatted Incorrectly.",
              "tasks": [
                  {
                      "name": "task1",
                      "retry_id": 0,
                      "status": "FAILED_CANCELED",
                      "failure_message": "Task was canceled by user: osmo@nvidia.com. Formatted Incorrectly.",
                      "exit_code": null,
                      "logs": "",
                      "error_logs": null,
                      "start_time": "2023-04-20T06:22:15.965690",
                      "end_time": "2023-04-20T07:22:34.962973",
                      "input_download_start_time": null,
                      "input_download_end_time": null,
                      "output_upload_start_time": null,
                      "output_upload_end_time": null,
                      "dashboard_url": null,
                      "pod_name": "353638a63f124d6c-8ffae31664694865",
                      "task_uuid": "8ffae31664694865b1a7b0300eeb710a",
                      "node_name": "my_node"
                  }
              ]
          }
      ]
  }

.. note::

  All workflows by default a maximum default execution time set by admins unless requested in the workflow spec.
  Workflows that exceed the execution timeout are canceled by the service automatically to protect the pool resources.
