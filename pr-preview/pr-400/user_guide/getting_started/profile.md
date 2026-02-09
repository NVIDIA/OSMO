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

<a id="profile"></a>

# Setup Profile

## Viewing Settings

You can use the [Profile List CLI command](../appendix/cli/cli_profile.md#cli_reference_profile_list) to view your current
profile, including bucket and pool defaults.

```bash
$ osmo profile list
user:
  name: John Doe
  email: jdoe@nvidia.com
notifications:
  email: False
  slack: True
bucket:
  default: my-bucket
pool:
  default: my-pool
  accessible:
  - my-pool
  - team-pool
```

<a id="profile-default-dataset-bucket"></a>

## Default Dataset Bucket

### What is a Dataset?

A **Dataset** is a versioned collection of files and directories managed by OSMO.

Key benefits:

- 📦 **Automatic deduplication** - identical files are stored only once across versions
- 🔄 **Full version history** - track and rollback changes over time
- 🎯 **Any file type** - no restrictions on what you can store
- ☁️ **Multi-cloud support** - works with S3, GCS, Azure, and more

See [Datasets](../tutorials/data/index.md#tutorials-working-with-data-datasets) for complete details.

To choose a default bucket, first view available buckets with the [Bucket List CLI command](../appendix/cli/cli_bucket.md#cli-reference-bucket).

```bash
$ osmo bucket list

Bucket                Location
===========================================
my_bucket             s3://<name_of_bucket>
```

Set the default bucket using the profile CLI.

```bash
$ osmo profile set bucket my_bucket
```

## Default Pool

### What is a Pool?

A **Pool** is a shared group of managed compute resources (machines) used to run workflows.

Key benefits:

- 👥 **Team sharing** - access-controlled resources shared across your organization
- 🎯 **Hardware targeting** - platforms let you specify GPU types and configurations
- ⚖️ **Smart scheduling** - maximize resource usage with intelligent workload placement

See [Pools](../resource_pools/index.md#concepts-pools) for complete details.

To choose a default pool, use the [Profile List CLI command](../appendix/cli/cli_profile.md#cli_reference_profile_list) to
view available pools and [Resource List CLI command](../appendix/cli/cli_resource.md#cli_reference_resource_list) to see what
resources are in each pool.

Set the default pool using the profile CLI.

```bash
$ osmo profile set pool my_pool
```
