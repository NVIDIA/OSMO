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


Architecture Overview
=====================

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

Control Plane: OSMO Service
============================

The OSMO Service runs on the service cluster and provides the central management layer for the platform.

.. image:: ../install_service/osmo_full.png
   :width: 600
   :alt: OSMO Service Components

Core Service
------------

The core service is the central API server that users and systems interact with. When you submit a workflow, the Core Service receives it, validates your credentials, checks if you have access to the requested pool, and then queues the workflow for execution.

.. dropdown:: Responsibilities

   - Handle workflow submission requests
   - Validate workflows and check user permissions
   - Provide API endpoints for users to query workflow information
   - Provide API endpoints for admins to manage pools, backends, service configs, etc.
   - Authenticate users and enforce authorization policies

Worker
------

The worker manages workflow lifecycle from submission to completion. After the Core Service accepts your workflow, the Worker picks it up, determines which backend and pool it should run on, and coordinates with the backend to start execution.

.. dropdown:: Responsibilities

   - Monitor workflow queue and assign workflows to appropriate backends
   - Track workflow progress and update status in the database
   - Handle workflow cancellation and cleanup
   - Upload workflow artifacts (logs, outputs) to cloud storage
   - Manage workflow retry logic for transient failures

Agent
-----

The agent service receives real-time status updates from compute backends. As your workflow executes on a backend cluster, the Agent receives continuous status updates and keeps the system's information of your workflow current.

.. dropdown:: Responsibilities

   - Listen for status messages from backend operators
   - Creates jobs for worker to process workflow state transitions
   - Update current backend resource information in database
   - Process compute backend registration

Logger
------

The logger service streams workflow logs to users in real-time or post workflow execution.

.. dropdown:: Responsibilities

   - Collect logs from running workflow tasks
   - Stream logs to users via WebSocket connections
   - Read logs from from redis or cloud storage based on the status of the workflow, running workflow logs are streamed from redis, whereas finished workflow logs are read from cloud storage.

Router
------

The router service enables interactive access to running workflow containers. When users need to debug a workflow or access a running service, the Router establishes a secure tunnel between your local machine and the container running on the compute cluster.

.. dropdown:: Responsibilities

   - Provide bidirectional communication channel between users and workflow containers
   - Enable ``exec`` (terminal access) into running containers
   - Support ``port-forward`` for accessing services running in workflows
   - Enable ``rsync`` for file transfer to/from workflow containers

Delayed Job Monitor
-------------------

The delayed job monitor handles jobs from the delayed job queue and adds them into the worker job queue.

.. dropdown:: Responsibilities

   - Worker creates delayed jobs to terminate and cleanup workflows based on the workflow's timeout parameters
   - When the timestamp is reached, delayed job monitor retrieves the jobs
   - Delay job monitor moves these jobs back into the regular worker job queue for processing

Compute Plane: Backend Operator
================================

The Backend Operator runs on each compute backend cluster and serves as the execution engine for workflows.

.. important::

   **Key Architecture Points**

   - Backend operators **initiate connections to** the OSMO service (not the other way around)
   - The service cluster does not need network access to backend clusters
   - This allows backends to be deployed behind firewalls and in restricted networks
   - Backends can be in different clouds, on-premises, or edge locations


Backend Worker
--------------

The backend worker creates and deletes Kubernetes resources for workflows. When the OSMO Service assigns a workflow to a backend, the backend worker receives the Kubernetes spec and creates the resources in the cluster. It is responsible for the actual "launch" of your containers.

.. dropdown:: Responsibilities

   - Receive workflow execution requests from the OSMO Service
   - Create Kubernetes pods, services, and volumes for workflow tasks
   - Monitor resource creation and handle errors
   - Clean up resources when workflows complete or are canceled
   - Apply resource quotas and scheduling constraints


Backend Listener
----------------

Monitors Kubernetes resources and reports their state back to the control plane. As your workflow runs, the Backend Listener watches the Kubernetes pods and nodes and immediately reports any status changes back to the control plane, enabling real-time monitoring.

.. dropdown:: Responsibilities

   - Watch Kubernetes pods, jobs, and services for state changes
   - Detect when tasks start, run, complete, or fail
   - Capture error messages and exit codes
   - Transmit detailed status information to the OSMO Service Agent
   - Report resource usage and health metrics


How Components Interact
========================


