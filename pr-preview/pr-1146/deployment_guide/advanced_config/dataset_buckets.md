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

<a id="dataset-buckets"></a>

# Dataset Buckets

Register external cloud storage buckets (S3, GCS, Azure) with OSMO to organize [datasets](../../user_guide/tutorials/data/index.md#tutorials-working-with-data-datasets) across multiple storage locations (This configuration is optional)

## Why Use Dataset Buckets?

Multiple dataset buckets provide flexible data management for OSMO datasets:

✓ **Automatic Deduplication**
: Content-addressed storage means identical files are stored only once across versions, saving storage costs and transfer time.

✓ **Version Control**
: Full version history for datasets—track changes, rollback to previous versions, and maintain reproducible workflows.

✓ **Organize by Team or Project**
: Separate datasets across different buckets for access control, billing, or organizational boundaries.

✓ **Use Existing Infrastructure**
: Register pre-existing S3/GCS/Azure buckets without migrating data—integrate seamlessly with existing storage.

✓ **Multi-Cloud Support**
: Mix storage providers (AWS S3, Google Cloud Storage, Azure Blob) in the same OSMO deployment.

✓ **Simplified References**
: Use short names (e.g., `production/model-v2`) instead of full URIs (`s3://long-bucket-name/model-v2`).

✓ **Persistent & Shareable**
: Datasets persist beyond workflow execution and can be shared across workflows, teams, and accessed via CLI, workflows, or Web UI.

## How It Works

### Bucket Registration

**1. Register Bucket** 🪣

Add cloud storage

Map name to URI (S3, GCS, Azure)

**2. Set Default** ⭐

Choose primary bucket

Users reference without prefix

**3. Use in Workflows** 🔗

Reference datasets

Usage: `bucket-name/dataset-name`

### Bucket Naming

Once registered with a bucket name (say `production`), datasets in that bucket are referenced as:

- `production/imagenet`
- `production/resnet50`

If the bucket is set as the default bucket, datasets can be referenced without the bucket name prefix:

- `imagenet`
- `resnet50`

## Practical Guide

### Registering Buckets

**Step 1: Register Single Bucket**

Add your first cloud storage bucket:

```bash
$ cat << EOF > /tmp/dataset_config.json
{
  "buckets": {
    "production": {
      "dataset_path": "s3://my-production-bucket"
    }
  }
}
EOF

$ osmo config update DATASET --file /tmp/dataset_config.json
```

**Step 2: Register Multiple Buckets**

Add buckets from different cloud providers:

```bash
$ cat << EOF > /tmp/dataset_config.json
{
  "buckets": {
    "production": {
      "dataset_path": "s3://prod-datasets"
    },
    "staging": {
      "dataset_path": "s3://staging-datasets"
    },
    "research": {
      "dataset_path": "gs://research-bucket"
    },
    "archive": {
      "dataset_path": "azure://archive-storage"
    }
  }
}
EOF

$ osmo config update DATASET --file /tmp/dataset_config.json
```

**Step 3: Set Default Bucket**

Designate one bucket as the default (users can omit the bucket name prefix):

```bash
$ cat << EOF > /tmp/default_bucket_config.json
{
  "default_bucket": "production"
}
EOF

$ osmo config update DATASET --file /tmp/default_bucket_config.json
```

**Step 4: Verify Configuration**

List all registered buckets:

```bash
$ osmo bucket list

Bucket               Location
============================================
production (default) s3://prod-datasets
staging              s3://staging-datasets
research             gs://research-bucket
archive              azure://archive-storage
```

### Usage Examples

### **Team-Based Buckets**

Separate datasets by team or department:

```json
{
  "buckets": {
    "robotics": {
      "dataset_path": "s3://robotics-team-data"
    },
    "ml-research": {
      "dataset_path": "s3://ml-research-data"
    },
    "engineering": {
      "dataset_path": "s3://engineering-shared"
    }
  },
  "default_bucket": "robotics"
}
```

**Workflow Usage:**

```yaml
inputs:
  - robotics/sim-data-2024      # Robotics team bucket
  - ml-research/models          # ML research bucket
  - synthetic-data              # Default bucket (robotics)
```

### **Environment-Based Buckets**

Organize by development stage:

```json
{
  "buckets": {
    "dev": {
      "dataset_path": "s3://dev-datasets"
    },
    "staging": {
      "dataset_path": "s3://staging-datasets"
    },
    "production": {
      "dataset_path": "s3://prod-datasets"
    }
  },
  "default_bucket": "dev"
}
```

### **Multi-Cloud Buckets**

Mix storage providers:

```json
{
  "buckets": {
    "aws-main": {
      "dataset_path": "s3://primary-storage"
    },
    "gcp-backup": {
      "dataset_path": "gs://backup-datasets"
    },
    "azure-archive": {
      "dataset_path": "azure://cold-storage"
    }
  },
  "default_bucket": "aws-main"
}
```

### Troubleshooting

**Bucket Not Found**
: - Verify bucket name matches exactly (case-sensitive)
  - Check bucket was added before workflow submission
  - Run `osmo bucket list` to see all registered buckets

**Access Denied Errors**
: - Ensure OSMO service has IAM credentials for the bucket
  - Verify bucket permissions allow read/write operations
  - Check bucket region matches OSMO cluster region

**Default Bucket Not Working**
: - Confirm default_bucket name matches a registered bucket
  - Verify configuration was applied: `osmo config get DATASET`
  - Check workflows use correct dataset reference format

> **Tip**
>
> **Best Practices**

> - Use descriptive bucket names (team, project, or environment)
> - Set a default bucket for the most common use case
> - Document bucket purposes and access policies for teams
> - Use separate buckets for production vs. development data
> - Consider data locality (bucket region near compute)
> - Review and clean up unused buckets quarterly

> **Note**
>
> Supported storage protocols:
> : - `s3://` (AWS S3)
>   - `gs://` (Google Cloud Storage)
>   - `azure://` (Azure Blob Storage)

#### SEE ALSO
- Learn more about datasets in OSMO at [Datasets](../../user_guide/tutorials/data/index.md#tutorials-working-with-data-datasets)
