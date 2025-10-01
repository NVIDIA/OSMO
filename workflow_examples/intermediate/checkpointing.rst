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

.. _continuous_checkpointing_osmo_cli:

================================================
Checkpointing to Data Store
================================================

This tutorial displays how to add periodic checkpointing to your workflow.

Concepts
---------

To checkpoint data, you will need use the ``checkpoint`` field in your task spec and specify
the following parameters:

* ``path``: The local path within the task to checkpoint.
* ``url``: The remote path in the data store to checkpoint to.
* ``frequency``: Time between one checkpoint ending and the next one beginning.
* ``regex``: Regex for files to checkpoint.

.. code-block:: yaml

  tasks:
  - name: task1
    checkpoint:
    - path: /local/path/to/checkpoint
      url: s3://my-bucket/my-folder
      frequency: 30m
      regex: .*.json

Learn more about checkpointing in the :ref:`concepts_checkpointing` section.

Example
-------

This workflow demonstrates continuous checkpointing of data to cloud storage
using OSMO CLI.

The workflow:

* Creates sample data files in a local directory
* Runs a background process that periodically syncs the data to cloud storage
* Continues until all data is generated and uploaded

Parameters:

* ``upload_location``: Cloud storage URI where data will be uploaded (e.g. s3://bucket/path)
* ``checkpoint_cadence``: Time between one checkpoint ending and the next one beginning (e.g. 60s, 5m, 1h)
* ``local_path``: Local directory path where data will be generated

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/continuous_checkpointing_osmo_cli/osmo_cli.yaml
      :language: yaml

    To run the workflow, you can use the following command:

    .. code-block:: bash
      :substitutions:

      # Set the upload location to sync the data to:
      export UPLOAD_PATH_URI=<s3 location>

      $ osmo workflow submit ~/workflow_specs/data_checkpoint.yaml --set upload_location=$UPLOAD_PATH_URI
      Workflow submit successful.
          Workflow ID   - continuous-checkpointing-osmo-cli-1
          Workflow Overview - |osmo_url|/workflows/continuous-checkpointing-osmo-cli-1

  .. md-tab-item:: App

    To run the app, you can use the following command:

    .. code-block:: bash

      $ osmo app submit sample-checkpointing --set upload_location=<s3 location>

Once the workflow is done, you can download the data from ``task1``:

.. code-block:: bash
  :substitutions:

  $ osmo data download $UPLOAD_PATH_URI /tmp
