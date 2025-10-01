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

.. _wf_logs:

===================
Logs
===================

There are two methods of viewing workflow logs - through the browser or the CLI. For ``FAILED`` workflows, there are error logs that may provide more debugging information.

Browser
-------

All **logs** and **error logs** can be viewed from the **workflow details page** in the browser. Open workflow logs and task logs from the ``actions menu``. Switch between logs using the ``dropdown menu``.

.. image:: log-picker.gif
  :width: 800
  :alt: Image of the log viewer


Console
--------

To fetch the logs of a workflow:

.. code-block:: bash

  $ osmo workflow logs -h
  usage: osmo workflow logs [-h] [--error] workflow_id

    positional arguments:
    workflow_id  The workflow ID or UUID for which to fetch the logs.

    options:
    -h, --help   show this help message and exit
    --error      Show error logs instead of regular logs


Workflow logs are streamed realtime while the workflow is running in the pool

.. code-block:: bash

  $ osmo workflow logs isaac_ros_detectnet_graph-2LsjmqG4T7eNmirgWYIlhg
  Workflow isaac_ros_detectnet_graph-2LsjmqG4T7eNmirgWYIlhg has logs:
  2023/04/21 07:31:30 [ros][osmo] Download Start
  2023/04/21 07:31:30 [ros][osmo] Downloading r2b_hallway
  2023/04/21 07:31:58 [ros][osmo] Downloaded r2b_hallway
  2023/04/21 07:31:58 [ros][osmo] Downloading model_peoplenet
  2023/04/21 07:32:03 [ros][osmo] Downloaded model_peoplenet
  2023/04/21 07:32:03 [ros][osmo] All Inputs Downloaded
  2023/04/21 07:32:06 [ros] Hit:1 https://repo.download.nvidia.com/jetson/common r35.2 InRelease
  2023/04/21 07:32:06 [ros] Hit:3 http://packages.ros.org/ros2-testing/ubuntu focal InRelease
  2023/04/21 07:32:06 [ros] Hit:2 https://packagecloud.io/github/git-lfs/ubuntu focal InRelease
  2023/04/21 07:32:06 [ros] Hit:4 http://ppa.launchpad.net/mosquitto-dev/mosquitto-ppa/ubuntu focal InRelease
  2023/04/21 07:32:06 [ros] Hit:5 http://ports.ubuntu.com/ubuntu-ports focal InRelease
  2023/04/21 07:32:06 [ros] Hit:6 https://apt.kitware.com/ubuntu focal InRelease
  2023/04/21 07:32:06 [ros] Get:7 http://ports.ubuntu.com/ubuntu-ports focal-updates InRelease [114 kB]
  2023/04/21 07:32:07 [ros] Get:8 http://ports.ubuntu.com/ubuntu-ports focal-backports InRelease [108 kB]
  2023/04/21 07:32:07 [ros] Get:9 http://ports.ubuntu.com/ubuntu-ports focal-security InRelease [114 kB]
  ...
