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

.. _workflow_exit_codes:

==========
Exit Codes
==========

.. seealso::

  For a full list of exit actions, see :ref:`workflow_spec_exit_actions`.

The following is a list of possible task exit codes and their descriptions. Users should handle
user exit codes.

* User exit codes are the exit codes returned by the user's task.
* Preflight exit codes are the exit codes returned by the preflight tests.
* OSMO configuration exit codes are the exit codes returned by the OSMO when
  handling data inputs/outputs and communicating with the service.
* Infra exit codes are the exit codes returned by the service when processing the user task.

.. note::

  If a task encounters multiple exit codes, the **highest exit code** will be selected.

.. tab-set::

  .. tab-item:: User Exit Codes

    ..  list-table::
        :header-rows: 1
        :widths: auto

        * - **Exit Code**
          - **Description**
        * - 0
          - Task completed.
        * - 1-255
          - User failure. :ref:`137 Error Code<troubleshooting_137_error_code>` explanation.
        * - 256-257
          - OSMO initialization failure.

  .. tab-item:: Service Exit Codes

    ..  list-table::
        :header-rows: 1
        :widths: 20 80

        * - **Exit Code**
          - **Description**
        * - 2002
          - Unknown runtime error.
        * - 2010
          - Download operation failed.
        * - 2011
          - Mount operation failed.
        * - 2012
          - Upload operation failed.
        * - 2013
          - Data authorization check failed.
        * - 2014
          - Data access is unauthorized.
        * - 2020
          - Invalid authentication token for connecting to the service.
        * - 2021
          - Service connection timed out.
        * - 2022
          - Failed to send/receive messages to/from the service.
        * - 2023
          - Failed to send/receive messages to/from the user task.
        * - 2024
          - Barrier synchronization failed.
        * - 2025
          - Failed to create or process metrics.
        * - 2030-2040
          - Miscellaneous failure.
        * - 3000
          - Upstream tasks failed.
        * - 3001
          - Backend error.
        * - 3002
          - OSMO server error.
        * - 3003
          - Start error. Task failed to start execution.
        * - 3004
          - Evicted. Task was evicted from the node.
        * - 3005
          - Start timeout. Task took too long to initialize. This may happen if the task gets stuck pulling secrets or images.
        * - 3006
          - Preempted. The task was preempted to make space for a higher priority task.
        * - 4000
          - Unknown error.
