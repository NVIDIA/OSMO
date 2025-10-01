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

.. _app_show:

================================================
Show
================================================

You can find out what the parameters are for an app:

.. code-block:: bash

  $ osmo app show -h
  usage: osmo app show [-h] name

  positional arguments:
    name        Name of the app. Specify version to get info from a specific version by using <app>:<version> format.

  options:
    -h, --help  show this help message and exit

For example:

.. code-block:: bash
  :substitutions:

  $ osmo app show my-app
  DESCRIPTION
    The is a test app for documentation.

  PARAMETERS
    workflow_name: my-workflow-name # Name to assign to the workflow
    image: ubuntu # Image to use for the task
