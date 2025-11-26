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

.. _workflow_execution:

================================================
Understanding Task Execution
================================================

When you submit a workflow to OSMO, each task runs as a Kubernetes pod on your backend cluster. This page explains the technical architecture of these pods—how they're structured, how the containers inside the pod communicate, and what happens during execution.

.. tip::

   **Why read this?** Understanding OSMO workflow pod execution helps you debug issues, optimize data operations, and provide necessary support to users in case of workflow failures or when they use interactive features like ``exec`` and ``port-forward``.


Task Pod Architecture
======================

Every workflow task executes as a Kubernetes pod with three containers that work together. These containers share volumes (``/osmo/data/input`` and ``/osmo/data/output``) and communicate via Unix sockets to seamlessly orchestrate your task from data download through execution to results upload.


.. image:: pod_architecture.svg
   :align: center
   :width: 80%


The Three Containers
=====================

Each pod contains three containers working together to execute your task:

.. grid:: 3
    :gutter: 3

    .. grid-item-card:: :octicon:`gear` OSMO Init
        :class-card: sd-border-primary

        **(Init Container)**

        Prepares the environment before your code runs:

        - Creates ``/osmo/data/input`` and ``/osmo/data/output`` directories
        - Installs OSMO CLI (available in your container)
        - Sets up Unix socket for inter-container communication

        :bdg-info:`Runs once` → Exits after setup

    .. grid-item-card:: :octicon:`sync` OSMO Ctrl
        :class-card: sd-border-success

        **(Sidecar Container)**

        Coordinates task execution and data:

        - Downloads input data from cloud storage
        - Streams logs to OSMO service in real-time for monitoring
        - Uploads output artifacts after completion
        - Handles interactive requests (exec, port-forward)

        :bdg-success:`Runs throughout` task lifetime

    .. grid-item-card:: :octicon:`package` User Container
        :class-card: sd-border-warning

        **(Main Container)**

        Runs your code as a process:

        - Executes the command you specified
        - Uses requested CPU/GPU/memory resources
        - Reads input data from ``/osmo/data/input``
        - Writes output data to ``/osmo/data/output``
        - Logs to stdout/stderr

        :bdg-warning:`Runs` your code from start to exit

Execution Flow
===============

Every task follows this four-phase progression:

.. grid:: 4
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **1. Initialize** 🔧
        ^^^

        **OSMO Init** sets up environment

        Creates directories, installs OSMO CLI, configures Unix socket for inter-container communication

        +++

        Time in the order of 5-10 seconds

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **2. Download** ⬇️
        ^^^

        **OSMO Ctrl** fetches data

        Downloads and extracts input datasets to ``/osmo/data/input``

        +++

        Time varies by download size

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **3. Execute** ▶️
        ^^^

        **Your code** runs inside the container

        Reads inputs, writes outputs, logs streamed in real-time

        +++

        Time varies by code runtime

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **4. Upload** ⬆️
        ^^^

        **OSMO Ctrl** saves results

        Uploads artifacts from ``/osmo/data/output``

        +++

        Time varies by upload size

.. note::

   **Data handling is automatic.** Your code only needs to read from ``{{input}}`` (``/osmo/data/input``) and write to ``{{output}}`` (``/osmo/data/output``). The **Ctrl** container manages all transfers.

Practical Guide
================

Directory Structure
--------------------

Your container automatically has access to these paths:

.. code-block:: text

   /osmo/data/
   ├── input/              ← Read input datasets here
   │   ├── 0/dataset1/
   │   └── 1/dataset2/
   ├── output/             ← Write results here
   │   └── (your artifacts)
   └── socket/             ← Unix socket (managed by OSMO)
       └── data.sock

Example Task Configuration
----------------------------

.. code-block:: yaml
   :emphasize-lines: 6-8

   tasks:
     - name: train-model
       image: nvcr.io/nvidia/pytorch:24.01-py3
       command: ["python", "train.py"]
       args:
         - --input={{input:0}}/dataset1
         - --input={{input:1}}/dataset2
         - --output={{output}}/model

Debugging
------------

.. dropdown:: View Container Logs
   :icon: file-code

   **osmo-ctrl logs** (data operations):

   .. code-block:: bash

      $ kubectl logs <pod-name> -c osmo-ctrl

   **Your container logs** (application output):

   .. code-block:: bash

      $ kubectl logs <pod-name> -c <task-name>

.. dropdown:: Interactive Access
   :icon: terminal

   Access your running container with a shell:

   .. code-block:: bash

      $ osmo exec my-workflow task-1 -- bash

   **How it works:** Command flows through OSMO Service → osmo-ctrl → User Container via Unix socket

.. dropdown:: Resource Allocation
   :icon: cpu

   **Your container:** All requested CPU/GPU/memory

   **osmo-ctrl overhead:** ~50-100 MB memory, minimal CPU (active during transfers only)

Learn More
==========

.. seealso::

   - :ref:`Workflow Overview <workflow_overview>` - User guide for writing workflows
   - :ref:`Workflow Lifecycle <workflow_lifecycle>` - Understanding workflow states
   - :ref:`architecture` - Overall OSMO system architecture