Here's what happens when you submit a workflow:

.. raw:: html

   <style>
   /* Light Mode (Default) */
   .workflow-container {
       margin: 2em 0;
       padding: 1.5em;
       background: linear-gradient(to bottom, #f8f9fa 0%, #ffffff 100%);
       border-radius: 12px;
       box-shadow: 0 2px 8px rgba(0,0,0,0.08);
   }

   .flow-step {
       position: relative;
       margin: 1.5em auto;
       padding: 1.2em 1.5em;
       background: white;
       border-left: 5px solid #76b900;
       border-radius: 8px;
       box-shadow: 0 2px 6px rgba(0,0,0,0.1);
       transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
       cursor: pointer;
       max-width: 800px;
   }

   .flow-step:hover {
       transform: translateX(8px);
       box-shadow: 0 4px 16px rgba(118, 185, 0, 0.25);
       border-left-width: 6px;
   }

   .flow-step.expanded {
       background: linear-gradient(135deg, #f0f9e8 0%, #ffffff 100%);
       border-left-color: #5a9100;
   }

   .step-header {
       display: flex;
       align-items: center;
       gap: 12px;
   }

   .step-num {
       display: flex;
       align-items: center;
       justify-content: center;
       min-width: 36px;
       height: 36px;
       background: linear-gradient(135deg, #76b900 0%, #5a9100 100%);
       color: white;
       border-radius: 50%;
       font-weight: bold;
       font-size: 16px;
       box-shadow: 0 2px 4px rgba(118, 185, 0, 0.3);
   }

   .step-title {
       font-size: 1.15em;
       font-weight: 600;
       color: #2c3e50;
       flex: 1;
   }

   .step-icon {
       font-size: 1.2em;
       color: #2c3e50;
       transition: transform 0.3s ease;
   }

   .flow-step.expanded .step-icon {
       transform: rotate(90deg);
   }

   .step-content {
       margin-top: 1em;
       margin-left: 48px;
       padding-left: 1em;
       border-left: 2px dashed #e0e0e0;
       max-height: 0;
       overflow: hidden;
       transition: max-height 0.4s ease, opacity 0.3s ease;
       opacity: 0;
   }

   .flow-step.expanded .step-content {
       max-height: 500px;
       opacity: 1;
   }

   .step-content ul {
       margin: 0.5em 0;
       padding-left: 1.2em;
       list-style: none;
   }

   .step-content li {
       margin: 0.6em 0;
       color: #495057;
       line-height: 1.6;
       position: relative;
       padding-left: 1.2em;
   }

   .step-content li:before {
       content: "•";
       position: absolute;
       left: 0;
       color: #76b900;
       font-weight: bold;
   }

   .component {
       display: inline-block;
       padding: 2px 10px;
       background: linear-gradient(135deg, #76b900 0%, #5a9100 100%);
       color: white;
       border-radius: 4px;
       font-weight: 600;
       font-size: 0.9em;
       box-shadow: 0 1px 3px rgba(118, 185, 0, 0.3);
   }

   .code-snippet {
       background: #2d2d2d;
       color: #a8e6a1;
       padding: 8px 14px;
       border-radius: 6px;
       font-family: 'Courier New', monospace;
       font-size: 0.9em;
       display: inline-block;
       margin: 0.4em 0;
       border-left: 3px solid #76b900;
   }

   .flow-arrow {
       text-align: center;
       font-size: 2em;
       color: #76b900;
       margin: -0.3em 0;
       animation: pulse 2s ease-in-out infinite;
       user-select: none;
   }

   @keyframes pulse {
       0%, 100% {
           opacity: 0.6;
           transform: translateY(0);
       }
       50% {
           opacity: 1;
           transform: translateY(3px);
       }
   }

   .expand-hint {
       text-align: center;
       color: #6c757d;
       font-size: 0.9em;
       margin-bottom: 1em;
       font-style: italic;
   }

   /* Dark Mode - Multiple selectors for compatibility */
   @media (prefers-color-scheme: dark),
   (prefers-color-scheme: dark) and (prefers-contrast: more),
   (prefers-color-scheme: dark) and (prefers-contrast: less) {
       .workflow-container {
           background: linear-gradient(to bottom, #1a1a1a 0%, #2d2d2d 100%) !important;
           box-shadow: 0 2px 8px rgba(0,0,0,0.3);
       }

       .flow-step {
           background: #2d2d2d !important;
           border-left-color: #8fd915;
           box-shadow: 0 2px 6px rgba(0,0,0,0.3);
       }

       .flow-step:hover {
           box-shadow: 0 4px 16px rgba(143, 217, 21, 0.3);
       }

       .flow-step.expanded {
           background: linear-gradient(135deg, #1f2e15 0%, #2d2d2d 100%) !important;
           border-left-color: #8fd915;
       }

       .step-num {
           background: linear-gradient(135deg, #8fd915 0%, #76b900 100%);
           color: #1a1a1a;
           box-shadow: 0 2px 4px rgba(143, 217, 21, 0.4);
       }

       .step-title {
           color: #e0e0e0;
       }

       .step-icon {
           color: #b0b0b0;
       }

       .step-content {
           border-left-color: #4a4a4a;
       }

       .step-content li {
           color: #b0b0b0;
       }

       .step-content li:before {
           color: #8fd915;
       }

       .component {
           background: linear-gradient(135deg, #8fd915 0%, #76b900 100%);
           color: #1a1a1a;
           box-shadow: 0 1px 3px rgba(143, 217, 21, 0.4);
       }

       .code-snippet {
           background: #1a1a1a;
           color: #8fd915;
           border-left-color: #8fd915;
       }

       .flow-arrow {
           color: #8fd915;
       }

       .expand-hint {
           color: #909090;
       }
   }

   /* Dark mode support for Sphinx/RTD themes */
   [data-theme="dark"] .workflow-container,
   html[data-theme="dark"] .workflow-container,
   body[data-theme="dark"] .workflow-container,
   .theme-dark .workflow-container {
       background: linear-gradient(to bottom, #1a1a1a 0%, #2d2d2d 100%) !important;
       box-shadow: 0 2px 8px rgba(0,0,0,0.3);
   }

   [data-theme="dark"] .flow-step,
   html[data-theme="dark"] .flow-step,
   body[data-theme="dark"] .flow-step,
   .theme-dark .flow-step {
       background: #2d2d2d !important;
       border-left-color: #8fd915;
       box-shadow: 0 2px 6px rgba(0,0,0,0.3);
   }

   [data-theme="dark"] .flow-step.expanded,
   html[data-theme="dark"] .flow-step.expanded,
   body[data-theme="dark"] .flow-step.expanded,
   .theme-dark .flow-step.expanded {
       background: linear-gradient(135deg, #1f2e15 0%, #2d2d2d 100%) !important;
       border-left-color: #8fd915;
   }

   [data-theme="dark"] .step-title,
   html[data-theme="dark"] .step-title,
   body[data-theme="dark"] .step-title,
   .theme-dark .step-title {
       color: #e0e0e0;
   }

   [data-theme="dark"] .step-icon,
   html[data-theme="dark"] .step-icon,
   body[data-theme="dark"] .step-icon,
   .theme-dark .step-icon {
       color: #b0b0b0;
   }

   [data-theme="dark"] .step-content,
   html[data-theme="dark"] .step-content,
   body[data-theme="dark"] .step-content,
   .theme-dark .step-content {
       border-left-color: #4a4a4a;
   }

   [data-theme="dark"] .step-content li,
   html[data-theme="dark"] .step-content li,
   body[data-theme="dark"] .step-content li,
   .theme-dark .step-content li {
       color: #b0b0b0;
   }

   [data-theme="dark"] .step-content li:before,
   html[data-theme="dark"] .step-content li:before,
   body[data-theme="dark"] .step-content li:before,
   .theme-dark .step-content li:before {
       color: #8fd915;
   }

   [data-theme="dark"] .component,
   html[data-theme="dark"] .component,
   body[data-theme="dark"] .component,
   .theme-dark .component {
       background: linear-gradient(135deg, #8fd915 0%, #76b900 100%);
       color: #1a1a1a;
   }

   [data-theme="dark"] .code-snippet,
   html[data-theme="dark"] .code-snippet,
   body[data-theme="dark"] .code-snippet,
   .theme-dark .code-snippet {
       background: #1a1a1a;
       color: #8fd915;
       border-left-color: #8fd915;
   }

   [data-theme="dark"] .flow-arrow,
   html[data-theme="dark"] .flow-arrow,
   body[data-theme="dark"] .flow-arrow,
   .theme-dark .flow-arrow {
       color: #8fd915;
   }

   [data-theme="dark"] .expand-hint,
   html[data-theme="dark"] .expand-hint,
   body[data-theme="dark"] .expand-hint,
   .theme-dark .expand-hint {
       color: #909090;
   }

   @media (prefers-reduced-motion: reduce) {
       .flow-step,
       .step-content,
       .step-icon {
           transition: none;
       }
       .flow-arrow {
           animation: none;
       }
       .flow-step:hover {
           transform: none;
       }
   }

   @media (max-width: 768px) {
       .step-content {
           margin-left: 0;
       }
       .flow-step {
           padding: 1em;
       }
   }
   </style>

   <div class="workflow-container">
       <div class="expand-hint">💡 Click on any step to see details</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">1</div>
               <div class="step-title">Authentication & Authorization</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li>User logs in via Keycloak</li>
                   <li>Role assignments are passed through the user's request headers</li>
                   <li><span class="component">Core Service</span> verifies user identity and permissions</li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">2</div>
               <div class="step-title">Submission</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <div class="code-snippet">osmo workflow submit my-workflow.yaml --pool gpu-pool</div>
               <ul>
                   <li>Request goes to the <span class="component">Core Service</span></li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">3</div>
               <div class="step-title">Workflow Queuing</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li><span class="component">Core Service</span> validates the workflow specification</li>
                   <li>Stores workflow in database with "pending" status</li>
                   <li>Places workflow in execution queue</li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">4</div>
               <div class="step-title">Workflow Assignment</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li><span class="component">Worker</span> picks up the workflow from queue</li>
                   <li>Determines which backend hosts <code>gpu-pool</code></li>
                   <li>Sends execution request to that backend's <span class="component">Backend Worker</span></li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">5</div>
               <div class="step-title">Resource Creation</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li><span class="component">Backend Worker</span> creates Kubernetes pods for each task</li>
                   <li>Applies scheduling rules, node selectors, and resource limits</li>
                   <li>Pulls container images and starts containers</li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">6</div>
               <div class="step-title">Status Monitoring</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li><span class="component">Backend Listener</span> watches pod status changes</li>
                   <li>Reports state transitions to <span class="component">Agent</span>: "task-1 started", "task-1 running", "task-1 completed"</li>
                   <li><span class="component">Agent</span> adds a job in execution queue</li>
                   <li><span class="component">Worker</span> updates workflow status in database</li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">7</div>
               <div class="step-title">Log Streaming</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <div class="code-snippet">osmo logs my-workflow</div>
               <ul>
                   <li><span class="component">Logger</span> connects to backend pods and streams logs back to user</li>
               </ul>
           </div>
       </div>

       <div class="flow-arrow">↓</div>

       <div class="flow-step" onclick="this.classList.toggle('expanded')">
           <div class="step-header">
               <div class="step-num">8</div>
               <div class="step-title">Completion</div>
               <div class="step-icon">▶</div>
           </div>
           <div class="step-content">
               <ul>
                   <li>When all tasks complete, <span class="component">Backend Listener</span> reports final status</li>
                   <li><span class="component">Worker</span> uploads artifacts to cloud storage</li>
                   <li><span class="component">Backend Worker</span> cleans up Kubernetes resources</li>
                   <li>Workflow marked as "completed" in database</li>
               </ul>
           </div>
       </div>
   </div>

.. raw:: html

   <script>
   // Auto-expand first step as example
   document.addEventListener('DOMContentLoaded', function() {
       const firstStep = document.querySelector('.flow-step');
       if (firstStep) {
           setTimeout(() => firstStep.classList.add('expanded'), 500);
       }
   });
   </script>



Authentication & Authorization
-------------------------------

- All API requests require authentication (specific paths can be excluded from authentication during service deployment)
- Role-based access control determines pool access
- Service accounts used for backend-to-service communication
- See :doc:`../appendix/authentication/index` for details


Next Steps
==========

Now that you understand the architecture:

- **Deploy the Service**: :doc:`../install_service/deploy_service`
- **Set up a Backend**: :doc:`../install_backend/deploy_backend`
- **Configure Pools**: :doc:`../install_backend/configure_pool`
- **Learn About Concepts and Advanced Configuration**: :doc:`../appendix/advanced_config/index`

