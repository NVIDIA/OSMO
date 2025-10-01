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

.. _tutorials_osmo_cli:

================================================
Running OSMO Commands in a Task
================================================

Example
---------

In every workflow, OSMO injects the OSMO CLI into the container regardless of the base image.
This allows you to run OSMO commands in your workflow.

.. literalinclude:: ../../../samples/osmo_cli/osmo_cli.yaml
  :language: yaml

If you wanted to save your data in the workflow while it is running or if the workflow is stuck,
you can exec into the workflow and run ``osmo dataset upload``.

.. code-block:: bash

  osmo workflow exec <workflow_id> <task_name> --entry bash
  osmo dataset upload <dataset_name>
