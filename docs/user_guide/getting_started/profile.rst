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

.. _profile:

=============
Setup Profile
=============

Viewing Settings
----------------

You can use the :ref:`Profile List CLI command <cli_reference_profile_list>` to view your current
profile, including bucket and pool defaults.

.. code-block:: bash

  $ osmo profile list
  user:
    name: John Doe
    email: jdoe@nvidia.com
  notifications:
    email: False
    slack: True
  bucket:
    default: my-bucket
  pool:
    default: my-pool
    accessible:
    - my-pool
    - team-pool
  roles:
  - osmo-user
  - osmo-ml-team

Default Pool
------------

.. auto-include:: ../resource_pools/what_is_a_pool.in.rst

To choose a default pool, use the :ref:`Profile List CLI command <cli_reference_profile_list>` to
view available pools and :ref:`Resource List CLI command <cli_reference_resource_list>` to see what
resources are in each pool.

Set the default pool using the profile CLI.

.. code-block:: bash

  $ osmo profile set pool my_pool
