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

:tocdepth: 3

.. _cli_reference_profile:

================================================
osmo profile
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=profile | ref-prefix=cli_reference_profile | flags=argument-anchor

.. code-block:: text

   [1;34musage: [0m[1;35mosmo profile[0m [[32m-h[0m] [32m{set,list} ...[0m

.. _cli_reference_profile_positional_arguments:

Positional Arguments
--------------------

``command``
    Possible choices: set, list

Sub-commands
------------

.. _cli_reference_profile_set:

set
~~~

Set profile settings.

.. code-block:: text

   [1;34m[0m[1;35mosmo profile set[0m [[32m-h[0m]
                    [32m{notifications,bucket,pool}[0m [32mvalue[0m [32m[{true,false}][0m

.. _cli_reference_profile_set_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``setting``
    Possible choices: notifications, bucket, pool

    Field to set

``value``
    Type of notification, or name of bucket/pool

``enabled``
    Possible choices: true, false

    Enable or disable, strictly for notifications.


Ex. osmo profile set bucket my_bucket
Ex. osmo profile set pool my_pool
Ex. osmo profile set notifications email true # Enable only email notifications
Ex. osmo profile set notifications slack false # Disable slack notifications

.. _cli_reference_profile_list:

list
~~~~

Fetch notification settings.

.. code-block:: text

   [1;34m[0m[1;35mosmo profile list[0m [[32m-h[0m] [[36m--format-type [33m{json,text}[0m]

.. _cli_reference_profile_list_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``
