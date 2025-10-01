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

.. _gazebo_sdg:

================================================
Using Gazebo
================================================

Example
-------

Setup
~~~~~

Before starting, you must create a data credential to upload your dataset, if you have not already.
Refer to the data credentials :ref:`section <credentials_data>`.

Workflow
~~~~~~~~

This workflow demonstrates synthetic data generation using Gazebo simulator.
It performs the following steps:

1. Sets up a Ubuntu 22.04 container with Gazebo Garden simulator
2. Installs required dependencies (Gazebo, Python packages)
3. Runs a Python script (sdg.py) that:

  - Launches Gazebo with a segmentation world
  - Captures 5 synthetic images
  - Saves the images to a dataset

4. Outputs the generated data as a dataset named "gazebo-sdg-sample"

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../../samples/sdg/gazebo/sdg.yaml
      :language: yaml

    Create a scripts folder, if it has not been created and download the scripts
    :download:`sdg.py <../../../../samples/sdg/gazebo/scripts/sdg.py>` and
    :download:`segmentation_world.sdf <../../../../samples/sdg/gazebo/scripts/segmentation_world.sdf>`
    into the folder:

    .. code-block:: bash

      $ mkdir -p <location of sdg.yaml>/scripts

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-gazebo

The sample workflow typically takes **5** minutes to complete.

Once the workflow is completed, you can download the dataset by running:

.. code-block:: bash

    $ osmo dataset download gazebo-sdg-sample <local_folder>

You have created datasets, and downloaded them! Here is an example of an image in the dataset:

.. image:: gazebo_sdg_example.png
  :width: 800
  :align: center
