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

.. _concepts_ds_update:

================================================
Update
================================================

Updating a Dataset
==================

Dataset versions are immutable once created. However, a new dataset version can be created from
an existing dataset version by adding or removing files.

This process mirrors the :ref:`concepts_ds_create` section and utilizes the manifest file of the
existing dataset version to create a new dataset version.

Updating a Collection
=====================

Collections on the other hand can be updated by adding or removing dataset versions.

.. note::

  When deleting and adding files/datasets to datasets/collections, the deletion operation comes
  first.
