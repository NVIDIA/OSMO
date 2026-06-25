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

.. _cli_reference_profile:

:tocdepth: 3

================================================
osmo profile
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=profile | ref-prefix=cli_reference_profile | flags=argument-anchor

.. code-block:: text

   usage: osmo profile [-h] {set,list} ...

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

   osmo profile set [-h]
                    {notifications,bucket,pool} value [{true,false}]

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

   osmo profile list [-h] [--format-type {json,text}]

.. _cli_reference_profile_list_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``
