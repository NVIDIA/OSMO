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

.. _cli_reference_user_delete:

================
osmo user delete
================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=user delete | ref-prefix=cli_reference_user_delete | flags=argument-anchor

Delete a user and all associated data (tokens, roles, profile).

.. code-block:: text

   usage: osmo user delete [-h] [--force] user_id

.. _cli_reference_user_delete_positional_arguments:

Positional Arguments
--------------------

``user_id``
    User ID to delete.

.. _cli_reference_user_delete_named_arguments:

Named Arguments
---------------

``--force, -f``
    Skip confirmation prompt.

    Default: ``False``


Ex. osmo user delete myuser@example.com
