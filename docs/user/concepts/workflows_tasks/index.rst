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

.. _concepts_wf:

================================================
Workflows & Tasks
================================================

A **workflow** is a user-defined, directed acyclic graph (DAG) of tasks that need to be executed. Each **task** is designed to run a list of commands within a Docker container. Within this workflow, you can establish multiple tasks and set them to execute in a sequential order by specifying the dependencies between them. A task starts after all of the inputs that it relies on have completed. Tasks can utilize files produced by other tasks that they depend on and can also upload to or download data from various data storage solutions provided by cloud service providers including AWS, GCP, and Azure.

A **group** is a feature that allows you to set a collection of tasks to run simultaneously and interact with each other within the network. When a group is defined, it must have a single task designated as the **group leader**. The group execution is considered complete only when the group leader task is finished. It's important to note that a group can only have one group leader. If groups are not defined in the workflow, each task is treated as a standalone group of 1 task.

It is possible that the collection of tasks inside a group can all run on the same node or on different nodes of homogeneous architectures (for example, amd64) or on different nodes of heterogeneous architecture (for example, amd64 and arm64) depending on it's resource requirement.

For example, the following shows a workflow with three groups. ``Group 1`` runs three tasks concurrently with two datasets downloaded as inputs from the data store. It exits when the group leader ``Task 2`` finishes execution writing it's output to ``Dataset 3``. ``Group 2`` and ``Group 3`` start executing after ``Group 1`` is finished. ``Group 2`` uses the dataset created by ``Group 1`` as input. Both ``Group 2`` and ``Group 3`` output their own datasets.

.. image:: wf.png


Workflows can be classified broadly into the following major types based on the dependency defined in the workflow DAG:

* `Serial Workflows` - Workflows that define tasks to execute after one another
* `Parallel Workflows` - Workflows that define groups of tasks that execute simultaneously
* `Combination Workflows` - Workflows that are serial and parallel

.. toctree::
  :hidden:

  workflow_lifecycle
  priority
  specification
  interacting_with_running_workflows
  applications
