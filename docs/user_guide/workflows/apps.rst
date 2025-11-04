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

.. _apps:

================================================
Apps
================================================

What are Apps?
==============

An **App** is a parameterized workflow template stored in OSMO that can be launched with custom parameters.
It consists of two main parts:

1. **Workflow Template**: The workflow specification with template variables (``{{ variable_name }}``)
2. **Default Values**: Default parameter values with inline documentation

Why Apps?
=========

Apps enables existing workflows to be:

* **reusable** - predictably reused by other users
* **extensible** - templated and can be extended by with custom parameters
* **centralized** - stored centrally in OSMO instead of locally on your machine

.. list-table::
   :header-rows: 1
   :widths: 20 40 40

   * - Feature
     - Regular Workflows
     - Apps
   * - **Storage**
     - Local YAML files on your machine
     - Centralized in OSMO cloud
   * - **Sharing**
     - Manual (email, chat, shared folders)
     - Automatic discovery with

       ``osmo app list``
   * - **Parameters**
     - Hidden in YAML, users must read docs
     - Self-documenting with

       ``osmo app show``
   * - **Updates**
     - Re-share files to everyone
     - Automatic - everyone uses latest version
   * - **Discovery**
     - Ask colleagues "Do we have a workflow for X?"
     - Search and browse:

       ``osmo app list --name training``
   * - **Versioning**
     - Manual file naming (v1, v2, final, final-final)
     - Built-in version control

.. note::

   **Key Benefit**: Apps are workflows that are stored centrally in OSMO instead of locally on your machine.
   This enables collaboration, self-documentation, and easy sharing across your entire team.

----

Quick Start: Your First App in 5 Minutes
================================================

Let's create a simple training app that anyone can launch with custom parameters.

Step 1: Create an App
---------------------

First, create a file called ``training-app.yaml`` with a parameterized workflow:

.. code-block:: yaml

   workflow:
     name: {{ workflow_name }}
     tasks:
     - name: training-task
       image: {{ docker_image }}
       command: "python"
       args: ["train.py", "--model", "{{ model_name }}", "--epochs", "{{ epochs }}"]

   default-values:
     workflow_name: ml-training-run     # Name for the workflow instance
     docker_image: pytorch/pytorch      # Docker image to use
     model_name: resnet50               # Model architecture
     epochs: 10                         # Number of training epochs

Create the app in OSMO:

.. code-block:: bash

   $ osmo app create training-app \
       --description "ML training app for computer vision models" \
       --file training-app.yaml

   App training-app created successfully

Step 2: Submit the App
----------------------

Now anyone can launch this app with custom parameters:

.. code-block:: bash

   $ osmo app submit training-app \
       --set model_name="vit-large" \
       --set epochs=20

   Workflow submit successful.
       Workflow ID        - ml-training-run-1
       Workflow Overview  - https://osmo.example.com/workflows/ml-training-run-1

That's it! The workflow is now running with your custom parameters.

Step 3: Share with Your Team
----------------------------

Your teammates can now discover and use your app:

.. code-block:: bash

   # Discover available apps
   $ osmo app list
   Owner      Name           Description                     Created Date   Latest Version
   =======================================================================================
   you        training-app   ML training app for CV models   Oct 27, 2025   2

   # See what parameters are available
   $ osmo app show training-app
   DESCRIPTION
     ML training app for computer vision models

   PARAMETERS
     workflow_name: ml-training-run     # Name for the workflow instance
     docker_image: pytorch/pytorch      # Docker image to use
     model_name: resnet50               # Model architecture
     epochs: 10                         # Number of training epochs

   # Launch it with their own parameters
   $ osmo app submit training-app --set model_name="efficientnet" --set epochs=50

----

Understanding Apps in Depth
================================================

App Anatomy
-----------

.. code-block:: yaml

   workflow:
     # This is the workflow template - same structure as regular workflows
     # Use {{ variable }} syntax for parameterization
     name: {{ workflow_name }}
     tasks:
     - name: {{ task_name }}
       image: {{ image }}
       command: "sleep"
       args: ["{{ sleep_time }}"]

   default-values:
     # These are the default parameters users can override
     # Add inline comments to document what each parameter does
     workflow_name: my-workflow    # Name for this workflow instance
     task_name: main-task          # Name of the primary task
     image: ubuntu:22.04           # Container image to use
     sleep_time: 300               # Time to sleep in seconds

Template Variables
~~~~~~~~~~~~~~~~~~

.. seealso::

   See :ref:`here <workflow_spec_templates_and_special_tokens>` for more details on template variables and special tokens.

Use Jinja2-style template variables anywhere in your workflow:

