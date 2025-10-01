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

Show
====

The ``osmo config show`` command displays the contents of a configuration.

.. code-block:: bash

    $ osmo config show -h
    usage: osmo config show [-h] config_type [names ...]

    positional arguments:
      config_type  Config to show in format <CONFIG_TYPE>[:<revision>]
      names        Optional names/indices to index into the config. Can be used to show a named config.

    options:
      -h, --help   show this help message and exit

    Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

    Ex. osmo config show SERVICE
    Ex. osmo config show RESOURCE_VALIDATION default_cpu
    Ex. osmo config show POD_TEMPLATE:3 amlfs


Examples
--------

Show a service configuration in JSON format:

.. code-block:: bash

    $ osmo config show SERVICE
    {
      "agent_queue_size": 1024,
      "cli_config": {
        "cli_name": "5.0.0.5a0e9b81",
        "credential": {
          "access_key": "**********",
          "access_key_id": "exampleuser:AUTH_team-osmo-ops",
          "endpoint": "|data_path|",
          "region": "us-east-1"
        },
        "min_supported_version": null
      },
      "max_pod_restart_limit": "30m",
      "service_auth": {
        "active_key": "366307e9-49eb-4f58-97b6-a24c99276884",
        "audience": "osmo",
        "issuer": "osmo",
        "keys": {
          "366307e9-49eb-4f58-97b6-a24c99276884": {
            "private_key": "**********",
            "public_key": {"e":"AQAB","kid":"366307e9-49eb-4f58-97b6-a24c99276884","kty":"RSA","n":"umeClqylEFb8OvoiNxLe5ozY1d7nQL7YFCZSKs0NYIfSgzKzueflEwGtBg8dsx27VdihcP_wSJjNU_NHa2RQEpoqvHSKvZ20NF72U6sumZc8f5h4k8BVD77KYwt-3797eCIVXq-z2ufpT9LOpGuV9oLJAMrGuuJkhvFae2pVlbQndekjLnzQGpedUIqdSGcHJM_g_rLyJjwVqag5wWTJJqW15HosDVhMqm1CW5VrjwtJNkYS4gydU1669VwYcGtfD1AHn99siW0DJS1_YjBxvD0vXA5MiFC0xG5bypHe4SxntDpEmKVEzGzLhm7JaNZQjatU7oLuDnjcBW8rTknh_Q"}
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


Show the ``amlfs`` pod template in a previous revision:

.. code-block:: bash

    $ osmo config show POD_TEMPLATE:3 amlfs
    {
      "spec": {
        "containers": [
          {
            "name": "{{USER_CONTAINER_NAME}}",
            "volumeMounts": [
              {
                "mountPath": "/mnt/amlfs-01",
                "name": "amlfs-01",
                "subPath": "gear"
              },
              {
                "mountPath": "/mnt/amlfs-02",
                "name": "amlfs-02",
                "subPath": "gear"
              },
              {
                "mountPath": "/mnt/amlfs-03",
                "name": "amlfs-03",
                "subPath": "gear"
              }
            ]
          },
          {
            "name": "osmo-ctrl",
            "volumeMounts": [
              {
                "mountPath": "/mnt/amlfs-01",
                "name": "amlfs-01",
                "subPath": "gear"
              },
              {
                "mountPath": "/mnt/amlfs-02",
                "name": "amlfs-02",
                "subPath": "gear"
              },
              {
                "mountPath": "/mnt/amlfs-03",
                "name": "amlfs-03",
                "subPath": "gear"
              }
            ]
          }
        ],
        "volumes": [
          {
            "name": "amlfs-01",
            "persistentVolumeClaim": {
              "claimName": "amlfs-01"
            }
          },
          {
            "name": "amlfs-02",
            "persistentVolumeClaim": {
              "claimName": "amlfs-02"
            }
          },
          {
            "name": "amlfs-03",
            "persistentVolumeClaim": {
              "claimName": "amlfs-03"
            }
          }
        ]
      }
    }
