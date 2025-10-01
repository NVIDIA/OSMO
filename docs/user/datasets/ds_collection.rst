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

.. _ds_collection:

================================================
Collection
================================================

A collection is defined as a group of one or more **dataset versions**. When you download a collection, all datasets that are part of that collection are downloaded. Some CLIs apply for both datasets and collections, for more information see :ref:`faqs`.

.. note::

  Two versions of the same dataset cannot be in a collection. A collection can be used to create another collection.

To create a collection:

.. code-block:: bash

  $ osmo dataset collect -h
  usage: osmo dataset collect [-h] name datasets [datasets ...]

  positional arguments:
    name        Collection name. Specify bucket and with [bucket/][C]. All datasets and collections added to
                this collection are based off of this bucket
    datasets    Each Dataset to add to collection. To create a collection from another collection, add the collection name.

  options:
    -h, --help  show this help message and exit

For example:

.. code-block::

    osmo dataset collect CName C1 DS1 DS2 DS3:latest

You can use the following CLI commands with collections:

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **CLI**
      - **Collection**
    * - Collect
      - ✔
    * - Download
      - ✔
    * - Update
      - ✔
    * - List
      - ✔
    * - Info
      - ✔
    * - Delete
      - ✔
    * - Label
      - ✔
    * - Rename
      - ✔
    * - Query
      - ✔
