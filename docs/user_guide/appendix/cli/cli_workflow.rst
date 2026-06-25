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

:tocdepth: 3

.. _cli_reference_workflow:

================================================
osmo workflow
================================================

.. CLI-REFERENCE-GENERATED -- do not edit by hand; regenerate with: make -C docs cli-rst
.. cli-source: module=src.cli.main_parser | func=create_cli_parser | prog=osmo | path=workflow | ref-prefix=cli_reference_workflow | flags=argument-anchor,markdown

.. code-block:: text

   [1;34musage: [0m[1;35mosmo workflow[0m [[32m-h[0m]
                        [32m{submit,restart,validate,logs,events,cancel,query,list,tag,exec,spec,port-forward,rsync} ...[0m

.. _cli_reference_workflow_positional_arguments:

Positional Arguments
--------------------

``command``
    Possible choices: submit, restart, validate, logs, events, cancel, query, list, tag, exec, spec, port-forward, rsync

Sub-commands
------------

.. _cli_reference_workflow_submit:

submit
~~~~~~

Submit a workflow to the workflow service.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow submit[0m [[32m-h[0m] [[36m--format-type [33m{json,text}[0m]
                        [[36m--set [33mSET [SET ...][0m]
                        [[36m--set-string [33mSET_STRING [SET_STRING ...][0m]
                        [[36m--set-env [33mSET_ENV [SET_ENV ...][0m]
                        [[36m--dry-run[0m] [[36m--pool [33mPOOL[0m] [[36m--rsync [33mRSYNC[0m]
                        [[36m--priority [33m{HIGH,NORMAL,LOW}[0m]
                        [32mworkflow_file[0m

.. _cli_reference_workflow_submit_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_file``
    The workflow file to submit, or the spec of a workflow ID to submit. If using a workflow ID, --dry-run and --set are not supported.

.. _cli_reference_workflow_submit_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

``--set``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable

    Default: ``[]``

``--set-string``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string

    Default: ``[]``

``--set-env``
    Assign environment variables to the workflow. The value should be in the format <key>=<value>. Multiple key-value pairs can be passed. If an environment variable passed here is already defined in the workflow, the value declared here will override the value in the workflow.

    Default: ``[]``

``--dry-run``
    Does not submit the workflow and prints the workflow into the console.

    Default: ``False``

``--pool, -p``
    The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

``--rsync``
    Start a background rsync daemon to continuously upload data from local machine to the lead task of the workflow. The value should be in the format <local_path>:<remote_path>. The daemon process will automatically exit when the workflow is terminated.

``--priority``
    Possible choices: HIGH, NORMAL, LOW

    The priority to use when scheduling the workflow. If none is provided, NORMAL will be used. The scheduler will prioritize scheduling workflows in the order of HIGH, NORMAL, LOW. LOW workflows may be preempted to allow a higher priority workflow to run.

.. _cli_reference_workflow_restart:

restart
~~~~~~~

Restart a failed workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow restart[0m [[32m-h[0m] [[36m--format-type [33m{json,text}[0m]
                         [[36m--pool [33mPOOL[0m]
                         [32mworkflow_id[0m

.. _cli_reference_workflow_restart_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID to restart.

.. _cli_reference_workflow_restart_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

``--pool, -p``
    The target pool to run the workflow with.

.. _cli_reference_workflow_validate:

validate
~~~~~~~~

validate a workflow to the workflow server.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow validate[0m [[32m-h[0m] [[36m--set [33mSET [SET ...][0m]
                          [[36m--set-string [33mSET_STRING [SET_STRING ...][0m]
                          [[36m--pool [33mPOOL[0m]
                          [32mworkflow_file[0m

.. _cli_reference_workflow_validate_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_file``
    The workflow file to submit.

.. _cli_reference_workflow_validate_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--set``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. Values will be cast as int or float if applicable

    Default: ``[]``

``--set-string``
    Assign fields in the workflow file with desired elements in the form "<field>=<value>". These values will override values set in the "default-values" section. Overridden fields in the yaml file should be in the form {{ field }}. All values will be cast as string

    Default: ``[]``

``--pool, -p``
    The target pool to run the workflow with. If no pool is specified, the default pool assigned in the profile will be used.

.. _cli_reference_workflow_logs:

logs
~~~~

Get the logs from a workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow logs[0m [[32m-h[0m] [[36m--task [33mTASK[0m] [[36m--retry-id [33mRETRY_ID[0m]
                      [[36m--error[0m] [[32m-n [33mLAST_N_LINES[0m]
                      [32mworkflow_id[0m

.. _cli_reference_workflow_logs_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID for which to fetch the logs.

.. _cli_reference_workflow_logs_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--task, -t``
    The task name for which to fetch the logs.

``--retry-id, -r``
    The retry ID for the task which to fetch the logs. If not provided, the latest retry ID will be used.

``--error``
    Show task error logs instead of regular logs

    Default: ``False``

``-n``
    Show last n lines of logs

.. _cli_reference_workflow_events:

events
~~~~~~

Get the events from a workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow events[0m [[32m-h[0m] [[36m--task [33mTASK[0m] [[36m--retry-id [33mRETRY_ID[0m]
                        [32mworkflow_id[0m

.. _cli_reference_workflow_events_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID for which to fetch the events.

.. _cli_reference_workflow_events_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--task, -t``
    The task name for which to fetch the events.

``--retry-id, -r``
    The retry ID for the task which to fetch the events. If not provided, the latest retry ID will be used.

.. _cli_reference_workflow_cancel:

cancel
~~~~~~

Cancel a queued or running workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow cancel[0m [[32m-h[0m] [[36m--message [33mMESSAGE[0m] [[36m--force[0m]
                        [[36m--format-type [33m{json,text}[0m]
                        [32mworkflow_ids [workflow_ids ...][0m

.. _cli_reference_workflow_cancel_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_ids``
    The workflow IDs or UUIDs to cancel. Multiple IDs or UUIDs can be passed.

.. _cli_reference_workflow_cancel_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--message, -m``
    Additional message describing reason for cancelation.

``--force, -f``
    Force cancel task group pods in the cluster.

    Default: ``False``

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

.. _cli_reference_workflow_query:

query
~~~~~

Query the status of a running workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow query[0m [[32m-h[0m] [[36m--verbose[0m] [[36m--format-type [33m{json,text}[0m]
                       [32mworkflow_id[0m

.. _cli_reference_workflow_query_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID to query the status of.

.. _cli_reference_workflow_query_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--verbose, -v``
    Whether to show all retried tasks.

    Default: ``False``

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

.. _cli_reference_workflow_list:

list
~~~~

List workflows with different filters. Without the --pool flag, workflows from all pools will be listed.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow list[0m [[32m-h[0m] [[36m--count [33mCOUNT[0m] [[36m--offset [33mOFFSET[0m]
                      [[36m--name [33mNAME[0m] [[36m--order [33m{asc,desc}[0m]
                      [[36m--status [33mSTATUS [STATUS ...][0m]
                      [[36m--format-type [33m{json,text}[0m]
                      [[36m--submitted-after [33mSUBMITTED_AFTER[0m]
                      [[36m--submitted-before [33mSUBMITTED_BEFORE[0m]
                      [[36m--tags [33mTAGS [TAGS ...][0m]
                      [[36m--priority [33m{HIGH,NORMAL,LOW} [{HIGH,NORMAL,LOW} ...][0m]
                      [[36m--user [33mUSER [USER ...][0m | [36m--all-users[0m]
                      [[36m--pool [33mPOOL [POOL ...][0m] [[36m--app [33mAPP[0m]

.. _cli_reference_workflow_list_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--count, -c``
    Display the given count of workflows. Default value is 20. Use --offset to skip results for pagination.

    Default: ``20``

``--offset, -f``
    Skip the first N workflows (newest first, server-side order). Use with --count to paginate results. Default is 0.

    Default: ``0``

``--name, -n``
    Display workflows which contains the string.

``--order, -o``
    Possible choices: asc, desc

    Display in the order in which workflows were submitted. asc means latest at the bottom. desc means latest at the top. Default is asc.

    Default: ``'asc'``

``--status, -s``
    Possible choices: RUNNING, FAILED, COMPLETED, PENDING, WAITING, FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_SUBMISSION, FAILED_CANCELED, FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL, FAILED_EVICTED, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED

    Display all workflows with the given status(es). Users can pass multiple values to this flag. Acceptable values: RUNNING, FAILED, COMPLETED, PENDING, WAITING, FAILED_EXEC_TIMEOUT, FAILED_SERVER_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_SUBMISSION, FAILED_CANCELED, FAILED_BACKEND_ERROR, FAILED_IMAGE_PULL, FAILED_EVICTED, FAILED_START_ERROR, FAILED_START_TIMEOUT, FAILED_PREEMPTED

``--format-type, -t``
    Possible choices: json, text

    Specify the output format type (Default text).

    Default: ``'text'``

``--submitted-after``
    Filter for workflows that were submitted after AND including this date. Must be in format YYYY-MM-DD.
    Example: --submitted-after 2023-05-03

``--submitted-before``
    Filter for workflows that were submitted before (NOT including) this date. Must be in format YYYY-MM-DD.
    Example: --submitted-after 2023-05-02 --submitted-before 2023-05-04 includes all workflows that were submitted any time on May 2nd and May 3rd only.

``--tags``
    Filter for workflows that contain the tag(s).

``--priority``
    Possible choices: HIGH, NORMAL, LOW

    Filter workflows by priority levels.

``--user, -u``
    Display all workflows by this user. Users can pass multiple values to this flag.

    Default: ``[]``

``--all-users, -a``
    Display all workflows with no filtering on users.

    Default: ``False``

``--pool, -p``
    Display all workflows by this pool. Users can pass multiple values to this flag.

    Default: ``[]``

``--app, -P``
    Display all workflows created by this app. For a specific app or app version, use the format <app>:<version>.

.. _cli_reference_workflow_tag:

tag
~~~

List or change tags from workflow(s) if no workflow is specified. Remove is applied before add

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow tag[0m [[32m-h[0m] [[36m--workflow [33mWORKFLOW [WORKFLOW ...][0m]
                     [[36m--add [33mADD [ADD ...][0m]
                     [[36m--remove [33mREMOVE [REMOVE ...][0m]

.. _cli_reference_workflow_tag_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--workflow, -w``
    List of workflows to update. If not set, the CLI will return the list of available tags to assign.

``--add, -a``
    List of tags to add.

    Default: ``[]``

``--remove, -r``
    List of tags to remove.

    Default: ``[]``

.. _cli_reference_workflow_exec:

exec
~~~~

Exec into a task of a workflow.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow exec[0m [[32m-h[0m] [[36m--entry [33mEXEC_ENTRY_COMMAND[0m]
                      [[36m--connect-timeout [33mCONNECT_TIMEOUT[0m]
                      [[36m--keep-alive[0m]
                      [32mworkflow_id[0m ([36m--group [33mGROUP[0m | [32mtask[0m)

.. _cli_reference_workflow_exec_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID to exec in.

``task``
    The task name to exec into.

.. _cli_reference_workflow_exec_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--group``
    Send command to all tasks in the group.

``--entry``
    Specify the entry point for exec (Default /bin/bash).

    Default: ``'/bin/bash'``

``--connect-timeout``
    The connection timeout period in seconds. Default is 60 seconds.

    Default: ``60``

``--keep-alive``
    Restart the exec command if connection is lost.

    Default: ``False``

.. _cli_reference_workflow_spec:

spec
~~~~

Get workflow spec.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow spec[0m [[32m-h[0m] [[36m--template[0m] [32mworkflow_id[0m

.. _cli_reference_workflow_spec_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The workflow ID or UUID to query the status of.

.. _cli_reference_workflow_spec_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--template``
    Show the original templated spec

    Default: ``False``

.. _cli_reference_workflow_port_forward:

port-forward
~~~~~~~~~~~~

Port-forward data from workflow to local machine.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow port-forward[0m [[32m-h[0m] [[36m--host [33mHOST[0m] [36m--port [33mPORT[0m [[36m--udp[0m]
                              [[36m--connect-timeout [33mCONNECT_TIMEOUT[0m]
                              [32mworkflow_id[0m [32mtask[0m

.. _cli_reference_workflow_port_forward_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``workflow_id``
    The ID or UUID of the workflow to port forward from

``task``
    Name of the task in the workflow to port forward from

.. _cli_reference_workflow_port_forward_named_arguments:

Named Arguments
^^^^^^^^^^^^^^^

``--host``
    The hostname used to bind the local port. Default value is localhost.

    Default: ``'localhost'``

``--port``
    Port forward from task in the pool. Input value should be in format local_port[:task_port], or in range port1-port2,port3-port4 (right end inclusive). e.g. "8000:2000", "8000", "8000-8010:9000-9010,8015-8016". If using a single port value or range, the client will use that port value for both local port and task port.

``--udp``
    Use UDP port forward.

    Default: ``False``

``--connect-timeout``
    The connection timeout period in seconds. Default is 60 seconds.

    Default: ``60``



.. rubric:: Examples

Forward UDP traffic from a task to your local machine::

  osmo workflow port-forward wf-1 sim-task --port 47995-48012,49000-49007 --udp
        

.. _cli_reference_workflow_rsync:

rsync
~~~~~

Syncs data between local machine and a remote workflow task.

/osmo/run/workspace is always available as a remote path.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow rsync[0m [[32m-h[0m] [32m{upload,download,status,stop} ...[0m

.. _cli_reference_workflow_rsync_positional_arguments:

Positional Arguments
^^^^^^^^^^^^^^^^^^^^

``rsync_command``
    Possible choices: upload, download, status, stop

.. _cli_reference_workflow_rsync_upload:

upload
^^^^^^

Upload local data to a remote workflow task.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow rsync upload[0m [[32m-h[0m] [[36m--timeout [33mTIMEOUT[0m]
                              [[36m--upload-rate-limit [33mUPLOAD_RATE_LIMIT[0m]
                              [[36m--poll-interval [33mPOLL_INTERVAL[0m]
                              [[36m--debounce-delay [33mDEBOUNCE_DELAY[0m]
                              [[36m--reconcile-interval [33mRECONCILE_INTERVAL[0m]
                              [[36m--max-log-size [33mMAX_LOG_SIZE[0m]
                              [[36m--verbose[0m] [[36m--daemon[0m] [[36m--no-progress[0m]
                              [32mworkflow_id[0m [32m[task][0m [32m[path][0m

.. _cli_reference_workflow_rsync_upload_positional_arguments:

Positional Arguments
""""""""""""""""""""

``workflow_id``
    The ID or UUID of the workflow to rsync to

``task``
    (Optional) The task to upload to. If not provided, the upload will be to the lead task of the first group.

``path``
    The <local_path>:<remote_path> to rsync between.

.. _cli_reference_workflow_rsync_upload_named_arguments:

Named Arguments
"""""""""""""""

``--timeout``
    The connection timeout period in seconds. Default is 10 seconds.

    Default: ``10``

``--upload-rate-limit``
    Rate limit the upload speed in bytes per second. The upload speed is also subjected to admin configured rate-limit.

``--poll-interval``
    The amount of time (seconds) between polling the task for changes in daemon mode. If not provided, the admin-configured default will be used.

``--debounce-delay``
    The amount of time (seconds) of inactivity after last file change before a sync is triggered in daemon mode. If not provided, the admin-configured default will be used.

``--reconcile-interval``
    The amount of time (seconds) between reconciling the upload in daemon mode. This is used to ensure that failed uploads during network interruptions will resume after connection is restored. If not provided, the admin-configured default will be used.

``--max-log-size``
    The maximum log size in bytes for the daemon before log rotation. Default is 2MB.

    Default: ``2097152``

``--verbose``
    Enable verbose logging for the daemon.

    Default: ``False``

``--daemon``
    Run as a background daemon that continuously monitors the source path and uploads changes to the remote task.

    Default: ``False``

``--no-progress``
    Suppress transfer progress output. By default, progress is shown for foreground transfers.

    Default: ``False``

.. _cli_reference_workflow_rsync_download:

download
^^^^^^^^

Download data from a remote workflow task to local machine.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow rsync download[0m [[32m-h[0m] [[36m--timeout [33mTIMEOUT[0m]
                                [[36m--no-progress[0m]
                                [32mworkflow_id[0m [32m[task][0m [32m[path][0m

.. _cli_reference_workflow_rsync_download_positional_arguments:

Positional Arguments
""""""""""""""""""""

``workflow_id``
    The ID or UUID of the workflow to rsync from

``task``
    (Optional) The task to download from. If not provided, the download will be from the lead task of the first group.

``path``
    The <remote_path>:<local_path> to rsync between.

.. _cli_reference_workflow_rsync_download_named_arguments:

Named Arguments
"""""""""""""""

``--timeout``
    The connection timeout period in seconds. Default is 10 seconds.

    Default: ``10``

``--no-progress``
    Suppress transfer progress output. By default, progress is shown.

    Default: ``False``

.. _cli_reference_workflow_rsync_status:

status
^^^^^^

Show the status of all rsync daemons.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow rsync status[0m [[32m-h[0m]

.. _cli_reference_workflow_rsync_stop:

stop
^^^^

Stop one or more rsync daemons.

.. code-block:: text

   [1;34m[0m[1;35mosmo workflow rsync stop[0m [[32m-h[0m] [[36m--task [33mTASK[0m] [32m[workflow_id][0m

.. _cli_reference_workflow_rsync_stop_positional_arguments:

Positional Arguments
""""""""""""""""""""

``workflow_id``
    (Optional) The workflow ID to filter daemons by.

.. _cli_reference_workflow_rsync_stop_named_arguments:

Named Arguments
"""""""""""""""

``--task``
    (Optional) The task name to filter daemons by.



.. rubric:: Examples

Upload to a task::

    osmo workflow rsync upload <workflow_id> <task_name> <local_path>:<remote_path>

Upload to lead task::

    osmo workflow rsync upload <workflow_id> <local_path>:<remote_path>

Run as a background daemon::

    osmo workflow rsync upload <workflow_id> <local_path>:<remote_path> --daemon

Download from a task::

    osmo workflow rsync download <workflow_id> <task_name> <remote_path>:<local_path>

Download from lead task::

    osmo workflow rsync download <workflow_id> <remote_path>:<local_path>

Get the status of daemons::

    osmo workflow rsync status

Stop all daemons::

    osmo workflow rsync stop

Stop a specific daemon::

    osmo workflow rsync stop <workflow_id>
        
