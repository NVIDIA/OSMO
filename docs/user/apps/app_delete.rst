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

.. _app_delete:

================================================
Delete
================================================

You can delete an app by using the following command. Only the owner of the app can delete it.

.. code-block:: bash

  $ osmo app delete -h
  usage: osmo app delete [-h] [--all] [--force] name

  positional arguments:
    name         Name of the app. Specify version to delete a specific version by using <app>:<version> format.

  options:
    -h, --help   show this help message and exit
    --all, -a    Delete all versions of the app.
    --force, -f  Delete the app without user confirmation.

  Ex. osmo app delete my-app

.. note::

  After the CLI is ran, the app version will be marked as ``PENDING_DELETE`` and may take some time
  before the app is deleted.

By default, you are prompted to confirm the delete. You can use ``--force`` to bypass the prompt.

.. code-block:: bash

  Are you sure you want to delete app <app> version <version>? [y/n]:

For example:

.. code-block:: bash
  :substitutions:

  $ osmo app delete my-app
  Are you sure you want to delete app my-app version 3? [y/n]: y

  Delete Job for App my-app version 3 has been scheduled
