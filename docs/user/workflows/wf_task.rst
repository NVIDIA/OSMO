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

.. _wf_task:

====
Task
====

You can monitor all the tasks submitted and resource requested from the tasks.

.. code-block:: bash

  $ osmo task list -h
  usage: osmo task list [-h] [--status STATUS [STATUS ...]] [--workflow-id WORKFLOW_ID] [--user USER [USER ...] | --all-users] [--pool POOL [POOL ...] | --node NODE [NODE ...]]
                        [--started-after STARTED_AFTER] [--started-before STARTED_BEFORE] [--count COUNT] [--offset OFFSET] [--order {asc,desc}] [--verbose | --summary]
                        [--priority {HIGH,NORMAL,LOW} [{HIGH,NORMAL,LOW} ...]] [--format-type {json,text}]

  options:
    -h, --help            show this help message and exit
    --status STATUS [STATUS ...], -s STATUS [STATUS ...]
                          Display all tasks with the given status(es). Users can pass multiple values to this flag. Defaults to PROCESSING, SCHEDULING, INITIALIZING and RUNNING.
                          Acceptable values: WAITING, PROCESSING, SCHEDULING, INITIALIZING, RUNNING, FAILED, COMPLETED, FAILED_EXEC_TIMEOUT, FAILED_START_ERROR, FAILED_START_TIMEOUT,
                          FAILED_SERVER_ERROR, FAILED_BACKEND_ERROR, FAILED_QUEUE_TIMEOUT, FAILED_IMAGE_PULL, FAILED_UPSTREAM, FAILED_EVICTED, FAILED_PREEMPTED, FAILED_CANCELED.
    --workflow-id WORKFLOW_ID, -w WORKFLOW_ID
                          Display workflows which contains the string.
    --user USER [USER ...], -u USER [USER ...]
                          Display all tasks by this user. Users can pass multiple values to this flag.
    --all-users, -a       Display all tasks with no filtering on users.
    --pool POOL [POOL ...], -p POOL [POOL ...]
                          Display all tasks by this pool. Users can pass multiple values to this flag. If not specified, all pools will be selected.
    --node NODE [NODE ...], -n NODE [NODE ...]
                          Display all tasks which ran on this node. Users can pass multiple values to this flag. If not specified, all nodes will be selected.
    --started-after STARTED_AFTER
                          Filter for tasks that were started after AND including this date. Must be in format YYYY-MM-DD. Example: --started-after 2023-05-03.
    --started-before STARTED_BEFORE
                          Filter for tasks that were started before (NOT including) this date. Must be in format YYYY-MM-DD. Example: --started-after 2023-05-02 --started-before
                          2023-05-04 includes all tasks that were started any time on May 2nd and May 3rd only.
    --count COUNT, -c COUNT
                          Display the given count of tasks. Default value is 20. Max value of 1000.
    --offset OFFSET, -f OFFSET
                          Used for pagination. Returns starting tasks from the offset index.
    --order {asc,desc}, -o {asc,desc}
                          Display in the order in which tasks were started. asc means latest at the bottom. desc means latest at the top.
    --verbose, -v         Display storage, cpu, memory, and gpu request.
    --summary, -S         Displays resource request grouped by user and pool.
    --priority {HIGH,NORMAL,LOW} [{HIGH,NORMAL,LOW} ...]
                          Filter tasks by priority levels.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).

  .. code-block:: bash
    :substitutions:

    $ osmo task list --all-users
    User             Workflow ID           Task    Status      Pool     Priority  Node         Start Time
    =================================================================================================================
    svc-osmo-admin   serial-workflow-550   task1   RUNNING     my_pool  NORMAL    osmo-vm-01   Sep 17, 2024 14:48 PDT
    svc-osmo-sre     serial-workflow-541   task1   SCHEDULING  my_pool  LOW       -            -

  Sample usage below to list the running tasks from the user with resource requests:

  .. code-block:: bash
    :substitutions:

    $ osmo task list -r -s RUNNING
    User             Workflow ID           Task    Status    Pool     Priority  Node         Start Time               Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
    ================================================================================================================================================================
    svc-osmo-admin   serial-workflow-550   task1   RUNNING   my_pool  NORMAL    osmo-vm-01   Sep 17, 2024 14:48 PDT   100            4         64             8
    svc-osmo-admin   serial-workflow-551   task1   RUNNING   my_pool  LOW       osmo-vm-01   Sep 17, 2024 14:48 PDT   100            4         64             8
    ================================================================================================================================================================
                                                                                                                      200            8         128            16

  Sample usage below to list high priority tasks:

  .. code-block:: bash
    :substitutions:

    $ osmo task list --priority high
    User             Workflow ID           Task    Status      Pool     Priority  Node         Start Time
    =================================================================================================================
    svc-osmo-admin   serial-workflow-550   task1   RUNNING     my_pool  NORMAL    osmo-vm-01   Sep 17, 2024 14:48 PDT

To view summary information for resource requests for each user and pool:

.. code-block:: bash
  :substitutions:

  $ osmo task list -a --summary
  User             Pool      Priority  Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
  ===================================================================================
  svc-osmo-admin   my_pool   NORMAL    100            4         64             8
  svc-osmo-admin   my_pool   LOW       50             4         64             8
  svc-osmo-admin   my_pool2  LOW       100            4         64             8
  svc-osmo-sre     my_pool   LOW       50             4         64             8
  ===================================================================================
                                       300            16        256            32
