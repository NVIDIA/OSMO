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

.. _wf_tag:

=====
Tag
=====

Tagging a workflow allows you to filter a workflow that contain the specific tag.

.. code-block:: bash

  $ osmo workflow tag -h
  usage: osmo workflow tag [-h] --workflow WORKFLOW [WORKFLOW ...] [--add-tags ADD_TAGS [ADD_TAGS ...]] [--remove-tags REMOVE_TAGS [REMOVE_TAGS ...]]

  options:
    -h, --help            show this help message and exit
    --workflow WORKFLOW [WORKFLOW ...], -w WORKFLOW [WORKFLOW ...]
                          List of workflows to update.
    --add-tags ADD_TAGS [ADD_TAGS ...], -a ADD_TAGS [ADD_TAGS ...]
                          List of tags to add.
    --remove-tags REMOVE_TAGS [REMOVE_TAGS ...], -r REMOVE_TAGS [REMOVE_TAGS ...]
                          List of tags to remove.

Sample usage below to list the running workflows from all users

.. code-block:: bash

  $ osmod workflow tag -w wf-01 wf-02 -a FAILED_START
  Workflow wf-01 updated.
  Workflow wf-02 updated.

.. note::

    The list of available tags to set is defined by admins. If a invalid tag is set, an error message will be shown:

    .. code-block:: bash

      $ osmod workflow tag -w wf-01 wf-02 -a INVALID_TAG
      {"message":"Invalid tag detected. Users can only set specified tags: FAILED_START, RELEASE_TEST","error_code":"USER","workflow_id":null}

Workflows can then be fetched using the ``osmo workflow list`` CLI.
For more information on listing, refer to workflow :ref:`wf_list`.

.. code-block:: bash

  $ osmod workflow list --tags FAILED_START
  User            Workflow ID   Submit Time          Status   Overview
  =============================================================================================================================================================================
  svc-osmo-admin  wf-01         2023-04-21 06:05:45  PENDING  |osmo_url|/workflows/apriltag_ros_apriltag_node-pYiGAmRkRyqIgnP6VwVgbQ/logs

  svc-osmo-admin  wf-02         2023-04-21 06:05:47  RUNNING  |osmo_url|/workflows/isaac_ros_visual_slam_node-fkG-hY3UTWOEY3BJXK8GpQ/logs
