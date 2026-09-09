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

=================
Configuration CLI
=================

Use ``osmo config show`` to inspect the configuration currently loaded by the service.
It is the only command under ``osmo config`` in 6.4.

Configuration management
------------------------

OSMO 6.4 loads service configuration from a validated ConfigMap snapshot.
To change configuration, update the unified chart's ``configuration`` Helm values
and redeploy through your deployment workflow. Use GitOps for change history,
diffs, and rollbacks. Configuration changes take effect as replacement pods start;
a read during a rollout reflects the snapshot loaded by the responding API pod.

The former ``update``, ``set``, ``delete``, ``list``, ``history``, ``diff``,
``rollback``, and ``tag`` commands, and ``TYPE:revision`` lookups, are removed.
To list current objects of a type, use commands such as ``osmo config show POOL``
or ``osmo config show ROLE``.

Supported configuration types
-----------------------------

``show`` accepts ``SERVICE``, ``WORKFLOW``, ``BACKEND``, ``POOL``, ``POD_TEMPLATE``,
``GROUP_TEMPLATE``, ``RESOURCE_VALIDATION``, ``BACKEND_TEST``, and ``ROLE``.
Optional names and indices select nested values. For pools, ``--verbose`` includes
resolved pod templates, group templates, and resource validations.

Command reference
-----------------

.. toctree::
   :maxdepth: 1

   config_show
