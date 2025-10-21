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

.. _app_rename:

================================================
Rename
================================================

You can rename an app with the following command:

.. code-block::

  $ osmo app rename -h
  usage: osmo app rename [-h] [--force] original_name new_name

  Rename a workflow app from the original name to a new name.

  positional arguments:
    original_name          Original name of the app.
    new_name              New name for the app.

  options:
    -h, --help            show this help message and exit
    --force, -f           Rename the app without user confirmation.

  Ex. osmo app rename old-app-name new-app-name

The rename command allows you to change the name of an existing app. You can only rename apps that you own.

.. note::

  App names are global across the system. If an app with the new name already exists,
  the rename operation will fail.

Examples:

.. code-block:: bash
  :substitutions:

  # Basic rename with confirmation
  $ osmo app rename my-old-app my-new-app
  Are you sure you want to rename App my-old-app to my-new-app? (y/N): y
  App my-old-app renamed to my-new-app successfully.

  # Force rename without confirmation
  $ osmo app rename my-old-app my-new-app --force
  App my-old-app renamed to my-new-app successfully.

  # Rename with different naming convention
  $ osmo app rename training-app-1 training-app-v2
  Are you sure you want to rename App training-app-1 to training-app-v2? (y/N): y
  App training-app-1 renamed to training-app-v2 successfully.
