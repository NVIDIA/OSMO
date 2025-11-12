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

.. _concepts_resources_pools_platforms:

=========
Overview
=========

.. _concepts_resources:

Resources
---------

A ``resource`` refers to the machine which is used to run a workflow. These resources are grouped
into ``pools`` and ``platforms`` so that you can share resources between other users and specify
what type of hardware you want to run your workflow on.

The diagram below illustrates the organizational hierarchy in an OSMO cluster. Click on pools or
platforms to learn more about each layer.

.. figure:: pool_organization.svg
   :width: 100%
   :align: center
   :class: transparent-bg no-scaled-link

The following sections explain each layer (i.e. ``pools`` and ``platforms``) in detail.

.. _concepts_pools:

Pools
-----

A ``pool`` is a group of resources that are shared between users which contains ``platforms``
to differentiate between different types of hardware. These pools are access controlled to enable
different teams to share resources.

.. dropdown:: How do pools manage workflow priority and preemption?
    :color: primary
    :icon: question

    Depending on the scheduler on the backend, a ``pool`` can have a quota imposed to limit the
    number of ``HIGH`` or ``NORMAL`` priority workflows (see :ref:`concepts_priority`).

    ``LOW`` priority workflows can go beyond the pool quota by borrowing unused GPUs
    available in the cluster. However, ``LOW`` maybe subjected to preemption (see :ref:`concepts_borrowing`).

.. card:: Pool Statuses

   .. list-table::
      :header-rows: 1
      :widths: 25 75

      * - **Status**
        - **Description**
      * - :tag-online:`ONLINE`
        - The pool is ready to run workflows.
      * - :tag-offline:`OFFLINE`
        - Workflows can be submitted to the pool, but will be queued until the pool is online.
      * - :tag-maintenance:`MAINTENANCE`
        - The pool is undergoing maintenance. You won't be able to submit workflows to the pool.

          .. note::

            Please contact your administrator for more information on pools under maintenance.

.. card:: Resource Types

   .. list-table::
      :header-rows: 1
      :widths: 25 75

      * - **Type**
        - **Description**
      * - :tag-online:`SHARED`
        - The resource is shared with another pool.
      * - :tag-maintenance:`RESERVED`
        - The resource is only available to the pool.

To view the pools, you can use :ref:`Pool List <cli_reference_pool_list>`.

To view the available resources in a pool, you can use :ref:`Resource List <cli_reference_resource_list>`.

.. _concepts_platforms:

Platforms
---------

A ``platform`` is a group of resources in a pool and denotes a specific type of hardware.

Resources are already assigned to a platform by the administrator. You can view more information
about the resource and its access configurations using :ref:`Resource Info <cli_reference_resource_info>`.

.. card:: Platform Access Configurations

   .. list-table::
      :header-rows: 1
      :widths: 30 20 50

      * - **Configuration**
        - **Type**
        - **Description**
      * - ``Privileged Mode Allowed``
        - ``boolean``
        - Whether the platform allows privileged containers. If enabled, you can set :kbd:`privileged`
          to ``true`` in the workflow spec (see :ref:`workflow_spec_task`).
      * - ``Host Network Allowed``
        - ``boolean``
        - Whether the platform allows host networking. If enabled, you can set :kbd:`hostNetwork`
          to ``true`` in the workflow spec (see :ref:`workflow_spec_task`).
      * - ``Default Mounts``
        - ``list[string]``
        - Default volume mounts from the node to the task container for the platform.
      * - ``Allowed Mounts``
        - ``list[string]``
        - Volume mounts that are **allowed** for the platform. These are **not** mounted by default.
          You may add these to :kbd:`volumeMounts` in the workflow spec (see :ref:`workflow_spec_task`).

.. important::

  When you are submitting a workflow, you will need to specify a platform to target in the
  workflow resource spec. Learn more at :ref:`workflow_spec_resources`.
