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

.. _validate_osmo:

================================================
Running Workflows
================================================

Backend
===========================

Once the backend operator is deployed you can validate the backend configuration by using the OSMO CLI.

.. code-block:: bash

  $ osmo config show BACKEND $BACKEND_NAME | grep "online"
  "online": true,


Pool
========================

You can validate the pool configuration by using the OSMO CLI.

.. code-block:: bash

  $ osmo pool list
  Pool      Description    Status   GPU [#]
                                 Quota Used   Quota Limit   Total Usage   Total Capacity
  =========================================================================================
  default   Default pool   ONLINE   0            12            0             19
  =========================================================================================
                                    0            12            0             19


Workflow
========================

Once the backend and pool are configured, you can validate end to end functionality by submitting the following workflows.

+-------------------+-----------------------------------------------+-----------------------------------------------------------------------------------------+
| Workflow Name     | Validates                                     | Workflow to Submit                                                                      |
+===================+===============================================+=========================================================================================+
| Simple Workflow   | Basic workflow execution, logging, data       | Submit the `hello world tutorial <https://nvidia.github.io/OSMO/user_guide/tutorials/   |
|                   | access and scheduling                         | hello_world/>`__ workflow and verify it completes successfully.                         |
+-------------------+-----------------------------------------------+-----------------------------------------------------------------------------------------+
| Parallel Workflow | Co-scheduling and parallel task execution     | Submit the `parallel tasks workflow <https://github.com/NVIDIA/OSMO/blob/main/          |
|                   |                                               | workflows/basics/parallel_tasks/README.md>`_ and verify it completes successfully.      |
+-------------------+-----------------------------------------------+-----------------------------------------------------------------------------------------+
| GPU Workflow      | GPU resource allocation and usage             | Submit the `single node GPU workflow <https://github.com/NVIDIA/OSMO/blob/main/         |
|                   |                                               | workflows/dnn_training/single_node/README.md>`_ and verify it completes successfully.   |
+-------------------+-----------------------------------------------+-----------------------------------------------------------------------------------------+
| Router Workflow   | Router functionality                          | Submit the `Jupyter workflow <https://github.com/NVIDIA/OSMO/tree/main/workflows/       |
|                   |                                               | integration_and_tools/jupyterlab/README.md>`_ and verify you can access the JupyterLab  |
|                   |                                               | via `osmo workflow port-forward` command.                                               |
+-------------------+-----------------------------------------------+-----------------------------------------------------------------------------------------+
