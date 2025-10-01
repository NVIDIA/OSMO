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

.. _data_express:

========================================================
Running Distributed Data Transfer
========================================================

Example
-------

This tutorial utilizes the OSMO Data Express workflow which uses the OSMO Python Library to
perform distributed data upload/download. This is useful for transferring large amounts of data
to and from NFS storage.

This workflow does **NOT** support moving data between data storage solutions.

Currently, this workflow does **NOT** support moving **OSMO Datasets**. It is a tool for moving
data from data storage paths between workflow storage and remote storage.

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/data_express/data-express.yaml
      :language: jinja

    Create a scripts folder, if it has not been created and download
    :download:`data_utils.py <../../../samples/data_express/scripts/data_utils.py>`,
    :download:`lister.py <../../../samples/data_express/scripts/lister.py>`,
    and :download:`worker.py <../../../samples/data_express/scripts/worker.py>`
    and copy the files to the scripts folder:

    .. code-block:: bash

      $ mkdir -p <location of data-express.yaml>/scripts

    When submitting the workflow, there are several parameters that need to be set:

    .. code-block:: bash
      :substitutions:

      # The service URL to use for the workflow i.e. https://osmo.nvidia.com
      export SERVICE_URL=|osmo_url|

      # The location where data is read from. Workflow path for upload, Remote path for download:
      # i.e. input_location: "/inside/workflow/folder/path"
      # i.e. input_location: "s3://bucket/path/to/data"
      export INPUT_LOCATION=<path>

      # The location where data is uploaded/downloaded to.
      # Remote path for upload, Workflow path for download:
      # i.e. output_location: "s3://bucket/path/to/data"
      # i.e. output_location: "/inside/workflow/folder/path"
      export OUTPUT_LOCATION=<path>

      # The number of workers to use for the upload/download.
      export NUM_WORKERS=<number>

      # [Optional] The location to save the failure and benchmark results.
      # Add this parameter to the command below to save the failure and benchmark results to a remote location
      # benchmark_location=$BENCHMARK_LOCATION
      export BENCHMARK_LOCATION=<s3_path>

    Submit the workflow:

    .. code-block:: bash

      $ osmo workflow submit data-express.yaml --set service_url=$SERVICE_URL input_location=$INPUT_LOCATION output_location=$OUTPUT_LOCATION num_workers=$NUM_WORKERS
      Workflow submit successful.
          Workflow ID   - data-express-1
          Workflow Overview - |osmo_url|/workflows/data-express-1

  .. md-tab-item:: App

    When submitting the app, there are several parameters that need to be set:

    .. code-block:: bash
      :substitutions:

      # The service URL to use for the workflow i.e. https://osmo.nvidia.com
      export SERVICE_URL=|osmo_url|

      # The location where data is read from. Workflow path for upload, Remote path for download:
      # i.e. input_location: "/inside/workflow/folder/path"
      # i.e. input_location: "s3://bucket/path/to/data"
      export INPUT_LOCATION=<path>

      # The location where data is uploaded/downloaded to.
      # Remote path for upload, Workflow path for download:
      # i.e. output_location: "s3://bucket/path/to/data"
      # i.e. output_location: "/inside/workflow/folder/path"
      export OUTPUT_LOCATION=<path>

      # The number of workers to use for the upload/download.
      export NUM_WORKERS=<number>

      # [Optional] The location to save the failure and benchmark results.
      # Add this parameter to the command below to save the failure and benchmark results to a remote location
      # benchmark_location=$BENCHMARK_LOCATION
      export BENCHMARK_LOCATION=<s3_path>

    Submit the app:

    .. code-block:: bash

      $ osmo app submit data-express --set service_url=$SERVICE_URL input_location=$INPUT_LOCATION output_location=$OUTPUT_LOCATION num_workers=$NUM_WORKERS
      Workflow submit successful.
          Workflow ID   - data-express-1
          Workflow Overview - |osmo_url|/workflows/data-express-1

FAQ
-----

"Data Express does not support moving data between the data storage backends or moving data to and from local storage."
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Verify the input and output locations have one workflow storage path and one remote storage path.
Data Express will raise an exception if both the input and output locations are workflow paths or
if both are remote paths.

Data Express does not support moving data within your local device to remote/workflow storage.

Stuck in PENDING
~~~~~~~~~~~~~~~~

If the workflow is stuck in PENDING, it is likely because you have too many workers. You can try
decreasing the number of workers by decreasing the ``num_workers``, ``worker_memory``,
or ``worker_process_count`` parameters.

Decreasing each will have the following effects:

* ``num_workers``: Decrease distribution of work and could slow down the workflow.
* ``worker_memory``: Decrease the amount of memory allocated to each worker which could cause the
  worker to be evicted and the workflow to fail.
* ``worker_process_count``: Decrease the number of processes per worker which could slow down the
  workflow.

Catching Failures
~~~~~~~~~~~~~~~~~~~

If you notice any missing data, if you have added the ``benchmark_location`` parameter to the
command, the failure and benchmark results will be saved to the remote location.

Viewing `result_all.json` in the remote location should show the following:

.. code-block:: json

  {
    "total_retries": 0,
    "total_size_gib": 0.9765625,
    "failed_messages": [],
    "benchmark_results": [
      {
        "start_time_ms": 1741290915889,
        "end_time_ms": 1741290920903,
        "duration_ms": 5013,
        "average_mbps": 159,
        "total_bytes_transferred": 104857600,
        "total_number_of_files": 100,
        "chunk_number": 1
      },
      {
        "start_time_ms": 1741290951415,
        "end_time_ms": 1741290956251,
        "duration_ms": 4836,
        "average_mbps": 165,
        "total_bytes_transferred": 104857600,
        "total_number_of_files": 100,
        "chunk_number": 2
      }
    ]
  }

If there are failures, the ``failed_messages`` field will contain the messages that failed to
be uploaded/downloaded.

.. code-block:: json

  {
    "failed_messages": [
      "Boto3 Client Error: Failed to upload file: /inside/workflow/folder/path/file_1.txt"
    ]
  }
