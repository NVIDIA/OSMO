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
..

.. _service_deployment_options:

============================
Service Deployment Options
============================

This guide provides step-by-step instructions for installing OSMO on a Kubernetes cluster.

There are several ways to install OSMO depending on your use case and requirements:

1. **Quick Start Deployment** - Single-tenant sandbox for testing and development
2. **Single-Tenant Deployment** - Single-tenant production deployment with authentication
3. **Multi-tenant Deployment** - Production deployment supporting multiple isolated tenants

Choose the deployment type that best fits your needs:

.. list-table:: Deployment Comparison
   :header-rows: 1
   :widths: 25 25 25 25

   * - Feature
     - Quick Start
     - Single-Tenant
     - Multi-tenant
   * - **Use Case**
     - Testing/Development
     - Single Organization
     - Multiple Organizations
   * - **Authentication**
     - None
     - SSO (Keycloak / Bring Your Own SSO)
     - SSO (Keycloak / Bring Your Own SSO)
   * - **Tenant Isolation**
     - Single Tenant
     - Single Tenant
     - Multi-tenant
   * - **Complexity**
     - Low
     - Medium
     - High
   * - **Resource Requirements**
     - Low
     - Medium
     - High


Choose your installation type based on your requirements:

**Choose Quick Start Deployment if:**

- You want to quickly test OSMO functionality
- You're developing or evaluating OSMO
- You don't need user authentication
- You're working in a sandbox environment

**Choose Single-Tenant Deployment if:**

- You need a production-ready single-tenant setup
- You require user authentication and authorization
- You have one organization using OSMO

**Choose Multi-tenant Deployment if:**

- You need to support multiple organizations
- You require tenant isolation and data segregation
- You're a service provider offering OSMO to multiple clients
- You need advanced scaling and resource management

.. toctree::
   :maxdepth: 1

   deploy_single_tenant
   deploy_multitenant


Infrastructure Prerequisites
=============================

* Kubernetes cluster with version 1.27 or higher
* PostgreSQL database with version 15 or higher
* Redis instance with version 7.0 or higher

  * Sample terraform setup for AWS or Azure is available in our repository at ``/deployments/terraform/aws/example`` or ``/deployments/terraform/azure/example`` directory


