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

.. _concepts_ds_labels_and_metadata:

================================================
Labels and Metadata
================================================

Labels are a dictionary per **dataset and collection** which enables users to store information
describing features about **ALL** the versions connected to it.

Metadata is also a dictionary, but stores information exclusive to a single **dataset version**.

Some examples of what might be stored in each:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Labels**
    - **Metadata**
  * - The project that uses the dataset
    - Workflow ID that created the dataset version
  * - All versions store Synthetic or Real Data
    - The user who created it
  * -
    - The hardware that ran the tests

Go to :ref:`cli_reference_dataset_metadata` and :ref:`cli_reference_dataset_label` for more information
on how to apply labels and metadata to a dataset.
