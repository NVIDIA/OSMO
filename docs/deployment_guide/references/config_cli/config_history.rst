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

.. _cli_reference_config_history:

===================
osmo config history
===================

List history of configuration changes

.. code-block::

   osmo config history [-h] [config_type] [--offset OFFSET] [--count COUNT] [--order {asc,desc}] [--name NAME] [--revision REVISION] [--tags TAGS [TAGS ...]] [--at-timestamp AT_TIMESTAMP] [--created-before CREATED_BEFORE] [--created-after CREATED_AFTER] [--format-type {json,text}] [--fit-width]

   Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

   Ex. osmo config history
   Ex. osmo config history --format-type json --offset 10 --count 2
   Ex. osmo config history SERVICE
   Ex. osmo config history --created-after "2025-05-18" --created-before "2025-05-25"

Positional Arguments
====================

:kbd:`config_type`
   Config type to show history for (CONFIG_TYPE)


Named Arguments
===============

--offset, -o
   Number of records to skip for pagination (default 0)

--count, -c
   Maximum number of records to return (default 20, max 1000)

--order
   Possible choices: asc, desc

   Sort order by creation time (default asc)

--name, -n
   Filter by changes to a particular config, e.g. "isaac-hil" pool

--revision, -r
   Filter by revision number

--tags
   Filter by tags

--at-timestamp
   Get config state at specific timestamp (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone

--created-before
   Filter by creation time before (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone

--created-after
   Filter by creation time after (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS) in current timezone

--format-type, -t
   Possible choices: json, text

   Specify the output format type (default text)

--fit-width
   Fit the table width to the terminal width


Examples
========

View history in text format (default):

.. code-block:: bash

    $ osmo config history
    Config Type   Name   Revision   Username                  Created At               Description                       Tags
    =======================================================================================================================================
    SERVICE       -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration             -
    WORKFLOW      -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration             -
    DATASET       -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration             -
    SERVICE       -      2          user@example.com          Apr 29, 2025 14:26 EDT   Test service config patch - 0     exampleuser-test-0
    WORKFLOW      -      2          user@example.com          Apr 29, 2025 14:27 EDT   Test workflow config patch - 0    exampleuser-test-0
    DATASET       -      2          user@example.com          Apr 29, 2025 14:27 EDT   Test dataset config patch - 0     exampleuser-test-0
    SERVICE       -      3          user@example.com          Apr 29, 2025 14:27 EDT   Test service config patch - 1     exampleuser-test-1
    WORKFLOW      -      3          svc-account@example.com   May 01, 2025 14:13 EDT   Patched WORKFLOW configuration    -
    ...

View history in JSON format with pagination:

.. code-block:: bash

    $ osmo config history --format-type json --offset 10 --count 2
    {
      "configs": [
        {
          "config_type": "BACKEND",
          "name": "isaac",
          "revision": 2,
          "username": "user@example.com",
          "created_at": "2025-05-02T00:30:38.623202",
          "description": "Set backend 'isaac' configuration",
          "tags": null,
          "data": null
        },
        {
          "config_type": "WORKFLOW",
          "name": "",
          "revision": 5,
          "username": "svc-osmo-admin@example.com",
          "created_at": "2025-05-06T21:01:13.716128",
          "description": "Patched WORKFLOW configuration",
          "tags": null,
          "data": null
        }
      ]
    }


View history for a specific configuration type:

.. code-block:: bash

    $ osmo config history SERVICE
    Config Type   Name   Revision   Username                  Created At               Description                     Tags
    =====================================================================================================================================
    SERVICE       -      1                                    Apr 29, 2025 13:55 EDT   Initial configuration           -
    SERVICE       -      2          user@example.com          Apr 29, 2025 14:26 EDT   Test service config patch - 0   exampleuser-test-0
    SERVICE       -      3          user@example.com          Apr 29, 2025 14:27 EDT   Test service config patch - 1   exampleuser-test-1
    SERVICE       -      4          svc-account@example.com   May 08, 2025 10:39 EDT   Patched service configuration   -
    SERVICE       -      5          user@example.com          May 23, 2025 18:47 EDT   Update CLI version              -

View history for a specific time range:

.. code-block:: bash

    $ osmo config history --created-after "2025-05-18" --created-before "2025-05-25"
    Config Type    Name   Revision   Username                  Created At               Description                      Tags
    ===================================================================================================================================
    WORKFLOW       -      11         svc-account@example.com   May 19, 2025 14:26 EDT   Patched workflow configuration   -
    SERVICE        -      5          user@example.com          May 23, 2025 18:47 EDT   Update CLI version               -
    WORKFLOW       -      12         user@example.com          May 23, 2025 18:50 EDT   Patched workflow configuration   -
    WORKFLOW       -      13         user@example.com          May 23, 2025 18:55 EDT   Patched workflow configuration   -

