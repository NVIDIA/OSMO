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

============================
Installation
============================

As a part of the installation process, the following OSMO components will be installed:

- OSMO Service
- OSMO Web UI
- OSMO Router
- OSMO Backend Operator

In addition to installing the OSMO components, there are a few service configurations following the installation process.

- Configuration of central data storage for logs and user data
- Configuration of backend, and pools


For a quick installation without authentication, please refer to the :ref:`deploy_quickstart` guide. Otherwise, please refer to the :ref:`service_deployment_options` guide to choose the appropriate deployment option for your use case.

.. toctree::
   :maxdepth: 1
   :hidden:

   quickstart
   service_deployment_options/index
   deploy_service
   backend_deployment/index
   register_data/index
   advanced_configurations/index
