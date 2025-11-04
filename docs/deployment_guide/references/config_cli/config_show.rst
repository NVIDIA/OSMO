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

.. _cli_reference_config_show:

================
osmo config show
================

Show a configuration or previous revision of a configuration

.. code-block::

   osmo config show [-h] config_type [names ...]

   Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

   Ex. osmo config show SERVICE
   Ex. osmo config show RESOURCE_VALIDATION default_cpu
   Ex. osmo config show WORKFLOW:3 user_workflow_limits

Positional Arguments
====================

:kbd:`config_type`
   Config to show in format <CONFIG_TYPE>[:<revision>]


:kbd:`names`
   Optional names/indices to index into the config. Can be used to show a named config.


Examples
========

Show a service configuration in JSON format:

.. code-block:: bash

    $ osmo config show SERVICE
    {
      "agent_queue_size": 1024,
      "cli_config": {
        "latest_version": "6.0.0",
        "min_supported_version": null
      },
      "max_pod_restart_limit": "30m",
      "service_auth": {
        "active_key": "12345678-1234-5678-1234-567812345678",
        "audience": "osmo",
        "issuer": "osmo",
        "keys": {
          "12345678-1234-5678-1234-567812345678": {
            "private_key": "**********",
            "public_key": {"e":"AQAB","kid":"12345678-1234-5678-1234-567812345678","kty":"RSA","n":"**********"}
          }
        },
        "user_roles": ["osmo-user"],
        "ctrl_roles": ["osmo-user", "osmo-ctrl"]
      },
      "service_base_url": "|osmo_url|:443"
    }


Show the ``default_cpu`` resource validation rule:

.. code-block:: bash

    $ osmo config show RESOURCE_VALIDATION default_cpu
    [
      {
        "operator": "LE",
        "left_operand": "{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}",
        "right_operand": "{{K8_CPU}}",
        "assert_message": "Value {% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %} too high for CPU"
      },
      {
        "operator": "GT",
        "left_operand": "{% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %}",
        "right_operand": "0",
        "assert_message": "Value {% if USER_CPU is none %}1{% else %}{{USER_CPU}}{% endif %} needs to be greater than 0 for CPU"
      }
    ]


Show the ``user_workflow_limits`` workflow configuration in a previous revision:

.. code-block:: bash

    $ osmo config show WORKFLOW:3 user_workflow_limits
    {
      "max_num_workflows": null,
      "max_num_tasks": 6000
    }
