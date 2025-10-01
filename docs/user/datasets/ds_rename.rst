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

.. _ds_rename:

================================================
Rename
================================================

Rename an existing dataset or collection. Names must be unique within a bucket.

.. code-block:: bash

  $ osmo dataset rename -h
  usage: osmo dataset rename [-h] original_name new_name

  positional arguments:
    original_name    Old dataset/collection name. Specify bucket with [bucket/][DS].
    new_name         New dataset/collection name.

  options:
    -h, --help            show this help message and exit

  Ex. osmo dataset rename original_name new_name
