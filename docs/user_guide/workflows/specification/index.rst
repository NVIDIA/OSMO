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

.. _workflow_spec:

================================================
Specification
================================================

.. _workflow_spec_workflow:

Workflow
========

.. list-table::
   :widths: auto
   :header-rows: 1

   * - Field Name
     - Type
     - Required
     - Description
   * - :kbd:`name`
     - ``string``
     - **Yes**
     - The name of the workflow.
   * - :kbd:`pool`
     - ``string``
     - No
     - The pool to submit the workflow to.
   * - :kbd:`timeout`
     - ``dict``
     - No
     - :ref:`Timeout configuration <workflow_spec_timeouts>`
   * - :kbd:`resources`
     - ``dict``
     - No
     - Dictionary of :ref:`resource specifications <workflow_spec_resources>`
   * - :kbd:`tasks`
     - ``list``
     - **Yes** (or :kbd:`groups`)
     - List of :ref:`task definitions <workflow_spec_task>`.
   * - :kbd:`groups`
     - ``list``
     - **Yes** (or :kbd:`tasks`)
     - List of :ref:`group definitions <workflow_spec_group>`.

.. _workflow_spec_task:

Task
====

.. list-table::
  :widths: auto
  :header-rows: 1

  * - Field Name
    - Type
    - Required
    - Description
  * - :kbd:`name`
    - ``string``
    - **Yes**
    - The name of the task (unique within the workflow).
  * - :kbd:`image`
    - ``string``
    - **Yes**
    - The container image registry and image tag, ex: ``ubuntu:22.04``
  * - :kbd:`lead`
    - ``boolean``
    - No
    - The group leader designation of the task. Only applicable if the task is part of a :ref:`workflow_spec_group`.
  * - :kbd:`command`
    - ``list``
    - **Yes**
    - The command to run in the container.
  * - :kbd:`args`
    - ``list``
    - No
    - The arguments to pass to the command.
  * - :kbd:`environment`
    - ``dict``
    - No
    - The environment variables to set in the container.
  * - :kbd:`credentials`
    - ``dict``
    - No
    - The credentials to inject into the container. See :ref:`workflow_spec_secrets` for more information.
  * - :kbd:`inputs`
    - ``list``
    - No
    - The inputs to download into the task container. See :ref:`workflow_spec_inputs` for more information.
  * - :kbd:`outputs`
    - ``list``
    - No
    - The outputs to upload after completion. See :ref:`workflow_spec_outputs` for more information.
  * - :kbd:`files`
    - ``list``
    - No
    - The files to mount into the task container. See :ref:`workflow_spec_file_injection` for more information.
  * - :kbd:`resource`
    - ``string``
    - No
    - Reference to the ``resources`` spec defined at the :ref:`workflow <workflow_spec_workflow>` level.
  * - :kbd:`volumeMounts`
    - ``list``
    - No
    - The volumes to mount into the task container. See :ref:`workflow_spec_host_mounts` for more information.
  * - :kbd:`exitActions`
    - ``dict``
    - No
    - The exit actions to perform after the task terminates. See :ref:`workflow_spec_exit_actions` for more information.
  * - :kbd:`checkpoint`
    - ``list``
    - No
    - The checkpoint specifications to use for this task. See :ref:`workflow_spec_checkpointing` for more information.
  * - :kbd:`privileged`
    - ``boolean``
    - No
    - The privileged mode setting that grants containers nearly unrestricted access to the host system.

      .. note::

        Please consult your administrator to enable this feature.
  * - :kbd:`hostNetwork`
    - ``boolean``
    - No
    - The task pod host network setting that allows a pod to use the host node's network namespace
      instead of having its own isolated network stack.

      .. note::

        Please consult your administrator to enable this feature.


.. _workflow_spec_group:

Group
=====

.. list-table::
  :widths: auto
  :header-rows: 1

  * - Field Name
    - Type
    - Required
    - Description
  * - :kbd:`name`
    - ``string``
    - **Yes**
    - The name of the group (unique within the workflow).
  * - :kbd:`barrier`
    - ``boolean``
    - No
    - Default is ``true``. When enabled, the tasks in the group will be synchronized
      and execution will start only when all tasks in the group are ready.

      See :ref:`workflow_spec_barriers` for more information.
  * - :kbd:`ignoreNonleadStatus`
    - ``boolean``
    - No
    - Default is ``true``. When set to ``true``, a failure of a non-lead task will not cause
      the group to fail.

      When set to ``false``, the group will fail if any task (lead or non-lead) fails.

      .. note::

        When a task gets rescheduled, the other tasks in the group continue running.

        If you want the other tasks to be restarted, please set ``ignoreNonleadStatus`` to ``false``.
        Learn more at :ref:`workflow_lifecycle_group`.
  * - :kbd:`tasks`
    - ``list``
    - **Yes**
    - The list of tasks in the group. See :ref:`workflow_spec_task` for more information.

      .. important::

         Each group must have 1 **lead** task.

.. seealso::

   Already have a workflow spec and ready to submit? See :ref:`workflow_submission` for more information.

.. toctree::
  :hidden:

  barriers
  checkpointing
  exit_actions
  file_injection
  host_mounts
  inputs_and_outputs
  resources
  secrets
  templates_and_tokens
  timeouts
