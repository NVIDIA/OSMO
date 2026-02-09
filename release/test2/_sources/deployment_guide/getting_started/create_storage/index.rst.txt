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

.. _create_data_storage:

================================================
Create Data Storage
================================================

OSMO uses cloud storage buckets to power workflow execution and enable seamless data management:

- **Service Bucket**: OSMO requires a dedicated bucket to function. This bucket stores workflow logs, manages intermediate data between tasks, and ensures smooth workflow execution.
- **Team Buckets**: Development teams bring their own buckets to store, access, and manage their workflow data with complete isolation and control.

This separation ensures secure data isolation while giving teams the flexibility to manage their data independently.

Follow the below guides to create the required buckets:

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`cloud` AWS S3
          :link: ./s3/index
          :link-type: doc

          Set up S3 buckets with IAM policies and user groups on AWS.

      .. grid-item-card:: :octicon:`cloud` Azure Blob Storage
          :link: ./azure/index
          :link-type: doc

          Configure Azure Blob Storage accounts, containers, and networking permissions.

      .. grid-item-card:: :octicon:`cloud` Google Cloud Storage (GCS)
          :link: ./gcp/index
          :link-type: doc

          Create GCS buckets with IAM roles and access control lists on GCP.

      .. grid-item-card:: :octicon:`cloud` Torch Object Storage (TOS)
          :link: ./tos/index
          :link-type: doc

          Configure TOS buckets with IAM policies and user access.

..
  Optional storage sections can be included

.. auto-include:: ./**.in.rst

.. toctree::
   :hidden:
   :maxdepth: 1

   s3/index
   azure/index
   gcp/index
   tos/index

Once the desired buckets are created, follow instructions at :ref:`configure_data` to use them with OSMO.
