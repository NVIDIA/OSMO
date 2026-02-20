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

<a id="architecture"></a>

# Architecture

OSMO is a distributed platform that separates control plane functionality (workflow management, API, UI) from compute plane functionality (where workflows actually execute). This separation allows you to manage multiple compute clusters from a single control point and scale compute resources independently.

For a detailed view showing infrastructure, Kubernetes, and container-level components, see the comprehensive diagram below:

![image](deployment_guide/introduction/deployment_architecture.svg)

OSMO uses a control plane / compute plane architecture:

| **Control Plane**   | Runs on the service cluster. Provides APIs, UI, authentication, workflow scheduling, and centralized management.   |
|---------------------|--------------------------------------------------------------------------------------------------------------------|
| **Compute Plane**   | Runs on one or more backend clusters. Executes user workflows and reports status back to the control plane.        |

This separation provides several benefits:

- **Scalability**: Add or remove compute backends without affecting the control plane
- **Isolation**: Isolate different teams or projects on separate compute backends
- **Flexibility**: Mix different hardware types (cloud, on-premises, edge devices)
- **Security**: Keep workflow execution separate from management functions

## Control Plane

The OSMO Service runs on the service cluster (i.e., control plane) and provides the central management layer for the platform.

## Compute Plane

The Backend Operator runs on each compute backend cluster (i.e., compute plane) and serves as the execution engine for workflows.

> **Key Architecture Points**
>
> ## Key Architecture Points

> - Backend operators **initiate connections to** OSMO (not the other way around)
> - The service cluster does not need network access to backend clusters
> - This allows backends to be deployed behind firewalls and in restricted networks
> - Backends can be in different clouds, on-premises, or edge locations

## Workflow Management

Below diagram shows the interaction between the components when a workflow is submitted.

![image](deployment_guide/introduction/workflow_sequence.svg)

#### SEE ALSO
To learn more, refer to [Understanding Task Execution](../appendix/workflow_execution.md)

## Authentication

- All API requests require **authentication** (specific paths can be excluded from authentication during service deployment)
- **Role-based access** allows you group users by roles and determine pool access
- Backend operators authenticate to the service using **service accounts**

#### SEE ALSO
To learn more, refer to [AuthN/AuthZ](../appendix/authentication/index.md)
