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

.. _ds_upload:

================================================
Upload
================================================

Upload a dataset from a local file system, or from a container running on compute nodes, or directly from a |data_solution| URL:

.. code-block:: bash

  $ osmo dataset upload -h
  usage: osmo dataset upload [-h] [--desc DESCRIPTION] [--resume] name path [path ...]

  positional arguments:
    name                Dataset name. Specify bucket and tag with [bucket/]DS[:tag].If you want to continue
                        an upload, then the most recent PENDING version is chosen
    path                Path where the dataset lies.

  optional arguments:
    -h, --help          show this help message and exit
    --desc DESCRIPTION  Description of dataset.
    --metadata METADATA [METADATA ...], -m METADATA [METADATA ...]
                        Yaml files of metadata to assign to dataset version
    --labels LABELS [LABELS ...], -l LABELS [LABELS ...]
                        Yaml files of labels to assign to dataset
    --regex REGEX, -x REGEX
                        Regex to filter which types of files to upload
    --resume            Resume a canceled/failed upload.


To create a dataset ``TestDataset`` based on the file  ``test_file.txt``:

.. code-block:: bash
  :substitutions:

  $ touch test_file.txt
  $ osmo dataset upload TestDataset test_file.txt
  Uploading to Dataset TestDataset version 1
  Dataset TestDataset has been uploaded

To create a dataset ``TestDataset`` in a bucket ``TestBucket``, based on the file  ``test_file.txt``:

.. code-block:: bash
  :substitutions:

  $ touch test_file.txt
  $ osmo dataset upload TestBucket/TestDataset test_file.txt
  Uploading to Dataset TestDataset version 1
  Dataset TestDataset has been uploaded

To create the ``CarData`` dataset, based on files in your local machine at ``/path1/folder1`` and ``/path2/folder2`` with a data location on |data_path|:

.. code-block:: bash
  :substitutions:

  $ osmo dataset upload CarData /path1/folder1 /path2/folder2 |data_path|
  Uploading to Dataset CarData version 1
  Dataset CarData has been uploaded

This command packages all of the files in the directory specified as ``<path>`` and uploads them as an OSMO dataset. If a dataset with the given name does not already exist, a new dataset is created with that name. If the dataset with the given name already exists, then a new version is uploaded under the existing dataset.

If an upload operation is interrupted due to connection issues and the upload is not completed, you can use the ``--resume`` flag with the corresponding version UUID to continue the specific version that is in a ``PENDING`` state. Using this flag resumes the operation from where it left off.

.. code-block:: bash
  :substitutions:

  $ osmo dataset upload CarData /path1/folder1 /path2/folder2 |data_path|
  Uploading to Dataset CarData version 1 bucket osmo

  <Connection Issue Occurs>

  $ osmo dataset upload CarData:1 /path1/folder1 /path2/folder2 |data_path| --resume
  Uploading to Dataset CarData version 1 bucket osmo
  Dataset CarData has been uploaded

To set a metadata file to a dataset, you can specify it in the ``--metadata`` flag. To learn more about the file formatting, see :ref:`ds_metadata`.

.. code-block:: bash

  $ osmo dataset upload CarData:1 /path1/folder1 --metadata ~/path/to/metadata.yaml
  Uploading to Dataset CarData version 1 bucket osmo
  Dataset CarData has been uploaded to bucket osmo

You can use ``-regex`` to specify specific types of files to upload. This only uploads ``.txt`` files.

.. code-block:: bash

  $ osmo dataset upload CarData:1 /path1/folder1 --regex ".*\.txt$"
  Uploading to Dataset CarData version 1 bucket osmo
  Dataset CarData has been uploaded to bucket osmo

