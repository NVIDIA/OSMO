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

.. _cli_reference_token_list:

===============
osmo token list
===============

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=token list | ref-prefix=cli_reference_token_list | flags=argument-anchor

List access tokens for yourself or another user (admin only).

.. code-block:: text

   usage: osmo token list [-h] [--user USER]
                          [--format-type {json,text}]

.. _cli_reference_token_list_named_arguments:

Named Arguments
---------------

``--user, -u``
    List tokens for a specific user (admin only). By default, lists tokens for the current user.

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``


Ex. osmo token list
Ex. osmo token list --user service-account@example.com
