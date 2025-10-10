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

.. _app_info:

================================================
Info
================================================

You can get the info of an app:

.. code-block:: bash

  $ osmo app info -h
  usage: osmo app info [-h] [--count COUNT] [--order {asc,desc}] [--format-type {json,text}] name

  positional arguments:
  name                  Name of the app. Specify version to get info from a specific version by using <app>:<version> format.

  options:
  -h, --help            show this help message and exit
  --count COUNT, -c COUNT
                          For Datasets. Display the given number of versions. Default 100.
  --order {asc,desc}, -o {asc,desc}
                          Display in the given order. asc means latest at the bottom. desc means latest at the top
  --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  Ex. osmo app info my-app

For example:

.. code-block:: bash
  :substitutions:

  $ osmo app info my-app
  -----------------------------------------------------

  Name: my-app
  UUID: 4be7ad41e3d7476fa2ba41141e1ff219
  Owner: user@email.com
  Create Date: May 15, 2025 14:40 PDT
  Description: The is a test app for documentation.

  Version   Created By   Created Date             Status
  =======================================================
  1         testuser     May 15, 2025 14:40 PDT   READY
  2         testuser     May 15, 2025 14:50 PDT   DELETED
  3         testuser     May 15, 2025 15:04 PDT   READY
  4         testuser     May 15, 2025 15:04 PDT   PENDING
