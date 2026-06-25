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

.. _cli_reference_config_set:

===============
osmo config set
===============

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config set | ref-prefix=cli_reference_config_set | flags=argument-anchor

Set a field into the config

.. code-block:: text

   [1;34musage: [0m[35mosmo config set [-h] config_type name type [--field FIELD] [--description DESCRIPTION] [--tags TAGS [TAGS ...]][0m

.. _cli_reference_config_set_positional_arguments:

Positional Arguments
--------------------

``config_type``
    Possible choices: ROLE

    Config type to set (CONFIG_TYPE)

``name``
    Name of the role

``type``
    Type of field

.. _cli_reference_config_set_named_arguments:

Named Arguments
---------------

``--field``
    Field name in context. For example, the backend to target.

``--description``
    Optional description for the set action

``--tags``
    Optional tags for the set action



Available config types (CONFIG_TYPE): ROLE

.. rubric:: Examples

Creating a new pool role::

    osmo config set ROLE osmo-pool-name pool

.. note::

    The pool name **MUST** start with ``osmo-`` to be correctly recognized so that users
    can see the pool in the UI and profile settings. This will be changed to be more flexible
    in the future.

Creating a new backend role::

    osmo config set ROLE my-backend-role backend --field name-of-backend
        
