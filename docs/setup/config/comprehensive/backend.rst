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
Backend Config
===========================

Backend config is used to configure compute backends that execute workflows.

Top-Level Configuration
========================

Top-level configuration is used to configure the compute backend.


.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``backends``
     - Array[`Backend`_]
     - List of compute backend configurations.

Backend
=======

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``name``
     - String
     - Unique identifier for the backend.
   * - ``description``
     - String
     - Human-readable description of the backend and its purpose.
   * - ``version``
     - String
     - Version identifier of the backend software.
   * - ``k8s_uid``
     - String
     - Kubernetes cluster unique identifier.
   * - ``k8s_namespace``
     - String
     - Kubernetes namespace where the backend operates.
   * - ``dashboard_url``
     - String
     - URL to the backend's management dashboard.
   * - ``grafana_url``
     - String
     - URL to the backend's Grafana monitoring dashboard.
   * - ``scheduler_settings``
     - `Scheduler Settings`_
     - Configuration for the Kubernetes scheduler.
   * - ``node_conditions``
     - `Node Conditions`_
     - Configuration for node health and condition monitoring.
   * - ``router_address``
     - String
     - WebSocket address for backend communication.


Scheduler Settings
==================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``scheduler_type``
     - String
     - Type of Kubernetes scheduler to use. Supported values: "default", "scheduler-plugins", "volcano", "kai". Default is "default".
   * - ``scheduler_name``
     - String
     - Name of the kubernetes scheduler or scheduler plugin to use. This should match the name of the scheduler or scheduler plugin in the kubernetes cluster. e.g., "scheduler-plugins-scheduler", "kai-scheduler". Default is "default-scheduler".
   * - ``coscheduling``
     - Boolean
     - Whether to enable co-scheduling for group workflows. Default is false.
   * - ``scheduler_timeout``
     - Integer
     - Timeout in seconds for scheduling operations.

Node Conditions
================

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``additional_node_conditions``
     - Array[String]
     - Additional node conditions to monitor beyond the defaults.
   * - ``ignore_node_conditions``
     - Array[String]
     - Node conditions to ignore when evaluating node health.
   * - ``prefix``
     - String
     - Prefix to apply to custom node condition labels.

Cache Config
============

.. list-table::
   :header-rows: 1
   :widths: 30 15 55

   * - **Field**
     - **Type**
     - **Description**
   * - ``endpoints``
     - Array[String]
     - List of cache endpoint configurations for the backend.
