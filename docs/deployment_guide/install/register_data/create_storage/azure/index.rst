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

.. _azure_blob_permissions:

=============================
Azure Blob Storage
=============================

To handle who can access Datasets, the necessary Azure resources/policies must be created. This includes

- An Azure Blob Storage Account
- An Azure Blob Storage Container
- Networking Permissions

Setting up Storage Account and Container
========================================

First, follow the instructions from the `Azure documentation <https://learn.microsoft.com/en-us/azure/storage/common/storage-account-create?tabs=azure-portal>`_ to create a storage account and container.

Once you are in the Azure portal, go to the storage account, on the left side bar, click on ``Data Storage`` > ``Containers``.

When the Containers dashboard is loaded, click on the ``Add Container`` button.

Networking
==========

In the storage account page, click on ``Security + Networking`` > ``Networking`` on the left side bar.

Click on ``Manage`` under ``Public network access``.

In the ``Public network access`` section, set the following:

- Set ``Enable`` for Public network access
- Set ``Enable`` from all networks' for 'Public network access scope'

Configuring IAM Policy
======================

We currently do not support users to access storage accounts.
This is because an Azure connection string that has perpetual access always have admin privileges,
and there is no way to provide that to users without giving them admin privileges.

Users will not be able to use `osmo data`, but users will be able to use `osmo dataset`, because
the dataset operation goes through the OSMO service.

Construct URI
=============

URIs are constructed as follows with examples for container name ``my_container``:

.. code-block:: bash
  :class: no-copybutton

  azure://<account>/<container>/<path>

  # Example
  azure://my_account/my_container

Follow :ref:`ds_bucket` to add the bucket to OSMO.
