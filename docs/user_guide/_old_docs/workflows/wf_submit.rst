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

.. _wf_submit:

================================================
Submit
================================================

Submitting a workflow will validate the workflow spec for usage errors, resource availability, credential validity and then submit the job to the job queue.
If submission was successful, it will provide a workflow ID and link to the real-time logs streaming from the container executed on the compute node:

.. code-block:: bash

  usage: osmo workflow submit [-h] [--format-type {json,text}] [--set SET [SET ...]] [--set-string SET_STRING [SET_STRING ...]] [--dry-run] [--pool POOL] [--rsync RSYNC]
                              [--priority {HIGH,NORMAL,LOW}]
                              workflow_file

  positional arguments:
    workflow_file         The workflow file to submit, or the spec of a workflow ID to submit. If using a workflow ID, --dry-run and --set are not supported.

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
    --rsync RSYNC         Start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow. The value should be in the format
                          <local_path>:<remote_path>. The daemon process will automatically exit when the workflow is terminated.
    --priority {HIGH,NORMAL,LOW}
                          The priority to use when scheduling the workflow. If none is provided, NORMAL will be used. The scheduler will prioritize scheduling workflows in the order of
                          HIGH, NORMAL, LOW. LOW workflows may be preempted to allow a higher priority workflow to run.

An example of submitting a workflow spec is shown below:

.. code-block:: bash
  :substitutions:

  $ osmo workflow submit sim-sdg.yaml
  Workflow submit successful.
      Workflow ID        - sim-sdg-N_Q69hQAT5uAkDjHLD3-8w
      Workflow Overview  - |osmo_url|/workflows/sim-sdg-N_Q69hQAT5uAkDjHLD3-8w
      Workflow Dashboard - |osmo_url|/backend-dashboard/#/search?namespace=_all&q=vsoalgepxjbv7egb6ljml6ng4m

The workflow dashboard provides direct access for debugging and remote development for users. The link is only valid for ``PENDING`` and ``RUNNING`` workflows

Refer to :ref:`faqs` to use the dashboard for live debug.

.. note::

  If a usage, resource, or credential error code is encountered, the CLI will exit with error code 1, indicating that the workflow failed submission.
  Refer to :ref:`troubleshooting` for tips for debugging

Overrides
------------------

To replace any templated variables when submitting a workflow, use the ``--set`` flag:

.. code-block:: bash

  $ osmo workflow submit sample_wf.yaml --set <field1>=<value1> <field2>=<value2>

For more information, refer to in :ref:`concepts_wf_templates_and_special_tokens`.

Environment Variables
---------------------

You can set environment variables to the workflow using the ``--set-env`` flag, to add or override environment variables defined in the workflow.

.. code-block:: bash

  $ osmo workflow submit sample_wf.yaml --set-env <key1>=<value1> <key2>=<value2>

.. note::

  These environment variables are applied for all tasks in the workflow.

Dry-run
-------

You can submit a workflow as a dry-run using the ``--dry-run`` flag. A dry run submission replaces all the templating and outputs the final resulting specification to the console, but will not submit the workflow. This can also be used in conjunction with the ``--set`` flag.

Example spec.yaml

.. code-block:: yaml

  workflow:
    name: {{ workflow_name }}
    tasks:
    - name: main-task-like-isaac-sim
      image: {{ image }}
      command: "sleep"
      args: ["30"]

  default-values:
    workflow_name: workflow_file_test

To dry-run, just append the ``--dry-run`` option

.. code-block:: bash

  $ osmo workflow submit workflow_file.yaml --set image="nvcr.io/nvidian/osmo/ubuntu-test:latest" --dry-run
  workflow:
    name: workflow_file_test
    tasks:
    - name: main-task-like-isaac-sim
      image: nvcr.io/nvidian/osmo/ubuntu-test:latest
      command: "sleep"
      args: ["30"]

Rsync
-----

You can start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow.
The daemon process will automatically exit when the workflow is terminated. For more information, refer to :ref:`wf_rsync`.

.. code-block:: bash

  $ osmo workflow submit workflow_file.yaml --rsync /local/workspace:/remote/workspace
  Workflow ID        - dev-workspace-1
  Workflow Overview  - |osmo_url|/workflows/dev-workspace-1
  Rsync daemon started in detached process: PID 12345
  To view daemon logs: tail -f /Users/user/.osmo/rsync/rsync_daemon_dev-workspace-1_dev-workspace.log
