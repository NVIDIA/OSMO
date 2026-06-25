..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _cli_reference_user_update:

================
osmo user update
================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=user update | ref-prefix=cli_reference_user_update | flags=argument-anchor

Add or remove roles from a user.

.. code-block:: text

   [1;34musage: [0m[1;35mosmo user update[0m [[32m-h[0m]
                           [[36m--add-roles [33mADD_ROLES [ADD_ROLES ...][0m]
                           [[36m--remove-roles [33mREMOVE_ROLES [REMOVE_ROLES ...][0m]
                           [[36m--format-type [33m{json,text}[0m]
                           [32muser_id[0m

.. _cli_reference_user_update_positional_arguments:

Positional Arguments
--------------------

``user_id``
    User ID to update.

.. _cli_reference_user_update_named_arguments:

Named Arguments
---------------

``--add-roles, -a``
    Roles to add to the user.

``--remove-roles, -r``
    Roles to remove from the user.

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``


Ex. osmo user update myuser@example.com --add-roles osmo-admin
Ex. osmo user update myuser@example.com --remove-roles osmo-ml-team
Ex. osmo user update myuser@example.com --add-roles admin --remove-roles guest
