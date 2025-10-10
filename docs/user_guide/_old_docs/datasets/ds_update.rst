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

.. _ds_update:

================================================
Update
================================================

Create a new dataset version from an existing dataset version by adding or removing one or more files or datasets.
The ``--remove`` operation always occurs before the ``--add`` operation.


For datasets, you can add local files and |data_solution| URIs with the ``--add`` input. To specify a remote
prefix where the files will be uploaded to, use ``:`` and then specify the remote path.

.. code-block:: bash

  $ osmo dataset update -h
  usage: osmo dataset update [-h] [--add ADD [ADD ...]] [--remove REMOVE] [--metadata METADATA [METADATA ...]] [--force] [--resume RESUME] name

  positional arguments:
    name                  Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

  options:
    -h, --help            show this help message and exit
    --add ADD [ADD ...], -a ADD [ADD ...]
                          Local paths/Remote URIs to append to the dataset. To specify path in the dataset where the files should be stored, use ":" to delineate local/path:remote/path. Files in the local path will be stored with the prefix of the remote path.
    --remove REMOVE, -r REMOVE
                          Regex to filter which types of files to remove.
    --metadata METADATA [METADATA ...], -m METADATA [METADATA ...]
                          Yaml files of metadata to assign to the newly created dataset version
    --labels LABELS [LABELS ...], -l LABELS [LABELS ...]
                          Yaml files of labels to assign to the dataset
    --force, -f           Disable prompt when removing from dataset without providing path.
    --resume RESUME       Resume a canceled/failed update. To resume, specify the PENDING version to continue.

  Ex. osmo dataset update DS1 --add relative/path:remote/path /other/local/path s3://path:remote/path
  Ex. osmo dataset update DS1 --remove ".*\.(yaml|json)$"

To update the ``CarData`` dataset, based on files in your local machine, ``local/path1/folder1`` at a relative path ``new_folder``
as well as data location on |data_solution| at |data_path|:

.. code-block:: bash
  :substitutions:

  $ osmo dataset update CarData --add local/path1/folder1:new_folder |data_path|
  Uploading to Dataset CarData version 2 bucket <bucket>
  Dataset CarData has been uploaded to bucket <bucket>
  Uploaded 16 MiB new data to the storage.

To update the ``CarData`` dataset, remove a relative path ``new_folder``:

.. code-block:: bash

  $ osmo dataset update CarData --remove "^new_folder/.*$"
  Uploading to Dataset CarData version 3 bucket <bucket>
  Dataset CarData has been uploaded to bucket <bucket>

If an update operation is interrupted due to connection issues and the update is not completed,
you can use the ``--resume`` flag with the corresponding version UUID to continue the specific version that is in a ``PENDING`` state.
Using this flag resumes the operation from where it left off.

.. code-block:: bash
  :substitutions:

  $ osmo dataset update CarData --add local/path1/folder1:new_folder |data_path|
  Uploading to Dataset CarData version 4 bucket <bucket>

  <Connection Issue Occurs>

  $ osmo dataset update CarData --add local/path1/folder1:new_folder |data_path| --resume 4
  Uploading to Dataset CarData version 4 bucket <bucket>
  Dataset CarData has been uploaded to bucket <bucket>

To set a metadata file to a dataset, you can specify it in the ``--metadata`` flag. To learn more about the file formatting, see :ref:`ds_metadata`.

.. code-block:: bash

  $ osmo dataset update CarData:1 --add local/path1/folder1 --metadata ~/path/to/metadata.yaml
  Uploading to Dataset CarData version 5 bucket <bucket>
  Dataset CarData has been uploaded to bucket <bucket>

.. note::

  When updating a dataset with a file that already is in the dataset, the new file will override the
  old file.
