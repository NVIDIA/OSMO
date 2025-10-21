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

.. _app_submit:

================================================
Submit
================================================

You can submit an app as a workflow using the following command:

.. code-block:: bash

  $ osmo app submit -h
  usage: osmo app submit [-h] [--format-type {json,text}] [--set SET [SET ...]] [--set-string SET_STRING [SET_STRING ...]] [--dry-run] [--pool POOL] [--local-path LOCAL_PATH]
                        [--rsync RSYNC] [--priority {HIGH,NORMAL,LOW}]
                        name

  positional arguments:
    name                  Name of the app. Specify version to submit a specific version by using <app>:<version> format.

  options:
    -h, --help            show this help message and exit
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).
    --set SET [SET ...]   Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section.
                          Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable
    --set-string SET_STRING [SET_STRING ...]
                          Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section.
                          Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string
    --set-env SET_ENV [SET_ENV ...]
                          Assign environment variables to the workflow. The value should be in the format <key>=<value>. Multiple key-value pairs can be passed. If an environment variable passed here is already defined in the workflow, the value declared here will
                          override the value in the workflow.
    --dry-run             Does not submit the workflow and prints the workflow into the console.
    --pool POOL, -p POOL  The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.
    --local-path LOCAL_PATH, -l LOCAL_PATH
                          The absolute path to the location for where local files in the workflow file should be fetched from. If not specified, the current working directory will be
                          used.
    --rsync RSYNC         Start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow. The value should be in the format
                          <local_path>:<remote_path>. The daemon process will automatically exit when the workflow is terminated.
    --priority {HIGH,NORMAL,LOW}
                          The priority to use when scheduling the workflow. If none is provided, NORMAL will be used. The scheduler will prioritize scheduling workflows in the order of
                          HIGH, NORMAL, LOW. LOW workflows may be preempted to allow a higher priority workflow to run.

An example of submitting a workflow spec is shown below:

.. code-block:: bash
  :substitutions:

  $ osmo app submit my-app --set workflow_name="my-workflow"
  Workflow submit successful.
      Workflow ID        - my-workflow-1
      Workflow Overview  - |osmo_url|/workflows/my-workflow-1
      Workflow Dashboard - |osmo_url|/backend-dashboard/#/search?namespace=_all&q=vsoalgepxjbv7egb6ljml6ng4m

Based on the parameters set in the app spec from the :ref:`app_show` command,
you can set the parameters for the workflow using the ``--set`` flag.

You can set environment variables to the workflow using the ``--set-env`` flag,
to add or override environment variables defined in the app spec.

If the workflow contains references to local files, you can use the ``--local-path`` flag to
specify a relative path to the local files.

.. code-block:: bash

  $ osmo app spec my-app
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

  $ osmo app submit my-app --local-path /folder
  Workflow submit successful.
    Workflow ID        - example-workflow-1
    Workflow Overview  - |osmo_url|/workflows/example-workflow-1
    Workflow Dashboard - |osmo_url|/backend-dashboard/#/search?namespace=_all&q=vsoalgepxjbv7egb6ljml6ng4m

Refer to :ref:`cli_reference_workflow_submit` for more information on the parameters of the workflow.
