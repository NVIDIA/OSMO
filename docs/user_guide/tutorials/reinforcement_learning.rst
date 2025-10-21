
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

.. _reinforcement_learning:

Training Robot Policy through Reinforcement Learning using Isaac Lab
--------------------------------------------------------------------

This tutorial walks you through running a reinforcement learning training job on a single node with OSMO.
You'll learn the basics of launching your training script, selecting resources, managing data
and monitoring training progress using TensorBoard.

The complete workflow example is available `here <https://github.com/NVIDIA/OSMO/tree/main/workflow_examples/reinforcement_learning>`_.

Launching a Training Script in a Workflow
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

You will first create a workflow spec file that specifies the training script to run.

.. code-block:: yaml

    tasks:
    - name: train
      command: ["bash"]
      args: ["/tmp/entry.sh"]
      image: nvcr.io/nvidia/isaac-lab:2.2.0
      environment: # (1)
        ACCEPT_EULA: Y
        NO_NUCLEUS: Y
        OMNI_KIT_ALLOW_ROOT: '1'
        OMNI_SERVER: isaac-dev.ov.nvidia.com

.. code-annotations::
  1. These are the environment variables required for Isaac Lab to run.

We will reference the commands in the Isaac Lab reinforcement learning `example for Stable Baselines 3 <https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/rl_existing_scripts.html#stable-baselines3>`_.
The Python modules are already installed in the Isaac Lab image, so we can skip that installation command,
and use the training command directly.

Then, you will create the entry script that will define the command to run:

.. code-block:: bash

      files:
      - contents: |2-

          set -euxo pipefail

          ./isaaclab.sh -p scripts/reinforcement_learning/sb3/train.py \
            --task Isaac-Velocity-Flat-Unitree-A1-v0 --headless  # (1)

        path: /tmp/entry.sh

.. code-annotations::
  1. This is the command to run the reinforcement learning training script.
     Note that you need to pass ``--headless`` to run the training script because the machine is
     not attached to a display.

Playing the Trained Policy
~~~~~~~~~~~~~~~~~~~~~~~~~~

After the training is done, you can play the trained policy in the simulation.
Since the machine is not attached to a display, we will pick the headless version of the play command,
by picking the command that plays the agent and records it in video:

.. code-block:: bash

      files:
      - contents: |2-

          set -euxo pipefail

          ./isaaclab.sh -p scripts/reinforcement_learning/sb3/train.py \
            --task Isaac-Velocity-Flat-Unitree-A1-v0 --headless

          apt update && apt install -y ffmpeg  # (1)
          ./isaaclab.sh -p scripts/reinforcement_learning/sb3/play.py \
            --task Isaac-Velocity-Flat-Unitree-A1-v0 --headless --video --video_length 200  # (2)

        path: /tmp/entry.sh

.. code-annotations::
  1. This installation is required for the play script below.
  2. This is the command to run the reinforcement learning play script.

Saving Training Results
~~~~~~~~~~~~~~~~~~~~~~~

To save the trained model as an OSMO dataset, use the ``outputs`` field in your task spec:

.. code-block:: yaml

  - name: train
    outputs:
    - dataset:
        name: robot-policy-dataset  # (1)
        path: output  # (2)

.. code-annotations::
  1. The name of the output dataset.
  2. The path to the output dataset.

Isaac Lab directly writes the data to the `logs/` directory.
After running the training and play script, we will move the the data to the output directory
and use the `output` path to save the trained model as an OSMO dataset.

.. code-block:: bash

  mkdir -p {{output}}/output
  mv logs/sb3/ {{output}}/output/  # (1)

.. code-annotations::
  1. The path to the output dataset. Note that the path defined in the dataset path is
     relative to the `{{output}}` directory.


**TensorBoard**

If you want to use TensorBoard for monitoring your training progress, you can launch it before launching the training script through a separate process,
and stop it after the training is done.

.. code-block:: yaml

  tasks:
  - name: train
    files:
    - path: /tmp/entry.sh
      contents: |
        # ...

        # Launch TensorBoard
        ./isaaclab.sh -p -m tensorboard.main --logdir=logs &

        # Launch training

        # Kill TensorBoard when training is done
        pkill -f "python3 -m tensorboard.main --logdir=logs" || true

.. note::
    If you launch TensorBoard in the same task as the training script, you need to stop it at the end so that the task can finish.

When the task is running, you can run the port-forward command to forward the TensorBoard to your local port:

.. code-block:: bash

  $ osmo workflow port-forward <workflow ID> train --port 6006

Open your browser and visit ``http://localhost:6006`` to see the TensorBoard:

.. image:: images/tensorboard_reinforcement_learning.png
  :width: 800
  :align: center

Reviewing Training Results
~~~~~~~~~~~~~~~~~~~~~~~~~~

The model checkpoints and videos are saved in the `robot-policy-dataset` dataset.
You can get the checkpoints and videos by downloading the dataset:

.. code-block:: bash

  osmo dataset download robot-policy-dataset ~/

You will be able to see the checkpoints in the
`~/robot-policy-dataset/output/sb3/Isaac-Velocity-Flat-Unitree-A1-v0/<date>` directory.

Once you are in that directory, you can view the video in the `videos/play/` subdirectory,
and you can view the video of the new policy running on the agents:

.. image:: images/rl-video-step-0.gif
  :width: 600
  :align: center

Running Other Reinforcement Learning Examples
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

Isaac Lab supports other reinforcement learning libraries such as RL Games, RSL-RL, and SKRL too, and you can view
all the examples in the `Isaac Lab documentation <https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/rl_existing_scripts.html>`_.

In this tutorial we were using Stable Baselines 3 to train the policy, but you can modify the entry script to use other libraries as well.

For example, you can pick the `RSL-RL training script <https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/rl_existing_scripts.html#rsl-rl>`_,
and modifying the entry script to call the new script:

.. code-block:: bash

    files:
    - contents: |2-

        set -euxo pipefail

        ./isaaclab.sh -p scripts/reinforcement_learning/rsl_rl/train.py \
          --task Isaac-Reach-Franka-v0 --headless  # (1)

        apt update && apt install -y ffmpeg
        ./isaaclab.sh -p scripts/reinforcement_learning/rsl_rl/play.py \
          --task Isaac-Reach-Franka-v0 --headless --video --video_length 200  # (2)

      path: /tmp/entry.sh

.. code-annotations::
  1. New command to run the RSL-RL training script.
  2. Note that the play script command will also need to be updated. Please refer to the documentation linked above.

After the workflow completes, you can access the results through the dataset as well!
