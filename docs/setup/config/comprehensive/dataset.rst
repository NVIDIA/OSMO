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

.. _dataset_config:

===========================
Dataset Config
===========================

Dataset config is used to configure dataset storage buckets and access.

Top-Level Configuration
========================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``buckets``
     - `Bucket`_
     - Configuration for available dataset storage buckets.
   * - ``default_bucket``
     - String
     - The default bucket identifier to use when none is specified.

Bucket
======

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``dataset_path``
     - String
     - The URI to the dataset storage location including protocol and bucket/container.
   * - ``region``
     - String
     - The cloud storage region where the bucket is located.
   * - ``check_key``
     - Boolean
     - Whether to validate access keys before allowing access to the bucket.
   * - ``description``
     - String
     - Human-readable description of the bucket and its intended use.
   * - ``mode``
     - String
     - Access mode for the bucket. Can be "read-only" or "read-write".
   * - ``default_credential``
     - String/null
     - Default credential identifier to use for this bucket. If null, someone using the bucket will need to specify a credential.
