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

.. _concepts_tasks:

============
Tasks
============

The following fields can be used to describe a task in the workflow spec:

.. code-block:: yaml

  workflow:
    name: my_workflow
    tasks:
    - name: task1        # (1)
      image: ubuntu      # (2)
      lead: true         # (3)
      command: [echo]    # (4)
      args: ["Task1!"]   # (5)
      inputs:            # (6)
      ...
      outputs:           # (7)
      ...
      files:             # (8)
      ...
      resource: default  # (9)
      privileged: false  # (10)
      hostNetwork: false # (11)
      environment:       # (12)
      - FOO=BAR
      ...
      volumeMounts:      # (13)
      ...
      credentials:       # (14)
      ...
      exitActions:       # (15)
        COMPLETE: 0-10
        FAIL: 11-20
        RESCHEDULE: 21-30
      checkpoint:        # (16)
      ...

.. code-annotations::

  1. Name of the task.
  2. The container image registry and image tag, ex: `nvcr.io/nvidia/pytorch:25.06-py3`
  3. The group leader designation of the task.
  4. The command to run inside the Docker image.
  5. A list of arguments to pass to the program inside the Docker image.
  6. Inputs to download into the task container. See :ref:`concepts_wf_inputs_and_outputs` for more information.
  7. Outputs to upload after completion. See :ref:`concepts_wf_inputs_and_outputs` for more information.
  8. Files to mount into the task's container. See :ref:`concepts_wf_file_injection` for more information.
  9. Defines what resource spec to use. See :ref:`concepts_wf_resources` for more information.
  10. Privileged mode setting that grants containers nearly unrestricted access to the host system. This feature can only be used if enabled during configuration of platforms.
  11. The task pod host network setting that allows a pod to use the host node's network namespace instead of having its own isolated network stack. This feature can only be used if enabled during configuration of platforms.
  12. A list of key-value pairs of environment variables to pass to the container.
  13. A list of host mounts to add to the task container. See :ref:`concepts_host_mounts` for more information.
  14. A list of credentials to be injected as secrets. See :ref:`concepts_wf_secrets` for more information.
  15. A list of exit actions to perform after the task completes. See :ref:`concepts_wf_actions` for more information.
  16. A list of checkpoint specifications to use for this task. See :ref:`concepts_checkpointing` for more information.

.. _concepts_host_mounts:

Host Mounts
============

Host directories can be mounted from the node to a task's container image before the task is
started. Here are some examples:

.. code-block:: yaml

  workflow:
    name: "host-mount"
    tasks:
    - name: task1
      volumeMounts:
      - /dev/shm             # (1)
      ...
    - name: task2
      image: ubuntu
      command: [sh]
      args: [/tmp/run.sh]
      files:
      - contents: |
          ls /home/opt
        path: /tmp/run.sh
      volumeMounts:
      - /opt:/home/opt       # (2)

.. code-annotations::

  1. Mount the ``/dev/shm`` directory from the node to the task container, allowing it to use
     shared memory.
  2. Mount the ``/opt`` directory from the node to the ``/home/opt`` directory in the
     task container, allowing it to access the ``/opt`` directory.

.. note::

  The default list of host directories that are allowed to be mounted in your task
  for each type of pool and platform can be configured but requires service-level configuration.
  If you have administrative access, you can enable this directly. Otherwise, contact someone
  with pool administration privileges.
