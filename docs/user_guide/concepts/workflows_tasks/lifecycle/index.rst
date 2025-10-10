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

.. _concepts_workflows_tasks_workflow_lifecycle:

================================================
Workflow Lifecycle
================================================

.. toctree::
  :hidden:

  status
  exit_codes

Workflow Lifecycle
===================

1. Initially, the workflow's status is **PENDING**, indicating that the first group of tasks is being scheduled.
2. When a group of tasks begins execution, the workflow's status changes to **RUNNING**.
3. If the running group finishes and no other group is running, the workflow's status changes to **WAITING**.
4. Once all the groups have finished, the workflow's status changes to **COMPLETED** or **FAILED** status.

.. _concepts_wf_group_lifecycle:

Group Lifecycle
===================

1. Initially, the group's status is **SUBMITTING**, indicating that the group is being submitted.
2. When the group is submitted, the group's status changes to **PROCESSING** if it has no upstream
   groups to wait for, otherwise it changes to **WAITING**.
3. After the group is sent to the backend, the group's status changes to **SCHEDULING**, indicating
   that the group is waiting to be scheduled onto a node.
4. Once the nodes are ready, the group's status changes to **INITIALIZING** and the tasks begin to pull images.
5. When a task finishes initializing, the group's status changes to **RUNNING**.
6. Once all the tasks have finished, the group's status changes to **COMPLETED** or **FAILED** status.

The group status behavior is influenced by the ``ignoreNonleadStatus`` field. The default value
is ``true``. When the field is set to:

..  list-table::
  :header-rows: 1
  :widths: auto

  * -
    - **Finished Status**
    - **Reschedule Behavior**
  * - true
    - The group's status is dependent only on the lead task.
    - When a task is rescheduled, the other tasks in the group continue running.
  * - false
    - The group's status is dependent on all the tasks in the group. If any task fails, the group will fail.
    - When a task is rescheduled, the other tasks in the group are restarted and the group status stays at ``RUNNING``.

Learn more about group fields at :ref:`concepts_groups`.

Task Lifecycle
===================

1. Initially, the task's status is **SUBMITTING**.
2. Once submitted, the task's status changes to **PROCESSING** if it has no upstream tasks to wait
   for, otherwise it changes to **WAITING**.
3. After the service sends the task to the backend, the task's status changes to **SCHEDULING**.
4. Once the task is assigned to a node, the task's status changes to **INITIALIZING** to pull images.
5. After pulling images, the task's status changes to **RUNNING**.

   a. A sidecar container to the task begins downloading any specified inputs.
   b. Once the inputs are downloaded, the task begins running your command and is available for exec and port-forwarding.
   c. After the task finishes running your command, the sidecar container begins uploading any specified outputs.

6. When the task is running, the task's status changes to **COMPLETED** or **FAILED** status.

Task Output Behavior
---------------------

There are several conditions that affect the task's output behavior:

* If the task is canceled or ends suddenly due to a backend error or eviction/preemption,
  the task's output will **NOT** be uploaded.
* If you specifies an :ref:`concepts_wf_outputs`, the task's output will be uploaded to the specified location.
* If there is a downstream task, the task's output will be uploaded to an intermediate location for the downstream task to use.
* If there is no downstream task **AND** you does not specify any :ref:`concepts_wf_outputs`,
  any files in the task's output folder **WILL** still be uploaded to intermediate storage in case
  you forgot to specify any outputs.

.. _concepts_wf_task_reschedule_restart:

Task Reschedule and Restart
-----------------------------

When a task is **rescheduled**, it means that the old task is cleared from the backend, and a
new task with an incremented retry ID is created with the same spec as the old one.

The new task can land on any available node that satisfies its resource requirement,
not necessarily the same as the old.

When a task is **restarted**, it means that the user command is re-executed.
Different from rescheduling, restarting doesn't create a new task.

Therefore, the restarted task will run on the same node, doesn't require a second time input
downloading, and has access to any intermediate data.

See :ref:`Actions <concepts_wf_actions>` for more information.

.. note::

  The maximum number of retries can be configured but requires service-level configuration.
  If you have administrative access, you can enable this directly. Otherwise, contact someone
  with workflow administration privileges.
