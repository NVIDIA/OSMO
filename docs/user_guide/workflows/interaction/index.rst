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

.. _concepts_workflows_tasks_interacting_with_running_workflows:

================================================
Interacting with Running Workflows
================================================

OSMO provides handful of ways to interact with running workflows and tasks.
Once your task is running, you can interact with it using:

* **Exec** - Open a shell or execute commands inside a task for debugging and inspection
* **Port-Forward** - Forward ports to access web services like Jupyter, VSCode, or dashboards
* **Rsync** - Sync files between your local machine and running tasks

.. toctree::
  :hidden:

  exec
  port_forward
  rsync

.. note::
  Before you interact with a running task, make sure that the task has the **RUNNING** status and your
  container command in the task spec has started.

.. note::
  Interacting with a remote task relies on OSMO's routing system to manage network traffic.
  There could be a slight delay compared to directly interacting with a local task.
