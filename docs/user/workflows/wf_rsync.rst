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

.. _wf_rsync:

================================================
Rsync
================================================

Rsync upload to a running task in your workflow from your local machine using ``rsync`` command.

.. note::

    We currently do not support deleting files/directories in a workflow.


.. code-block:: bash

  $ osmo workflow rsync -h
  usage: osmo workflow rsync [-h] [--status] [--stop] [--timeout TIMEOUT] [--upload-rate-limit UPLOAD_RATE_LIMIT] [--poll-interval POLL_INTERVAL] [--debounce-delay DEBOUNCE_DELAY] [--reconcile-interval RECONCILE_INTERVAL] [--max-log-size MAX_LOG_SIZE] [--verbose] [--once] [workflow_id] [task] [path]

  Syncs data from local machine to a remote workflow task via a persistent background daemon. It will continuously monitors the source path and automatically upload any changes to the remote task.

  /osmo/run/workspace is always available as a remote path.

  positional arguments:
    workflow_id           The ID or UUID of the workflow to rsync to/from
    task                  (Optional) The task to rsync upload to. If not provided, the upload will be to the lead task of the first group.
    path                  The src:dst path to rsync between.

  options:
    -h, --help            show this help message and exit
    --status, -s          Show the status of all rsync daemons
    --stop                Stop one or more rsync daemons
    --timeout TIMEOUT     The connection timeout period in seconds. Default is 10 seconds.
    --upload-rate-limit UPLOAD_RATE_LIMIT
                          Rate limit the upload speed in bytes per second. The upload speed is also subjected to admin configured rate-limit. Default is 1MB/s.
    --poll-interval POLL_INTERVAL
                          The amount of time (seconds) between polling the task for changes in daemon mode. If not provided, the admin-configured default will be used.
    --debounce-delay DEBOUNCE_DELAY
                          The amount of time (seconds) of inactivity after last file change before a sync is triggered in daemon mode. If not provided, the admin-configured default will be used.
    --reconcile-interval RECONCILE_INTERVAL
                          The amount of time (seconds) between reconciling the upload in daemon mode. This is used to ensure that failed uploads during network interruptions will resume after connection is restored. If not provided, the admin-configured default will be used.
    --max-log-size MAX_LOG_SIZE
                          The maximum log size in bytes for the daemon before log rotation. Default is 2MB.
    --verbose             Enable verbose logging for the daemon.
    --once                Run a single rsync upload to the workflow. The upload will be done in the foreground and will automatically exit once the upload completes.

  examples:
    Upload to a task:             osmo workflow rsync <workflow_id> <task_name> <local_path>:<remote_path>
    Upload to lead task:          osmo workflow rsync <workflow_id> <local_path>:<remote_path>
    Run a single upload:          osmo workflow rsync <workflow_id> <local_path>:<remote_path> --once
    Get the status of daemons:    osmo workflow rsync --status
    Stop all daemons:             osmo workflow rsync --stop
    Stop a specific daemon:       osmo workflow rsync <workflow_id> --stop

.. note::

    If ``task`` is not provided, the upload will be to the lead task of the first group.

.. note::

    ``/osmo/run/workspace`` is always available as a remote path.

.. code-block:: bash

  $ osmo workflow rsync wf-id ~/my/path:/osmo/run/workspace
  Rsync daemon started in detached process: PID 80754
  To view daemon logs: tail -f ~/.local/state/osmo/rsync/rsync_daemon_wf-id_task-name.log

Logs
====

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

Status
======

To get the status of all rsync daemons, you can use the ``osmo workflow rsync --status`` command.

.. code-block:: bash

  $ osmo workflow rsync --status

  Workflow ID   Task Name   PID     Status    Last Synced                  Source Path   Destination Path      Log File
  =======================================================================================================================================================================
  wf-id         task-name   26720   RUNNING   2025-05-29T10:39:55.696803   /my/path      /osmo/run/workspace   ~/.local/state/osmo/rsync/rsync_daemon_wf-id_task-name.log

Stopping daemon(s)
==================

To stop a specific daemon, you can use the ``osmo workflow rsync wf-id task-name --stop`` command.

To stop all daemons for a workflow, you can use the ``osmo workflow rsync wf-id --stop`` command.

Finally, to stop all daemons, you can use the ``osmo workflow rsync --stop`` command.

.. code-block:: bash

  $ osmo workflow rsync --stop
  Are you sure you want to stop all running daemons?

          * wf-id_1/task-name
          * wf-id_2/task-name

  [y/N] y
  Stopping rsync daemon wf-id_1/task-name
  Stopping rsync daemon wf-id_2/task-name
