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

.. _workflow_interactive_rsync:

================================================
Rsync
================================================

Rsync data to and from a running task in your workflow using the ``rsync`` command.
For detailed CLI options, see :ref:`osmo workflow rsync <cli_reference_workflow_rsync>`.

.. caution::

    We currently do not support deleting files/directories in a workflow.

.. hint::

    If ``task`` is not provided, the operation will target the lead task of the first group.

.. hint::

    ``/osmo/run/workspace`` is always available as a remote path.

Upload
======

Upload files or directories from your local machine to a running task.
By default, the upload runs in the foreground and exits once complete.

.. code-block:: bash

  $ osmo workflow rsync upload wf-id ~/my/path:/osmo/run/workspace

Daemon mode
-----------

Pass ``--daemon`` to start a background daemon that continuously monitors
the source path and uploads changes to the remote task.

.. code-block:: bash

  $ osmo workflow rsync upload wf-id ~/my/path:/osmo/run/workspace --daemon
  Rsync daemon started in detached process: PID 80754
  To view daemon logs: tail -f ~/.local/state/osmo/rsync/rsync_daemon_wf-id_task-name.log

Daemon logs
^^^^^^^^^^^

The daemon will output logs to the designated log file.

.. code-block:: bash

  $ tail -f ~/.local/state/osmo/rsync/rsync_daemon_wf-id_task-name.log
  2025-05-29 10:38:04,517 - 26720 - rsync.py:854 - osmo.rsync - INFO - Starting rsync daemon...
  2025-05-29 10:38:04,521 - 26720 - rsync.py:947 - osmo.rsync - INFO - Polling task...
  2025-05-29 10:38:04,666 - 26720 - rsync.py:980 - osmo.rsync - INFO - Task is in running state...
  2025-05-29 10:38:04,672 - 26720 - rsync.py:377 - osmo.rsync - INFO - Starting rsync client...
  2025-05-29 10:38:04,672 - 26720 - rsync.py:553 - osmo.rsync - INFO - Starting rsync port forwarding...
  2025-05-29 10:38:05,421 - 26720 - rsync.py:433 - osmo.rsync - INFO - Uploading /my/path
  2025-05-29 10:38:05,947 - 26720 - rsync.py:482 - osmo.rsync - INFO - Rsync upload completed successfully for wf-id/task-name
  2025-05-29 10:39:17,517 - 26720 - rsync.py:736 - osmo.rsync - INFO - Path event handler (/my/path) detected changes...
  2025-05-29 10:39:55,121 - 26720 - rsync.py:433 - osmo.rsync - INFO - Uploading /my/path
  2025-05-29 10:39:55,694 - 26720 - rsync.py:482 - osmo.rsync - INFO - Rsync upload completed successfully for wf-id/task-name

Download
========

Download files or directories from a running task to your local machine.
The download runs in the foreground and exits once complete. The local
destination path is treated as a directory — downloaded files are placed inside it.

.. code-block:: bash

  $ osmo workflow rsync download wf-id /osmo/run/workspace/my_data:/tmp/output

To download a single file:

.. code-block:: bash

  $ osmo workflow rsync download wf-id /osmo/run/workspace/results.csv:/tmp/output

Daemon status
=============

To get the status of all rsync daemons, use the ``osmo workflow rsync status`` command.

.. code-block:: bash

  $ osmo workflow rsync status

  Workflow ID   Task Name   PID     Status    Last Synced                  Local Path   Remote Path           Log File
  ====================================================================================================================================================================
  wf-id         task-name   26720   RUNNING   2025-05-29T10:39:55.696803   /my/path     /osmo/run/workspace   ~/.local/state/osmo/rsync/rsync_daemon_wf-id_task-name.log

Stopping daemon(s)
==================

To stop a specific daemon, use ``osmo workflow rsync stop wf-id --task task-name``.

To stop all daemons for a workflow, use ``osmo workflow rsync stop wf-id``.

Finally, to stop all daemons, use ``osmo workflow rsync stop``.

.. code-block:: bash

  $ osmo workflow rsync stop
  Are you sure you want to stop all running daemons?

          * wf-id_1/task-name
          * wf-id_2/task-name

  [y/N] y
  Stopping rsync daemon wf-id_1/task-name
  Stopping rsync daemon wf-id_2/task-name
