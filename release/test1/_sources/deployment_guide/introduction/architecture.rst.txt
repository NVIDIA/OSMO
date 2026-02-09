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

.. _architecture:

================================================
Architecture
================================================

OSMO is a distributed platform that separates control plane functionality (workflow management, API, UI) from compute plane functionality (where workflows actually execute). This separation allows you to manage multiple compute clusters from a single control point and scale compute resources independently.



For a detailed view showing infrastructure, Kubernetes, and container-level components, see the comprehensive diagram below:

.. image:: deployment_architecture.svg
   :width: 100%



OSMO uses a control plane / compute plane architecture:

.. list-table::
   :widths: 30 70
   :header-rows: 0

   * - **Control Plane**
     - Runs on the service cluster. Provides APIs, UI, authentication, workflow scheduling, and centralized management.
   * - **Compute Plane**
     - Runs on one or more backend clusters. Executes user workflows and reports status back to the control plane.

This separation provides several benefits:

- **Scalability**: Add or remove compute backends without affecting the control plane
- **Isolation**: Isolate different teams or projects on separate compute backends
- **Flexibility**: Mix different hardware types (cloud, on-premises, edge devices)
- **Security**: Keep workflow execution separate from management functions

Control Plane
============================

The OSMO Service runs on the service cluster (i.e., control plane) and provides the central management layer for the platform.

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`server` Core Service

          Central API server that handles workflow submission, validates user credentials, and manages authentication.

          +++

          **Key Functions:**

          • Workflow submission & validation
          • User authentication & authorization
          • Workflow monitoring & management
          • Dataset operations, inspection

      .. grid-item-card:: :octicon:`workflow` Worker

          Manages workflow lifecycle from submission to completion and coordinates backend execution for all tasks.

          +++

          **Key Functions:**

          • Assign workflows to backends
          • Track progress & update status
          • Handle cancellation & cleanup
          • Upload artifacts to cloud storage

      .. grid-item-card:: :octicon:`broadcast` Agent

          Receives real-time status updates from compute backends to keep workflow information current.

          +++

          **Key Functions:**

          • Listen for backend status messages
          • Process state transitions
          • Update backend resource info
          • Handle backend registration

      .. grid-item-card:: :octicon:`log` Logger

          Streams workflow logs to users in real-time from active workflows or cloud storage from completed ones.

          +++

          **Key Functions:**

          • Collect logs from running tasks
          • WebSocket streaming for live logs
          • Read from Redis (active) or storage (completed)

      .. grid-item-card:: :octicon:`arrow-switch` Router

          Enables interactive access to running workflow containers for debugging, port forwarding, and file transfer.

          +++

          **Key Functions:**

          • Terminal access (``exec``)
          • Port forwarding
          • File transfer (``rsync``)

      .. grid-item-card:: :octicon:`clock` Delayed Job Monitor

          Manages scheduled workflow operations including timeout handling and deferred cleanup tasks for all workflows.

          +++

          **Key Functions:**

          • Process delayed job queue
          • Handle workflow timeouts
          • Trigger cleanup operations

Compute Plane
================================

The Backend Operator runs on each compute backend cluster (i.e., compute plane) and serves as the execution engine for workflows.

.. admonition:: Key Architecture Points
  :class: info

  - Backend operators **initiate connections to** OSMO (not the other way around)
  - The service cluster does not need network access to backend clusters
  - This allows backends to be deployed behind firewalls and in restricted networks
  - Backends can be in different clouds, on-premises, or edge locations


.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`package` Backend Worker

          Creates and manages Kubernetes resources for workflow execution on the compute backend clusters.

          +++

          **Key Functions:**

          • Execute workflow requests from the Service
          • Create Kubernetes pods, services, and volumes for workflow tasks
          • Monitor resource creation and handle errors
          • Clean up resources when workflows complete or are canceled
          • Apply resource quotas and scheduling constraints

      .. grid-item-card:: :octicon:`eye` Backend Listener

          Monitors Kubernetes resources and reports all state changes back to the OSMO Service control plane.

          +++

          **Key Functions:**

          • Watch Kubernetes pods, jobs, and services for state changes
          • Detect when tasks start, run, complete, or fail
          • Capture error messages on task failure and exit codes
          • Transmit detailed status information to the OSMO Service Agent
          • Report resource usage and health metrics


Workflow Management
========================

Below diagram shows the interaction between the components when a workflow is submitted.

.. image:: workflow_sequence.svg
   :width: 100%

.. seealso::

    To learn more, refer to :doc:`../appendix/workflow_execution`


Authentication
===============

- All API requests require **authentication** (specific paths can be excluded from authentication during service deployment)
- **Role-based access** allows you group users by roles and determine pool access
- Backend operators authenticate to the service using **service accounts**

.. seealso::

    To learn more, refer to :doc:`../appendix/authentication/index`


