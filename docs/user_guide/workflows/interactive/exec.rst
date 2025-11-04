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

.. _workflow_interactive_exec:

================================================
Exec
================================================

There are two methods of opening a shell into a running task in the workflow - through the CLI or the browser.

CLI
===

You can open a shell into a running task in the workflow using the ``exec`` command.
For detailed CLI options, see :ref:`osmo workflow exec <cli_reference_workflow_exec>`.

By default, ``osmo workflow exec`` will connect to the container using the ``/bin/bash`` shell.
You can terminate a session by either using ``CTRL+D`` or by using the ``exit`` command:

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1
  root@task1-t4tpwhegz5a5nli7jkfo7h24um:/# echo Hello from inside task1!
  Hello from inside task1!
  root@task1-t4tpwhegz5a5nli7jkfo7h24um:/# exit
  $


Use the ``--keep-alive`` flag to resume the shell if connection is lost:

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1 --keep-alive
  root@d1f013e8308f45a88bd8f894202c7faf:/# echo Hello from inside task1!
  Hello from inside task1!
  root@d1f013e8308f45a88bd8f894202c7faf:/#
  Connection Closed: received 1012 (service restart); then sent 1012 (service restart)
  Reconnecting to the exec session...
  root@d1f013e8308f45a88bd8f894202c7faf:/#

Use an alternative shell like ``sh``, or even an alternative executable with the ``--entry`` command-line argument:

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1 --entry /bin/sh
  root:# echo Hello from inside task1!
  Hello from inside task1!
  root:# exit
  $


Execute a Non-Interactive Command
---------------------------------

.. note::

  ``--entry`` is a string that can be executed as an entry point for a shell.
  It can be a single command, or a command with arguments.

For example:

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1 --entry ls

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1 --entry "ls -l"

.. code-block:: bash

  $ osmo workflow exec my-workflow-t4tpwhegz5a5nli7jkfo7h24um task1 --entry "bash -c \"cd examples && ls\""

.. note::

  With ``--keep-alive`` flag, when the connection is lost, the exec command will be **restarted** and **re-executed**.

Send Exec Command to All Running Tasks in a Group
-------------------------------------------------

You can send a command to all running tasks in a group by using the ``--group`` command-line argument:

.. code-block:: bash

  $ osmo workflow query wf-32
  Workflow ID : wf-32
  Status      : RUNNING

  Task Name   Start Time               Status
  ============================================
  tcp         Apr 11, 2025 14:31 PDT   RUNNING
  udp         Apr 11, 2025 14:31 PDT   RUNNING
  $
  $ osmo workflow exec wf-32 --group echo --entry hostname
  [udp] 3c7dec70b09f46769a31903c6612829c
  [tcp] d3c1c69f36464075977fc147d76e3472

.. note::

   The ``--group`` argument does not support interactive entry commands like ``/bin/bash`` or ``--keep-alive`` flag.

Browser
=======

You can exec into **running workflow tasks** in the browser by clicking on the task name from
the **workflow details page** to see the actions menu and selecting the ``Shell`` option.
Switch between tasks using the handy ``dropdown menu`` at the top of the shell.
Search inside the shell using ``Ctrl+F`` (``Cmd+F`` on Mac).

.. image:: exec.gif
  :width: 800
  :alt: Image of the Exec Shell
