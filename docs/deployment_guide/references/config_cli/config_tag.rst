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

.. _cli_reference_config_tag:

===============
osmo config tag
===============

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config tag | ref-prefix=cli_reference_config_tag | flags=argument-anchor

Update tags for a config revision. Tags can be used for organizing configs by category and filtering output of ``osmo config history``. Tags do not affect the configuration itself.

.. code-block:: text

   [1;34musage: [0m[35mosmo config tag [-h] config_type [--set SET [SET ...]] [--delete DELETE [DELETE ...]][0m

.. _cli_reference_config_tag_positional_arguments:

Positional Arguments
--------------------

``config_type``
    Config to update tags for in format <CONFIG_TYPE>[:<revision>]

.. _cli_reference_config_tag_named_arguments:

Named Arguments
---------------

``--set, -s``
    Tags to add to the config history entry

``--delete, -d``
    Tags to remove from the config history entry



Available config types (CONFIG_TYPE): BACKEND, BACKEND_TEST, DATASET, GROUP_TEMPLATE, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

.. rubric:: Examples

View current tags for a revision::

    osmo config history BACKEND -r 5

Update tags by adding and removing::

    osmo config tag BACKEND:5 --set foo --delete test-4 test-3

Verify the updated tags::

    osmo config history BACKEND -r 5

Update tags for current revision::

    osmo config tag BACKEND --set current-tag
        
