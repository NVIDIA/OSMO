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

.. _concepts_preflight:

================================================
Preflight Test
================================================

OSMO runs preflight tests before workflows being launched to ensure systems are healthy.
Preflight tests are running right before task starts.

Currently OSMO provides NCCL Bandwidth Test as the preflight test, it will run when:

* The task group has more than one tasks.
* Each task in the group requires all GPUs on a node.
* NCCL Bandwidth Test is enabled for the pool.
* The task group has no restarted / rescheduled tasks.

When a task is failed with "Preflight Test Failed", it means the node that the task is assigned
to has either lower bandwidth than what is expected or no network.
OSMO will automatically remove such bad nodes based on the results of preflight tests.
:ref:`Task Reschedule and Restart <concepts_wf_task_reschedule_restart>` can help automatically
re-assign the task to a different node and try again.
See :ref:`Exit Codes <concepts_wf_exit_codes>` and :ref:`Actions <concepts_wf_actions>` for
more information.
