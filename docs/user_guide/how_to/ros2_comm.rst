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

.. _guides_ros2_comm:

===============================
ROS 2: Multi-Node Communication
===============================

This tutorial demonstrates how to set up ROS 2 multi-node communication using a centralized Discovery Server architecture in OSMO.
You will learn how to orchestrate multiple ROS 2 nodes across different containers to communicate in a distributed environment,
which is essential for building scalable robotics applications.

This tutorial is based on the official `ROS 2 Discovery Server tutorial <https://docs.ros.org/en/foxy/Tutorials/Advanced/Discovery-Server/Discovery-Server.html#run-this-tutorial>`_.

The complete workflow example is available `here <https://github.com/NVIDIA/OSMO/tree/main/workflows/ros/comm>`_.

Architecture
------------

This workflow orchestrates **three tasks** running in parallel to demonstrate ROS 2 inter-node communication:

.. grid:: 1 1 3 3
   :gutter: 3
   :margin: 4 4 0 0

   .. grid-item-card::
      :class-header: bg-primary text-white
      :class-body: text-center

      🌐 **Discovery Server**

      A FastDDS Discovery Server that facilitates node discovery and message routing between containers.

   .. grid-item-card::
      :class-header: bg-success text-white
      :class-body: text-center

      📢 **Publisher Node**

      A ROS 2 node that publishes "Hello World" messages to a topic at regular intervals.

   .. grid-item-card::
      :class-header: bg-info text-white
      :class-body: text-center

      👂 **Subscriber Node**

      A ROS 2 node that subscribes to the topic and receives messages from the talker.

Building the Workflow
----------------------

Let's examine the key components of the ROS 2 communication workflow:

.. code-block:: yaml
   :emphasize-lines: 5, 17, 41

    workflow:
      groups:
      - name: nodes
        tasks:
        - name: discovery-server
          image: osrf/ros:humble-desktop-full
          args:
          - /tmp/client.sh
          command:
          - /bin/bash
          files:
          - contents: |-
              #!/bin/bash
              source /opt/ros/humble/setup.bash
              fastdds discovery --server-id 0 -p 11811
            path: /tmp/client.sh
        - name: publisher-node
          image: osrf/ros:humble-desktop-full
          args:
          - /tmp/entry.sh
          command:
          - bash
          files:
          - contents: |-
              apt-get update
              apt-get install -y dnsutils

              # (1)
              DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
                  'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')

              export ROS_DISCOVERY_SERVER=$DISCOVERY_SERVER_IP:11811

              # Set up environment variables
              source /opt/ros/humble/setup.bash

              # (2)
              ros2 run demo_nodes_cpp talker --ros-args --remap __node:=talker_discovery_server
            path: /tmp/entry.sh
          lead: true
        - name: subscriber-node
          image: osrf/ros:humble-desktop-full
          args:
          - /tmp/entry.sh
          command:
          - bash
          files:
          - contents: |-
              apt-get update
              apt-get install -y dnsutils

              DISCOVERY_SERVER_IP=$(nslookup {{host:discovery-server}} | grep -oP \
                  'Address: \K\d[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}')

              export ROS_DISCOVERY_SERVER=$DISCOVERY_SERVER_IP:11811

              # Set up environment variables
              source /opt/ros/humble/setup.bash

              # (3)
              ros2 run demo_nodes_cpp listener --ros-args --remap __node:=listener_discovery_server
            path: /tmp/entry.sh
      name: ros-comms
      resources:
        default:
          cpu: 1
          memory: 1Gi
          storage: 1Gi
      timeout:
        exec_timeout: 15m


.. code-annotations::
  1. The discovery server IP is resolved using DNS lookup. The IP is required
     in order to set the ROS_DISCOVERY_SERVER environment variable to communicate
     through the discovery server. This is also done in the `subscriber-node`.
  2. The talker node publishes simple String messages to the topic `/chatter`.
  3. The listener node subscribes to the topic `/chatter` and prints the messages to the console.

Understanding the Logs
~~~~~~~~~~~~~~~~~~~~~~

After submitting the workflow, once all the tasks are running, you should see that the publisher
node is publishing messages to the topic through the discovery server.

**Publisher Node logs:**
::

   [INFO] [talker_discovery_server]: Publishing: 'Hello World: 1'
   [INFO] [talker_discovery_server]: Publishing: 'Hello World: 2'
   [INFO] [talker_discovery_server]: Publishing: 'Hello World: 3'

Since the subscriber node is subscribed to the topic and configured to listen for messages from
the discovery server, it will only print the messages to the console if it receives the messages
from the publisher node.

**Subscriber Node logs:**
::

   [INFO] [listener_discovery_server]: I heard: [Hello World: 1]
   [INFO] [listener_discovery_server]: I heard: [Hello World: 2]
   [INFO] [listener_discovery_server]: I heard: [Hello World: 3]

If the subscriber node prints these messages, it means the subscriber node is able to receive the messages
from the publisher node through the discovery server, even if the two ROS nodes are running on different
machines in different networks.

.. note::

  This workflow has a timeout of **15 minutes**. If the workflow runs for longer than that,
  it will be terminated by the service automatically.
