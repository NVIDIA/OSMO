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

<a id="create-data-storage"></a>

# Create Data Storage

OSMO uses cloud storage buckets to power workflow execution and enable seamless data management:

- **Service Bucket**: OSMO requires a dedicated bucket to function. This bucket stores workflow logs, manages intermediate data between tasks, and ensures smooth workflow execution.
- **Team Buckets**: Development teams bring their own buckets to store, access, and manage their workflow data with complete isolation and control.

This separation ensures secure data isolation while giving teams the flexibility to manage their data independently.

Follow the below guides to create the required buckets:

<!-- Optional storage sections can be included -->

Once the desired buckets are created, follow instructions at [Configure Data Storage](../configure_data.md#configure-data) to use them with OSMO.
