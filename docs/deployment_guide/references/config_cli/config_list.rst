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

.. _cli_reference_config_list:

================
osmo config list
================

List current configuration revisions for each config type

.. code-block::

   osmo config list [-h] [--format-type {json,text}] [--fit-width]

   Ex. osmo config list

Named Arguments
===============

--format-type, -t
   Possible choices: json, text

   Specify the output format type (default text)

--fit-width
   Fit the table width to the terminal width

Examples
========

List configurations in text format (default):

.. code-block:: bash

    $ osmo config list
    Config Type           Revision   Username           Created At
    ==========================================================================
    BACKEND               4          user@example.com   May 28, 2025 10:10 EDT
    DATASET               3          user@example.com   May 08, 2025 11:19 EDT
    POD_TEMPLATE          4          user@example.com   May 27, 2025 14:01 EDT
    POOL                  5          user@example.com   May 28, 2025 10:09 EDT
    RESOURCE_VALIDATION   3          user@example.com   May 27, 2025 14:02 EDT
    SERVICE               5          user@example.com   May 23, 2025 18:47 EDT
    WORKFLOW              13         user@example.com   May 23, 2025 18:55 EDT

List configurations in JSON format:

.. code-block:: bash

    $ osmo config list --format-type json
    {
      "configs": [
        {
          "config_type": "BACKEND",
          "name": "my-backend",
          "revision": 4,
          "username": "user@example.com",
          "created_at": "2025-05-28T14:10:12.871199",
          "description": "Removing unused backend",
          "tags": [
            "cleanup,deprecated"
          ],
          "data": null
        },
        {
          "config_type": "DATASET",
          "name": "",
          "revision": 3,
          "username": "user@example.com",
          "created_at": "2025-05-08T15:19:47.659986",
          "description": "Set complete dataset configuration",
          "tags": null,
          "data": null
        },
        {
          "config_type": "POD_TEMPLATE",
          "name": "",
          "revision": 4,
          "username": "user@example.com",
          "created_at": "2025-05-27T18:01:03.170243",
          "description": "Roll back POD_TEMPLATE to r1",
          "tags": null,
          "data": null
        },
        {
          "config_type": "POOL",
          "name": "my-pool",
          "revision": 5,
          "username": "user@example.com",
          "created_at": "2025-05-28T14:09:28.894220",
          "description": "Delete pool my-pool",
          "tags": null,
          "data": null
        },
        {
          "config_type": "RESOURCE_VALIDATION",
          "name": "",
          "revision": 3,
          "username": "user@example.com",
          "created_at": "2025-05-27T18:02:23.213221",
          "description": "Roll back RESOURCE_VALIDATION to r1",
          "tags": null,
          "data": null
        },
        {
          "config_type": "SERVICE",
          "name": "",
          "revision": 5,
          "username": "user@example.com",
          "created_at": "2025-05-23T22:47:27.922464",
          "description": "Update CLI version",
          "tags": null,
          "data": null
        },
        {
          "config_type": "WORKFLOW",
          "name": "",
          "revision": 13,
          "username": "user@example.com",
          "created_at": "2025-05-23T22:55:50.075262",
          "description": "Patched workflow configuration",
          "tags": null,
          "data": null
        }
      ]
    }

