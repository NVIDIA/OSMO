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


.. _roles_appendix:

=======================================================
OSMO Roles Management
=======================================================

Creating Roles
==============

To create a role, the admin should first fetch the existing roles using the
``osmo config show`` CLI.

.. code-block:: bash

  $ osmo config show ROLE > roles.json

The admin can then edit the ``roles.json`` file to add the new role.

.. code-block:: bash

  $ cat roles.json
  [
    {
      "name": "osmo-admin",
      ...
    },
    ...
    {
      "name": "new-role",
      "description": "Demo new role",
      "policies": [
        {
          "actions": [
              "http:/api/bucket/*:*",
              "http:/api/credential/*:*"
          ]
        }
      ],
      "immutable": false
    }
  ]

The admin can then update the roles with the ``roles.json`` file.

.. code-block:: bash

  $ osmo config update ROLE -f roles.json
  Successfully updated ROLE config

Quality of Life Features
========================

Since there are so many APIs to be aware of, for new pool and backend roles, admins can use the
``osmo config set`` CLI to generate the role which contain the required policies. Learn more
about the CLI at :ref:`config_set`.

FAQs
====

How do I create a role for a pool?
----------------------------------

Assuming we had a pool with the name ``my-pool`` and we wanted to create a role for it, we can
use the ``osmo config set`` CLI to generate the role which contain the required policies. Learn more
about the CLI at :ref:`config_set`.

.. note::

  Currently, pool role names must start with ``osmo-`` to be recognized as a pool role.

.. code-block:: bash

  $ osmo config set ROLE osmo-my-pool -p my-pool
  Successfully created ROLE config

  $ osmo config show ROLE osmo-my-pool
  {
    "name": "osmo-my-pool",
    "policies": [
      {
        "actions": [
          "http:/api/pool/my-pool*:Post",
          "http:/api/profile/*:*"
        ]
      }
    ],
    "immutable": false,
    "description": "Generated Role for pool my-pool"
  }

Once I have a role, how do I assign it to a Service Access Token?
-----------------------------------------------------------------

Assuming we had a role with the name ``osmo-my-role`` and we wanted to assign it to a Service Access
Token, we can use the ``osmo token set`` CLI to generate the token.

.. code-block:: bash

  $ osmo token set service-token-name --expires-at 2026-01-01 --description "Service token for my-role" --role osmo-my-role

.. note::

  If you wanted to create a token for a pool, you probably want to include to `osmo-user` role as
  the pool role only allows access to workflow submission by default. By including the `osmo-user`
  role, the token will be able to access all the APIs that the user role allows such as workflow
  cancel or query.
