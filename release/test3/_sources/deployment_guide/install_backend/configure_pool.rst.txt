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

.. _configure_pool:

================================================
Create Resource Pools
================================================

After registering a backend to OSMO, you must configure resource pools to organize and allocate compute resources. Users submit AI workflows to these pools, which define what resources are available and how they can be accessed. This configuration allows you to control resource allocation, set quotas, and manage access across different user groups.

For detailed information about pools, see :ref:`pool`.

Configure Default Pool
========================

OSMO automatically creates a default pool during initial service deployment. Link this pool to your registered backend by updating the pool configuration using the OSMO CLI:

.. code-block:: bash

  $ cat << EOF > /tmp/pool_config.json
  {
    "pools": {
      "default": {
        "backend": "<backend-name>",
        "description": "<pool-description>"
      }
    }
  }
  EOF

  $ osmo config update POOL --file /tmp/pool_config.json

.. note::
  If your backend is named ``default``, you can skip this configuration step.

Validate Pool Configs
========================

Verify the pool configuration:

.. code-block:: bash

  $ osmo pool list
  Pool      Description    Status    GPU [#]
                                   Quota Used   Quota Limit   Total Usage   Total Capacity
  =============================================================================================
  default   Default pool   ONLINE    N/A          N/A           0             24
  =============================================================================================
                                                                0             24

.. seealso::

  See :ref:`advanced_pool_configuration` to add new resource pools
