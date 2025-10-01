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

.. _ds_recollect:

================================================
Recollect
================================================

Update a collection by adding or removing one or more datasets/collections.
The ``--remove`` operation always occurs before the ``--add`` operation.

.. code-block:: bash

  $ osmo dataset recollect -h
  usage: osmo dataset recollect [-h] [--add ADD [ADD ...]] [--remove REMOVE [REMOVE ...]] [--force] name

  positional arguments:
  name                  Collection name. Specify bucket with [bucket/]Collection.

  options:
  -h, --help            show this help message and exit
  --add ADD [ADD ...], -a ADD [ADD ...]
                          Datasets to add to collection.
  --remove REMOVE [REMOVE ...], -r REMOVE [REMOVE ...]
                          Datasets to remove from collection. The remove operation happens before the add.

  Ex. osmo dataset recollect C1 --remove DS1 --add DS2:4


To update the ``CarCollection`` collection and add the ``WheelData`` dataset  with tag ``latest``:

.. code-block:: bash

  $ osmo dataset recollect CarCollection --add WheelData:latest
   Dataset      Version
   ======================
   CarData      2
   WheelData    4
