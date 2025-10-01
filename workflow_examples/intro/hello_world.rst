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

.. _hello_world:

================================================
Hello World!
================================================

In this tutorial you will submit your first OSMO workflow. For install and login instructions,
see :ref:`install`.

To verify the OSMO version you are using:

.. code-block:: bash

  $ osmo version

When you are able to verify the version successfully, you can begin the tutorial steps.


Create Workflow
-----------------

1. Create a folder where you can store your workflow specification:

.. code-block:: bash

  $ mkdir -p ~/workflow_specs

2. Create a new file in the folder and name it ``hello_world.yaml``:

.. code-block:: bash

  $ vim ~/workflow_specs/hello_world.yaml

3. Copy the following workflow spec into the file:

.. literalinclude:: ../../../samples/hello_world/hello_world.yaml
  :language: yaml

Submit Workflow
---------------------

1. Submit your workflow to the service:

.. code-block:: bash
  :substitutions:

  $ osmo workflow submit ~/workflow_specs/hello_world.yaml
  Workflow submit successful.
      Workflow ID   - hello-osmo-1
      Workflow Overview - |osmo_url|/workflows/hello-osmo-1

2. Review the status of the workflow by using the query command:

.. code-block:: bash

  $ osmo workflow query <workflow ID>

Where ``<workflow ID>`` is the workflow ID shown after submission, for example:

.. code-block:: bash

  $ osmo workflow query hello-osmo-1

3. Review the logs of the workflow using the log command:

.. code-block:: bash

  $ osmo workflow logs <workflow ID>

Logs are streamed to your command line as the workflow continues to run real time. A typical output is:

.. code-block:: bash
  :class: no-copybutton

  Workflow hello-osmo-1 has logs:
  2023/10/20 23:06:13 [hello][osmo] Downloading Start
  2023/10/20 23:06:13 [hello][osmo] All Inputs Gathered
  2023/10/20 23:06:13 [hello] Hello from OSMO!
  2023/10/20 23:06:13 [hello][osmo] Upload Start
  2023/10/20 23:06:13 [hello][osmo] No Files in Output Folder
  2023/10/20 23:06:14 [hello][osmo] hello is running on osmo

4. For more details on the workflow, you can pass an extra argument to the query command:

.. code-block:: bash

  $ osmo workflow query <workflow ID> --format-type json
