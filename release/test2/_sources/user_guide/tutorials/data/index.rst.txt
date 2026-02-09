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

.. _tutorials_working_with_data:

=================
Working with Data
=================

OSMO makes it easy to upload and download data for your workflows. This tutorial will cover:

* How data is used :ref:`inside a workflow <tutorials_working_with_data_inside_a_workflow>`.
* How to work with :ref:`storage URLs <tutorials_working_with_data_storage_urls>`
* How to work with :ref:`datasets <tutorials_working_with_data_datasets>`

.. admonition:: Prerequisites
  :class: important

  Before you start, please make sure you have configured your data credentials.
  See :ref:`credentials_data` for more details.

.. hint::

  The examples below demonstrate reading and writing from remote storage. Please replace any URLs
  with your own storage URLs.

.. _tutorials_working_with_data_inside_a_workflow:

Inside a Workflow
=================

OSMO provides two directories for data management in every task:

.. code-block:: text

   /osmo/
   ├── input/              ← Read input data here
   │   ├── 0/
   │   └── 1/
   └── output/             ← Write results here
       └── (user outputs)

**How it works:**

1. **Before task starts** → OSMO downloads data specified in ``inputs:`` to ``/osmo/input/``
2. **During task execution** → Your code reads from ``{{input:#}}/``
3. **After task completes** → OSMO uploads ``/osmo/output/`` to locations specified in ``outputs:``

**Example:**

.. code-block:: yaml

  tasks:
  - name: process
    command: ["bash", "-c"]
    args:
    - |
      cat {{input:0}}/data.txt                # Reads the first input
      echo "Result" > {{output}}/result.txt   # Write output
    
    inputs:
    - dataset: {name: my_data}     # ← Downloads here
    outputs:
    - dataset: {name: my_results}  # ← Uploads here

.. seealso::

  The above explains the fundamentals of how a workflow can read/write data. For more details on
  how **data flows between tasks** in a workflow, see :ref:`tutorials_serial_workflows`.

.. _tutorials_working_with_data_storage_urls:

Storage URLs
============

URL Patterns
------------

.. include:: supported_data_urls.in.rst

Uploading Data
--------------

Upload data directly to cloud storage (S3, GCS, Azure) using URLs:

.. literalinclude:: ../../../../workflows/tutorials/data_upload.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Files from ``{{output}}`` are uploaded to the S3 bucket after task completion.

Downloading Data
----------------

Download data directly from cloud storage using URLs:

.. literalinclude:: ../../../../workflows/tutorials/data_download.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Access downloaded files at ``{{input:0}}/``.
  2. Files are downloaded from S3 before the task starts.

.. _tutorials_working_with_data_datasets:

Datasets
========

.. seealso::

  Before you start, please make sure you have set a :ref:`profile_default_dataset_bucket`.

What is a Dataset?
------------------

.. important::

  A **dataset** is a versioned collection of files managed by OSMO. Datasets persist beyond
  workflow execution and can be shared across workflows and teams.

**Key characteristics:**

* Datasets are versioned - each upload creates a new version
* Content-addressed for efficient storage and deduplication
* Accessible via CLI, workflows, and Web UI
* Support filtering and metadata

.. dropdown:: Dataset Naming Convention
  :color: primary
  :icon: info

  Datasets use the pattern ``dataset_name:version``:

  * ``training_data`` - Latest version
  * ``training_data:v1`` - Specific version
  * ``training_data:baseline`` - Named version

Uploading a Dataset
-------------------

To upload a dataset from a workflow task, write files to the ``{{output}}`` directory and
specify a :kbd:`dataset` in the outputs:

.. literalinclude:: ../../../../workflows/tutorials/dataset_upload.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Everything in ``{{output}}`` is uploaded to ``my_dataset`` after the task completes successfully.

Once uploaded, you can download a dataset to your local machine using the CLI:

.. code-block:: bash

  # Download latest version
  $ osmo dataset download my_dataset /tmp

  # Download specific version
  $ osmo dataset download my_dataset:1 /tmp

Downloading a Dataset
---------------------

To download a dataset in a workflow, add it to the task's inputs. To reference the dataset, use the
:ref:`workflow_spec_special_tokens` ``{{input:#}}`` where # is the zero-based index of the input.

.. literalinclude:: ../../../../workflows/tutorials/dataset_download.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Access the dataset at ``{{input:0}}/my_dataset/`` where ``{{input:0}}`` is the first input.
  2. The dataset is downloaded before the task starts.

Combining URLs and Datasets
===========================

You can mix URLs and datasets in the same workflow:

.. literalinclude:: ../../../../workflows/tutorials/data_and_dataset_combined.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Download from OSMO dataset at ``{{input:0}}/my_dataset/``.
  2. Download from S3 at ``{{input:1}}/``.
  3. Upload to OSMO dataset.
  4. Also upload to S3 bucket.

Filtering Data
==============

Filter which files to download or upload using regex patterns:

.. literalinclude:: ../../../../workflows/tutorials/data_filter.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Only download ``.txt`` files from the input dataset.
  2. Only upload ``.json`` and ``.yaml`` files to the output dataset.

Next Steps
==========

Now that you understand data management, you're ready to build more complex workflows.
Continue to :ref:`Serial Workflows <tutorials_serial_workflows>` to learn about task dependencies.

.. seealso::

  - :ref:`Inputs and Outputs Reference <workflow_spec_inputs_and_outputs>`
  - :ref:`File Injection <workflow_spec_file_injection>`
