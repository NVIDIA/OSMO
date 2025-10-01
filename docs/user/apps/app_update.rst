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

.. _app_update:

================================================
Update
================================================

You can update an app. This will **NOT** update the app in-place, but will create a new
version of the app based on the version specified to update from. This will **NOT** create a new
app. To create a new app, use :ref:`app_create`.

Anyone can edit an app.

.. code-block::

  $ osmo app update -h
  usage: osmo app update [-h] [--file FILE] name

  Update a workflow app using the user's editor.

  positional arguments:
    name                  Name of the app. Can specify a version number to edit from a specific version by using <app>:<version> format.

  options:
    -h, --help            show this help message and exit
    --file FILE, -f FILE  Path to the app file.

  Ex. osmo app update my-app


With this CLI, you will be given the latest app spec or the specified version of the app spec and
prompted to enter edits the spec. If the edited spec is the same or is empty,
the app will not be updated.

.. note::

  After the CLI is ran, the app contents will be uploaded in the service and may take some time
  before the app is available to be submitted.

.. note::

  Deleted apps can still be updated. The app spec fetched will be empty.

You can also update the app spec by providing a file containing the app spec.

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

  $ touch test_file.yaml # File containing the app spec
  $ osmo app update my-app --file test_file.yaml
  App my-app updated successfully
  Version 2

If you wanted to update from a specific version, you can do so by using the following format:

.. code-block:: bash
  :substitutions:

  $ osmo app update my-app:1 --file test_file.yaml
  App my-app updated successfully
  Version 3
