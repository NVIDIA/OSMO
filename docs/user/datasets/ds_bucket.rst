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

.. _ds_bucket:

================================================
Bucket
================================================

List all available buckets. The default bucket is used when no bucket is referenced in the other CLIs.

.. code-block:: bash

  $ osmo bucket list -h
  usage: osmo bucket list [-h] [--format-type {json,text}]

  options:
    -h, --help            show this help message and exit
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

For example:

.. code-block:: bash

  $ osmo bucket list

  Bucket           Description      Location                    Mode        Default Cred
  ======================================================================================
  my_bucket        my bucket        s3://my-bucket-location     read-write  No
  osmo (default)   my osmo bucket   gs://osmo-bucket            read-only   Yes
  team_bucket      my team bucket   s3://team-bucket-location   read-write  No

In the example above, the bucket ``osmo`` has a default cred. This means you can submit a workflow
using that dataset without needing to specify credentials. However, you cannot perform local dataset
operations without creating a dataset credential for that dataset since your local client may
not have the credential stored.

Refer to below table for access permissions needed for the various dataset CLI

  ..  list-table::
      :header-rows: 1
      :widths: auto

      * - **CLI**
        - **Read**
        - **Write**
        - **Delete**
      * - Upload
        - ✔
        - ✔
        - ✕
      * - Collect
        - ✔
        - ✕
        - ✕
      * - Download
        - ✔
        - ✕
        - ✕
      * - Update
        - ✔
        - ✔
        - ✕
      * - List
        - ✕
        - ✕
        - ✕
      * - Info
        - ✔
        - ✕
        - ✕
      * - Delete
        - ✕
        - ✕
        - ✔
      * - Tags
        - ✕
        - ✔
        - ✕
      * - Label
        - ✕
        - ✔
        - ✕
      * - Metadata
        - ✕
        - ✔
        - ✕
      * - Rename
        - ✕
        - ✔
        - ✕
      * - Query
        - ✔
        - ✕
        - ✕
