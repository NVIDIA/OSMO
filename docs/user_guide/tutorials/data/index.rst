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
    - url: s3://my-bucket/inputs/             # ← Downloads here
    outputs:
    - url: s3://my-bucket/outputs/            # ← Uploads here

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

.. literalinclude:: ../../../../cookbook/tutorials/data_upload.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Files from ``{{output}}`` are uploaded to the S3 bucket after task completion.

Downloading Data
----------------

Download data directly from cloud storage using URLs:

.. literalinclude:: ../../../../cookbook/tutorials/data_download.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Access downloaded files at ``{{input:0}}/``.
  2. Files are downloaded from S3 before the task starts.

Filtering Data
==============

Filter which files to download or upload using regex patterns:

.. literalinclude:: ../../../../cookbook/tutorials/data_filter.yaml
  :language: yaml
  :start-after: SPDX-License-Identifier: Apache-2.0

.. code-annotations::

  1. Only download ``.txt`` files from the input.
  2. Only upload ``.json`` and ``.yaml`` files to the output.

Next Steps
==========

Now that you understand data management, you're ready to build more complex workflows.
Continue to :ref:`Serial Workflows <tutorials_serial_workflows>` to learn about task dependencies.

.. seealso::

  - :ref:`Inputs and Outputs Reference <workflow_spec_inputs_and_outputs>`
  - :ref:`File Injection <workflow_spec_file_injection>`
