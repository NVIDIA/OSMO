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

.. _ds_inspect:

================================================
Inspect
================================================

Provides file information about a dataset version.

.. code-block:: bash

  $ osmo dataset inspect -h
  usage: osmo dataset inspect [-h] [--format-type {text,tree,json}] [--regex REGEX] name

    positional arguments:
    name                  Dataset name. Specify bucket and tag/version with [bucket/]DS[:tag/version].

    options:
    -h, --help            show this help message and exit
    --format-type {text,tree,json}, -t {text,tree,json}
                            Type text is that files are just printed out.
                            Type tree displays a better representation of the directory structure.
                            Type json prints out the list of json objects with both URI and URL links.
    --regex REGEX, -x REGEX
                            Regex to filter which types of files to inspect
    --count COUNT, -c COUNT
                            Number of files to print. Default 10,000.

    Ex. osmo dataset inspect DS1:latest --format-type tree

This would list files in the dataset:

.. code-block:: bash

  $ osmo dataset inspect drivesim2_sdg_sample
  left/1.jpg
  left/2.jpg
  left/3.jpg
  left/4.jpg
  metadata/stats.json
  right/1.jpg
  right/2.jpg


The output the files in a more pretty fashion, use ``--format-type tree``:

.. code-block:: bash

  $ osmo dataset inspect drivesim2_sdg_sample --format-type tree
  ├──left
  │  ├──1.jpg
  │  ├──2.jpg
  │  ├──3.jpg
  │  └──4.jpg
  ├──metadata
  │  └──stats.json
  ├──right
  │  ├──1.jpg
  │  ├──2.jpg


To fetch the browser urls for each file, use ``--format-type json``:

.. code-block:: bash

  $ osmo dataset inspect drivesim2_sdg_sample --format-type json
  [
  {
    "relative_path": "left/1.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/50f84daf3a6dfd6a9f20c9f8ef428942"
    "url": https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/50f84daf3a6dfd6a9f20c9f8ef428942",
    "size": 5,
    "etag": "50f84daf3a6dfd6a9f20c9f8ef428942"
  },
  {
    "relative_path": "left/2.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/39e380fe57e0a2d85edf3d82101ad90a",
    "url": https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/39e380fe57e0a2d85edf3d82101ad90a",
    "size": 11,
    "etag": "39e380fe57e0a2d85edf3d82101ad90a"
  },
  {
    "relative_path": "left/3.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/cd45f76a03741758817ae58fd0131283",
    "url": https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/cd45f76a03741758817ae58fd0131283",
    "size": 10,
    "etag": "cd45f76a03741758817ae58fd0131283"
  },
  {
    "relative_path": "left/4.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/d41d8cd98f00b204e9800998ecf8427e",
    "url": https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/d41d8cd98f00b204e9800998ecf8427e",
    "size": 0,
    "etag": "d41d8cd98f00b204e9800998ecf8427e"
  },
  {
    "relative_path": "metadata/stats.json",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/8c0170ea1732459632a9cea8dd7012fa",
    "url": "https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/8c0170ea1732459632a9cea8dd7012fa",
    "size": 8622,
    "etag": "8c0170ea1732459632a9cea8dd7012fa"
  },
  {
    "relative_path": "right/1.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/50f84daf3a6dfd6a9f20c9f8ef428942",
    "url": "https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/50f84daf3a6dfd6a9f20c9f8ef428942",
    "size": 5,
    "etag": "50f84daf3a6dfd6a9f20c9f8ef428942"
  },
  {
    "relative_path": "right/2.jpg",
    "storage_path": "s3://datasets/Xpx18tXARR-5hKrl2-TnGw/hashes/39e380fe57e0a2d85edf3d82101ad90a",
    "url": "https://datasets.s3.us-east-1.amazonaws.com/Xpx18tXARR-5hKrl2-TnGw/hashes/39e380fe57e0a2d85edf3d82101ad90a",
    "size": 11,
    "etag": "39e380fe57e0a2d85edf3d82101ad90a"
  }
  ]


To fetch only specific files, you can use the regex flag:

.. code-block:: bash

  $ osmo dataset inspect drivesim2_sdg_sample --regex ".*\.json$"
  metadata/stats.json
