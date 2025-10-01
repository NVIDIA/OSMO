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

After a dataset version is created, the files inside can be modified using the :ref:`ds_update`
CLI. There, you can add or remove files.

Collections use the same :ref:`ds_update` CLI to add or remove dataset versions from the collection.

.. note::

  When deleting and adding files/datasets to datasets/collections, the deletion operation comes
  first.

You can rename datasets and collections using the :ref:`ds_rename` CLI.
