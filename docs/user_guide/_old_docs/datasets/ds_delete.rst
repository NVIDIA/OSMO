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

.. _ds_delete:

================================================
Delete
================================================

Deletes one or more versions of a dataset or collection.

For datasets, delete simply marks a given version of a dataset
for deletion by changing its status to ``PENDING_DELETE``. Once all the versions are marked as ``PENDING_DELETE``,
the data created and stored in osmo associated with the dataset will be deleted.

For collections, the collection will be deleted but the underlying dataset versions are **NOT** deleted.

.. note::

  Pre-existing storage data that was linked to the dataset will **NOT** be deleted.

.. code-block:: bash

  $ osmo dataset delete -h
  usage: osmo dataset delete [-h] [--all] [--force] [--format-type {json,text}] name

  positional arguments:
    name                  Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

  options:
    -h, --help            show this help message and exit
    --all, -a             Deletes all versions.
    --force, -f           Deletes without confirmation.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo dataset delete DS1:latest --force --format-type json


By default, you are prompted to confirm the delete. You can use ``--force`` to bypass the prompt.

.. code-block:: bash

  Are you sure you want to mark the latest version of Dataset <dataset> from bucket <bucket> as PENDING_DELETE?
  The storage objects will not be deleted yet. [y/n]:

When successful, it provides the following information:

.. code-block:: bash

  Dataset <dataset> version <version> bucket <bucket> has been marked as PENDING_DELETE

Once all the versions are marked, the user will be prompted on whether to wipe the data.

.. code-block:: bash

  $ osmo dataset delete my_dataset --all
  Are you sure you want to mark all versions of Dataset my_dataset from bucket <bucket> as PENDING_DELETE?
  The storage objects will not be deleted yet. [y/n]: y

  All versions of my_dataset has been marked as PENDING_DELETE. Do you want to delete the storage objects and wipe the dataset?
  Note: Any concurrent uploads to this dataset may be effected. [y/n]: y

  Dataset my_dataset in bucket <bucket> has been deleted.
  Cleaned up 10GiB.
