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

========
User CLI
========

This section describes how to manage users and access tokens in OSMO using the ``osmo user`` and ``osmo token`` commands.

User management
---------------

The ``osmo user`` command provides sub-commands for creating, listing, updating, and deleting users, as well as managing their role assignments. All user management commands require admin privileges (``osmo-admin`` role).

Show help docs with ``osmo user --help``.

Access token management
-----------------------

The ``osmo token`` command provides sub-commands for creating, listing, and deleting access tokens. Admins can manage tokens for any user; non-admin users can manage their own tokens.

Show help docs with ``osmo token --help``.

Command overview
----------------

.. toctree::
   :maxdepth: 1

   user_list
   user_create
   user_get
   user_update
   user_delete
   token_set
   token_list
   token_roles
   token_delete
