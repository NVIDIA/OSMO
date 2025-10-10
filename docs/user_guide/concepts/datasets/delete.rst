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

.. _concepts_ds_delete:

================================================
Delete
================================================

Deleting a Dataset
==================

When a dataset version is deleted, it is marked as ``PENDING_DELETE``, but no hashes or manifests
are deleted from object storage as the same hash file is shared across multiple versions.

Once all the versions of the dataset have been marked for deletion, the hashes and manifests are
deleted from object storage and the dataset is removed from OSMO.

.. note::

  A race condition may occur if a client tries to upload a new version while another client is
  deleting the dataset, causing the dataset to become corrupted or missing files.

Deleting a Collection
=====================

When a collection is deleted, the collection is removed from OSMO and corresponding dataset versions
remain untouched.
