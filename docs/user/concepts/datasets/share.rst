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

.. _concepts_ds_share:

================================================
Share
================================================

To list datasets that belong to a team, you can use the :ref:`ds_list` CLI.

For more granular filtering on listing datasets, the :ref:`ds_query` CLI is recommended.

Datasets can be further inspected with the :ref:`ds_info` CLI. This CLI requires **read**
permission on the bucket.
Info allows the user to view details regarding the dataset and versions.

To share a dataset, reference the dataset or version with the bucket associated with it.
For example, to reference version `2` of dataset ``my_dataset`` from bucket ``team_bucket``,
use ``team_bucket/my_dataset:2``.
