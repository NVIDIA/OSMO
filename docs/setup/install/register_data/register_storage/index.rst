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

.. _ds_bucket:

=============================
Register Data Storage
=============================

Follow below steps to register your Data storage bucket with OSMO

Workflow Logs
===============

To configure where the workflow spec/log storage location, run the following command:

.. code-block:: bash

  # URI of your s3 bucket e.g. s3://my_bucket
  BACKEND_URI=...

  ACCESS_KEY_ID=...
  ACCESS_KEY=...

  # Bucket Region
  REGION=...

  echo '{
    "workflow_log": {
        "credential": {
            "endpoint": "'$BACKEND_URI'",
            "access_key_id": "'$ACCESS_KEY_ID'",
            "access_key": "'$ACCESS_KEY'",
            "region": "'$REGION'"
        }
    }
  }' > /tmp/workflow_log_config.json

Then, update the workflow configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update WORKFLOW --file /tmp/workflow_log_config.json


Workflow Data
========================

To configure where the intermediate data storage location, run the following command:

.. code-block:: bash

  # URI of your s3 bucket e.g. s3://my_bucket
  BACKEND_URI=...

  ACCESS_KEY_ID=...
  ACCESS_KEY=...

  # Bucket Region
  REGION=...

  echo '{
    "workflow_data": {
        "credential": {
            "endpoint": "'$BACKEND_URI'",
            "access_key_id": "'$ACCESS_KEY_ID'",
            "access_key": "'$ACCESS_KEY'",
            "region": "'$REGION'"
        }
    }
  }' > /tmp/workflow_data_config.json

Then, update the workflow data configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update WORKFLOW --file /tmp/workflow_data_config.json


Workflow App
========================

To configure where the workflow app storage location, run the following command:

.. code-block:: bash

  # URI of your s3 bucket e.g. s3://my_bucket
  BACKEND_URI=...

  ACCESS_KEY_ID=...
  ACCESS_KEY=...

  # Bucket Region
  REGION=...

  echo '{
    "workflow_app": {
        "credential": {
            "endpoint": "'$BACKEND_URI'",
            "access_key_id": "'$ACCESS_KEY_ID'",
            "access_key": "'$ACCESS_KEY'",
            "region": "'$REGION'"
        }
    }
  }' > /tmp/workflow_app_config.json

Then, update the workflow app configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update WORKFLOW --file /tmp/workflow_app_config.json


.. note::

  Without completing this setup, OSMO app APIs will not work. Ensure you have configured the workflow data and workflow app storage locations as described above before using any OSMO app commands or APIs.


Datasets
==============

With the URI, decide on a name for the URI which will be OSMO's reference. For example, if the name is ``decided_name``,
datasets which are placed in that bucket will be referenced by ``decided_name/dataset_name``.

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


Once the bucket has been added to OSMO, verify the installation using ``osmo bucket list``.

.. code-block:: bash
  :substitutions:

  $ osmo bucket list

  Bucket               Location
  ============================================
  my_bucket (default)  s3://my_bucket_location
