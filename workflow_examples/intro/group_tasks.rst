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

.. _group_tasks:

================================================
Running Tasks in Parallel
================================================

Concepts
---------

To run tasks in parallel, you can use the ``group`` field in the workflow spec. All tasks in the
group will be scheduled and begin execution at the **same time**.

One task in the group **must** be marked as the leader. When the leader task completes,
the group will finish.

.. code-block:: yaml

  workflow:
    name: parallel-tasks
    groups:
    - name: my_group
      tasks:
      - name: task1
        lead: true # The group will finish when this task completes
        files:
        - contents: |
            echo "Running at the same time as task2"
          path: /tmp/run.sh
      - name: task2
        files:
        - contents: |
            echo "Running at the same time as task1"
          path: /tmp/run.sh

Example
-------

This workflow demonstrates how to run multiple tasks in a group that need to communicate with
each other. It creates a simple TCP server and client setup:

* The server task:

  * Opens a TCP server listening on port 24831
  * Has a text file containing "hello"
  * Waits for a client connection and sends the file contents
  * Saves the file to the output directory

* The client task:

  * Waits for the server container to be ready using DNS lookup
  * Connects to the server using the special {{host:server}} token to get server IP
  * Receives the "hello" message

The tasks run simultaneously as part of a group. The server task is marked as the group leader,
so when it completes, the group will finish.

.. literalinclude:: ../../../samples/group_tasks/group_tasks.yaml
  :language: yaml
