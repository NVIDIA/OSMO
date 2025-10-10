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

.. _wf_query:

======
Query
======

You can query the workflow to retrieve its status. There are two methods of querying a workflow.

.. note::

    For more information regarding different workflow statuses, refer to workflow
    :ref:`concepts_wf_status`.

Browser
--------

Upon submission, URL link is provided to track the status of your workflow. You can also construct the URL using below scheme:

.. code-block:: bash
  :substitutions:

  |osmo_url|/api/workflow/<workflow_id>

Or the verbose version:

.. code-block:: bash
  :substitutions:

  |osmo_url|/api/workflow/<workflow_id>?verbose=True

Replace the ``workflow_id`` with your workflow ID. For example,

.. code-block:: bash
  :substitutions:

  |osmo_url|/api/workflow/sim-sdg-N_Q69hQAT5uAkDjHLD3-8w


Console
--------

To query the status of a workflow:

.. code-block:: bash

  $ osmo workflow query -h
  usage: osmo workflow query [-h] [--verbose] [--format-type {json,text}] workflow_id

    positional arguments:
    workflow_id           The workflow ID or UUID to query the status of.

    options:
    -h, --help            show this help message and exit
    --verbose, -v         Whether to show all retried tasks.
    --format-type {json,text}
                            Specify the output format type (Default text).

.. code-block:: bash
  :substitutions:

  $ osmo workflow query my_workflow_id
  --------------------------------------------------------------------

  Workflow ID : my_workflow_id
  Status      : FAILED
  User        : my_email
  Submit Time : Oct 30, 2024 11:25 PDT
  Overview    : |osmo_url|/workflows/<my_workflow_id>

  Task Name   Start Time               Status
  ===========================================
  example     Oct 30, 2024 11:29 PDT   FAILED

To query the detailed status of your workflow, append ``--verbose``:

.. code-block:: bash
  :substitutions:

  $ osmo workflow query my_workflow_id --verbose
  --------------------------------------------------------------------

  Workflow ID : my_workflow_id
  Status      : FAILED
  User        : my_email
  Submit Time : Oct 30, 2024 11:25 PDT
  Overview    : |osmo_url|/workflows/<my_workflow_id>

  Task Name   Retry ID   Start Time               Status
  ===========================================================
  example     1          Oct 30, 2024 11:29 PDT   FAILED
  example     0          Oct 30, 2024 11:28 PDT   RESCHEDULED

To query with the json format output, append the ``--format-type json``

.. code-block:: bash
  :substitutions:

  $ osmo workflow query sim-sdg-bgdhktgcyjhg7gfpddwrxc7w4m --format-type json
  {
    "name": "sim-sdg-bgdhktgcyjhg7gfpddwrxc7w4m",
    "uuid": "bgdhktgcyjhg7gfpddwrxc7w4m",
    "submitted_by": "osmo@nvidia.com",
    "cancelled_by": null,
    "logs": "|osmo_url|/api/workflow/sim-sdg-bgdhktgcyjhg7gfpddwrxc7w4m/logs",
    "dashboard_url": "https://dashboard-link.com/dashboard/#/search?namespace=_all&q=bgdhktgcyjhg7gfpddwrxc7w4m",
    "grafana_url": "https://grafana-link.com/grafana/d/HExS-0HVk/workflow-resources?var-namespace=default&var-uuid=bgdhktgcyjhg7gfpddwrxc7w4m&from=now-47h&to=now-46h",
    "submit_time": "2023-11-10T00:55:56.032875",
    "start_time": "2023-11-10T00:56:02.059608",
    "end_time": "2023-04-19T01:03:12.567009",
    "exec_timeout": null,
    "queue_timeout": null,
    "duration": "0:07:10.507401",
    "status": "COMPLETED",
    "outputs": "",
    "groups": [
      {
        "name": "sim-sdg-group",
        "status": "COMPLETED",
        "start_time": "2023-11-10T00:56:02.059608",
        "end_time": "2023-11-10T01:03:12.567009",
        "remaining_upstream_groups": [],
        "downstream_groups": [],
        "failure_message": null,
        "tasks": [
            {
                "name": "sim-sdg",
                "status": "COMPLETED",
                "failure_message": null,
                "exit_code": 0,
                "start_time": "2023-04-19T00:56:02.059608",
                "end_time": "2023-04-19T01:03:12.567009",
                "input_download_start_time": "2023-04-19T00:56:03.169325",
                "input_download_end_time": "2023-04-19T00:56:05.531126",
                "output_upload_start_time": "2023-04-19T01:03:12.629712",
                "output_upload_end_time": "2023-04-19T01:03:18.002433",
                "pod_name": "task1-dzom332rrjesljtdo7nzmppfmm",
                "node_name": "ovx-03"
            }
        ]
      }
    ]
  }