.. code-block:: yaml

   workflow:
     name: {{ workflow_name }}
     tasks:
     - name: training
       image: {{ training_image }}
       env:
         LEARNING_RATE: "{{ learning_rate }}"
         BATCH_SIZE: "{{ batch_size }}"

When users submit the app, they can override any of these values using ``--set``:

.. code-block:: bash

   $ osmo app submit my-app \
       --set training_image="pytorch/pytorch" \
       --set learning_rate=0.001 \
       --set batch_size=128

App Versioning
--------------

Apps support automatic versioning. Every update creates a new version:

.. code-block:: bash

   $ osmo app info training-app
   Name: training-app
   Owner: you@nvidia.com

   Version   Created By   Created Date        Status
   ===================================================
   1         you          Oct 26, 2025        READY
   2         you          Oct 27, 2025        READY
   3         teammate     Oct 28, 2025        READY    ← Latest

By default, ``osmo app submit`` uses the latest version. You can specify a version:

.. code-block:: bash

   $ osmo app submit training-app:2 --set model_name="resnet50"

.. hint::

   Specify the version to submit via ``{app_name}:{version_number}`` format.

Global Naming
-------------

.. important::

   App names are **global across your OSMO instance**. If someone has already created an app called
   ``training-app``, you'll need to choose a different name. Consider using prefixes like
   ``team-training-app`` or ``yourname-training-app``.

----

Best Practices
================================================

App Design
------------------------------------------------

**1. Use descriptive parameter names**

.. code-block:: yaml

   # Good
   default-values:
     docker_image: ubuntu:22.04        # Container image to use
     gpu_count: 4                      # Number of GPUs per node

   # Bad
   default-values:
     img: ubuntu:22.04
     n: 4

**2. Provide inline documentation for all parameters**

.. code-block:: yaml

   default-values:
     learning_rate: 0.001              # Initial learning rate for optimizer
     batch_size: 32                    # Training batch size per GPU
     checkpoint_freq: 1000             # Save checkpoint every N steps

**3. Choose sensible defaults**

Pick defaults that work for the common case:

.. code-block:: yaml

   default-values:
     workflow_name: training-run       # Users might override this
     epochs: 10                        # Good starting point

**4. Group related apps with naming conventions**

.. code-block:: bash

   ml-training-vision      # For computer vision
   ml-training-nlp         # For NLP
   ml-training-rl          # For reinforcement learning

   data-pipeline-daily     # Daily ETL
   data-pipeline-hourly    # Hourly ETL

Security
--------

**1. Don't hardcode secrets in app specs**

.. code-block:: yaml

   # Bad - hardcoding secrets in the app spec
   env:
     API_KEY: "sk-1234567890abcdef"

   # Bad - secrets will be templated and rendered in the workflow spec
   env:
     API_KEY: "{{ api_key }}"

Instead, setup a :ref:`credential <workflow_spec_secrets>` and use it in the app spec:

.. code-block:: yaml

   credentials:
     api_key:
       API_KEY: "{{ api_key }}"

**2. Be careful with local file paths**

Ensure you're not accidentally uploading sensitive files when using ``--local-path``.

----

Troubleshooting
================================================

**Issue**: App name already exists

.. code-block:: text

   Error: App name 'my-app' already exists

**Solution**: Choose a unique name. App names are global across your OSMO instance.

.. code-block:: bash

   $ osmo app create team-myapp --description "..."  # Add a prefix

---

**Issue**: App status is PENDING

.. code-block:: bash

   $ osmo app info my-app
   Version   Status
   =================
   1         PENDING

**Solution**: Wait a few moments. The app is being processed and will be available shortly.

---

**Issue**: Cannot find local files

.. code-block:: text

   Error: File not found: scripts/train.py

**Solution**: Use ``--local-path`` to specify the correct base directory:

.. code-block:: bash

   $ osmo app submit my-app --local-path /absolute/path/to/project

---

**Issue**: Parameters not being substituted

.. code-block:: yaml

   # In app spec
   command: "{{ command }}"

.. code-block:: bash

   $ osmo app submit my-app
   # Workflow runs with literal "{{ command }}" instead of substitution

**Solution**: Provide values for all template variables:

.. code-block:: bash

   $ osmo app submit my-app --set command="python train.py"

Or define them in ``default-values``.

---

**Issue**: Can't update someone else's app

**Note**: Anyone can update any app (not just the owner). If you're getting an error, check:

1. The app name is correct: ``osmo app list --all-users``
2. Your file has valid YAML syntax
3. The app is not currently in a :kbd:`PENDING` or :kbd:`DELETED` state

CLI Reference
=============

.. seealso::

   See :ref:`here <cli_reference_app>` for a complete CLI reference for working with apps.
