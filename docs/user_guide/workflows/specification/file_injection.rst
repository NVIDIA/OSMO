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

.. _workflow_spec_file_injection:

================================================
File Injection
================================================

Files
======

Local files can be injected into a task's container image. You can define file contents inline
or pass a relative path. The file path must be relative to the where the spec resides.

.. note::

  File injection is not supported when submitting a workflow through the **UI**. Please use the CLI to submit workflows with local files.
  For more information, see :ref:`submit_cli`.

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

  The ``localpath`` field only supports files. **NOT** directories.

Directory Inputs
================

OSMO does not upload local directories during workflow submission.

For large inputs, place the data in external object storage and reference it with ``url`` in
``inputs``, or produce it in an upstream task and consume it through a ``task`` dependency.

.. seealso::

  - See :ref:`workflow_spec_inputs_and_outputs` for supported ``task`` and ``url`` data flows.
  - See :ref:`submit_cli` for CLI-only features that remain supported during submission.
