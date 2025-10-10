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
Datasets and Collections
================================================

A **Dataset** is a versioned group of files and directories that is stored and managed by OSMO.
There are no restrictions on what types of files are stored in a dataset. A dataset is comprised of
two parts:

- **Hashes**: Each file in the dataset is stored as a hash file. The hash file has the same contents
  as the original file, but its name is the hashed contents of the file. This way, the same file is
  used across multiple versions of the same dataset to eliminate deduplication.
- **Manifests**: A manifest file is a JSON file that contains the mapping between the original file
  path and the hash file name. Each dataset version has a manifest file.

More details on the hash and manifest files can be found in the
:ref:`concepts_ds_version` section.

A **Collection** is a group of datasets.

Dataset and Collection names are unique per OSMO **Bucket**. An bucket in OSMO is simply the
location where the dataset hashes and manifests are stored. As a result, buckets can
use the same name, but using the same name within a bucket results in a new version rather
than a new instantiation of a dataset.

The supported storage backends are:

- Amazon S3
- Google Storage
- Azure Blob Storage
- Torch Object Storage
- Swiftstack

.. toctree::
  :hidden:

  version
  collection
  create
  update
  delete
  labels_and_metadata
  uri
