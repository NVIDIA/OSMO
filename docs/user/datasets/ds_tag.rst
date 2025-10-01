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

.. _ds_tag:

================================================
Tag
================================================

Datasets are internally versioned. You can set a human readable ``tag``, if needed, that is unique per dataset. You cannot have two versions marked with the same tag in the same dataset.

The ``tag`` is used to refer to a specific version of a dataset for use across all APIs.


.. code-block:: bash

  $ osmo dataset tag -h
  usage: osmo dataset tag [-h] [--set SET [SET ...]] [--delete DELETE [DELETE ...]] name

  positional arguments:
    name                  Dataset name to update. Specify bucket and tag/version with
                          [bucket/]DS[:tag/version].

  options:
    -h, --help            show this help message and exit
    --set SET [SET ...], -s SET [SET ...]
                          Set tag to dataset version.
    --delete DELETE [DELETE ...], -d DELETE [DELETE ...]
                          Delete tag from dataset version.

  Ex. osmo dataset tag DS1 --set tag1 --delete tag2

