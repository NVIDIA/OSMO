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

.. _dataset_buckets:

===============
Dataset Buckets
===============

Datasets are optional and are used if users have preexisting data buckets or want to store data in isolated buckets. This option allows users to register that bucket with osmo and use our datasets concept to manage their data.

With the URI, decide on a name for the URI which will be OSMO's reference. For example, if the name is ``decided_name``,
datasets which are placed in that bucket will be referenced by ``decided_name/dataset_name``.

Configure Dataset Buckets
==========================

Create the configuration of the new bucket with the following command:

.. code-block:: bash

  # Name of Bucket
  BUCKET_NAME=...

  # URI of your s3 bucket e.g. s3://my_bucket
  BACKEND_URI=...

  echo '{
    "buckets": {
        "'$BUCKET_NAME'": {
            "dataset_path": "'$BACKEND_URI'"
        }
    }
  }' > /tmp/dataset_config.json

Then, update the dataset configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update DATASET --file /tmp/dataset_config.json


If there are multiple buckets to be included, add each bucket to the dictionary of buckets in ``buckets``.
For example, if there were two buckets, the json would look like:

.. code-block:: json
  :class: no-copybutton

  {
    "buckets": {
        "bucket1": {
            "dataset_path": "s3://bucket1"
        },
        "bucket2": {
            "dataset_path": "gs://bucket2"
        }
    }
  }

Set Default Bucket
==================

For example, if the bucket name is ``my_bucket`` and the URI is ``s3://my_bucket``:

If this bucket will be the default bucket users will use, create this configuration:

.. code-block:: bash

  # Name of Bucket
  BUCKET_NAME=...

  echo '{
    "default_bucket": "'$BUCKET_NAME'"
  }' > /tmp/dataset_default_bucket_config.json

Then, update the dataset configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update DATASET --file /tmp/dataset_default_bucket_config.json


Verify Configuration
====================

Once the bucket has been added to OSMO, verify the installation using ``osmo bucket list``.

.. code-block:: bash
  :substitutions:

  $ osmo bucket list

  Bucket               Location
  ============================================
  my_bucket (default)  s3://my_bucket_location

