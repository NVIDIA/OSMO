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

.. _concepts_ds_collection:

================================================
Collections
================================================

**Collections** are a method of linking multiple **dataset versions** together for easier
downloading and packaging. These are some restrictions on collections:

.. note::

  * Collections can only include datasets from the **SAME** bucket.
  * Collections do **NOT** support versioning. There is only one name per collection.
  * Collections can only store **ONE** version per dataset.

Collections can be created with the :ref:`cli_reference_dataset_collect` CLI and use the most of
the same CLIs as datasets. To learn more about CLIs that are exclusive to datasets, see :ref:`faqs`.
You cannot upload, tag, or add metadata to a collection.
