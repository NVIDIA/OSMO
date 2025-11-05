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

=======================
OSMO Deployment Guide
=======================

Welcome to the OSMO Deployment Guide! This guide will walk you through deploying OSMO, a cloud-native platform designed for robotics developers to manage all aspects of AI and robotics development, from compute resources to data storage.

What is OSMO?
=============

OSMO is a comprehensive workflow orchestration platform built on Kubernetes that provides:

- **Unified Interface**: Single platform to manage AI/ML workflows, robotics simulations, and data pipelines
- **Cloud-Native Architecture**: Scalable, resilient, and portable across cloud providers and on-premises infrastructure
- **Multi-Backend Support**: Execute workflows across heterogeneous compute resources (CPUs, GPUs, edge devices)
- **Data Management**: Integrated data storage and dataset management for workflow artifacts and outputs

What You'll Deploy
==================

.. raw:: html

    <style>
        .deployment-architecture {
            margin: 3em auto;
            max-width: 900px;
        }

        .control-plane {
            border: 3px solid #76B900;
            border-radius: 12px;
            padding: 2em;
            text-align: center;
            background: rgba(118, 185, 0, 0.08);
            margin-bottom: 2em;
            position: relative;
        }

        .plane-label {
            position: absolute;
            top: -14px;
            left: 50%;
            transform: translateX(-50%);
            background: #1a1a1a;
            padding: 0 15px;
            color: #76B900;
            font-weight: bold;
            font-size: 1em;
            white-space: nowrap;
        }

        /* Dark mode - explicit */
        @media (prefers-color-scheme: dark) {
            .plane-label {
                background: #1a1a1a;
            }
        }

        [data-theme="dark"] .plane-label,
        html[data-theme="dark"] .plane-label,
        body[data-theme="dark"] .plane-label,
        .theme-dark .plane-label {
            background: #1a1a1a;
        }

        /* Light mode */
        @media (prefers-color-scheme: light) {
            .plane-label {
                background: white;
            }
        }

        [data-theme="light"] .plane-label,
        html[data-theme="light"] .plane-label,
        body[data-theme="light"] .plane-label,
        .theme-light .plane-label {
            background: white;
        }

        .service-cluster {
            display: inline-block;
            padding: 1.2em 2em;
            border: 2px solid #76B900;
            border-radius: 8px;
            background: rgba(118, 185, 0, 0.12);
        }

        .cluster-name {
            font-weight: bold;
            color: #76B900;
            font-size: 1.1em;
            margin-bottom: 0.5em;
        }

        .cluster-details {
            font-size: 0.85em;
            opacity: 0.85;
            line-height: 1.4;
        }

        .connection-flow {
            text-align: center;
            margin: 2em 0;
            color: #76B900;
            font-weight: 500;
        }

        .connection-arrow {
            font-size: 2em;
            margin: 0.5em 0;
            animation: pulse 2s ease-in-out infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; transform: translateY(0); }
            50% { opacity: 0.6; transform: translateY(-5px); }
        }

        .connection-label {
            font-size: 0.9em;
            font-style: italic;
            margin-top: 0.5em;
        }

        .compute-plane {
            border: 3px dashed #76B900;
            border-radius: 12px;
            padding: 2em;
            background: rgba(118, 185, 0, 0.05);
            position: relative;
        }

        .backend-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.2em;
        }

        .backend-cluster {
            border: 2px solid #76B900;
            border-radius: 8px;
            padding: 1.2em;
            text-align: center;
            background: rgba(118, 185, 0, 0.1);
            transition: transform 0.2s ease;
        }

        .backend-cluster:hover {
            transform: scale(1.05);
        }

        .backend-type {
            font-weight: bold;
            color: #76B900;
            font-size: 0.95em;
            margin-bottom: 0.5em;
        }

        .backend-location {
            font-size: 0.8em;
            opacity: 0.8;
            line-height: 1.3;
        }

        @media (max-width: 768px) {
            .backend-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>

    <div class="deployment-architecture">
        <!-- Control Plane -->
        <div class="control-plane">
            <div class="plane-label">Control Plane</div>
            <div class="service-cluster">
                <div class="cluster-name">OSMO Service Cluster</div>
                <div class="cluster-details">
                    API • UI • Database • Authentication
                </div>
            </div>
        </div>

        <!-- Connection Flow -->
        <div class="connection-flow">
            <div class="connection-arrow">↑ ↑ ↑</div>
            <div class="connection-label">Backend operators connect to service</div>
        </div>

        <!-- Compute Plane -->
        <div class="compute-plane">
            <div class="plane-label">Compute Plane (One or More)</div>

            <div class="backend-grid">
                <div class="backend-cluster">
                    <div class="backend-type">Cloud Backend</div>
                    <div class="backend-location">
                        AWS / Azure / GCP<br/>
                        GPU / CPU pools
                    </div>
                </div>

                <div class="backend-cluster">
                    <div class="backend-type">On-Premises</div>
                    <div class="backend-location">
                        Data Center<br/>
                        DGX / OVX systems
                    </div>
                </div>

                <div class="backend-cluster">
                    <div class="backend-type">Edge Devices</div>
                    <div class="backend-location">
                        Jetson / AGX<br/>
                        On-device compute
                    </div>
                </div>
            </div>
        </div>
    </div>


An OSMO deployment consists of two main components:

**1. OSMO Service** (Control Plane)
   The central service that provides the API and UI for workflow submission, monitoring, and management. This includes:

   - API server for workflow operations
   - Web UI for visual workflow management
   - Data storage configuration
   - Workflow scheduling and lifecycle management

**2. Backend Operators** (Compute Plane)
   One or more backend clusters where workflows execute. Each backend includes:

   - Backend operator for resource management
   - Compute resources (CPU/GPU nodes)
   - Workflow execution environment


A detailed overview of the architecture is available in :doc:`introduction/architecture`.

Deployment Workflow
===================

The deployment process follows these high-level steps:

**Phase 1: Preparation**

   1. Review :doc:`prerequisites <getting_started/prereqs>` and :doc:`system requirements <getting_started/system_reqs>`
   2. Set up :doc:`infrastructure <getting_started/infrastructure_setup>` (Kubernetes, PostgreSQL, Redis)
   3. Create :doc:`cloud storage <getting_started/create_storage/index>` for workflow data

**Phase 2: Deploy Service**

   4. :doc:`Deploy OSMO service <install_service/deploy_service>` (API, UI, core components)
   5. :doc:`Configure data storage <install_service/configure_data>` (logs, artifacts, datasets)

**Phase 3: Deploy Backend**

   6. Create backend cluster (cloud: :doc:`cloud <install_backend/create_backend/cloud_setup>` or on-premises: :doc:`on-premises <install_backend/create_backend/onprem_setup>`)
   7. Install :doc:`required dependencies <install_backend/dependencies/dependencies>`
   8. :doc:`Deploy backend operator <install_backend/deploy_backend>`
   9. :doc:`Configure compute pools <install_backend/configure_pool>`
   10. :doc:`Validate deployment <install_backend/validate_osmo>`


Ready to Begin?
===============

Choose your deployment path:

**Quick Start** → :ref:`Quick Start Installation <quick_start>`
   Get OSMO running in 30 minutes for testing and evaluation.

**Full Deployment** → :doc:`Prerequisites <getting_started/prereqs>`
   Complete production-ready deployment with all features.



.. toctree::
  :hidden:
  :caption: Introduction

  Overview <self>
  introduction/architecture

.. toctree::
  :hidden:
  :caption: Getting Started

  getting_started/prereqs
  getting_started/system_reqs
  getting_started/infrastructure_setup
  getting_started/create_storage/index

.. toctree::
  :hidden:
  :caption: Install Service

  install_service/deploy_service
  install_service/configure_data

.. toctree::
  :hidden:
  :caption: Install Backend

  install_backend/create_backend/index
  install_backend/dependencies/dependencies
  install_backend/deploy_backend
  install_backend/configure_pool
  install_backend/validate_osmo

.. toctree::
  :hidden:
  :caption: References

  references/configs_definitions/index
  references/config_cli/index

.. toctree::
  :hidden:
  :caption: Appendix

  appendix/advanced_config/index
  appendix/authentication/index
  appendix/workflow_execution
  appendix/quickstart
  appendix/deploy_multitenant
