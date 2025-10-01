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

.. _app_list:

================================================
List
================================================

You can get the list of apps you have created, updated, or submitted:

.. code-block:: bash

  $ osmo app list -h
  usage: osmo app list [-h] [--name NAME] [--user USER [USER ...]] [--all-users] [--count COUNT] [--order {asc,desc}] [--format-type {json,text}]

  Lists all apps you created, updated, or submitted by default.

  options:
    -h, --help            show this help message and exit
    --name NAME, -n NAME  Display apps that have the given substring in their name
    --user USER [USER ...], -u USER [USER ...]
                          Display all app where the user has created.
    --all-users, -a       Display all apps with no filtering on users
    --count COUNT, -c COUNT
                          Display the given number of apps. Default 20.
    --order {asc,desc}, -o {asc,desc}
                          Display in the given order. asc means latest at the bottom. desc means latest at the top
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text)

For example:

.. code-block:: bash
  :substitutions:

  $ osmo app list
  Owner      Name     Description                                Created Date             Latest Version
  ======================================================================================================
  user       ssh      Runs a workflow meant to test ssh.         May 15, 2025 14:40 PDT   5
  user       train    Runs a workflow meant to run training.     May 19, 2025 13:32 PDT   2
  user       serial   Runs a workflow with serial tasks.         May 19, 2025 13:38 PDT   1
