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

.. _concepts_workflows_tasks_specification:

================================================
Specification
================================================

The workflow specification is a YAML file that describes a list of tasks to run:

.. code-block:: yaml

  workflow:
    name: my_workflow   # (1)
    resources:          # (2)
    ...
    tasks:              # (3)
    ...
    groups:             # (4)
    ...

.. code-annotations::

  1. Name of the workflow. A ``workflow_id`` is generated using the workflow name and an auto-incrementing ID.
  2. Resources definitions for tasks in the workflow. See :ref:`concepts_wf_resources` for more information.
  3. Individual tasks definitions for the workflow. See :ref:`concepts_tasks` for more information.
  4. Groups definitions for tasks in the workflow. See :ref:`concepts_groups` for more information.

.. warning::

  The ``groups`` and ``tasks`` fields are mutually exclusive.

.. toctree::
  :hidden:

  resources
  groups
  tasks
  inputs_and_outputs
  file_injection
  templates_and_tokens
  secrets
  timeouts
  exit_actions
  checkpointing
