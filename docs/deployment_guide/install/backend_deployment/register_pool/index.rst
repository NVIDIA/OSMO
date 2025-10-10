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

.. _register_pool:

================================================
Register Pool
================================================

Once the backend operators are deployed, a pool must be configured so users can target the compute resources in their workflow.
For a refresher, see :ref:`pool`.


Prerequisites
================================================

- Install and configure the OSMO CLI: `Install the OSMO CLI <../../../docs/getting_started/install.html#install-client>`_
- A registered compute backend; see :ref:`register_cb`

Configure Pool
================================================

During the initial deployment of the service, a default pool is created.
To link the pool to the backend defined in previous steps, update the pool configuration using the OSMO CLI.

.. note::
  If you have named your backend ``default``, you can skip this step and use the default pool.

.. code-block:: bash

  echo '{
    "default": {
      "backend": "<backend name>",
      "description": "<pool description>"
    }
  }' > /tmp/pool_config.json

Then, update the pool configuration using the OSMO CLI.

.. code-block:: bash

  osmo config update POOL --file /tmp/pool_config.json

Validate
--------------------------

Using the OSMO CLI, run ``osmo pool list`` to see if the newly added pool is available.

.. code-block:: bash
  :substitutions:

  $ osmo pool list
  Pool         Description         Status    GPU [#]
                                             Quota Used   Quota Limit   Total Usage   Total Capacity
  =============================================================================================
  <pool name>  <pool description>  ONLINE    N/A          N/A           0             24
  =============================================================================================
                                                                        0             24
