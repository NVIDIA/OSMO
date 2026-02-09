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

.. _workflow_overview:

========
Overview
========

Workflows turn complex computational pipelines into simple YAML definitions. You define what
to run, how tasks connect, and what resources they need. OSMO handles the rest - scheduling,
orchestration, and execution across your compute infrastructure.

What is a Workflow?
===================

.. important::

   A **workflow** is a user-defined, directed acyclic graph (DAG) of tasks that is scheduled
   and executed by OSMO.

**Key characteristics:**

* Workflows are defined in YAML and submitted via CLI or Web UI.
* Tasks execute based on defined dependencies
* Support serial, parallel, and combined execution patterns
* Scheduled automatically by OSMO

.. dropdown:: Workflow Example
    :color: primary
    :icon: code
    :open:

    .. grid:: 1 1 2 2
        :gutter: 3

        .. grid-item::

            .. code-block:: yaml

                workflow:

                  name: ml-pipeline

                  tasks:
                  - name: preprocess
                    image: python:3.10
                    command: ["python"]
                    args: ["preprocess.py"]
                    ...

                  - name: train
                    image: pytorch/pytorch
                    command: ["python"]
                    args: ["train.py"]
                    ...
                    inputs:
                    - task: preprocess # (1)

                  - name: evaluate
                    image: python:3.10
                    command: ["python"]
                    args: ["evaluate.py"]
                    ...
                    inputs:
                    - task: train # (2)

                  - name: export-onnx
                    image: python:3.10
                    command: ["python"]
                    args:
                    - "export.py"
                    - "--format=onnx"
                    ...
                    inputs:
                    - task: train # (2)

            .. code-annotations::

              1. The ``task`` input specifies the upstream task dependency.
              2. Both ``evaluate`` and ``export-onnx`` depend only on ``train``, so they run in parallel.

        .. grid-item::
            :child-align: center

            .. include:: diagrams/workflow_example.in.rst

What is a Task?
===============

.. important::

  Tasks are the fundamental units of work in OSMO. A **task** is an independent environment that
  runs a list of commands within a Docker container.

**Capabilities:**

* 📂 Access local files, upstream task, or cloud storage
* 💻 Develop interactively with VSCode, Jupyter, or SSH
* 🔐 Use managed secrets for secure credential access
* 🖥️ Request specific hardware (GPU, CPU, RAM)
* 🔁 Configure automatic retries for failures
* And much more!

.. dropdown:: Example ``train`` task from the above workflow
    :color: primary
    :icon: code
    :open:

    .. code-block:: yaml

        - name: train
          image: pytorch/pytorch:2.0-cuda11.8

          # Task dependencies
          inputs:
          - task: preprocess

          # Secrets
          credentials:
            wandb_cred:
              WANDB_API_KEY: wandb_api_key # (1)

          # Execution
          command: ["python"]
          args:
          - "train.py"
          - "--data=/workspace/data"
          - "--checkpoint=/workspace/ckpt/base.pth"
          - "--output={{output}}" # (2)

          # Task outputs
          outputs: # (3)
          - url: s3://my-bucket/models/

    .. code-annotations::

        1. Use secrets for secure credential management
        2. Writes to an output directory that is recognized by OSMO for further processing
        3. Uploads the output directory to S3 after completion

What is a Group?
================

.. important::

    A **group** is a collection of **tasks** that are executed together. It synchronizes the execution
    of multiple tasks, enabling them to communicate within the same network.

.. caution::

    :kbd:`groups` and :kbd:`tasks` fields are mutually exclusive in a workflow.

**How groups work:**

* A single task in a group is designated as the **group leader**
* All tasks in a group start together
* Tasks can communicate over the network
* Tasks may run on the same node or across different nodes
* Supports both homogeneous (e.g., all x86_64) and heterogeneous (e.g., x86_64 + ARM64) architectures

**Common patterns:**

* **Distributed training** - Multiple workers with parameter servers
* **Multi-stage pipelines** - Tasks that need real-time coordination
* **Service architectures** - Long-running services with dependent workers

.. dropdown:: Groups Example
    :color: primary
    :icon: code
    :open:

    .. code-block:: yaml

        workflow:
          name: my_workflow
          groups:

          ################################################
          # Group 1 (runs first)
          ################################################

          - name: group_1
            tasks:
            - name: task_1
              lead: true # (1)
              ...
            - name: task_2
              ...
              outputs:
              - dataset:
                  name: dataset_3 # (2)
            - name: task_3
              ...

          ################################################
          # Group 2 (runs after group 1)
          ################################################

          - name: group_2
            tasks:
            - name: task_4
              lead: true
              ...
              inputs:
              - dataset:
                  name: dataset_3 # (3)

          ################################################
          # Group 3 (runs after group 1)
          ################################################

          - name: group_3
            tasks:
            - name: task_5
              lead: true
              ...
              inputs:
              - dataset:
                  name: dataset_3
            - name: task_6 # (4)
              ...

    .. code-annotations::
        1. Every group must have one and only one lead task.
        2. ``task_2`` outputs ``dataset_3`` which is used as an input for other groups.
        3. ``group_2`` runs **after** ``group_1`` because of the dependency on ``dataset_3``.
        4. Despite not having a direct dependency on ``dataset_3``, ``task_6``'s peer task (``task_5``)
           depends on ``dataset_3``.

           Therefore, ``group_3`` must run **after** ``group_1``.

    .. include:: diagrams/groups_example.in.rst

.. seealso::

    See :ref:`here <workflow_spec>` for the full workflow specification.
