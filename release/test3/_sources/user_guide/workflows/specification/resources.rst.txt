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

.. _workflow_spec_resources:

============
Resources
============

A resource spec defines the number and types of resources required to run the task.
The following fields are used to describe a resource spec:

..  list-table::
  :header-rows: 1
  :widths: 40 160

  * - **Field**
    - **Description**
  * - ``cpu``
    - Specify the amount of cores to request
  * - ``memory``
    - Specify the amount of memory (RAM) to use.
  * - ``storage``
    - Specify the amount of disk space to use.
  * - ``gpu``
    - Specify the amount of GPUs to request
  * - ``platform``
    - Specify the platform to target. If no platform is specified, the default platform for the
      pool is used if the admins have specified a default platform. Learn more at :ref:`Pool List <cli_reference_pool>`.
  * - ``nodesExcluded``
    - Specify the nodes to exclude from the resource spec.

.. note::

  The default resource spec can be configured but requires service-level configuration.
  If you have administrative access, you can enable this directly. Otherwise, contact someone
  with pool administration privileges.

Multiple resource specs can be defined in the same workflow and assigned individually to tasks.
To define a resource spec in the workflow, use the ``resources`` field under ``workflow``. To
assign the resource to each task, use the ``resource`` field under ``tasks``:

.. code-block:: yaml

  workflow:
    name: my_workflow
    resources:
      default:                # (1)
        cpu: 1
        memory: 16Gi
        storage: 1Gi
        platform: ovx-a40
      x86_gpu:                # (2)
        cpu: 4
        gpu: 1
        memory: 16Gi
        storage: 1Gi
        platform: dgx-a100
    tasks:
    - name: task1
      resource: default       # (3)
      ...
    - name: task2
      resource: x86_gpu       # (4)
      ...
    - name: task3             # (5)
      ...

.. code-annotations::

  1. Defines the ``default`` resource spec which targets an A40 node.
  2. Defines the ``x86_gpu`` resource spec uses a single GPU which targets an A100 node.
  3. Assigns the ``default`` resource to task1.
  4. Assigns the ``x86_gpu`` resource to task2.
  5. Since ``task3`` does not define a resource, the ``default`` resource spec will be used.

If the resource field is left blank, the ``default`` resources are used.

Follow the :ref:`Resource List CLI <cli_reference_resource>` for available resources before building the
resource spec.

If there are some node with poor performance or network in the pool, you can exclude them using the
``nodesExcluded`` field in the resource spec:

.. code-block:: yaml

  resources:
    default:
      cpu: 1
      memory: 16Gi
      storage: 1Gi
      nodesExcluded:
      - worker1
      - worker2

.. warning::

  Excluding too many nodes can lead to the tasks stuck in PENDING forever!
