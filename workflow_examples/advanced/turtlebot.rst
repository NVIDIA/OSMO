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

.. _turtlebot:

================================================
Evaluating in Simulation (Software-In-Loop)
================================================

Example
-------

Workflow
~~~~~~~~

This workflow demonstrates the Classic ROS2 Turtlebot example and stream the simulated robot's topics to
Foxglove, a popular visualization client for robotics.
It launches:

- Turtlebot3 robot simulation in Gazebo
- Navigation2 (Nav2) stack for autonomous navigation
- Foxglove bridge to stream robot data for visualization

The workflow consists of:

- A single task that runs the robot simulation and navigation stack
- Foxglove bridge running on port 9090 to stream robot data
- Gazebo simulator running in non-headless mode
- Nav2 running without RViz visualization

Key components:

- Uses ROS2 Humble and Turtlebot3 Waffle model
- Nav2 for path planning and control
- Gazebo for physics simulation
- Foxglove bridge for data streaming and visualization

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/sil_evaluation/turtlebot_demo.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-turtlebot

Stream Foxglove
~~~~~~~~~~~~~~~

Once the workflow is running, you can use the foxglove UI to visualize data from your workflow.

1. Open a browser, such as Google Chrome, and navigate to `https://app.foxglove.dev`.
2. Validate that you see the Foxglove client:

.. image:: foxglove_init.png
  :width: 800
  :align: center

3. Check the logs. You must wait for a few minutes for the ROS2 Turtlebot to finish initializing.
   Besides using the command line tool for streaming logs, you can also view the logs through your
   browser:

.. code-block:: bash
  :substitutions:

  |osmo_url|/api/workflow/<Workflow ID>/logs

When the logs indicate that the ROS2 Turtlebot has initialized:

.. code-block:: console
  :class: no-copybutton

  2023/10/23 20:55:58 [turtlebot-gazebo] [component_container_isolated-5] [INFO] [1698094558.154298097] [local_costmap.local_costmap]: Activating
  2023/10/23 20:55:58 [turtlebot-gazebo] [component_container_isolated-5] [INFO] [1698094558.154305659] [local_costmap.local_costmap]: Checking transform

You are ready to see a visualization of the transform by port-forwarding the data that the Turtlebot is publishing to its ROS2 topics.

4.  Search for the log ``Activating`` and ``Checking transform``.

5. Run the port-forward command:

.. code-block:: bash

  $ osmo workflow port-forward <workflow ID> turtlebot-gazebo --port 9090:9090 --connect-timeout 1000

6. After the port-forwarding process has started, go back to the Foxglove client, and click **Open connection**.

7. Select **Foxglove Websocket**, and enter the Turtlebot connection that is forwarded to your machine:

.. image:: foxglove_connect.png
  :width: 800
  :align: center

The robot frame appears in Foxglove:

.. image:: foxglove_no_map.png
  :width: 800
  :align: center

8.  To see the occupancy map, go to the 3D panel, and click on the options (the three dots in a vertical line):

.. image:: foxglove_import.png
  :width: 800
  :align: center

9. Click **Import/export settings**, and use the contents of this :download:`file <../../../samples/sil_evaluation/turtlebot.json>` as the settings.

After applying the settings, the map shows up on Foxglove:

.. image:: foxglove_with_map.png
  :width: 800
  :align: center
