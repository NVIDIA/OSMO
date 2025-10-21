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

.. _app_create:

================================================
Create
================================================

You can create an app with the following command:

.. code-block::

  $ osmo app create -h
  usage: osmo app create [-h] --description DESCRIPTION [--file FILE] name

  description:
    If file is not provided, the app will be created using the user's editor.

  positional arguments:
    name                  Name of the app.

  options:
    -h, --help            show this help message and exit
    --description DESCRIPTION, -d DESCRIPTION
                          Description of the app.
    --file FILE, -f FILE  Path to the app file.

  Ex. osmo app create my-app --description "My app description"


With this CLI, you will be prompted to enter the app spec which is the same as the workflow
spec with a more detailed default-values field.

.. note::

  After the CLI is ran, the app contents will be uploaded in the service and may take some time
  before the app is available to be submitted.

You can also create the app spec by providing a file containing the app spec.

For example:

.. code-block:: yaml

  workflow:
    name: {{ workflow_name }}
    tasks:
    - name: main-task-like-isaac-sim
      image: {{ image }}
      command: "sleep"
      args: ["30"]

  default-values:
    workflow_name: my-workflow-name # Name to assign to the workflow
    image: ubuntu # Image to use for the task

.. code-block:: bash
  :substitutions:

  $ osmo app create my-app --file test_file.yaml
  App my-app created successfully
