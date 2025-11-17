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

===========================
Configuration API
===========================

OSMO hosts a Swagger UI that provides a full overview of the available API endpoints.

The following table provides a list of API endpoints that admins can use to configure the service.

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - **API Endpoint**
     - **Description**
   * - :ref:`/api/configs/service <service_config>`
     - System-wide settings for the OSMO service
   * - :ref:`/api/configs/workflow <workflow_config>`
     - Default settings for workflow execution
   * - :ref:`/api/configs/dataset <dataset_config>`
     - Settings for dataset storage and handling
   * - :ref:`/api/configs/backend <backend_config>`
     - Compute backend configurations
   * - :ref:`/api/configs/pool <pool_config>`
     - Compute pool configurations for workload distribution
   * - :ref:`/api/configs/pod_template <pod_template_config>`
     - Kubernetes pod template configurations
   * - :ref:`/api/configs/resource_validation <resource_validation_config>`
     - Rules for validating resource requirements
   * - :ref:`/api/configs/role <roles_config>`
     - User roles and permissions

Admins can access the Swagger UI at ``http://osmo.example.com/api/docs`` to use the Swagger UI to configure the service.

.. image:: swagger.png
   :alt: Swagger UI
   :width: 1000
   :align: center

.. toctree::
   :hidden:

   service
   workflow
   dataset
   backend
   pool
   pod_template
   resource_validation
   roles
