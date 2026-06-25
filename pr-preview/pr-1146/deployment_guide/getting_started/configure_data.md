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

<a id="configure-data"></a>

# Configure Data Storage

> **Prerequisites**
>
> # Prerequisites

> Before configuring OSMO to use data storage, ensure you have created the required data storage: [Create Data Storage](create_storage/index.md#create-data-storage)

## Workflow Logs

Run the following commands to configure the workflow spec and log storage location in OSMO. Make sure to replace the placeholders with the actual values.

```bash
# URI of your s3 bucket e.g. s3://my_bucket
$ export BACKEND_URI=...

$ export ACCESS_KEY_ID=...
$ export ACCESS_KEY=...

# Bucket Region
$ export REGION=...

$ cat << EOF > /tmp/workflow_log_config.json
{
  "workflow_log": {
      "credential": {
          "endpoint": "'$BACKEND_URI'",
          "access_key_id": "'$ACCESS_KEY_ID'",
          "access_key": "'$ACCESS_KEY'",
          "region": "'$REGION'"
      }
  }
}
EOF
```

Then, update the workflow configuration using the OSMO CLI. Please make sure you’re logged in to your OSMO instance before running the following command.

```bash
$ osmo config update WORKFLOW --file /tmp/workflow_log_config.json
```

## Workflow Data

Configure the storage location for intermediate data that OSMO uses to pass outputs between workflow tasks. Replace the placeholders with your actual values.

```bash
# URI of your s3 bucket e.g. s3://my_bucket
$ export BACKEND_URI=...

$ export ACCESS_KEY_ID=...
$ export ACCESS_KEY=...

# Bucket Region
$ export REGION=...

$ cat << EOF > /tmp/workflow_data_config.json
{
  "workflow_data": {
      "credential": {
          "endpoint": "'$BACKEND_URI'",
          "access_key_id": "'$ACCESS_KEY_ID'",
          "access_key": "'$ACCESS_KEY'",
          "region": "'$REGION'"
      }
  }
}
EOF
```

Then, update the workflow data configuration using the OSMO CLI. Please make sure you’re logged in to your OSMO instance before running the following command.

```bash
$ osmo config update WORKFLOW --file /tmp/workflow_data_config.json
```

#### SEE ALSO
**Datasets (Optional)**

To configure storage buckets for users to store OSMO datasets, see [Dataset Buckets](../advanced_config/dataset_buckets.md#dataset-buckets) in the Advanced Configuration section.
