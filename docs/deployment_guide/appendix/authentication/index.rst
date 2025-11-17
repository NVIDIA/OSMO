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

.. _authentication_authorization:

================================================
AuthN/AuthZ
================================================

This section provides comprehensive information about authentication and authorization in OSMO, including how to configure identity providers, manage roles, and control access to resources.

Overview
========

OSMO provides a flexible authentication and authorization system that supports:

- **Authentication**: Verifying user identity through Keycloak and external identity providers
- **Authorization**: Controlling access to resources through role-based access control (RBAC)

Authentication Methods
======================

OSMO supports multiple authentication methods:

**1. Keycloak with External Identity Provider**
   Use Keycloak as an identity broker that integrates with your organization's identity provider (Azure AD, Google Workspace, etc.). This is recommended for production deployments.

**2. No Authentication (Development Only)**
   Deploy OSMO without authentication for testing and development purposes. Not recommended for production.

Authorization Model
===================

OSMO uses role-based access control (RBAC) where:

1. **Roles** define sets of permissions (policies) that grant access to specific API endpoints and resources
2. **Policies** specify which actions (HTTP methods on API paths) are allowed or denied
3. **Users** are assigned roles either directly or through group membership
4. **Pool Access** is controlled through specially-named roles that match pool naming patterns

Contents
========

.. toctree::
   :maxdepth: 2

   authentication_flow
   roles_policies
   keycloak_setup

Quick Navigation
================

- **Setting up authentication?** → Start with :doc:`authentication_flow`
- **Managing roles and permissions?** → See :doc:`roles_policies`
- **Configuring Keycloak roles and groups?** → Follow :doc:`keycloak_setup`

.. seealso::

   - :doc:`../../getting_started/deploy_service` for service deployment with authentication
   - :doc:`../../install_backend/configure_pool` for pool configuration
   - :ref:`roles_config` for role configuration reference

