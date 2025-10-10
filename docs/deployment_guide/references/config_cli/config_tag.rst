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

.. _config_tag:

Tag
===

The ``osmo config tag`` command allows you to update tags for configuration revisions. Tags can be
used for organizing configs by category and filtering output of ``osmo config history``. Tags do not
affect the configuration itself.

.. code-block:: bash

    $ osmo config tag -h
    usage: osmo config tag [-h] config_type [--set SET [SET ...]] [--delete DELETE [DELETE ...]]

    positional arguments:
      config_type           Config to update tags for in format <CONFIG_TYPE>[:<revision>]

    options:
      -h, --help            show this help message and exit
      --set SET [SET ...], -s SET [SET ...]
                            Tags to add to the config history entry
      --delete DELETE [DELETE ...], -d DELETE [DELETE ...]
                            Tags to remove from the config history entry

    Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

    Ex. osmo config tag BACKEND:5 --set foo --delete test-4 test-3
    Ex. osmo config tag BACKEND --set current-tag

Examples
--------

View current tags for a revision:

.. code-block:: bash

    $ osmo config history BACKEND -r 5
    Config Type   Name      Revision   Username   Created At    Description     Tags
    ===================================================================================
    BACKEND       default   5          testuser   May 08,       Set backend     test-3,
                                                  2025 10:15    'default'       test-4
                                                  EDT           configuration

Update tags by adding and removing:

.. code-block:: bash

    $ osmo config tag BACKEND:5 --set foo --delete test-4 test-3
    Successfully updated tags for BACKEND:5

Verify the updated tags:

.. code-block:: bash

    $ osmo config history BACKEND -r 5
    Config Type   Name      Revision   Username   Created At    Description     Tags
    ===================================================================================
    BACKEND       default   5          testuser   May 08,       Set backend     foo
                                                  2025 10:15    'default'
                                                  EDT           configuration

Update tags for current revision:

.. code-block:: bash

    $ osmo config tag BACKEND --set current-tag
    Successfully updated tags for BACKEND
