
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

.. _guides_reinforcement_learning:

============================================================
Isaac Lab: Training Robot Policy with Reinforcement Learning
============================================================

This tutorial walks you through running a reinforcement learning training job on a single node with OSMO,
using `Isaac Lab <https://developer.nvidia.com/isaac/lab>`_, NVIDIA's framework for robot learning.
You will learn the basics of launching a training script, monitoring training progress using TensorBoard,
and reviewing the checkpoints and videos of the trained policy.

The complete workflow example is available `here <https://github.com/NVIDIA/OSMO/tree/main/workflows/reinforcement_learning>`_.

Prerequisites
-------------

For this tutorial, make sure:

- The compute cluster has a GPU that satisfies Isaac Sim's `system requirements <https://docs.isaacsim.omniverse.nvidia.com/latest/installation/requirements.html>`_ (preferably an RTX 5080 or better)
- You have an OSMO data credential

.. seealso::

  You can check out the data credentials :ref:`section <credentials_data>` for more information.

Building the Workflow
---------------------

You will first create a workflow spec file that specifies the training script to run.

We will reference the commands in the Isaac Lab reinforcement learning `example for Stable Baselines 3 <https://isaac-sim.github.io/IsaacLab/main/source/overview/reinforcement-learning/rl_existing_scripts.html#stable-baselines3>`_.
The Python modules are already installed in the Isaac Lab image, so we can skip that installation command,
and use the training command directly.

.. code-block:: bash

  workflow:
    name: train-robot-policy
    tasks:
    - name: train
      command: ["bash"]
      args: ["/tmp/entry.sh"]
      image: nvcr.io/nvidia/isaac-lab:2.2.0
      environment: # (1)
        ACCEPT_EULA: Y
        NO_NUCLEUS: Y
      files:
      - contents: |2-
          set -euxo pipefail

          ./isaaclab.sh -p scripts/reinforcement_learning/sb3/train.py \
            --task Isaac-Velocity-Flat-Unitree-A1-v0 --headless

          apt update && apt install -y ffmpeg  # (2)
          ./isaaclab.sh -p scripts/reinforcement_learning/sb3/play.py \
            --task Isaac-Velocity-Flat-Unitree-A1-v0 --headless --video --video_length 200  # (3)

          mv logs/ {{output}}/  # (4)

        path: /tmp/entry.sh
      outputs:
      - dataset:
          name: robot-policy-dataset

.. code-annotations::
  1. These are the environment variables required for Isaac Lab to run.
  2. This installation is required for the play script below.
  3. After training the policy, you can play and evaluate the trained policy in simulation.
     Since the machine is not attached to a display, we will pick the headless version of the play command,
     by picking the command that plays the agent and records it in video.
  4. Isaac Lab directly writes the data to the `logs/` directory. Moving the model checkpoints and videos to the output directory.

Monitoring Training Progress with TensorBoard
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

If you want to use TensorBoard for monitoring your training progress, you can launch it through a background process (using ``&``) before launching the training script,
and kill it after the training is done.

.. code-block:: yaml

  tasks:
  - name: train
    files:
    - path: /tmp/entry.sh
      contents: |
        # ...

        # Launch TensorBoard using the Isaac Lab native command
        ./isaaclab.sh -p -m tensorboard.main --logdir=logs &

        # Launch training

        # Kill TensorBoard when training is done
        pkill -f "python3 -m tensorboard.main --logdir=logs" || true

.. important::

    If you launch TensorBoard in the same task as the training script, you need to stop it at the end so that the workflow can finish.

The complete workflow spec file is available as `train_policy.yaml <https://github.com/NVIDIA/OSMO/blob/main/workflows/reinforcement_learning/single_gpu/train_policy.yaml>`_.

Running the Workflow
~~~~~~~~~~~~~~~~~~~~

After you submit your workflow and the task is running, you can run the port-forward command to forward the TensorBoard to your local port:

.. code-block:: bash

  $ osmo workflow port-forward <workflow ID> train --port 6006

Open your browser and visit ``http://localhost:6006`` to see the TensorBoard:

.. image:: images/tensorboard_reinforcement_learning.png
  :width: 800
  :align: center

Reviewing Training Results
--------------------------

The model checkpoints and videos are saved in the `robot-policy-dataset` dataset.
You can get the checkpoints and videos by downloading the dataset:

.. code-block:: bash

  osmo dataset download robot-policy-dataset ~/

You will be able to see the checkpoints in the folder structure below, named ``model_<steps>_steps.zip``.

.. code-block:: none

  robot-policy-dataset/
  └── logs/
      └── sb3/
          └── Isaac-Velocity-Flat-Unitree-A1-v0/
              └── <date>/
                  ├── command.txt
                  ├── model.zip
                  ├── model_4096000_steps.zip
                  ├── model_8192000_steps.zip
                  ├── ...
                  ├── model_45056000_steps.zip
                  ├── model_49152000_steps.zip
                  ├── model_vecnormalize.pkl
                  ├── params/
                  └── videos/
                      └── play/
                          └── rl-video-step-0.mp4

In the `videos/play/` sub-directory, you can view the video of the trained policy running on robots in simulation:

.. image:: images/rl-video-step-0.gif
  :width: 600
  :align: center

Running Other Reinforcement Learning Examples
---------------------------------------------

Isaac Lab supports other reinforcement learning libraries such as RL Games, RSL-RL, and SKRL too, and you can view
all the examples in the `Isaac Lab documentation <https://isaac-sim.github.io/IsaacLab/release/2.2.0/source/overview/reinforcement-learning/rl_existing_scripts.html>`_.

In this tutorial we were using Stable Baselines 3 to train the policy, but you can modify the entry script to use other libraries as well.

For example, you can pick the `RSL-RL training script <https://isaac-sim.github.io/IsaacLab/release/2.2.0/source/overview/reinforcement-learning/rl_existing_scripts.html#rsl-rl>`_,
which will train a Franka arm robot to reach target locations. You can modify the entry script to call the new training script:

.. code-block:: bash

    files:
    - contents: |2-

        set -euxo pipefail

        ./isaaclab.sh -p scripts/reinforcement_learning/rsl_rl/train.py \
          --task Isaac-Reach-Franka-v0 --headless  # (1)

        apt update && apt install -y ffmpeg
        ./isaaclab.sh -p scripts/reinforcement_learning/rsl_rl/play.py \ # (2)
          --task Isaac-Reach-Franka-v0 --headless --video --video_length 200

        mv logs/ {{output}}/

      path: /tmp/entry.sh

.. code-annotations::
  1. The training script command is updated here to use RSL-RL.
  2. The play script command is also updated here.

After the workflow completes, you can access the results through the dataset as well! This is the video of the
Franka arm robot reaching the target locations.

.. image:: images/rl-franka-video-step-0.gif
  :width: 800
  :align: center
