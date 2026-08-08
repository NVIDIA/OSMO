..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _service_accounts:

================
Service Accounts
================

Service accounts provide programmatic access to OSMO for automation and CI/CD
pipelines. In OSMO, service accounts are regular users with access tokens for
API authentication.

Backend operators use a separate Kubernetes Secret-backed bootstrap credential
that does not require an OSMO user or access-token API call. See
:ref:`deploy_backend` for that flow.

Overview
========

A service account consists of two components:

1. **A user** — Represents the service account identity and holds role assignments
2. **An access token** — Provides authentication credentials for API access

This approach provides several benefits:

- **Unified role management** — Service accounts use the same role system as regular users
- **Centralized auditing** — All actions are attributed to the service account user
- **Flexible permissions** — Roles can be updated on the user, affecting future tokens
- **Easy token rotation** — Create a new token, update your systems, then delete the old token

Creating a Service Account
==========================

Follow these steps to create a service account for CI/CD pipelines or other
automation needs.

The examples use the preconfigured ``osmo-user`` role for standard workflow
automation. Use a narrower custom role when the automation needs fewer permissions.

Prerequisites
-------------

- OSMO CLI installed and configured
- Admin privileges (``osmo-admin`` role) to create users and manage roles

Step 1: Create the Service Account User
---------------------------------------

Create a user with an identifier that clearly indicates it's a service account:

.. code-block:: bash

   $ osmo user create svc-automation --roles osmo-user

**Example output:**

.. code-block:: text

   User created: svc-automation   Roles assigned: osmo-user

.. tip::

   Use a naming convention that distinguishes service accounts from regular users,
   such as ``svc-<purpose>`` (e.g., ``svc-backend-operator``, ``svc-monitoring``).

Step 2: Create an access token
--------------------------------------

Create an access token for the service account. By default, the token inherits all roles from the user.
You can limit the token to specific roles using the ``--roles`` (or ``-r``) option.

.. code-block:: bash

   $ osmo token set automation-token \
       --user svc-automation \
       --expires-at 2027-01-01 \
       --description "Automation Token" \
       --roles osmo-user

**Example output:**

.. code-block:: text

   Note: Save the token in a secure location as it will not be shown again
   Access token: osmo_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   Created for user: svc-automation
   Roles: osmo-user

.. tip::

   If ``--roles`` is not specified, the token inherits all of the user's roles.
   For service accounts, it's recommended to explicitly specify roles to follow the
   principle of least privilege.

   Adding a role to a user does not expand an existing scoped token. Removed
   roles are removed from existing tokens automatically. Rotate a scoped token
   only when it must gain a newly assigned role.

.. important::

   Save the token securely—it is only displayed once at creation time.


Managing Service Accounts
=========================

List Service Account Users
--------------------------

List users with the service-account naming prefix:

.. code-block:: bash

   $ osmo user list --id-prefix svc-

View Service Account Details
----------------------------

View details including assigned roles:

.. code-block:: bash

   $ osmo user get svc-automation

**Example output:**

.. code-block:: text

   User ID: svc-automation   Created At: 2026-01-15
   Created By: admin@example.com

   Roles:
     - osmo-user (assigned by admin@example.com on 2026-01-15)

List Service Account Tokens
---------------------------

View all tokens for a service account:

.. code-block:: bash

   $ osmo token list --user svc-automation

Update Service Account Roles
----------------------------

Add or remove roles from a service account:

.. code-block:: bash

   # Add a role
   $ osmo user update svc-automation --add-roles osmo-ml-team

   # Remove a role
   $ osmo user update svc-automation --remove-roles osmo-ml-team

.. note::

   When a role is removed from a user, it is automatically removed from all of that
   user's access tokens.

Rotate a Service Account Token
------------------------------

To rotate a token:

1. Create a new token:

   .. code-block:: bash

      $ osmo token set new-automation-token \
          --user svc-automation \
          --expires-at 2028-01-01 \
          --roles osmo-user

2. Update your systems to use the new token

3. Delete the old token:

   .. code-block:: bash

      $ osmo token delete automation-token --user svc-automation

Delete a Service Account
------------------------

Delete the service account user (this also deletes all associated tokens):

.. code-block:: bash

   $ osmo user delete svc-automation

.. seealso::

   - :doc:`../../references/user_cli/index` for user and token CLI reference

Common Service Account Patterns
================================

Backend Operator
----------------

Backend operators do not use this service-account pattern. Provision the shared
control/compute Kubernetes Secret described in :ref:`deploy_backend`.

Monitoring and Automation
-------------------------

For monitoring systems or automation scripts:

.. code-block:: bash

   # Create the service account with the standard operational role
   $ osmo user create svc-monitoring --roles osmo-user

   # Create a token with specific roles
   $ osmo token set monitoring-token \
       --user svc-monitoring \
       --expires-at 2027-01-01 \
       --description "Monitoring System" \
       --roles osmo-user

**Using the token in a script:**

.. code-block:: bash

   #!/bin/bash
   # Monitoring script example

   # Login with the service account token
   osmo login https://osmo.example.com --method=token --token-file=/etc/osmo/monitoring-token

   # Run monitoring commands
   osmo workflow list --format-type json | process_metrics.py

.. seealso::

   - :ref:`authentication_authorization` for authentication and access token overview
   - :ref:`deploy_backend` for backend operator deployment

Best Practices
==============

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Practice
     - Description
   * - **Use descriptive names**
     - Name service accounts and tokens to clearly indicate their purpose
   * - **Apply least privilege**
     - Assign only the roles necessary for the service account's function
   * - **Set appropriate expiration**
     - Use expiration dates appropriate for your security requirements
   * - **Rotate tokens regularly**
     - Periodically create new tokens and delete old ones
   * - **Use secret management**
     - Store tokens in secure secret management systems, not in code or config files
   * - **Monitor usage**
     - Review service account activity in OSMO logs

Troubleshooting
===============

Token Expired
-------------

**Symptom:** Connection fails with error about expired token.

**Solution:** Create a new token and update your systems:

.. code-block:: bash

   $ osmo token set new-token \
       --user svc-automation \
       --expires-at 2028-01-01 \
       --roles osmo-user

Permission Denied
-----------------

**Symptom:** API requests fail with permission denied errors.

**Solution:** Check the service account's roles:

.. code-block:: bash

   $ osmo user get svc-automation

Add necessary roles if missing:

.. code-block:: bash

   $ osmo user update svc-automation --add-roles osmo-user

User Not Found
--------------

**Symptom:** Cannot create token—user not found.

**Solution:** Create the user first:

.. code-block:: bash

   $ osmo user create svc-automation --roles osmo-user
