<!-- SPDX-FileCopyrightText: Copyright (c) 2025 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

SPDX-License-Identifier: Apache-2.0 -->

# Configuration API

OSMO hosts a Swagger UI that provides a full overview of the available API endpoints.

The following table provides a list of API endpoints that admins can use to configure the service.

| **API Endpoint**                                                                      | **Description**                                       |
|---------------------------------------------------------------------------------------|-------------------------------------------------------|
| [/api/configs/service](service.md#service-config)                                     | System-wide settings for the OSMO service             |
| [/api/configs/workflow](workflow.md#workflow-config)                                  | Default settings for workflow execution               |
| [/api/configs/dataset](dataset.md#dataset-config)                                     | Settings for dataset storage and handling             |
| [/api/configs/backend](backend.md#backend-config)                                     | Compute backend configurations                        |
| [/api/configs/pool](pool.md#pool-config)                                              | Compute pool configurations for workload distribution |
| [/api/configs/pod_template](pod_template.md#pod-template-config)                      | Kubernetes pod template configurations                |
| [/api/configs/resource_validation](resource_validation.md#resource-validation-config) | Rules for validating resource requirements            |
| [/api/configs/role](roles.md#roles-config)                                            | User roles and permissions                            |

Admins can access the Swagger UI at `http://osmo.example.com/api/docs` to use the Swagger UI to configure the service.

![Swagger UI](deployment_guide/references/configs_definitions/swagger.png)
