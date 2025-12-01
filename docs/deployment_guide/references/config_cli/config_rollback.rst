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

.. _cli_reference_config_rollback:

====================
osmo config rollback
====================

Roll back a configuration to a previous revision

When rolling back a configuration, the revision number is incremented by 1 and a new revision is
created. The new revision will have the same data as the desired rollback revision.

.. code-block::

   osmo config rollback [-h] revision [--description DESCRIPTION] [--tags TAGS [TAGS ...]]

   Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

   Ex. osmo config rollback SERVICE:4
   Ex. osmo config rollback BACKEND:7 --description "Rolling back to stable version" --tags rollback stable

Positional Arguments
====================

:kbd:`revision`
   Revision to roll back to in format <CONFIG_TYPE>:<revision>, e.g. ``SERVICE:12``


Named Arguments
===============

--description
   Optional description for the rollback action

--tags
   Optional tags for the rollback action


Examples
========

Roll back a service configuration:

.. code-block:: bash

    $ osmo config history SERVICE
    Config Type   Name   Revision   Username                  Created At               Description                     Tags
    ==============================================================================================================================
    SERVICE       -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration           -
    SERVICE       -      2          user@example.com          Apr 29, 2025 14:26 EDT   Test service config patch - 0   user-test-0
    SERVICE       -      3          user@example.com          Apr 29, 2025 14:27 EDT   Test service config patch - 1   user-test-1
    SERVICE       -      4          svc-account@example.com   May 08, 2025 10:39 EDT   Patched service configuration   -
    SERVICE       -      5          user@example.com          May 23, 2025 18:47 EDT   Update CLI version              -

    $ osmo config rollback SERVICE:4
    Successfully rolled back SERVICE to revision 4.

    $ osmo config history SERVICE
    Config Type   Name   Revision   Username                  Created At               Description                     Tags
    ==============================================================================================================================
    SERVICE       -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration           -
    SERVICE       -      2          user@example.com          Apr 29, 2025 14:26 EDT   Test service config patch - 0   user-test-0
    SERVICE       -      3          user@example.com          Apr 29, 2025 14:27 EDT   Test service config patch - 1   user-test-1
    SERVICE       -      4          svc-account@example.com   May 08, 2025 10:39 EDT   Patched service configuration   -
    SERVICE       -      5          user@example.com          May 23, 2025 18:47 EDT   Update CLI version              -
    SERVICE       -      6          user@example.com          May 28, 2025 10:27 EDT   Roll back SERVICE to r4         -


Roll back with description and tags:

.. code-block:: bash

    $ osmo config rollback BACKEND:7 --description "Rolling back to stable version" --tags rollback stable
    Successfully rolled back BACKEND to revision 7.
