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

.. _wf_pool:

================================================
Pool
================================================

For an explanation of pools and platforms, refer to :ref:`concepts_pool_platform`.

Users can see all the pools that are available:

.. code-block:: bash

  $ osmo pool list -h
  usage: osmo pool list [-h] [--pool POOL [POOL ...]] [--format-type {json,text}] [--mode {free,used}]

  Pool resource display formats:
    Used mode (default): Shows the number of GPUs used and the total number of GPUs
    Free mode: Shows the number of GPUs available for use

  Columns:
    Quota Limit:    The maximimum number of GPUs that can be used by HIGH/NORMAL
                    priority workflows.
    Quota Used:     The number of GPUs currently used by HIGH/NORMAL priority
                    workflows.
    Quota Free:     The additional number of GPUs that can be used by HIGH/NORMAL
                    priority workflows.
    Total Capacity: The total number of GPUs available on the nodes in the pool.
    Total Used:     The total number of GPUs used by all workflows in the pool.
    Total Free:     The number of free GPUs on the nodes in the pool.

  options:
    -h, --help            show this help message and exit
    --pool POOL [POOL ...], -p POOL [POOL ...]
                          Display resources for specified pool.
    --format-type {json,text}, -t {json,text}
                          Specify the output format type (Default text).
    --mode {free,used}, -m {free,used}
                          Show free or used resources (Default used).

The command shows the GPUs available for use in each pool

.. note::

  This is not the list of pools the user can access. That information is shown in :ref:`profile <workflow_examples>`.

For example:

.. code-block:: bash

    $ osmo pool list
    Pool                  Description                       Status    GPU [#]
                                                                      Quota Used   Quota Limit   Total Usage   Total Capacity
    =========================================================================================================================
    training              Join DL: Access-osmo-training     ONLINE    20           20            25            40
    isaac                 Join DL: Access-osmo              ONLINE    15           20            15            40 (shared)
    =========================================================================================================================
                                                                      35           40            35            40

In this example, the ``training`` and ``isaac`` pools share the same 40 physical GPUs. Each pool has a quota of 20, so they are each allowed
to use up to 20 GPUs with non-preemptible workflows (``HIGH`` or ``NORMAL`` priority). The ``training`` pool is using all of its quota, but the ``isaac`` pool
is only using 15 of its quota, leaving 5 GPUs available. The ``training`` pool is taking advantage of these 5 GPUs by running ``LOW`` priority workflows
on them which do not count against the quota.

.. note::

  It is possible for a pool to go over the quota limit by scheduling workflows with ``LOW`` priority. If another pool needs those GPUs,
  by submitting a ``HIGH`` or ``NORMAL`` priority workflow, then the ``LOW`` priority workflows will be preempted.

To get a summary of how much of the quota/capacity is free, use the ``--mode free`` flag:

.. code-block:: bash

  $ osmo pool list --mode free
  Pool                  Description                       Status    GPU [#]
                                                                    Quota Free   Total Free
  =========================================================================================
  training              Join DL: Access-osmo-training     ONLINE    0            0
  isaac                 Join DL: Access-osmo              ONLINE    5            0 (shared)
  dev                   Join DL: Access-osmo-dev          ONLINE    4            4
  =========================================================================================
                                                                    9            4

To filter the results by pool name, append the ``--pool`` flag:

.. code-block:: bash

  osmo pool list --pool <pool name>

.. note::

  If the pool flag is not supplied, the command will return information about all pools in the service.
