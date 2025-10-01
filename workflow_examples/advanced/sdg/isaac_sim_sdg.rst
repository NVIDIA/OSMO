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

.. _isaac_sim_sdg:

====================
Using Isaac Sim
====================

Example
-------

Setup
~~~~~

Before starting, you must create a data credential to upload your dataset, if you have not already.
Refer to the data credentials :ref:`section <credentials_data>`.

You can check the recommended GPU and driver versions by reviewing the official Isaac Sim
`system requirements <https://docs.omniverse.nvidia.com/isaacsim/latest/installation/requirements.html#system-requirements>`_.

Workflow
~~~~~~~~

This workflow generates synthetic data of scenes in a warehouse using NVIDIA's robotics simulator,
Isaac Sim. This workflow builds on the NVIDIA Isaac Sim `tutorial <https://docs.omniverse.nvidia.com/isaacsim/latest/replicator_tutorials>`_.
It performs the following steps:

1. Uses the NVIDIA Isaac Sim container image with version 4.0.0
2. Runs a Python script (scene_based_sdg.py) that:

  - Launches Isaac Sim in headless mode
  - Generates synthetic images of warehouse scenes
  - Saves the images to a ``{{output}}`` folder

3. Outputs the generated data as a dataset named "isaac-sim-sdg-sample"

.. md-tab-set::

  .. md-tab-item:: Workflow

    In this workflow, all the source files required to run the example are in the Docker image,
    so there is no need to add extra files to this workflow.

    .. literalinclude:: ../../../../samples/sdg/isaac_sim/sdg.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-isaac-sim

The workflow typically takes **15** minutes to run.

Once the workflow is completed, you can download the dataset by running:

.. code-block:: bash

  $ osmo dataset download isaac-sim-sdg-sample <local_folder>

You have created datasets, and downloaded them! Here is an example of an image in the dataset:

.. image:: isaac_sim_sdg_example.png
  :width: 800
  :align: center
