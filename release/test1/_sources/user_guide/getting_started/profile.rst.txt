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

.. _profile_default_dataset_bucket:

Default Dataset Bucket
----------------------

.. dropdown:: What is a Dataset?
    :color: primary
    :icon: question

    A **Dataset** is a versioned collection of files and directories managed by OSMO.

    Key benefits:

    - 📦 **Automatic deduplication** - identical files are stored only once across versions
    - 🔄 **Full version history** - track and rollback changes over time
    - 🎯 **Any file type** - no restrictions on what you can store
    - ☁️ **Multi-cloud support** - works with S3, GCS, Azure, and more

    See :ref:`tutorials_working_with_data_datasets` for complete details.

To choose a default bucket, first view available buckets with the :ref:`Bucket List CLI command <cli_reference_bucket>`.

.. code-block:: bash

  $ osmo bucket list

  Bucket                Location
  ===========================================
  my_bucket             s3://<name_of_bucket>

Set the default bucket using the profile CLI.

.. code-block:: bash

  $ osmo profile set bucket my_bucket

Default Pool
------------

.. auto-include:: ../resource_pools/what_is_a_pool.in.rst

To choose a default pool, use the :ref:`Profile List CLI command <cli_reference_profile_list>` to
view available pools and :ref:`Resource List CLI command <cli_reference_resource_list>` to see what
resources are in each pool.

Set the default pool using the profile CLI.

.. code-block:: bash

  $ osmo profile set pool my_pool
