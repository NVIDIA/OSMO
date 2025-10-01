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

.. _concepts_ds:

================================================
Datasets
================================================

A **dataset** is a group of files and directories that is stored, versioned, and managed by OSMO.
There are no restrictions on what types of files are stored in a dataset. These datasets are stored
in Amazon S3 or Google Storage depending on the admin dataset configuration.

Dataset and Collection names are unique per bucket. As a result, different teams can
use the same name, but using the same name within a bucket results in a new version rather
than a new instantiation of a dataset.

.. toctree::
  :hidden:

  collection
  version
  create
  share
  update
  delete
  labels_and_metadata
