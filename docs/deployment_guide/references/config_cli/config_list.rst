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

.. _cli_reference_config_list:

================
osmo config list
================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config list | ref-prefix=cli_reference_config_list | flags=argument-anchor

List current configuration revisions for each config type

.. code-block:: text

   [1;34musage: [0m[1;35mosmo config list[0m [[32m-h[0m] [[36m--format-type [33m{json,text}[0m]
                           [[36m--fit-width[0m]

.. _cli_reference_config_list_named_arguments:

Named Arguments
---------------

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (default text)

    Default: ``'text'``

``--fit-width``
    Fit the table width to the terminal width

    Default: ``False``



.. rubric:: Examples

List configurations in text format (default)::

    osmo config list

List configurations in JSON format::

    osmo config list --format-type json
        
