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

Setup Infrastructure
====================

.. admonition:: Prerequisites
  :class: important

  Before setting up infrastructure for OSMO, ensure you have the prerequisites as specified in :doc:`../requirements/prereqs`. This includes creating a VPC and subnets for the Kubernetes cluster, PostgreSQL database, and Redis instance.

Setup Options
=============

Option 1: Using Terraform (Recommended)
-------------------------------------------------------

This is the recommended way to set up infrastructure for OSMO and the quickest way to get started.

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`cloud` AWS Terraform
          :link: https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/aws/example
          :class-card: tool-card

          Automated infrastructure setup for AWS with complete reference implementation.

          +++

          **Creates:**

          • VPC
          • EKS cluster
          • RDS PostgreSQL
          • ElastiCache Redis

          **Time**: ~20-30 minutes

      .. grid-item-card:: :octicon:`cloud` Azure Terraform
          :link: https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/azure/example
          :class-card: tool-card

          Automated infrastructure setup for Azure with complete reference implementation.

          +++

          **Creates:**

          • VNet
          • AKS cluster
          • Azure Database for PostgreSQL
          • Azure Cache for Redis

          **Time**: ~20-30 minutes

Option 2: Manually
-----------------------

.. note::

   Creating infrastructure manually requires familiarity with cloud resources and networking. Consider using the Terraform examples from Option 1 if you're new to cloud infrastructure setup.


Follow the below guides to setup the infrastructure manually based on your cloud service provider of choice

.. only:: html

  .. grid:: 1 2 2 2
      :gutter: 3

      .. grid-item-card:: :octicon:`lock` Network (VPC/VNet)

          Create isolated network infrastructure for your cloud resources.

          +++

          `AWS - VPC <https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html>`_

          `Azure - Virtual Network <https://learn.microsoft.com/en-us/azure/virtual-network/quick-create-portal>`_

          `GCP - VPC <https://cloud.google.com/vpc/docs/create-modify-vpc-networks>`_

      .. grid-item-card:: :octicon:`container` Kubernetes Cluster

          Deploy managed Kubernetes service to run OSMO Service components.

          +++

          `AWS - EKS <https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html>`_

          `Azure - AKS <https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-portal>`_

          `GCP - GKE <https://cloud.google.com/kubernetes-engine/docs/deploy-app-cluster>`_

      .. grid-item-card:: :octicon:`database` PostgreSQL Database

          Create managed PostgreSQL database for application data storage.

          +++

          `AWS - RDS for PostgreSQL <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html>`_

          `Azure - Azure Database for PostgreSQL <https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/quickstart-create-server-portal>`_

          `GCP - Cloud SQL for PostgreSQL <https://cloud.google.com/sql/docs/postgres/create-instance>`_

      .. grid-item-card:: :octicon:`zap` Redis Cache

          Set up managed Redis cache for session management and real-time data.

          +++

          `AWS - ElastiCache Redis <https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/GettingStarted.html>`_

          `Azure - Azure Cache for Redis <https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/quickstart-create-redis>`_

          `GCP - Memorystore for Redis <https://cloud.google.com/memorystore/docs/redis/create-instance-console>`_


Configure Networking
========================

.. admonition:: Required Network Connectivity
  :class: important

  Ensure proper network connectivity between components for OSMO to function correctly.

.. rst-class:: connectivity-list

**Internal VPC Connections (Private Network):**

- Kubernetes ↔ PostgreSQL
- Kubernetes ↔ Redis

**External Connections:**

- Kubernetes → Cloud Storage *(Outbound internet or VPC endpoint)*
- User → Kubernetes *(Internet access via load balancer/ingress)*


Best Practices
========================

1. **Use managed services**: Cloud providers handle patching and updates
2. **Enable encryption**: Encryption at rest and in transit for all services
3. **Private subnets**: Keep databases and Redis in private subnets
4. **Minimal access**: Use security groups to restrict access to only required ports
5. **Service accounts**: Use cloud provider IAM for service-to-service authentication


