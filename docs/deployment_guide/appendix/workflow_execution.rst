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
.. _workflow_containers:

================================================
Workflow Execution
================================================

When you submit a workflow to OSMO, each task runs as a Kubernetes pod on your backend cluster. This page explains the technical architecture of these pods—how they're structured, how they communicate, and what happens during execution.

.. tip::

   **Why read this?** Understanding pod architecture helps you debug issues, optimize data operations, and effectively use interactive features like ``exec`` and ``port-forward``.

At a Glance
===========

Each workflow task executes as a Kubernetes pod containing three specialized containers:

.. grid:: 1 1 3 3
    :gutter: 2
    :class-container: text-center

    .. grid-item::

        **1. osmo-init**

        Sets up the environment

    .. grid-item::

        **2. osmo-ctrl**

        Manages data & coordination

    .. grid-item::

        **3. Your Container**

        Runs your workload

These containers share volumes (``/osmo/data/input`` and ``/osmo/data/output``) and communicate via Unix sockets to seamlessly orchestrate your task from data download through execution to results upload.

----

Pod Architecture
=================

Every workflow task runs in a pod with three containers that work together:

.. raw:: html

    <style>
        .container-diagram {
            text-align: center;
            margin: 2em 0;
            padding: 2em;
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
            border: 2px solid #76B900;
            border-radius: 8px;
        }

        /* Light mode overrides - system preference */
        @media (prefers-color-scheme: light) {
            .container-diagram {
                background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
            }
        }

        /* Light mode overrides - theme toggle */
        [data-theme="light"] .container-diagram,
        html[data-theme="light"] .container-diagram,
        body[data-theme="light"] .container-diagram,
        .theme-light .container-diagram {
            background: linear-gradient(135deg, #f5f5f5 0%, #e8e8e8 100%);
        }

        /* Dark mode overrides - theme toggle (explicit) */
        [data-theme="dark"] .container-diagram,
        html[data-theme="dark"] .container-diagram,
        body[data-theme="dark"] .container-diagram,
        .theme-dark .container-diagram {
            background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
        }

        .container-row {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 2em;
            margin: 2em 0;
        }

        .container-box {
            background: rgba(118, 185, 0, 0.1);
            border: 2px solid #76B900;
            padding: 1.5em;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(118, 185, 0, 0.2);
            min-width: 180px;
            opacity: 0;
            animation: fadeInUp 0.6s ease-out forwards;
        }

        .container-box.init { animation-delay: 0.2s; }
        .container-box.ctrl { animation-delay: 0.6s; }
        .container-box.user { animation-delay: 1.0s; }

        .container-title {
            font-weight: bold;
            color: #76B900;
            margin-bottom: 0.5em;
            font-size: 1.1em;
        }

        .container-type {
            font-size: 0.85em;
            opacity: 0.8;
            font-style: italic;
        }

        .arrow {
            position: relative;
            width: 40px;
            height: 3px;
            background-color: var(--nv-green);
            opacity: 0;
            animation: fadeIn 0.6s ease-out forwards;
        }

        .arrow::after {
            content: "";
            position: absolute;
            right: -8px;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-left: 10px solid var(--nv-green);
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
        }

        .arrow.bidirectional::before {
            content: "";
            position: absolute;
            left: -8px;
            top: 50%;
            transform: translateY(-50%);
            width: 0;
            height: 0;
            border-right: 10px solid var(--nv-green);
            border-top: 6px solid transparent;
            border-bottom: 6px solid transparent;
        }

        .arrow.a1 { animation-delay: 0.4s; }
        .arrow.a2 { animation-delay: 0.8s; }

        @keyframes fadeInUp {
            from {
                opacity: 0;
                transform: translateY(20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .pod-label {
            color: #76B900;
            font-size: 1.2em;
            font-weight: bold;
            margin-bottom: 1em;
        }
    </style>

    <div class="container-diagram">
        <div class="pod-label"> Kubernetes Pod (One per Task)</div>
        <div class="container-row">
            <div class="container-box init">
                <div class="container-title">osmo-init</div>
                <div class="container-type">Init Container</div>
            </div>
            <div class="arrow a1"></div>
            <div class="container-box ctrl">
                <div class="container-title">osmo-ctrl</div>
                <div class="container-type">Sidecar</div>
            </div>
            <div class="arrow a2 bidirectional"></div>
            <div class="container-box user">
                <div class="container-title">User Container</div>
                <div class="container-type">Main Container</div>
            </div>
        </div>
    </div>

The Three Containers
=====================

Each pod contains three containers working together to execute your task:

.. grid:: 3
    :gutter: 3

    .. grid-item-card:: :octicon:`gear` osmo-init
        :class-card: sd-border-primary

        **Init Container**

        Prepares the environment before your code runs:

        - Creates ``/osmo/data/input`` and ``/osmo/data/output`` directories
        - Installs OSMO CLI (available in your container)
        - Sets up Unix socket for inter-container communication

        :bdg-info:`Runs once` → Exits after setup

    .. grid-item-card:: :octicon:`sync` osmo-ctrl
        :class-card: sd-border-success

        **Sidecar Container**

        Coordinates task execution and data:

        - Downloads input data from cloud storage
        - Streams logs to OSMO service in real-time
        - Uploads output artifacts after completion
        - Handles interactive requests (exec, port-forward)

        :bdg-success:`Runs throughout` task lifetime

    .. grid-item-card:: :octicon:`package` User Container
        :class-card: sd-border-warning

        **Main Container**

        Your actual workload:

        - Executes the command you specified
        - Reads from ``/osmo/data/input``
        - Writes to ``/osmo/data/output``
        - Gets all requested CPU/GPU/memory resources

        :bdg-warning:`Runs` your code from start to exit

How It Works: Execution Flow
==============================

When a task pod starts, the containers execute in this sequence:

.. tab-set::

   .. tab-item:: 1. Initialize
      :sync: init

      **osmo-init** prepares the environment

      - Creates directory structure (``/osmo/data/input``, ``/osmo/data/output``)
      - Sets up Unix socket at ``/osmo/data/socket/data.sock``
      - Installs OSMO CLI binary
      - Exits when complete

      ⏱️ **Duration:** ~2-5 seconds

   .. tab-item:: 2. Download Data
      :sync: download

      **osmo-ctrl** fetches input data

      - Connects to OSMO service via WebSocket
      - Downloads datasets specified in workflow
      - Extracts to ``/osmo/data/input``
      - Reports progress

      ⏱️ **Duration:** Depends on data size

   .. tab-item:: 3. Execute
      :sync: execute

      **User Container** runs your workload

      **Your code:**
      - Reads from ``/osmo/data/input``
      - Writes to ``/osmo/data/output``
      - Logs to stdout/stderr

      **osmo-ctrl** (in parallel):
      - Streams logs to OSMO service
      - Handles interactive requests
      - Monitors for completion

      ⏱️ **Duration:** Your workload time

   .. tab-item:: 4. Upload Results
      :sync: upload

      **osmo-ctrl** uploads outputs

      - Detects user container exit
      - Uploads ``/osmo/data/output`` contents
      - Sends final status
      - Pod terminates

      ⏱️ **Duration:** Depends on output size

Visual Timeline
===============

Phase 1: Initialization
-----------------------

**What happens**: Pod starts, osmo-init runs

.. raw:: html

    <style>
        .phase-diagram {
            margin: 1.5em auto;
            max-width: 400px;
        }

        .phase-container {
            border: 2px solid #76B900;
            border-radius: 4px;
            margin-bottom: -2px;
        }

        .phase-container:first-child {
            border-radius: 8px 8px 0 0;
        }

        .phase-container:last-child {
            border-radius: 0 0 8px 8px;
            margin-bottom: 0;
        }

        .phase-header {
            padding: 0.8em 1em;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(118, 185, 0, 0.1);
        }

        .phase-name {
            font-weight: bold;
            color: #76B900;
        }

        .phase-status {
            font-size: 0.9em;
            padding: 0.3em 0.8em;
            border-radius: 12px;
            font-weight: 500;
        }

        .phase-status.running {
            background: #76B900;
            color: #1a1a1a;
        }

        .phase-status.waiting {
            background: rgba(128, 128, 128, 0.3);
            opacity: 0.7;
        }

        .phase-status.exited {
            background: rgba(118, 185, 0, 0.3);
            opacity: 0.7;
        }

        /* Light mode adjustments */
        @media (prefers-color-scheme: light) {
            .phase-status.running {
                color: white;
            }
        }

        [data-theme="light"] .phase-status.running,
        html[data-theme="light"] .phase-status.running,
        body[data-theme="light"] .phase-status.running,
        .theme-light .phase-status.running {
            color: white;
        }
    </style>

    <div class="phase-diagram">
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-init</span>
                <span class="phase-status running">Running</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-ctrl</span>
                <span class="phase-status waiting">Waiting</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">User Container</span>
                <span class="phase-status waiting">Waiting</span>
            </div>
        </div>
    </div>

**Actions**:

- Creates ``/osmo/data/input``, ``/osmo/data/output``
- Sets up shared volume mounts
- Copies OSMO CLI binary
- Creates Unix socket at ``/osmo/data/socket/data.sock``

**Duration**: Typically 2-5 seconds

Phase 2: Data Download
-----------------------

**What happens**: osmo-ctrl downloads input data

.. raw:: html

    <div class="phase-diagram">
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-init</span>
                <span class="phase-status exited">Exited</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-ctrl</span>
                <span class="phase-status running">Running</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">User Container</span>
                <span class="phase-status waiting">Waiting</span>
            </div>
        </div>
    </div>

**Actions**:

- Connects to OSMO service via WebSocket
- Downloads datasets specified in workflow
- Extracts data to ``/osmo/data/input``
- Reports download progress

**Duration**: Depends on data size (seconds to minutes)

Phase 3: Workload Execution
----------------------------

**What happens**: User code runs

.. raw:: html

    <div class="phase-diagram">
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-init</span>
                <span class="phase-status exited">Exited</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-ctrl</span>
                <span class="phase-status running">Running</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">User Container</span>
                <span class="phase-status running">Running</span>
            </div>
        </div>
    </div>

**Actions**:

- **User Container**: Executes user's command

  - Reads from ``/osmo/data/input``
  - Writes to ``/osmo/data/output``
  - Logs to stdout/stderr

- **osmo-ctrl**: Monitors and reports

  - Streams user container logs to OSMO service
  - Watches for output files in ``/osmo/data/output``
  - Handles interactive requests

**Duration**: Depends on user's workload

Phase 4: Upload and Cleanup
----------------------------

**What happens**: Results uploaded, pod terminates

.. raw:: html

    <div class="phase-diagram">
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-init</span>
                <span class="phase-status exited">Exited</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">osmo-ctrl</span>
                <span class="phase-status running">Running</span>
            </div>
        </div>
        <div class="phase-container">
            <div class="phase-header">
                <span class="phase-name">User Container</span>
                <span class="phase-status exited">Exited</span>
            </div>
        </div>
    </div>

**Actions**:

- osmo-ctrl detects when user container exits
- Uploads contents of ``/osmo/data/output`` to cloud storage
- Sends final status to OSMO service
- Pod terminates

**Duration**: Depends on output data size

Data and Communication
=======================

Shared Volumes
--------------

All containers share these mounted volumes:

.. grid:: 3
    :gutter: 2

    .. grid-item-card::
        :class-card: sd-text-center

        ``/osmo/data/input``
        ^^^
        Input datasets downloaded by **osmo-ctrl**, read by your code

    .. grid-item-card::
        :class-card: sd-text-center

        ``/osmo/data/output``
        ^^^
        Outputs written by your code, uploaded by **osmo-ctrl**

    .. grid-item-card::
        :class-card: sd-text-center

        ``/osmo/data/socket/``
        ^^^
        Unix socket for container communication

Inter-Container Communication
-------------------------------

**osmo-ctrl** and **User Container** communicate via Unix socket (``/osmo/data/socket/data.sock``) to coordinate:

- Start signals for task execution
- Interactive access requests (exec, port-forward, rsync)
- Status updates and health checks

Example: Interactive Exec Flow
^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

When you run ``osmo exec my-workflow task-1 -- bash``:

.. code-block:: text

   You → OSMO Service → osmo-ctrl → User Container
                                      ↓
                          Spawns bash shell
                                      ↓
   Terminal ← OSMO Service ← osmo-ctrl ← bash I/O


Quick Reference
================

Writing Workflows
------------------

Your container has automatic access to input/output directories:

.. code-block:: text

   /osmo/data/
   ├── input/              ← Your input datasets
   │   ├── dataset1/
   │   └── dataset2/
   └── output/             ← Write your results here
       └── (artifacts)

.. code-block:: yaml
   :caption: Example Task

   tasks:
     - name: train-model
       image: nvcr.io/nvidia/pytorch:24.01-py3
       command: ["python", "train.py"]
       args:
         - --input=/osmo/data/input/dataset
         - --output=/osmo/data/output/model

.. tip::

   **Data handling is automatic!** Just read from ``/osmo/data/input`` and write to ``/osmo/data/output``. The osmo-ctrl container handles all downloading and uploading.

Debugging
----------

.. tab-set::

   .. tab-item:: View Logs

      Check osmo-ctrl logs for data operations:

      .. code-block:: bash

         $ kubectl logs <pod-name> -c osmo-ctrl

      Check your container logs:

      .. code-block:: bash

         $ kubectl logs <pod-name> -c <task-name>

   .. tab-item:: Interactive Access

      Get a shell in your running container:

      .. code-block:: bash

         $ osmo exec my-workflow task-1 -- bash

      Access with full environment and installed tools.

   .. tab-item:: Resource Usage

      **Your container receives:**

      - All requested CPU/GPU/memory resources

      **osmo-ctrl overhead:**

      - ~50-100 MB memory
      - Minimal CPU (active during data transfers only)

      Total pod = Your request + small sidecar overhead

See Also
=========

.. seealso::

   - `Workflow Overview <https://nvidia.github.io/OSMO/user_guide/workflows/index.html>`__ - User guide for writing workflows
   - `Workflow Lifecycle <https://nvidia.github.io/OSMO/user_guide/workflows/lifecycle/index.html>`__ - Understanding workflow states
   - :ref:`architecture` - Overall OSMO system architecture

