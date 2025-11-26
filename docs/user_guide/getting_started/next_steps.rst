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
..

.. _getting_started_next_steps:

==========
Next Steps
==========

You have successfully completed:

✓ **Client Installed** - CLI installed and authenticated with OSMO

✓ **Profile Configured** - Notifications, default pool, and bucket set

✓ **Credentials Added** - Registry and data access configured

✓ **Ready to Run** - Your workflows can now access compute and storage


What You Can Do Now
===================

Your OSMO environment gives you access to:

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: 🚀 Submit Workflows
          :link: ../workflows/submission
          :link-type: doc

          Define tasks in YAML, submit to OSMO, and let the platform handle scheduling and execution.

      .. grid-item-card:: 💻 Interactive Development
          :link: ../workflows/interactive/index
          :link-type: doc

          Use SSH, VSCode, or Jupyter notebooks to interactively develop and debug in running tasks.

      .. grid-item-card:: 🎯 Distributed Training
          :link: ../how_to/training
          :link-type: doc

          Run training jobs and simulations across GPU clusters without managing infrastructure.

      .. grid-item-card:: 🤖 Hardware-in-the-Loop (HIL)
          :link: ../how_to/hil
          :link-type: doc

          Test robot policies on real hardware like Jetson while running simulation on GPU nodes.

.. only:: not html

   * **Submit Workflows** - Define tasks in YAML, submit to OSMO, and let the platform handle scheduling and execution. (:doc:`../workflows/submission`)
   * **Interactive Development** - Use SSH, VSCode, or Jupyter notebooks to interactively develop and debug in running tasks. (:doc:`../workflows/interactive/index`)
   * **Distributed Training** - Run training jobs and simulations across GPU clusters without managing infrastructure. (:doc:`../how_to/training`)
   * **Hardware-in-the-Loop (HIL)** - Test robot policies on real hardware like Jetson while running simulation on GPU nodes. (:doc:`../how_to/hil`)

----

Run Your First Workflow
=======================

The :ref:`Hello World tutorial <tutorials_hello_world>` takes 5 minutes and covers:

* Creating a workflow YAML definition
* Submitting via CLI or Web UI
* Querying workflow status
* Retrieving logs and results

.. button-ref:: ../tutorials/hello_world/index
   :color: primary
   :expand:
   :outline:

   Start Hello World Tutorial →
