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

.. _sdg_in_60:

================================================
Synthetic Data Generation (SDG) in 60 minutes
================================================

This workflow demonstrates how to generate synthetic data using Isaac Sim,
NVIDIA's robotics simulator. By the end of the tutorial, you will have a
generated dataset of synthetic images of warehouse scenes, that can be used
for training models.

This tutorial is for users who want to generate synthetic data to make
their models more robust and accurate.

Prerequisites
-------------

In this tutorial, you will need an OSMO data credential in order for the workflow
to upload the generated data to a dataset.

You can check out the data credentials :ref:`section <credentials_data>` for more information.

Overview
--------

This SDG workflow only has one task:

- Isaac Sim

The workflow will generate a dataset of synthetic images, and upload that dataset through OSMO service.

Building the Workflow
---------------------

We will first start with the skeleton of the workflow:

.. code-block:: yaml

  workflow:
    name: isaac-sim-sdg
    tasks:
    - name: isaac-sim-sdg
      image: nvcr.io/nvidia/isaac-sim:5.0.0
      command: ["bash"]
      args: ["/tmp/entry.sh"] # (1)
      environment:  # (2)
        ACCEPT_EULA: Y
        NO_NUCLEUS: Y

.. code-annotations::
  1. Entrypoint script to run Isaac Sim.
  2. Setting the environment variables for Isaac Sim to run.

Under environment, we will now add the files section.
We will now define the entrypoint script referenced in the command section:

.. code-block:: bash

  environment:
    ACCEPT_EULA: Y
    NO_NUCLEUS: Y
  files:
  - contents: |
      set -e
      # (1)
      /isaac-sim/python.sh /isaac-sim/standalone_examples/replicator/scene_based_sdg/scene_based_sdg.py \
        --config /tmp/config.json # (2)
      cp -r /isaac-sim/_out_scene_based_sdg/. {{output}} # (3)
    path: /tmp/entry.sh # (4)

.. code-annotations::
  1. This is the command to run the scene-based SDG example.
  2. Passing the custom config file to Isaac Sim.
  3. Copying the generated data to the output directory.
  4. Defining the path to the entrypoint script. The contents above will be executed line-by-line.

If you noticed, we are passing the custom config file to the Isaac Sim command.
This config file is crucial for the workflow to run properly.

In another entry for files, we will define the config file:

.. code-block:: bash

  - contents: |
      {
          "launch_config": {
              "headless": true # (1)
          }
      }
    path: /tmp/config.json

.. code-annotations::
  1. Launches Isaac Sim in headless mode, because Isaac Sim is not running on
     your machine locally.

Now we need to add the outputs section to the workflow:

.. code-block:: yaml

  outputs:
  - dataset:
      name: isaac-sim-sdg-sample

This defines the name of the dataset that will be uploaded to the OSMO service.
All the files that are placed in the ``{{output}}`` directory in the workflow will
be uploaded to that dataset.

Finally, we need to add the resources section to the workflow:

.. code-block:: yaml

  resources:
    default:
      cpu: 4
      gpu: 1
      memory: 32Gi
      storage: 10Gi

This task requires an RTX GPU to run Isaac Sim.
If there is a specific type of GPU that you want to use, you can specify it by adding the ``platform`` field.
To check the available resources in OSMO, you can run the following command:

.. code-block:: bash

  $ osmo resource list

The complete workflow file can be found `here <https://github.com/NVIDIA/OSMO/tree/main/workflow_examples/sdg>`_.

Running the Workflow
--------------------

Now, we can submit the workflow:

.. code-block:: bash

  $ osmo workflow submit isaac-sim-sdg.yaml

The workflow typically takes **15** minutes to run.

Once the workflow has completed, you can download the dataset by running:

.. code-block:: bash

  $ osmo dataset download isaac-sim-sdg-sample <local_folder>

The folder structure will look like this:

.. code-block:: bash

  <local_folder>/
    TopView/
    PalletView/
    DriverView/
    metadata.txt

And in each of those sub-folders, you will find the following:

.. code-block:: bash

  DriverView/
    metadata.txt
    bounding_box_2d_tight/
    bounding_box_3d/
    distance_to_image_plane/
    occlusion/
    rgb/
    semantic_segmentation/

Here is some examples of warehouse images from different viewpoints in the dataset:

.. list-table::
   :widths: 50 50
   :header-rows: 0

   * - RGB Image
     - Segmentation Map
   * - .. image:: images/palletview_01.png
         :width: 400
     - .. image:: images/palletview_segmentation_01.png
         :width: 400
   * - .. image:: images/topview_01.png
         :width: 400
     - .. image:: images/topview_segmentation_01.png
         :width: 400
   * - .. image:: images/driverview_01.png
         :width: 400
     - .. image:: images/driverview_segmentation_01.png
         :width: 400

Exploring Different SDG Workflows
---------------------------------

Isaac Sim offers many standalone examples that you can use to generate different types of synthetic data.
You can browse through all the available examples in the Isaac Sim `documentation <https://docs.isaacsim.omniverse.nvidia.com/5.0.0/replicator_tutorials/tutorial_replicator_overview.html>`_.

For example, instead of using the scene-based SDG workflow, you can use the `object-based SDG workflow <https://docs.isaacsim.omniverse.nvidia.com/5.0.0/replicator_tutorials/tutorial_replicator_object_based_sdg.html>`_.

To use the object-based SDG workflow, you can modify the Isaac Sim command of the entrypoint script, as denoted in the annotation:

.. code-block:: bash

  - contents: |
      set -e
      /isaac-sim/python.sh /isaac-sim/standalone_examples/replicator/object_based_sdg/object_based_sdg.py --config /tmp/config.json # (1)
      cp -r /isaac-sim/_out_obj_based_sdg_pose_writer/. {{output}} # (2)
    path: /tmp/entry.sh

.. code-annotations::
  1. Notice that the path is different. Now it is using the object-based SDG example, which lives at `replicator/object_based_sdg/object_based_sdg.py`.
  2. The location where Isaac Sim is writing the data has changed, so the path for the source is updated.

You can update the name of the dataset to distinguish it from the scene-based SDG workflow, and submit the workflow again.

Once you download the dataset, you can see examples of objects with bounding boxes using domain randomization:

.. list-table::
   :widths: 50 50
   :header-rows: 0

   * - Original Image
     - Bounding Box Overlay
   * - .. image:: images/object_based_rgb.png
         :width: 400
         :align: center
     - .. image:: images/object_based_bounding_box.png
         :width: 400
         :align: center
   * - .. image:: images/object_based_rgb_02.png
         :width: 400
         :align: center
     - .. image:: images/object_based_bounding_box_02.png
         :width: 400
         :align: center
   * - .. image:: images/object_based_rgb_03.png
         :width: 400
         :align: center
     - .. image:: images/object_based_bounding_box_03.png
         :width: 400
         :align: center

Writing Your Custom SDG Workflow
--------------------------------

If you want to use your own Isaac Sim script, you can add your Isaac Sim SDG script to the workflow:

.. code-block:: yaml

  files:
  - contents: |
      ...
    path: /tmp/entry.sh
  - contents: |
      ...
    path: /tmp/config.json
  - path: /my_sdg_script.py
    localpath: <path/to/your/script.py> # (1)

.. code-annotations::
  1. This path can just have the name of the script if it is in the same directory as the workflow.

In the entrypoint script, you can use the path to the script:

.. code-block:: bash

  /isaac-sim/python.sh /my_sdg_script.py --config /tmp/config.json
