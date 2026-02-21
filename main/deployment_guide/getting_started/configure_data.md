<!-- SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

<a id="configure-data"></a>

# Configure Data Storage

> **Prerequisites**
>
> # Prerequisites

> Before configuring OSMO to use data storage, ensure you have created the required data storage: [Create Data Storage](create_storage/index.md#create-data-storage)

## Workflow Logs

Run the following commands to configure the workflow spec and log storage location in OSMO. Make sure to replace the placeholders with the actual values.

```bash
$ cat << EOF > /tmp/workflow_log_config.json
{
  "workflow_log": {
      "credential": {
          "endpoint": "s3://my_bucket/workflows",
          "access_key_id": "EXAMPLE_ACCESS_KEY_ID",
          "access_key": "EXAMPLE_ACCESS_KEY",
          "region": "us-east-1",
          "override_url": "http://minio:9000" # Optional: HTTP endpoint for non-AWS S3
      }
  }
}
EOF
```

> **Note**
>
> `override_url` is optional. Set it only when using non-AWS S3-compatible services
> (MinIO, Ceph, LocalStack). Leave it empty or omit it for standard AWS S3.

Then, update the workflow configuration using the OSMO CLI. Please make sure you’re logged in to your OSMO instance before running the following command.

```bash
$ osmo config update WORKFLOW --file /tmp/workflow_log_config.json
```

## Workflow Data

Configure the storage location for intermediate data that OSMO uses to pass outputs between workflow tasks. Replace the placeholders with your actual values.

```bash
$ cat << EOF > /tmp/workflow_data_config.json
{
  "workflow_data": {
      "credential": {
          "endpoint": "s3://my_bucket/workflows",
          "access_key_id": "EXAMPLE_ACCESS_KEY_ID",
          "access_key": "EXAMPLE_ACCESS_KEY",
          "region": "us-east-1",
          "override_url": "http://minio:9000" # Optional: HTTP endpoint for non-AWS S3
      }
  }
}
EOF
```

> **Note**
>
> `override_url` is optional. Set it only when using non-AWS S3-compatible services
> (MinIO, Ceph, LocalStack). Leave it empty or omit it for standard AWS S3.

Then, update the workflow data configuration using the OSMO CLI. Please make sure you’re logged in to your OSMO instance before running the following command.

```bash
$ osmo config update WORKFLOW --file /tmp/workflow_data_config.json
```

#### SEE ALSO
**Datasets (Optional)**

To configure storage buckets for users to store OSMO datasets, see [Dataset Buckets](../advanced_config/dataset_buckets.md#dataset-buckets) in the Advanced Configuration section.
