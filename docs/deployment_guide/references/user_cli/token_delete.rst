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

.. _cli_reference_token_delete:

=================
osmo token delete
=================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=token delete | ref-prefix=cli_reference_token_delete | flags=argument-anchor

Delete an access token for yourself or another user (admin only).

.. code-block:: text

   [1;34musage: [0m[1;35mosmo token delete[0m [[32m-h[0m] [[36m--user [33mUSER[0m] [32mname[0m

.. _cli_reference_token_delete_positional_arguments:

Positional Arguments
--------------------

``name``
    Name of the token to delete.

.. _cli_reference_token_delete_named_arguments:

Named Arguments
---------------

``--user, -u``
    Delete token for a specific user (admin only). By default, deletes token for the current user.


Ex. osmo token delete my-token
Ex. osmo token delete old-token --user other-user@example.com
