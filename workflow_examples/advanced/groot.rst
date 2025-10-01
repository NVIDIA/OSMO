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

.. _groot:

================================================
Inference and Fine-tuning with Isaac Groot
================================================

Example
-------

Workflow
~~~~~~~~

This workflow demonstrates how to perform inference and fine-tuning using (Isaac Groot)[https://github.com/NVIDIA/Isaac-GR00T.

The workflow consists of:

- A JupyterLab interface
- All of the Isaac Groot tutorial Jupyter notebooks that feature fine-tuning and inference

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/groot/groot.yaml
      :language: yaml

    .. code-block:: bash

      $ osmo workflow submit ~/workflow_specs/groot.yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-groot

After the workflow starts running, you can access the JupyterLab interface by running the following command:

.. code-block:: bash

  $ osmo workflow port-forward <workflow ID> tutorial --port 6060

You can then access the JupyterLab interface by navigating to http://localhost:6060 in your browser.
On the left hand side, you can see the list of all the tutorial notebooks.

.. image:: groot_jupyter.png
  :width: 800
  :align: center

When running the notebooks, there are sections that require you to run Python scripts outside the notebook.
For example, in the `Fine-tuning` notebook, you will need to run the following script:

.. code-block:: bash

  $ python scripts/gr00t_finetune.py \
    --dataset-path ./demo_data/robot_sim.PickNPlace \
    --num-gpus 1 \
    --max-steps 500 \
    --output-dir /tmp/gr00t-1/finetuned-model

To run Python scripts like these, you can create an exec session, and run the scripts there instead:

.. code-block:: bash

  $ osmo workflow exec <workflow ID> tutorial --entry /bin/bash

Once you are in the exec session, you can run the Python script:

.. code-block:: bash

  root@a139e0d265f34309-9e501b6472754fb3:/workspace# python scripts/gr00t_finetune.py \
    --dataset-path ./demo_data/robot_sim.PickNPlace \
    --num-gpus 1 \
    --max-steps 500 \
    --output-dir /tmp/gr00t-1/finetuned-model \
    --data-config gr1_arms_only

You can keep the exec session open and run multiple scripts as outlined in later notebooks,
especially in the `New Embodiment Fine-tuning` notebook.
