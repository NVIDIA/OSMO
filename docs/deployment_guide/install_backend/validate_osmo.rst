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

.. _validate_osmo:

================================================
Run Workflows
================================================

Run sample workflows to validate the backend and pool configuration.

.. grid:: 2
    :gutter: 3

    .. grid-item-card:: :octicon:`workflow` Simple Workflow
        :link: https://github.com/NVIDIA/OSMO/blob/main/workflows/tutorials/hello_world.yaml
        :link-type: url

        **Validates:** Basic workflow execution, logging, data access and scheduling

        Submit the ``Hello World`` workflow to verify core functionality.

    .. grid-item-card:: :octicon:`workflow` Parallel Workflow
        :link: https://github.com/NVIDIA/OSMO/blob/main/workflows/tutorials/parallel_tasks.yaml
        :link-type: url

        **Validates:** Co-scheduling and parallel task execution

        Submit the ``Parallel Tasks`` workflow to test concurrent execution.

    .. grid-item-card:: :octicon:`workflow` GPU Workflow
        :link: https://github.com/NVIDIA/OSMO/blob/main/workflows/dnn_training/single_node/README.md
        :link-type: url

        **Validates:** GPU resource allocation and usage

        Submit the ``Single Node GPU`` workflow to verify GPU access.

    .. grid-item-card:: :octicon:`workflow` Router Workflow
        :link: https://github.com/NVIDIA/OSMO/blob/main/workflows/integration_and_tools/jupyterlab/README.md
        :link-type: url

        **Validates:** Router functionality

        Submit the ``Jupyter`` workflow and verify interactive access via ``osmo workflow port-forward``.
