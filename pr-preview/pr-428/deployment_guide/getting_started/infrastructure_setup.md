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

# Setup Infrastructure

> **Prerequisites**
>
> # Prerequisites

> Before setting up infrastructure for OSMO, ensure you have the prerequisites as specified in [Cloud](../requirements/prereqs.md). This includes creating a VPC and subnets for the Kubernetes cluster, PostgreSQL database, and Redis instance.

# Setup Options

## Option 1: Using Terraform (Recommended)

This is the recommended way to set up infrastructure for OSMO and the quickest way to get started.

## Option 2: Manually

> **Note**
>
> Creating infrastructure manually requires familiarity with cloud resources and networking. Consider using the Terraform examples from Option 1 if you’re new to cloud infrastructure setup.

Follow the below guides to setup the infrastructure manually based on your cloud service provider of choice

# Configure Networking

> **Required Network Connectivity**
>
> # Required Network Connectivity

> Ensure proper network connectivity between components for OSMO to function correctly.

**Internal VPC Connections (Private Network):**

- Kubernetes ↔ PostgreSQL
- Kubernetes ↔ Redis

**External Connections:**

- Kubernetes → Cloud Storage  *(Outbound internet or VPC endpoint)*
- User → Kubernetes  *(Internet access via load balancer/ingress)*

# Best Practices

1. **Use managed services**: Cloud providers handle patching and updates
2. **Enable encryption**: Encryption at rest and in transit for all services
3. **Private subnets**: Keep databases and Redis in private subnets
4. **Minimal access**: Use security groups to restrict access to only required ports
5. **Service accounts**: Use cloud provider IAM for service-to-service authentication
