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

This page explains how OSMO executes workflows at the technical level, focusing on the workflow pod that powers every workflow task.

Overview
========

When you submit a workflow to OSMO, each task in the workflow becomes a Kubernetes pod on a backend cluster. Understanding how these pods are structured helps you:

- Debug workflow issues
- Optimize data operations
- Understand resource usage
- Use interactive features (exec, port-forward, rsync)

Workflow Pod
========================

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

Container Roles and Responsibilities
=====================================

osmo-init: Setup Container
---------------------------

**Type**: Init Container (runs first, then exits)

**Purpose**: Prepare the environment before user code runs

**Responsibilities**:

1. **Directory Setup**

   - Creates directory structure for data operations
   - Sets proper permissions for shared volumes
   - Configures paths for input/output data

2. **OSMO CLI Installation**

   - Makes the OSMO CLI available inside user container
   - Enables user to use ``osmo`` commands in user workflow tasks
   - No need to install OSMO CLI in user container image

3. **Environment Preparation**

   - Populates login directory with necessary files
   - Sets up shared state between containers
   - Configures Unix socket for inter-container communication

**Lifecycle**: Runs once at pod startup, exits when setup complete

osmo-ctrl: Coordinator Container
---------------------------------

**Type**: Sidecar (runs throughout task lifetime)

**Purpose**: Bridge between user container and OSMO service

**Responsibilities**:

1. **Service Communication**

   - Maintains WebSocket connection to OSMO service
   - Sends logs and metrics in real-time
   - Receives user commands (exec, port-forward, rsync)

2. **Data Management**

   - Downloads input data before task starts
   - Monitors output directory for artifacts
   - Uploads results to cloud storage after completion

3. **Task Orchestration**

   - Signals user container when to start execution
   - Coordinates interactive access requests
   - Handles graceful shutdown

4. **Interactive Features**

   - Enables ``osmo exec`` for terminal access
   - Supports ``osmo port-forward`` for service access
   - Facilitates ``osmo rsync`` for file transfers

**Communication**: Uses Unix socket at ``/osmo/data/socket/data.sock``

**Lifecycle**: Runs for entire task duration

User Container: Workload Container
-----------------------------------

**Type**: Main Container (user actual workload)

**Purpose**: Run the user's code

**Responsibilities**:

1. **Execute User Code**

   - Runs the image and command you specified in the workflow
   - Has full access to GPUs and compute resources
   - Executes user's custom logic

2. **Data Operations**

   - Read input data from ``/osmo/data/input``
   - Write output data to ``/osmo/data/output``
   - Access shared volumes

3. **Interactive Response**

   - Respond to exec requests (terminal access)
   - Serve port-forward connections
   - Handle rsync file transfers

**Communication**: Receives signals from osmo-ctrl via Unix socket

**Lifecycle**: Runs user's command from start to exit

Container Interaction Flow
===========================

Here's how the containers work together during a task's lifecycle:

1. **osmo-init**: Creates directories and sets up environment
2. **osmo-init**: Exits after setup complete
3. **osmo-ctrl**: Starts and connects to OSMO service
4. **osmo-ctrl**: Downloads input data to shared volume
5. **osmo-ctrl**: Signals **User Container** to start
6. **User Container**: Executes user's command, reads input, writes output
7. **osmo-ctrl**: Uploads output data after user container exits

Detailed Execution Phases
==========================

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

Shared Volumes and Communication
=================================

Volume Mounts
-------------

All three containers share these volumes:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Mount Path
     - Purpose
   * - ``/osmo/data/input``
     - Input data downloaded by osmo-ctrl, read by user container
   * - ``/osmo/data/output``
     - Output data written by user container, uploaded by osmo-ctrl
   * - ``/tmp/osmo/``
     - Unix socket for inter-container communication

Inter-Container Communication
------------------------------

**osmo-ctrl ↔ User Container**: Unix socket at ``/osmo/data/socket/data.sock``

**Messages**:

- **Start signal**: "Begin executing user's command"
- **Exec request**: "User wants terminal access"
- **Port-forward request**: "Forward port X to user"
- **Rsync request**: "Transfer files to/from user"

Example: Interactive Exec
--------------------------

Here's what happens when user runs ``osmo exec my-workflow task-1 -- bash``:

1. **User → OSMO Service**: "I want exec access to task-1"
2. **OSMO Service → osmo-ctrl**: WebSocket message with exec request
3. **osmo-ctrl → User Container**: Unix socket message "Start bash shell"
4. **User Container**: Spawns bash process
5. **User Container ↔ osmo-ctrl**: Bidirectional stream (stdin/stdout)
6. **osmo-ctrl ↔ OSMO Service**: WebSocket streams terminal I/O
7. **OSMO Service → User**: Terminal session active


Practical Implications
======================

For Workflow Authors
--------------------

**Directory Structure User Container Sees**:

.. code-block:: text

   /osmo/
   ├── input/              ← Read input data here
   │   ├── dataset1/
   │   └── dataset2/
   └── output/             ← Write results here
       └── (user outputs)

**Example Task**:

.. code-block:: yaml

   tasks:
     - name: train-model
       image: nvcr.io/nvidia/pytorch:24.01-py3
       command:
         - python
         - train.py
         - --input=/osmo/data/input/dataset
         - --output=/osmo/data/output/model

The data operations are automatic—osmo-ctrl handles downloading and uploading!

For Debugging
-------------

**Check osmo-ctrl logs**:

.. code-block:: bash

   $ kubectl logs <pod-name> -c osmo-ctrl

Shows data download/upload progress and issues.

**Check user container logs**:

.. code-block:: bash

   $ kubectl logs <pod-name> -c <task-name>

Shows user's application output.

**Exec into user container**:

.. code-block:: bash

   $ osmo exec my-workflow task-1 -- bash

Access user container with full environment.

Resource Considerations
-----------------------

**User container gets**:

- All CPU/GPU resources user requested
- User specified memory limits
- Full compute allocation

**osmo-ctrl overhead**:

- ~50-100 MB memory
- Minimal CPU (only during data operations)
- Negligible network overhead

**Total pod resources** = User request + small sidecar overhead

See Also
========

- :doc:`../introduction/architecture` for overall OSMO architecture
- :doc:`advanced_config/pool` for pool configuration
- :doc:`advanced_config/scheduler` for scheduling behavior
- User Guide for workflow specification details

