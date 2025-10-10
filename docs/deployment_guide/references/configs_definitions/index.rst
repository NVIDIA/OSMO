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
Configuration Definitions
===========================

OSMO supports the following configurations:

* **Service**: System-wide settings for the OSMO service
* **Workflow**: Default settings for workflow execution
* **Dataset**: Settings for dataset storage and handling
* **Backend**: Compute and data backend configurations
* **Pool**: Compute pool configurations for workload distribution
* **Pod Template**: Kubernetes pod template configurations
* **Resource Validation**: Rules for validating resource requirements
* **Role**: User roles and permissions

A full overview of the configurations is available in the following sections:

.. toctree::
   :maxdepth: 1

   service
   workflow
   dataset
   backend
   pool
   pod_template
   resource_validation
   roles
