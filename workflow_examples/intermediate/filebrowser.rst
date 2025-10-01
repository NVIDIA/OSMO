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

.. _filebrowser:

================================================
Using Filebrowser
================================================

Example
-------

This workflow:

* Sets up a web-based file browser interface for remote workspace access
* Installs the filebrowser tool via curl
* Configures it to serve files from ``/workspace/examples`` directory
* Makes the interface accessible via port 8080 when port-forwarded

.. md-tab-set::

  .. md-tab-item:: Workflow

    .. literalinclude:: ../../../samples/remote_tools/file_browser.yaml
      :language: yaml

  .. md-tab-item:: App

    .. code-block:: bash

      $ osmo app submit sample-filebrowser

When the workflow is running, run the port-forward command:

.. code-block:: bash

    $ osmo workflow port-forward file-browser-1 browser --port 8080:8080

Once this command is running, go to your browser and visit localhost:8080.
Enter the default username ``admin`` and password shown in the workflow logs to access the file browser.

.. image:: filebrowser.gif
  :width: 1200
  :align: center
