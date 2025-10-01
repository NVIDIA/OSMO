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

.. _sim:

================================================
Launching Isaac Sim Livestream
================================================

NVIDIA Isaac Sim is a reference application built on NVIDIA Omniverse that enables developers to develop,
simulate, and test AI-driven robots in physically-based virtual environments.

OSMO Supports running Isaac Sim on a cloud environment with livestream clients enabled by port forwarding.

Example
-------

Setup
~~~~~

Isaac Sim requires an RTX GPU. Review the available resources in the backend to find one with an
RTX GPU and the supported driver version.

You can validate the recommended GPU and driver versions by reviewing the official Isaac Sim
`system requirements <https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html>`_.

To check the available resources in OSMO, run:

.. code-block:: bash

  $ osmo resource list

For more information, see the :ref:`wf_resource` section.

Depending on your use cases, you may also need to increase CPU, memory and disk resources accordingly.

To livestream a headless instance of Isaac Sim, you need to install the livestream client to your local machine.
Refer to the official Isaac Sim `Installation <https://docs.isaacsim.omniverse.nvidia.com/5.0.0/installation/manual_livestream_clients.html>`_ for more details.

Workflow
~~~~~~~~

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/remote_tools/sim.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-sim-livestream

Once the workflow is running, it can take a few minutes for Isaac Sim to load.
Make sure streaming service is up. To confirm this, look out for this line in the logs:

.. code-block:: bash

  Isaac Sim Full Streaming App is loaded.

After the streaming service is up, you can forward the ports to your local machine.
The following ports need to be forwarded: TCP/UDP 47995-48012, TCP/UDP 49000-49007, and TCP 49100.
In two separate terminals:

.. code-block:: bash

    $ osmo workflow port-forward sim-1 stream --port 47995-48012,49000-49007,49100 --connect-timeout 300

.. code-block:: bash

    $ osmo workflow port-forward sim-1 stream --port 47995-48012,49000-49007 --udp --connect-timeout 300


Wait several seconds for the ports to be forwarded. Then you can access Isaac Sim in the streaming client:

.. image:: client_start.png
  :width: 600
  :align: center

.. note::

  * Each Isaac Sim instance can only connect to one Streaming Client. Connecting to an
    Isaac Sim instance that is currently serving a Streaming Client results in an error
    for the second user.
  * When closing clients, please shutdown all port-forward commands to make sure connections are
    cleaned up.
  * Lower resolution results in less latency.

.. image:: client_display.png
  :width: 800
  :align: center
