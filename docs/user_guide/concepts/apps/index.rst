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

.. _apps:

================================================
Creating Apps
================================================

Apps allow you to create an easy to launch "application" from a parameterized workflow template.
Users can launch apps without needing to know the details of the underlying workflow specification.

With workflows, the workflow file is saved on a your local machine and has to be manually shared to
other users. With apps, the workflow file is saved in OSMO and other users can access it.
This allows for more efficient collaboration and sharing of workflows.

The main differences between workflows and apps are:

* App default values can be defined in the app spec ``osmo app spec`` so you can know what to
  set using the ``osmo app show`` command. For example:

.. code-block:: bash

  $ osmo app spec my-app
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

  $ osmo app show my-app
  DESCRIPTION
    The is a test app for documentation.

  PARAMETERS
    workflow_name: my-workflow-name
    image: ubuntu

* Since apps are not saved locally, you can specify a local path for paths referenced in the
  app spec.

.. code-block:: bash

  $ osmo app spec my-example-app
  workflow:
    name: example-workflow
    tasks:
    - name: example-task
      image: ubuntu
      resource: default
      args: ['/tmp/script.sh']
      command: ['/bin/bash']
      files:
      - localpath: scripts/script.sh
        path: /tmp/script.sh

  $ ls /folder
  scripts

  $ osmo app submit my-example-app --local-path /folder
  Workflow submit successful.
    Workflow ID        - example-workflow-1
    Workflow Overview  - |osmo_url|/workflows/example-workflow-1
    Workflow Dashboard - |osmo_url|/backend-dashboard/#/search?namespace=_all&q=vsoalgepxjbv7egb6ljml6ng4m


App names are global. So if you have already created an app with the name
``my-app``, another user can **NOT** create an app with the same name.


.. toctree::
  :glob:
  :maxdepth: 1

  app_create
  app_update
  app_info
  app_show
  app_spec
  app_list
  app_delete
  app_submit
  app_rename
