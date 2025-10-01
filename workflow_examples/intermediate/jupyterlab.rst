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

.. _jupyterlab:

================================================
Using JupyterLab
================================================

Example
-------

This workflow launches a JupyterLab server that can be accessed remotely.
It runs a single task that:

- Uses the PyTorch container image with CUDA support
- Starts JupyterLab on port 6060 configured for remote access
- Can be accessed via port-forwarding after the workflow starts

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/remote_tools/jupyter.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-jupyter

Once the workflow is running, run the port-forward command:

.. code-block:: bash

    $ osmo workflow port-forward jupyterlab-20 notebook --port 6060:6060

Once this command is running, go to your browser and visit localhost:6060.

.. image:: jupyter.png
  :width: 1200
  :align: center
