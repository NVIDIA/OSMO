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

.. _storage_access:

================================================
Create Data Storage
================================================

Buckets are used to isolate data storage so that each team or service has access to only their data.
It is recommended that each team has their own bucket that is also different from the bucket that is
used for storing service logs and intermediate data.

Once the desired buckets are created, follow instructions at :ref:`ds_bucket` to link the created
buckets to OSMO.

.. toctree::
  :maxdepth: 1
  :glob:

  */index
