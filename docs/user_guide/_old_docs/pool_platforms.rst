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

.. _concepts_pool_platform:

================================================
Pools and Platforms
================================================

A pool is an abstraction of a backend cluster managed by Distribution Lists (DLs).
Each pool can have a set of platforms that users can target.

A platform in OSMO is a set of resources that users can target within a pool. This allows users to
target a specific machine or gpu that they want to run their task against.

To view the available pools, you can use the following command:

.. code-block:: bash

  $ osmo pool list
  Pool        Description     Status    GPU [#]
                                        Quota Used   Quota Limit   Total Usage   Total Capacity
  =============================================================================================
  pool_name   Join DL: pool   ONLINE    50           100           55            100

Learn more about :ref:`pools <wf_pool>`.

To view available platforms for a given pool, you can use the following command:

.. code-block:: bash

  $ osmo resource list --pool pool
  Node      Pool        Platform          Type     Storage [Gi]   CPU [#]   Memory [Gi]   GPU [#]
  ===============================================================================================
  node1     pool        dgx-v100          SHARED   100/1024       20/128    512/1024      3/4
  node2     pool        dgx-a100          SHARED   500/1024       52/128    256/1024      4/4
  node3     pool        dgx-h100          SHARED   600/1024       103/128   712/1024      6/8
  ===============================================================================================
                                                   1200/3072      175/384   1480/3072     13/16


To submit to a pool, you can use the following command:

.. code-block:: bash

  $ osmo workflow submit workflow_spec.yaml --pool pool_name

Learn more about :ref:`submitting to a pool <wf_submit>`.

To specify a platform, in the resource specification, you can use the following syntax:

.. code-block:: yaml

  resources:
    platform: dgx-h100

If no platform is specified, the default platform for the pool will be used.

Learn more about :ref:`resources <concepts_wf_resources>`.
