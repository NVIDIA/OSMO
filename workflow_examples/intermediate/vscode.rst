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

.. _vscode:

================================================
Using VSCode Server
================================================

Example
-------

The workflow:

- Uses a container with PyTorch base image
- Downloads and installs code-server (VSCode server)
- Starts VSCode server on port 9000 with authentication disabled
- Can be accessed via browser after port-forwarding

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/remote_tools/vscode.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-vscode

When the workflow is running, run the port-forward command:

.. code-block:: bash

    $ osmo workflow port-forward <workflow_id> webserver --port 9000:9000

Once this command is running, go to your browser and visit localhost:9000.

.. image:: vscode.gif
  :width: 1200
  :align: center
