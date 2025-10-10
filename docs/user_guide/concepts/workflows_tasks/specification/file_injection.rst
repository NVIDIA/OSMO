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

.. _concepts_wf_file_injection:

================================================
File Injection
================================================

Files
======

Local files can be injected into a task's container image. You can define file contents inline
or pass a relative path. The file path must be relative to the where the spec resides.

Inline
--------------

The following example defines a file inline:

.. code-block:: yaml

  workflow:
    name: "inline-files"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]           # (1)
      files:
      - contents: |                 # (2)
          echo "Hello from task1!"
        path: /tmp/run.sh           # (3)

.. code-annotations::

  1. Executes the file as a shell script.
  2. The ``contents`` field is used to define the contents of the file.
  3. The ``path`` field is used to designate where to create this file in the task's container.


Localpath
-----------------

The following example defines a file with its relative path on the host machine:

.. code-block:: yaml

  workflow:
    name: "localpath-files"
    tasks:
    - name: task1
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - localpath: files/my_script.sh   # (1)
        path: /tmp/run.sh               # (2)

.. code-annotations::
  1. The ``localpath`` field is used to designate the path of the file on the host machine.
  2. The ``path`` field is used to designate where to create this file in the task's container.

.. warning::

  The ``localpath`` field only support files. **NOT** directories.

.. _ds_localpath:

Folder
=========

If you want to transfer a local folder to a task, you can use the ``localpath`` attribute in
the ``dataset`` input. This is useful for workflows that needs to use a large amount of local data
without the need for users to manually upload them to the cloud.

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
        name: bucket/dataset_name:1 # (1)
    - dataset:
        name: bucket/dataset_name:2 # (2)
    - dataset:
        name: bucket/dataset_name:3 # (3)
    - dataset:
        name: bucket/dataset_name:4 # (4)

.. code-annotations::

  1. The folder ``test/folder`` is uploaded to the dataset ``bucket/dataset_name:1``.
  2. The folder ``test/folder2`` is uploaded to the dataset ``bucket/dataset_name:2``.
  3. The file ``file.txt`` is uploaded to the dataset ``bucket/dataset_name:3``.
  4. The folder ``/current/workdir`` is uploaded to the dataset ``bucket/dataset_name:4``.

The uploaded datasets can be referenced in the task like so:

.. list-table:: Using Local Input Datasets (Example)
  :header-rows: 1
  :widths: auto

  * - Input
    - Reference
  * - ``test/folder``
    - ``{{input:0}}/dataset_name/folder``
  * - ``test/folder2``
    - ``{{input:1}}/dataset_name/folder2``
  * - ``file.txt``
    - ``{{input:2}}/dataset_name/file.txt``
  * - ``./``
    - ``{{input:3}}/dataset_name/workdir``
