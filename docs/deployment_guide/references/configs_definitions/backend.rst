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

.. _backend_config:

===========================
/api/configs/backend
===========================

Backend config is used to configure compute backends that execute workflows.

Top-Level Configuration
========================

Top-level configuration is used to configure the compute backend.


.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``backends``
     - Array[`Backend`_]
     - List of compute backend configurations.
     - ``[]``

Backend
=======

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``name``
     - String
     - Unique identifier for the backend.
     - ``None``
   * - ``description``
     - String
     - Human-readable description of the backend and its purpose.
     - ``None``
   * - ``dashboard_url``
     - String
     - URL to the backend's management dashboard.
     - ``None``
   * - ``grafana_url``
     - String
     - URL to the backend's Grafana monitoring dashboard.
     - ``None``
   * - ``scheduler_settings``
     - `Scheduler Settings`_
     - Configuration for the Kubernetes scheduler.
     - Default configuration
   * - ``node_conditions``
     - `Node Conditions`_
     - Configuration for node health and condition monitoring.
     - Default configuration
   * - ``router_address``
     - String
     - WebSocket address for backend communication.
     - ``None``


Scheduler Settings
==================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``scheduler_type``
     - String
     - Type of Kubernetes scheduler to use. Supported values: "kai".
     - ``kai``
   * - ``scheduler_name``
     - String
     - Name of the kubernetes scheduler or scheduler plugin to use. This should match the name of the scheduler or scheduler plugin in the kubernetes cluster. e.g., "kai-scheduler".
     - ``kai-scheduler``
   * - ``scheduler_timeout``
     - Integer
     - Timeout in seconds for scheduling operations.
     - ``30``

Node Conditions
================

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``rules``
     - Map[String, String]
     - Mapping of condition type regex to allowed status regex. Status combinations use ``|`` over ``True``, ``False``, ``Unknown``. Examples: ``{"^Ready$": "True"}``, ``{"^Sample.*$": "False|Unknown"}``.
     - ``{"Ready": "True"}``
   * - ``prefix``
     - String
     - Prefix to apply to custom node condition labels.
     - ``osmo.nvidia.com/``

Cache Config
============

.. list-table::
   :header-rows: 1
   :widths: 25 12 43 20

   * - **Field**
     - **Type**
     - **Description**
     - **Default Values**
   * - ``endpoints``
     - Array[String]
     - List of cache endpoint configurations for the backend.
     - ``[]``
