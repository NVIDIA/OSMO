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

.. _cli_reference_user_list:

==============
osmo user list
==============

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=user list | ref-prefix=cli_reference_user_list | flags=argument-anchor

List users with optional filtering.

.. code-block:: text

   [1;34musage: [0m[1;35mosmo user list[0m [[32m-h[0m] [[36m--id-prefix [33mID_PREFIX[0m]
                         [[36m--roles [33mROLES [ROLES ...][0m] [[36m--count [33mCOUNT[0m]
                         [[36m--format-type [33m{json,text}[0m]

.. _cli_reference_user_list_named_arguments:

Named Arguments
---------------

``--id-prefix, -p``
    Filter users whose ID starts with this prefix.

``--roles, -r``
    Filter users who have ANY of these roles.

``--count, -c``
    Number of results per page (default: 100).

    Default: ``100``

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``


Ex. osmo user list
Ex. osmo user list --id-prefix service-
Ex. osmo user list --roles osmo-admin osmo-user
