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

.. _cli_reference_config_set:

===============
osmo config set
===============

Set a field into the config

Currently, the only supported config type is ``ROLE`` and the only supported field type for ``ROLE``
is ``backend`` and ``pool``.

.. code-block::

   osmo config set [-h] config_type name type [--field FIELD] [--description DESCRIPTION] [--tags TAGS [TAGS ...]]

   Available config types (CONFIG_TYPE): ROLE

   Ex. osmo config set ROLE my-backend-role backend --field name-of-backend
   Ex. osmo config set ROLE osmo-<pool-name-prefix> pool

Positional Arguments
====================

:kbd:`config_type`
   Config type to set (CONFIG_TYPE)


:kbd:`name`
   Name of the role


:kbd:`type`
   Type of field


Named Arguments
===============

--field
   Field name in context. For example, the backend to target.

--description
   Optional description for the set action

--tags
   Optional tags for the set action

Examples
========

Creating a new pool role:

.. code-block:: bash

    $ osmo config set ROLE osmo-pool-name pool
    Successfully set ROLE osmo-pool-name

.. note::

    The pool name **MUST** start with ``osmo-`` to be correctly recognized so that users
    can see the pool in the UI and profile settings. This will be changed to be more flexible
    in the future.

Creating a new backend role:

.. code-block:: bash

    $ osmo config set ROLE my-backend-role backend --field name-of-backend
    Successfully set ROLE my-backend-role
