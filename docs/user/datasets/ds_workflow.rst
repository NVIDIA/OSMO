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

.. _ds_workflow:

================================================
Workflow
================================================

Datasets operate natively inside a workflow. To use datasets in your workflow, use them under the ``inputs`` and ``outputs`` tokens.

Each dataset or collection can be added as ``inputs``. The <tag/version> parameters are optional for input. If no version is specified, the latest version is picked up by default.

.. code-block:: yaml

  inputs:
    - dataset:
        name : <name> or <name>:<tag/id>

Datasets can also be an output of a task in the workflow. Multiple datasets can be output as follows.
Use ``path`` to specify the path of the files to be used for dataset creation.
The path is relative to {{output}}. If no path is specified, the entire {{output}} is uploaded as a dataset.

.. code-block:: yaml

  outputs:
    - dataset:
        name: <name>  or <name>_{{workflow_id}}
        path: <location>
    - dataset:
        name: <name>
        path: <location>

Datasets also support regex for uploading or downloading specific files. Use ``regex`` to specify the regex to use. Here are some examples:

To download all files ending with ``.txt``:

.. code-block:: yaml

  inputs:
    - dataset:
        name: <name>
        regex: .*\.txt$

To upload all files ending with ``.yaml`` or ``.json``:

.. code-block:: yaml

  outputs:
    - dataset:
        name: <name>
        regex: .*\.(yaml|json)$

To download all files that are inside the folder or subfolder ``folder``:

.. code-block:: yaml

  inputs:
    - dataset:
        name: <name>
        regex: ^(.*\/folder\/|folder\/.*)

To download all files that are inside the folder or subfolder ``folder`` ending with ``.jpg``:

.. code-block:: yaml

  inputs:
    - dataset:
        name: <name>
        regex: ^(.*\/folder\/|folder\/.*)(\.jpg)$

To add metadata to the dataset version, use the ``metadata`` field. To learn more about the file formatting, see :ref:`ds_metadata`.:

.. code-block:: yaml

  inputs:
    - dataset:
        name: <name>
        metadata:
        - path/to/metadata.yaml

To update labels to the dataset, use the ``labels`` field. To learn more about the file formatting, see :ref:`ds_labels`.:

.. code-block:: yaml

  inputs:
    - dataset:
        name: <name>
        labels:
        - path/to/labels.yaml

Users can also update a pre-existing dataset version with the task outputs to create a new version.
Use ``update_dataset`` to specify the paths in the output folder that you would like to upload.
If there is no specified path, the entire output folder will be uploaded.

.. code-block:: yaml

  outputs:
    # Upload everything
    - update_dataset:
        name: <name>
    # Upload folder "test/folder"
    - update_dataset:
        name: <name>
        paths:
        - test/folder
        metadata:
        - path/to/metadata.yaml
        labels:
        - path/to/labels.yaml

Users can also specify where the path will be uploaded relative to the root folder. To learn more, go to :ref:`ds_update`.

.. code-block:: yaml

  outputs:
    - update_dataset:
        name: <name>
        paths:
        - test/folder:relative/remote/folder

.. note::

  The ``update`` field does not support using ``regex``.


.. _ds_localpath:

Local Inputs
============

Local file and directory inputs are also supported for workflows through datasets. This is useful
for workflows that needs to use local data without the need for users to manually
upload them to the cloud.

To provide a local file or directory as an input, use the ``localpath`` attribute in the dataset input:

.. code-block:: yaml

  inputs:
    - dataset:
        name : <name>
        localpath: <path>

The ``localpath`` attribute can be a file or a directory. If it is a directory, all files within
the directory will be uploaded to the dataset.

If the workflow is defined as follows:

.. code-block:: yaml

  tasks:
  - name: task-name
    ...
    inputs:
      - dataset:
          name: bucket/dataset_name
          localpath: test/folder
      - dataset:
          name: bucket/dataset_name
          localpath: test/folder2
      - dataset:
          name: bucket/dataset_name
          localpath: file.txt
      - dataset:
          name: bucket/dataset_name
          localpath: ./               # Current directory (e.g. /current/workdir)

the final workflow specification will be:

.. code-block:: yaml

  tasks:
  - name: task-name
    ...
    inputs:
      - dataset:
          name: bucket/dataset_name:1 # Contains folder
      - dataset:
          name: bucket/dataset_name:2 # Contains folder2
      - dataset:
          name: bucket/dataset_name:3 # Contains file.txt
      - dataset:
          name: bucket/dataset_name:4 # Contains workdir

The uploaded datasets can be referenced in the task like so:

.. list-table:: Using Local Input Datasets (Example)
   :widths: 40 40
   :header-rows: 1

   * - Input
     - Reference
   * - ``bucket/dataset_name:1``, ``test/folder``
     - ``{{input:0}}/dataset_name/folder``
   * - ``bucket/dataset_name:2``, ``test/folder2``
     - ``{{input:1}}/dataset_name/folder2``
   * - ``bucket/dataset_name:3``, ``file.txt``
     - ``{{input:2}}/dataset_name/file.txt``
   * - ``bucket/dataset_name:4``, ``./``
     - ``{{input:3}}/dataset_name/workdir``
