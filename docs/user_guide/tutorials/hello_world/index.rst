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
..

.. _tutorials_hello_world:

===========
Hello World
===========

.. _getting_started_ui:

Using the Web UI
----------------

The easiest way to get started with submitting workflows to OSMO is to use the Web UI.
A workflow is essentially a job that will be executed in the compute cluster.
This section will walk you through using the Web UI to
submit your first workflow to OSMO and to track its progress as it runs.

.. note::

  The recommended web browsers are Google Chrome or Microsoft Edge.

.. image:: ui_getting_started.gif
  :alt: OSMO Web UI workflow
  :align: center
  :width: 100%

.. _getting_started_cli:

Using the CLI
-------------

Now that you have submitted your first workflow, it is time to try out the OSMO CLI.

.. note::

   For CLI installation and setup instructions, see :ref:`cli_install`.

The CLI encompasses many commands that allow you to manage your workflows and datasets,
and get information about compute resources available to you, without leaving your terminal.

Creating a Workflow File
~~~~~~~~~~~~~~~~~~~~~~~~

You can copy the following workflow definition into a file called `hello_world.yaml`.

.. code-block:: yaml

  workflow:
    name: hello-osmo
    tasks:
      - name: hello
        image: ubuntu:24.04
        command: ["bash"]
        args: ["/tmp/entry.sh"]
        files:
          - path: /tmp/entry.sh
            contents: |
              echo "Hello from OSMO!"

Submitting a Workflow
~~~~~~~~~~~~~~~~~~~~~

You can submit the workflow by running the following command:

.. code-block:: bash
  :substitutions:

  $ osmo workflow submit hello_world.yaml
  Workflow submit successful.
  Workflow ID        - hello-osmo-1
  Workflow Overview  - |osmo_url|/workflows/hello-osmo-1

To get the status of the workflow, you can use the ``osmo workflow query`` command.

.. code-block:: bash
  :substitutions:

  $ osmo workflow query hello-osmo-1
  Workflow ID : hello-osmo-1
  Status      : COMPLETED
  User        : osmo-user
  Submit Time : Oct 08, 2025 16:23 EDT
  Overview    : |osmo_url|/workflows/hello-osmo-1

  Task Name     Start Time               Status
  ================================================
  hello         Oct 08, 2025 16:24 EDT   COMPLETED

To get the logs of the workflow, you can use the ``osmo workflow logs`` command.
This will output the logs for all of the tasks in the workflow.

.. code-block:: bash
  :substitutions:

  $ osmo workflow logs hello-osmo-1
  Workflow hello-osmo-1 has logs:
  2025/10/08 20:23:43 [hello][osmo] Hello from OSMO!

.. note::

  For more detailed information on the workflow CLI, see :ref:`Workflow CLI Reference <cli_reference_workflow>`.
