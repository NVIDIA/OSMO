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

.. _cli_reference_token_set:

==============
osmo token set
==============

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=token set | ref-prefix=cli_reference_token_set | flags=argument-anchor

Create a personal access token for yourself or another user (admin only).

.. code-block:: text

   [1;34musage: [0m[1;35mosmo token set[0m [[32m-h[0m] [[36m--expires-at [33mEXPIRES_AT[0m]
                         [[36m--description [33mDESCRIPTION[0m] [[36m--user [33mUSER[0m]
                         [[36m--roles [33mROLES [ROLES ...][0m]
                         [[36m--format-type [33m{json,text}[0m]
                         [32mname[0m

.. _cli_reference_token_set_positional_arguments:

Positional Arguments
--------------------

``name``
    Name of the token.

.. _cli_reference_token_set_named_arguments:

Named Arguments
---------------

``--expires-at, -e``
    Expiration date of the token (UTC). Format: YYYY-MM-DD. Default: 31 days from now.

    Default: ``2026-07-26``

``--description, -d``
    Description of the token.

``--user, -u``
    Create token for a specific user (admin only). By default, creates token for the current user.

``--roles, -r``
    Role to assign to the token. Can be specified multiple times. If not specified, inherits all of the user's current roles.

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``


Ex. osmo token set my-token --expires-at 2026-05-01
Ex. osmo token set my-token -e 2026-05-01 -d "My token description"
Ex. osmo token set my-token -r role1 -r role2
Ex. osmo token set service-token --user service-account@example.com --roles osmo-backend
