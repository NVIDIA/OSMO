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

.. _concepts_ds_create:

================================================
Create
================================================

Creating a Dataset
==================

The process of creating a dataset version is as follows:

1. The user's client reports to the OSMO service to instantiate
   the dataset version information, and the new version is marked as ``PENDING``.

   a. If a dataset already exists with the same name in the same bucket, the version count is
      incremented and given to the new version.
   b. Otherwise, a new dataset is created and the version is ``1``.

2. Once the upload operation is completed, the client reports to the OSMO service to
   mark the version as ``READY`` and the version will be available to be downloaded.

.. note::

  Due to the fact that dataset files are hashed, when the user uploads a new version, the dataset
  library checks if the file already exists in hashes folder and if so, it skips uploading it.

To reference a dataset version, it is referred to by the dataset name and the version number or tag.
For example, after creating a dataset called ``my_dataset``, you can reference that dataset using:

* ``my_dataset`` refers to the newest version that is in the READY state.
* ``my_dataset:LkXFR4YFQsSED0T6MR72CQ`` refers to the version of the dataset which has a tag of
  ``LkXFR4YFQsSED0T6MR72CQ`` linked by the :ref:`cli_reference_dataset_tag` CLI.
* ``my_dataset:latest`` refers to the dataset with tag ``latest``.
* ``my_dataset:3`` refers to version ``3`` of the dataset.

To reference dataset ``my_dataset`` from bucket ``team_bucket``, use ``team_bucket/my_dataset``.

By default, the user needs to specify the bucket name when creating a dataset.

.. note::

  The service-wide default bucket can be configured but requires service-level configuration.
  If you have administrative access, you can enable this directly. Otherwise, contact someone
  with dataset administration privileges.

Creating a Collection
=====================

Collections are a grouping which links to multiple dataset versions.

When a collection is created, no new data is created or duplicated in object storage.
