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

.. _cli_reference_config_diff:

================
osmo config diff
================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=config diff | ref-prefix=cli_reference_config_diff | flags=argument-anchor

Show the difference between two config revisions

Available config types (config_type): BACKEND, BACKEND_TEST, DATASET, GROUP_TEMPLATE, POD_TEMPLATE, POOL, RESOURCE_VALIDATION, ROLE, SERVICE, WORKFLOW

.. code-block:: text

   [1;34musage: [0m[1;35mosmo config diff[0m [[32m-h[0m] [32mfirst[0m [32m[second][0m

.. _cli_reference_config_diff_positional_arguments:

Positional Arguments
--------------------

``first``
    First config to compare. Format: <config_type>[:<revision>] (e.g. BACKEND:3). If no revision is provided, uses the current revision.

``second``
    Second config to compare. Format: <config_type>[:<revision>] (e.g. BACKEND:6). If no revision is provided, uses the current revision.



.. rubric:: Examples

Show changes made to the workflow config since revision 15::

  osmo config diff WORKFLOW:15

.. image:: images/config_diff_workflow.png
    :align: center
    :class: mb-2

Show changes made between two revisions of the service configuration::

  osmo config diff SERVICE:14 SERVICE:15

.. image:: images/config_diff_service.png
    :align: center
    :class: mb-2
        
