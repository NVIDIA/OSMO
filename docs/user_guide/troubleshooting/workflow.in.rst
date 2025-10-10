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

.. _troubleshooting_workflow:

Workflow
================================================

When a workflow fails, refer to :ref:`cli_reference_workflow_query` to gain an overview of the workflow tasks
statuses on which pods failed as well as their failure messages. Refer to :ref:`concepts_wf_status`
that contains more information regarding different workflow statuses.

Use :ref:`cli_reference_workflow_logs` for a better insight of what happened during the workflow runtime.

.. _troubleshooting_137_error_code:

137 Error Code
----------------

When a task exits with exit code ``137``, it usually signifies that your task was killed due to
using too much memory.

A user can confirm this if the admins have setup a Grafana Dashboard for detailed
workflow usage information. To see the dashboard, users can click on the ``Resource Usage`` button
in the UI on the detailed workflow information page.

To resolve the memory issue, users can try increasing the amount of memory requested or lower
the memory usage within the task. To learn more about workflow resources, refer to
:ref:`concepts_resources_pools_platforms`.
