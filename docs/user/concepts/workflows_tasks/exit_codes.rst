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

.. _concepts_wf_exit_codes:

================================================
Exit Codes
================================================

The following is a list of possible task exit codes and their descriptions. Users should handle
user exit codes. Contact an admin if you encounter preflight, OSMO configuration, and infra
exit codes.

* User exit codes are the exit codes returned by the user's task.
* Preflight exit codes are the exit codes returned by the preflight tests.
* OSMO configuration exit codes are the exit codes returned by the OSMO when
  handling data inputs/outputs and communicating with the service.
* Infra exit codes are the exit codes returned by the service when processing the user task.

.. note::

  If a task encounters multiple exit codes, the highest exit code will be selected.

.. md-tab-set::

  .. md-tab-item:: User Exit Codes

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

  .. md-tab-item:: Service Exit Codes

    ..  list-table::
        :header-rows: 1
        :widths: auto

        * - **Exit Code**
          - **Description**
        * - 1001
          - OSMO :ref:`Preflight Tests <concepts_preflight>` failure.
        * - 2002
          - Unknown runtime error.
        * - 2010
          - Download operation failed.
        * - 2011
          - Mount operation failed.
        * - 2012
          - Upload operation failed.
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

.. _concepts_wf_actions:

Task Actions
================================================

User is allowed to define task actions based on **exit codes** for every task in a workflow.

Supported actions are:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **Action**
      - **Description**
    * - COMPLETE
      - Task will be marked as COMPLETED.
    * - FAIL
      - Task will be marked as FAILED.
    * - RESCHEDULE
      - Task will be marked as RESCHEDULED and a new task with the same spec will be scheduled.
        If you want all other tasks in the same group to be restarted,
        please set ``ignoreNonleadStatus`` to ``false`` for the group (see :ref:`concepts_groups`).

Exit codes have the format as ``start1-end1,num2,...``.
When the task exits with an exit code, it checks if this code falls into any defined actions.
If so, perform the action. If not, mark the task as ``COMPLETED`` when the exit code is ``0``
and mark the task as ``FAILED`` otherwise.

.. note::

  * User needs to make sure there is no overlapping between exit codes for different actions.
  * User tasks should return exit codes no greater than ``255`` and avoid conflicts with OSMO
    exit codes.

The following example shows how user can define actions for different exit codes.
The task in this workflow will return exit code as ``16`` and based on the actions the task will
have status as ``COMPLETED``.

.. code-block:: yaml

  workflow:
    name: exit-actions-example
    tasks:
    - name: example
      image: ubuntu
      command: [/bin/sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          echo hello
          exit 16
        path: /tmp/run.sh

      exitActions:
        COMPLETE: 0,1-10,16,20

The following example shows how user can reschedule a task based on its exit codes.
The task in this workflow will return exit code as ``16`` and based on the actions the task will have status as ``RESCHEDULED``.
A new task that has the same spec will be scheduled. Workflow query and overview show information about all latest tasks.

.. code-block:: yaml

  workflow:
    name: exit-actions-example
    tasks:
    - name: example
      image: ubuntu
      command: [/bin/sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          echo hello
          exit 16
        path: /tmp/run.sh

      exitActions:
        COMPLETE: 0-10
        RESCHEDULE: 11-20

Users can access information about rescheduled tasks by setting `verbose=True`:

.. code-block:: bash
  :substitutions:

  |osmo_url|/api/workflow/<workflow_id>?verbose=True

.. code-block:: bash
  :substitutions:

  osmo workflow query <workflow_id> --verbose

The following example shows how user can reschedule a group of tasks in case of an :ref:`preflight test error <concepts_wf_exit_codes>`.
When the lead task fails due to a preflight test error, it will return the exit code as ``1001`` and based on its actions the lead task will be rescheduled, and ``task2`` will be restarted.

.. code-block:: yaml

  workflow:
    name: preflight-failure-action-example
    groups:
    - name: my_group
      tasks:
      - name: task1
        image: ubuntu
        command: [bash]
        args: [/tmp/run.sh]
        files:
        - contents: |
            date
            sleep 10
          path: /tmp/run.sh
        exitActions:
          RESCHEDULE: 1001
        lead: true
      - name: task2
        image: ubuntu
        command: [bash]
        args: [/tmp/run.sh]
        files:
        - contents: |
            echo hello
            sleep 10
            echo bye
          path: /tmp/run.sh

.. note::

  * Some pools reschedule tasks for preflight test errors by default based on admin configurations.
  * Some preflight tests are only run for the first time tasks are submitted, and are disabled for rescheduled tasks, for example, NCCL Bandwidth Test.
  * For a practical example of rescheduling for backend errors in distributed training, see :ref:`Reschedule Training for Backend Errors <workflow_examples>`.
