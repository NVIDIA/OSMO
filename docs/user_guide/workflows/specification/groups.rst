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

.. _concepts_groups:

============
Groups
============

Groups are defined for the list of tasks that need to be started simultaneously.
Use the ``groups`` field to include the tasks in a group.
You must identify one task as a group leader by setting the ``lead`` field to ``true``.
The status of the lead task will propagate to all other tasks in the group.

.. code-block:: yaml

  workflow:
    name: sample-group
    groups:
    - name: my_group              # (1)
      ignoreNonleadStatus: true   # (2)
      barrier: true               # (3)
      tasks:
      - name: task1               # (4)
        lead: true
        ...
      - name: task2               # (5)
        ...

.. code-annotations::

    1. The name of the group.
    2. Determine how the group behavior should be influenced by the non-lead tasks. Default is ``true``. See :ref:`concepts_wf_group_lifecycle` for more information.
    3. Defines if the task execution in the group should be synchronized. Default is ``true``. See :ref:`concepts_barriers` for more information.
    4. The task1 is the group leader. The full task spec definition can be found in :ref:`concepts_tasks`.
    5. The task2 is not the group leader. The full task spec definition can be found in :ref:`concepts_tasks`.

An example of a group workflow that has multiple tasks is in :ref:`workflow_examples`.

The group status is determined by the status of the lead task. However, if you want the group to fail
when a non-lead task is failed, please set ``ignoreNonleadStatus`` to ``false``. Learn more at
:ref:`concepts_wf_group_lifecycle`.

When a task gets rescheduled, the other tasks in the group continue running. If you want the other
tasks to be restarted, please set ``ignoreNonleadStatus`` to ``false``. Learn more at
:ref:`concepts_wf_group_lifecycle`.

.. _concepts_barriers:

Barriers
============

Barriers are a mechanism which synchronize tasks in the same group.

An implicit barrier ensures that all tasks being execution at the same time, eliminating time gaps
caused by initialization steps such as image pulling and input data downloading.

Implicit barriers are **enabled** by default.

To disable the implicit barrier, set the ``barrier`` field to ``false`` in the group spec.

.. code-block:: yaml

  workflow:
    name: sample-group
    groups:
    - name: my_group
      barrier: false
      ...
