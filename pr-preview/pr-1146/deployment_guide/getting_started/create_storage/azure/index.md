<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

<a id="azure-blob-permissions"></a>

# Azure Blob Storage

To handle who can access Datasets, the necessary Azure resources/policies must be created. This includes

- An Azure Blob Storage Account
- An Azure Blob Storage Container
- Networking Permissions

## Setting up Storage Account and Container

First, follow the instructions from the [Azure documentation](https://learn.microsoft.com/en-us/azure/storage/common/storage-account-create?tabs=azure-portal) to create a storage account and container.

Once you are in the Azure portal, go to the storage account, on the left side bar, click on `Data Storage` > `Containers`.

When the Containers dashboard is loaded, click on the `Add Container` button.

## Networking

In the storage account page, click on `Security + Networking` > `Networking` on the left side bar.

Click on `Manage` under `Public network access`.

In the `Public network access` section, set the following:

- Set `Enable` for Public network access
- Set `Enable` from all networks’ for ‘Public network access scope’

## Configuring IAM Policy

In the storage account page, click on `Access Control (IAM)` on the left side bar.

Click on `Add` > `Add role assignment`.

In the `Role` section, select `Storage Blob Data Contributor`.

In the `Assign access to` section, select `User, group, or service principal`.

Click on `Select members`, and select the users you want to give access to.

Click on `Review + assign`.

After the role assignment is created, the users will be able to create their
credentials with a connection string to access the storage account.

## Construct URI

URIs are constructed as follows with examples for container name `my_container`:

```bash
azure://<account>/<container>/<path>

# Example
azure://my_account/my_container
```

Follow [Configure Data Storage](../../configure_data.md#configure-data) to add the bucket to OSMO.
