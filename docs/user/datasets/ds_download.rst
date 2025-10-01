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

.. _ds_download:

================================================
Download
================================================


Download a dataset to the given path on the local filesystem:

.. code-block:: bash

  $ osmo dataset download -h
  usage: osmo dataset download [-h] [--resume] name path

  positional arguments:
    name          Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].
    path          Location where dataset will be downloaded to.

  options:
    -h, --help    show this help message and exit
    --regex REGEX, -x REGEX
                  Regex to filter which types of files to download
    --resume, -r  Resume a canceled/failed download.

  Ex. osmo dataset download DS1:latest /path/to/folder

Download is a synchronous operation. When successful, it provides the following information:

.. code-block:: bash

  $ osmo dataset download sample /home/
  100%|█| 193M/193M [00:03<00:00, 56.9MB/s, file_name=..]
  Dataset sample has been downloaded to /home/

  $ ls .
  sample

If a download operation is interrupted due to connection issues and the upload is not completed, you can use the ``--resume`` flag with the corresponding version UUID to continue the specific version in a ``PENDING`` state. This flag resumes the operation from where it left off.

.. code-block:: bash

  $ osmo dataset download CarData /path1/folder1

  <Connection Issue Occurs>

  $ osmo dataset download CarData /path1/folder1 --resume
  Dataset CarData has been downloaded to /path1/folder1

  $ ls /path1/folder1
  CarData

You can use ``-regex`` to specify specific types of files to download. This only downloads ``.yaml`` or ``.json`` files.

.. code-block:: bash

  $ osmo dataset download sample /home/ --regex ".*\.(yaml|json)$"
  100%|█| 193M/193M [00:03<00:00, 56.9MB/s, file_name=file.yaml]
  Dataset sample has been downloaded to /home/

  $ ls /home/
  sample

Here is an example of downloading a collection.

.. code-block:: bash

  $ osmo dataset info my_collection
  -----------------------------------------------------

  Name: osmo/my_collection
  ID: cvDfqHl0Qg63Z1VWGwBOow
  Bucket: my_bucket
  Type: COLLECTION
  Created By: user@email.com
  Create Date: May 10, 2024 20:17 PDT
  Size: 3.8 MiB

  Dataset        Version
  ======================
  DS_1           3
  DS_2           1
  DS_3           1


  $ osmo dataset download my_collection /home/
  Dataset my_collection has been downloaded to /home/

  $ ls /home/
  DS_1  DS_2  DS_3
