..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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
Authentication and Authorization
================================================

This section explains how OSMO identifies users (authentication) and controls what they can do (authorization), in plain terms, and how to set it up with or without an external identity provider (IdP).

Overview
========

**Authentication** answers “who is this?” — OSMO needs to know the identity of the person or system making a request (e.g., a user name or service account).

**Authorization** answers “what can they do?” — OSMO uses **roles** and **policies** to decide whether that identity is allowed to perform an action (e.g., submit a workflow, create a pool, or manage users).

OSMO does not run its own user directory. Instead, it can operate in two main ways:

**1. Without an identity provider (IdP)**

   Best for: development, testing, or environments where you do not use a corporate login (e.g., Microsoft Entra ID, Google, Okta).

   - You configure a **default admin** user and password at deploy time. The OSMO service creates this user on startup and assigns it the ``osmo-admin`` role.
   - Users and scripts authenticate using **access tokens**. An admin creates users and assigns roles in OSMO, then creates access tokens for those users (or users create access tokens for themselves if they have permission).
   - There is no browser “log in with SSO” flow; access is token-based (access tokens and, for internal use, service-issued JWTs).

**2. With an identity provider (IdP)**

   Best for: production when you want users to sign in with your organization’s identity system (e.g., Microsoft Entra ID, Google Workspace, AWS IAM Identity Center).

   - Envoy (the API gateway in front of OSMO) talks **directly** to your IdP using OAuth 2.0 / OpenID Connect.
   - Users open the OSMO UI or CLI and are redirected to your IdP to log in. After login, the IdP issues a JWT that Envoy validates and forwards to OSMO with user identity and (optionally) role information.
   - Roles can come from:
     - **OSMO’s database** — users and roles are managed via OSMO’s user and role APIs (and optionally created automatically when users first log in).
     - **Your IdP** — group or role claims from the IdP can be mapped to OSMO roles (e.g., “LDAP_ML_TEAM” → ``osmo-ml-team``).
   - access tokens are still supported for scripts and automation; they are tied to a user in OSMO and inherit that user’s roles.

In both modes, **roles** in OSMO define what a user or token can do (see :doc:`roles_policies`). The only difference is how users and their roles are created and updated: manually in OSMO (no IdP) or via login + IdP/API (with IdP).

Major concepts
==============

- **User:** An identity known to OSMO (a human or service account). Stored in OSMO’s database. With an IdP, users can be created automatically the first time they log in (just-in-time provisioning).

- **Role:** A named set of permissions (policies) in OSMO. Examples: ``osmo-admin`` (full management), ``osmo-user`` (basic user), ``osmo-ml-team`` (access to specific pools).

- **Policy:** A rule that allows or denies specific actions (e.g., “allow GET /api/workflows”). Roles contain one or more policies.

- **Access token:** A long-lived secret used by scripts or the CLI to authenticate as a user. Access tokens are tied to a user and get a subset of that user’s roles at creation time.

- **Default admin:** A single admin user created by the OSMO service on startup when no IdP is used. Configured via Helm (e.g. ``services.defaultAdmin.enabled``, ``username``, and a Kubernetes secret for the password). This user has the ``osmo-admin`` role and one access token set to that password, so you can log in and create more users, roles, and access tokens.

How authorization works (high level)
=====================================

When a request hits OSMO:

1. **Identity** is determined from the request: either a JWT (from the IdP or from OSMO for access-token-based access) or, in development, possibly headers set by the gateway.
2. **Roles** for that identity are resolved from:
   - OSMO’s database (user → roles, and for access tokens, token → roles),
   - and, when using an IdP, from IdP claims (e.g., groups) mapped to OSMO roles.
3. OSMO loads the **policies** for those roles and checks whether any policy allows the requested action.
4. The request is **allowed** or **denied** (e.g., 403 Forbidden).

So: one identity → many roles → many policies → allow/deny per action.

Quick navigation
================

- **Understanding the full flow (with or without IdP)?** → :doc:`authentication_flow`
- **Setting up roles and policies?** → :doc:`roles_policies`
- **Managing user role mapping and sync modes?** → :doc:`user_role_mapping`
- **Service accounts (access tokens, backend operators)?** → :doc:`service_accounts`
- **Using an IdP (e.g., Microsoft Entra ID, Google)?** → :doc:`identity_provider_setup`
- **Using OSMO without an IdP (default admin)?** → :ref:`default_admin_setup` (below) and :doc:`../../getting_started/deploy_service`

.. _default_admin_setup:

Default admin (no IdP)
======================

When you do **not** use an identity provider, you need at least one user with admin rights to manage OSMO. The service can create this user for you at startup.

How it works
------------

The OSMO API service reads Helm values under ``services.defaultAdmin``. When default admin is enabled:

- On startup, the service ensures a **user** exists with the configured username.
- It assigns that user the **osmo-admin** role.
- It creates or updates a **access token** for that user whose secret is the **password** you provide (from a Kubernetes secret). So “logging in” as the default admin means using that password as the access token.

You use this token with the CLI or API to create more users, assign roles, and create additional access tokens. After that, you can rely on normal user/role/token management; the default admin is just the bootstrap account.

What to configure (Helm)
-------------------------

In the service Helm chart (see ``api-service.yaml`` and ``values.yaml``):

- **Enable default admin:** Set ``services.defaultAdmin.enabled`` to ``true``.
- **Username:** Set ``services.defaultAdmin.username`` (e.g. ``admin``). This is the user ID in OSMO.
- **Password:** Store the default admin’s password in a Kubernetes secret. Set:
  - ``services.defaultAdmin.passwordSecretName`` — name of the secret (e.g. ``default-admin-secret``).
  - ``services.defaultAdmin.passwordSecretKey`` — key in the secret that holds the password (e.g. ``password``).

The service receives these via:

- **Args:** ``--default_admin_username <username>`` when ``defaultAdmin.enabled`` is true.
- **Env:** ``OSMO_DEFAULT_ADMIN_PASSWORD`` from the secret ``passwordSecretName`` and ``passwordSecretKey``.

Example (conceptual): create the secret and enable default admin in your values:

.. code-block:: bash

   kubectl create secret generic default-admin-secret \
     --namespace osmo \
     --from-literal=password='<your-secure-admin-password>'

Then in your Helm values:

.. code-block:: yaml

   services:
     defaultAdmin:
       enabled: true
       username: "admin"
       passwordSecretName: default-admin-secret
       passwordSecretKey: password

After deployment, use the default admin username and that password as the access token (e.g. with ``osmo login`` or ``Authorization: Bearer <password>``) to access the API and create more users and access tokens.

.. seealso::

   - :doc:`../../getting_started/deploy_service` for deploying the service with or without an IdP
   - :doc:`authentication_flow` for request flow and token handling
   - :doc:`roles_policies` for role and policy reference
   - :doc:`identity_provider_setup` for direct IdP configuration

.. toctree::
   :maxdepth: 2
   :hidden:

   authentication_flow
   roles_policies
   identity_provider_setup
   user_role_mapping
   service_accounts
