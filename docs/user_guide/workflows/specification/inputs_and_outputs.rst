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

.. _workflow_spec_inputs_and_outputs:

================================================
Inputs and Outputs
================================================

.. _workflow_spec_inputs:

Inputs
======

An input is a source of data to be downloaded into the task's input directory.
There are 2 types of inputs supported:

* ``task``:  Specifies the upstream task that the current task depends on. The task dependency
  implies that the current task cannot be scheduled until the upstream task has ``COMPLETED``.
  All files uploaded from the upstream tasks' output directory will be downloaded.
* ``url``: Downloads files from an external object storage bucket using a URI.
  Learn more about the URI syntax at :ref:`Storage URLs <tutorials_working_with_data_storage_urls>`.

For example:

.. code-block:: yaml

  workflow:
    name: "input-example"
    tasks:
    - name: task1
      inputs:
      - url: s3://bucket/path       # (1)
      ...
    - name: task2
      inputs:
      - task: task1                 # (2)
      ...

.. code-annotations::

  1. Downloads the files from URI ``s3://bucket/path``.
  2. Downloads the files outputted by ``task1``.

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

These inputs can be referenced in the task using :ref:`workflow_spec_special_tokens`.

.. _workflow_spec_outputs:

Outputs
=========

An output folder is uploaded once the task has finished. To define a task output, use the
**outputs** field when defining a task. Outputs are uploaded to an external object storage
bucket using ``url``:

* ``url``: Upload files to an external object storage bucket using a URI.
  Learn more about the URI syntax at :ref:`Storage URLs <tutorials_working_with_data_storage_urls>`.

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

.. code-annotations::

  1. Uploads the files to the URI ``s3://bucket/path``.

``url`` allows for regex filtering on what to include. For example, a filter to only include
``.txt`` files:

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

On how to specify which files to be uploaded, go to :ref:`workflow_spec_templates_and_special_tokens`.
