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

.. _faq_data:

Data
====

How to convert |data_solution| URLs to datasets?
------------------------------------------------

You must have data access and the data must be in the |data_solution| bucket. OSMO natively supports ingesting |data_solution| URLs to OSMO datasets.

.. code-block:: bash
  :substitutions:

  $ osmo dataset upload sample_dataset |data_full_prefix|team_bucket/extracted_data/my_data.pod

After the process completes, you can view the dataset as mentioned in :ref:`cli_reference_dataset_info`.

How to resume dataset operations in case of failures?
-----------------------------------------------------

Dataset upload and download support resuming the process if it fails while operating.
For uploading, a failure during the upload leaves the dataset version in a PENDING state
that can be seen using the info CLI.

.. code-block:: bash

  $ osmo dataset upload DS:10 /path/upload/folder --resume

  $ osmo dataset download DS /path/download/folder --resume

The resume flag for uploading picks the selected PENDING version or selects the latest PENDING
version of the dataset and continues uploading from where it was interrupted.

For download, it continues from where it was interrupted.


What CLIs apply to Datasets and which to Collections?
-----------------------------------------------------

..  list-table::
    :header-rows: 1
    :widths: auto

    * - **CLI**
      - **Dataset**
      - **Collection**
    * - Upload
      - ✔
      - ✕
    * - Collect
      - ✕
      - ✔
    * - Download
      - ✔
      - ✔
    * - Update
      - ✔
      - ✔
    * - List
      - ✔
      - ✔
    * - Info
      - ✔
      - ✔
    * - Delete
      - ✔
      - ✔
    * - Tags
      - ✔
      - ✕
    * - Label
      - ✔
      - ✔
    * - Metadata
      - ✔
      - ✕
    * - Rename
      - ✔
      - ✔
    * - Query
      - ✔
      - ✔

What Bucket Access do I need to use the Dataset CLI?
----------------------------------------------------

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
