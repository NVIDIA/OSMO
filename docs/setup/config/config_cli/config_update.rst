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

Update
======

The ``osmo config update`` command allows you to update a configuration.

.. code-block:: bash

    $ osmo config update -h
    usage: osmo config update [-h] config_type [name] [--file FILE] [--description DESCRIPTION] [--tags TAGS [TAGS ...]]

    positional arguments:
      config_type           Config type to update (CONFIG_TYPE)
      name                  Optional name of the config to update

    options:
      -h, --help            show this help message and exit
      --file FILE, -f FILE  Path to a JSON file containing the updated config
      --description DESCRIPTION, -d DESCRIPTION
                            Description of the config update
      --tags TAGS [TAGS ...], -t TAGS [TAGS ...]
                            Tags for the config update

    Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

    Ex. osmo config update SERVICE
    Ex. osmo config update POOL my-pool --description "Updated pool settings" --tags production high-priority
    Ex. osmo config update BACKEND my-backend --file config.json


Examples
--------

Update a service configuration:

.. code-block:: bash

    $ osmo config show SERVICE cli_config cli_name
    Key        Value
    =========================
    cli_name   5.0.0.5a0e9b81

    $ osmo config update SERVICE
    Successfully updated SERVICE config

    $ osmo config show SERVICE cli_config cli_name
    Key        Value
    =========================
    cli_name   5.0.0.abcd0123

Update a backend configuration from a file:

.. code-block:: bash

    $ osmo config update BACKEND my-backend --file config.json
    Successfully updated BACKEND config

Update with description and tags:

.. code-block:: bash

    $ osmo config update POOL my-pool --description "Updated pool settings" --tags production high-priority
    Successfully updated POOL config
