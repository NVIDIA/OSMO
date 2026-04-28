..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _dataset_buckets:

===============
Dataset Buckets
===============

Register external cloud storage buckets (S3, GCS, Azure) with OSMO to organize datasets across multiple storage locations (This configuration is optional)

Why Use Dataset Buckets?
=========================

Multiple dataset buckets provide flexible data management for OSMO datasets:

✓ **Automatic Deduplication**
  Content-addressed storage means identical files are stored only once across versions, saving storage costs and transfer time.

✓ **Version Control**
  Full version history for datasets—track changes, rollback to previous versions, and maintain reproducible workflows.

✓ **Organize by Team or Project**
  Separate datasets across different buckets for access control, billing, or organizational boundaries.

✓ **Use Existing Infrastructure**
  Register pre-existing S3/GCS/Azure buckets without migrating data—integrate seamlessly with existing storage.

✓ **Multi-Cloud Support**
  Mix storage providers (AWS S3, Google Cloud Storage, Azure Blob) in the same OSMO deployment.

✓ **Simplified References**
  Use short names (e.g., ``production/model-v2``) instead of full URIs (``s3://long-bucket-name/model-v2``).

✓ **Persistent & Shareable**
  Datasets persist beyond workflow execution and can be shared across workflows, teams, and accessed via CLI, workflows, or Web UI.


How It Works
============

Bucket Registration
-------------------

.. grid:: 3
    :gutter: 2

    .. grid-item-card::
        :class-header: sd-bg-info sd-text-white

        **1. Register Bucket** 🪣
        ^^^

        Add cloud storage

        +++

        Map name to URI (S3, GCS, Azure)

    .. grid-item-card::
        :class-header: sd-bg-primary sd-text-white

        **2. Set Default** ⭐
        ^^^

        Choose primary bucket

        +++

        Users reference without prefix

    .. grid-item-card::
        :class-header: sd-bg-success sd-text-white

        **3. Use in Workflows** 🔗
        ^^^

        Reference datasets

        +++

        Usage: ``bucket-name/dataset-name``

Bucket Naming
-------------

Once registered with a bucket name (say ``production``), datasets in that bucket are referenced as:

- ``production/imagenet``
- ``production/resnet50``

If the bucket is set as the default bucket, datasets can be referenced without the bucket name prefix:

- ``imagenet``
- ``resnet50``

Practical Guide
===============

.. include:: ../_shared/configmap_banner.rst

Registering Buckets
-------------------

**Step 1: Register a Single Bucket**

Add your first cloud storage bucket under ``services.configs.dataset.buckets``:

.. code-block:: yaml

  services:
    configs:
      enabled: true
      dataset:
        buckets:
          production:
            dataset_path: s3://my-production-bucket
            region: us-east-1
            mode: read-write

**Step 2: Register Multiple Buckets**

Add buckets from different cloud providers:

.. code-block:: yaml

  services:
    configs:
      dataset:
        buckets:
          production:
            dataset_path: s3://prod-datasets
            region: us-east-1
            mode: read-write
          staging:
            dataset_path: s3://staging-datasets
            region: us-east-1
            mode: read-write
          research:
            dataset_path: gs://research-bucket
            region: us-central1
            mode: read-write
          archive:
            dataset_path: azure://archive-storage
            region: eastus
            mode: read-only
        default_bucket: production

**Step 3: Attach Credentials (Optional)**

If a bucket requires credentials, create a Kubernetes Secret with one credential field per key and reference it via ``default_credential.secretName``:

.. code-block:: bash

  kubectl create secret generic prod-bucket-cred \
      --from-literal=access_key_id=<your-access-key-id> \
      --from-literal=access_key=<your-secret-access-key>

.. code-block:: yaml

  services:
    configs:
      secretRefs:
        - secretName: prod-bucket-cred
      dataset:
        buckets:
          production:
            dataset_path: s3://prod-datasets
            region: us-east-1
            mode: read-write
            default_credential:
              secretName: prod-bucket-cred

Buckets that rely on workload identity (IRSA, Pod Identity) or public read-only access can leave ``default_credential`` as ``null``.

**Step 4: Apply**

.. code-block:: bash

  helm upgrade osmo deployments/charts/service -f my-values.yaml

**Step 5: Verify Configuration**

List all registered buckets:

.. code-block:: bash

  $ osmo bucket list

  Bucket               Location
  ============================================
  production (default) s3://prod-datasets
  staging              s3://staging-datasets
  research             gs://research-bucket
  archive              azure://archive-storage


Usage Examples
--------------

.. dropdown:: **Team-Based Buckets**
    :color: info
    :icon: people

    Separate datasets by team or department:

    .. code-block:: yaml

      services:
        configs:
          dataset:
            buckets:
              robotics:
                dataset_path: s3://robotics-team-data
                region: us-east-1
                mode: read-write
              ml-research:
                dataset_path: s3://ml-research-data
                region: us-east-1
                mode: read-write
              engineering:
                dataset_path: s3://engineering-shared
                region: us-east-1
                mode: read-write
            default_bucket: robotics

    **Workflow Usage:**

    .. code-block:: yaml

      inputs:
        - robotics/sim-data-2024      # Robotics team bucket
        - ml-research/models          # ML research bucket
        - synthetic-data              # Default bucket (robotics)

.. dropdown:: **Environment-Based Buckets**
    :color: info
    :icon: gear

    Organize by development stage:

    .. code-block:: yaml

      services:
        configs:
          dataset:
            buckets:
              dev:
                dataset_path: s3://dev-datasets
                region: us-east-1
                mode: read-write
              staging:
                dataset_path: s3://staging-datasets
                region: us-east-1
                mode: read-write
              production:
                dataset_path: s3://prod-datasets
                region: us-east-1
                mode: read-write
            default_bucket: dev

.. dropdown:: **Multi-Cloud Buckets**
    :color: info
    :icon: cloud

    Mix storage providers:

    .. code-block:: yaml

      services:
        configs:
          dataset:
            buckets:
              aws-main:
                dataset_path: s3://primary-storage
                region: us-east-1
                mode: read-write
              gcp-backup:
                dataset_path: gs://backup-datasets
                region: us-central1
                mode: read-write
              azure-archive:
                dataset_path: azure://cold-storage
                region: eastus
                mode: read-only
            default_bucket: aws-main


Troubleshooting
---------------

**Bucket Not Found**
  - Verify bucket name matches exactly (case-sensitive)
  - Check bucket was added before workflow submission
  - Run ``osmo bucket list`` to see all registered buckets

**Access Denied Errors**
  - Ensure the referenced Secret exists and ``secretName`` is listed in ``secretRefs``
  - Verify bucket permissions allow read/write operations
  - Check bucket region matches OSMO cluster region

**Default Bucket Not Working**
  - Confirm default_bucket name matches a registered bucket
  - Verify configuration was applied: ``osmo config get DATASET``
  - Check workflows use correct dataset reference format

.. tip::

   **Best Practices**

   - Use descriptive bucket names (team, project, or environment)
   - Set a default bucket for the most common use case
   - Document bucket purposes and access policies for teams
   - Use separate buckets for production vs. development data
   - Consider data locality (bucket region near compute)
   - Review and clean up unused buckets quarterly

.. note::

   Supported storage protocols:
    - ``s3://`` (AWS S3)
    - ``gs://`` (Google Cloud Storage)
    - ``azure://`` (Azure Blob Storage)
