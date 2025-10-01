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

.. _concepts_ds_create:

================================================
Create
================================================

After a dataset is created or uploaded, it is referred to by its name and an optional colon
separated version number or tag.
For example, after creating a dataset called ``my_dataset``, you can reference that dataset using:

* ``my_dataset`` refers to the newest version that is in the READY state.
* ``my_dataset:LkXFR4YFQsSED0T6MR72CQ`` Refers to the version of the dataset which has a tag of
  “LkXFR4YFQsSED0T6MR72CQ” linked by the :ref:`ds_tag` CLI.
* ``my_dataset:latest`` Refers to the dataset with tag “latest”.
* ``my_dataset:3`` Refers to version 3 of the dataset.

By default, all datasets are created and downloaded from the default **bucket** that is configure
by the Admin. To reference the datasets from your team, append the bucket name alongside a
`/` to the dataset name. To see all available buckets, use the :ref:`ds_bucket` CLI.

For example, to reference dataset ``my_dataset`` from bucket ``team_bucket``, use
``team_bucket/my_dataset``.

To create a dataset:

1. Set your dataset bucket credentials using:

* :ref:`credentials`

.. note::

  Upload requires both **write AND read** permissions.

2. Create the dataset using one of the following:

* :ref:`ds_upload`
* :ref:`ds_workflow`

To retrieve a dataset:

1. Set your dataset bucket credentials using:

* :ref:`credentials`

.. note::

  Download requires **read** permissions.

2. Download your dataset using:

* :ref:`ds_download`
