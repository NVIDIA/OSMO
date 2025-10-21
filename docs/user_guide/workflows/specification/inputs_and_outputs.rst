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

.. _concepts_wf_inputs_and_outputs:

================================================
Inputs and Outputs
================================================

.. _concepts_wf_inputs:

Inputs
======

An input is a source of data to be downloaded into the task's input directory.
There are 3 types of inputs supported:

* ``task``:  Specifies the upstream task that the current task depends on. The task dependency
  implies that the current task cannot be scheduled until the upstream task has ``COMPLETED``.
  All files uploaded from the upstream tasks' output directory will be downloaded.
* ``url``: Downloads files from an external object storage bucket using a URI.
  Learn more about the URI syntax at :ref:`concepts_uri`.
* ``dataset``: Downloads the files from a dataset. Learn more about datasets at :ref:`concepts_ds`.

.. note::

  ``dataset`` can also be used to download the user's local files/directories with the ``localpath``
  attribute. For more information, see :ref:`concepts_wf_file_injection`.

For example:

.. code-block:: yaml

  workflow:
    name: "input-example"
    tasks:
    - name: task1
      inputs:
      - url: s3://bucket/path       # (1)
      - dataset:
          name: workflow_example    # (2)
      ...
    - name: task2
      inputs:
      - task: task1                 # (3)
      ...

.. code-annotations::

  1. Downloads the files from URI ``s3://bucket/path``.
  2. Downloads the files from the dataset ``workflow_example``.
  3. Downloads the files outputted by ``task1``.

All inputs types also allow for regex filtering on what to include. For example, a filter to only
include ``.txt`` files:

.. code-block:: yaml

  workflow:
    name: "input-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      inputs:
      - task: task1
        regex: .*\.txt$
      - url: s3://bucket/path
        regex: .*\.txt$
      - dataset:
          name: workflow_example
          regex: .*\.txt$

These inputs can be referenced in the task using :ref:`concepts_special_tokens`.

Dataset
-------

Dataset and collection inputs has the additional fields:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Field**
    - **Description**
  * - name
    - The name of the dataset/collection.
  * - regex
    - A regex to filter the files to download.
  * - localpath
    - When this is specified, this path is taken from the user's local machine and uploaded as
      a dataset to be downloaded in the task. Learn more about localpath at :ref:`concepts_wf_file_injection`.

Examples of some regex usage:

.. code-block:: yaml

  inputs:
  - dataset:
      name: my_dataset
      regex: .*\.txt$ # (1)
  - dataset:
      name: my_dataset
      regex: .*\.(yaml|json)$ # (2)
  - dataset:
      name: my_dataset
      regex: ^(.*\/my_folder\/|my_folder\/.*) # (3)
  - dataset:
      name: my_dataset
      regex: ^(.*\/my_folder\/|my_folder\/.*)(\.jpg)$ # (4)

.. code-annotations::

  1. Downloads all files ending with ``.txt``.
  2. Downloads all files ending with ``.yaml`` or ``.json``.
  3. Downloads all files inside the folder or subfolder ``my_folder``.
  4. Downloads all files inside the folder or subfolder ``my_folder`` ending with ``.jpg``.

.. _concepts_wf_outputs:

Outputs
=========

An output folder is uploaded once the task has finished.
To define a task output, use the **outputs** field when defining a task. There are three
types of supported output types:

* ``url``: Upload files to an external object storage bucket using a URI.
  Learn more about the URI syntax at :ref:`concepts_uri`.
* ``dataset``: Uploads the files to a dataset. Learn more about datasets at :ref:`concepts_ds`.
* ``update_dataset``: Creates a new dataset version with the combined files from the task's
  output folder and the existing dataset version. Learn more about datasets at :ref:`concepts_ds_update`.

For example:

.. code-block:: yaml

  workflow:
    name: "output-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      outputs:
      - url: s3://bucket/path       # (1)
      - dataset:
          name: workflow_example    # (2)
      - update_dataset:
          name: workflow_example:1  # (3)

.. code-annotations::

  1. Uploads the files to the URI ``s3://bucket/path``.
  2. Uploads the files to the dataset ``workflow_example``.
  3. Creates a new dataset version with the combined files from the task's
     output folder and the existing dataset version ``workflow_example:1``.

``url`` and ``dataset`` types allow for regex filtering on what to include. For example,
a filter to only include ``.txt`` files:

.. code-block:: yaml

  workflow:
    name: "output-example"
    tasks:
    - name: task1
      image: ubuntu
      command: [echo]
      args: ["Hello!"]
      outputs:
      - url: s3://bucket/path
        regex: .*\.txt$
      - dataset:
          name: workflow_example
          regex: .*\.txt$

On how to specify which files to be uploaded, go to :ref:`concepts_special_tokens`.

Dataset
-------

``dataset`` has the additional fields:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Field**
    - **Description**
  * - name
    - The name of the dataset/collection.
  * - path
    - A relative path from ``{{output}}`` to upload. If no path is specified, the entire output folder will be uploaded.
  * - regex
    - A regex to filter the files to upload.
  * - metadata
    - A list of metadata files to apply to the dataset version. Learn more at :ref:`concepts_ds_labels_and_metadata`.
  * - labels
    - A list of labels files to apply to the dataset. Learn more at :ref:`concepts_ds_labels_and_metadata`.

``update_dataset`` has the additional fields:

..  list-table::
  :header-rows: 1
  :widths: auto

  * - **Field**
    - **Description**
  * - name
    - The name of the dataset/collection.
  * - path
    - A relative path from ``{{output}}`` to upload. If no path is specified, the entire output folder will be uploaded.
  * - metadata
    - A list of metadata files to apply to the dataset version. Learn more at :ref:`concepts_ds_labels_and_metadata`.
  * - labels
    - A list of labels files to apply to the dataset. Learn more at :ref:`concepts_ds_labels_and_metadata`.

.. note::

  The ``update_dataset`` field does not support using ``regex``.

An example of how to use the ``metadata`` and ``labels`` fields:

.. code-block:: yaml

  outputs:
  - dataset:
      name: my_dataset
      metadata:
      - path/to/metadata.yaml
      labels:
      - path/to/labels.yaml
