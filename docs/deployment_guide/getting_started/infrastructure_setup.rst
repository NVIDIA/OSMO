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

Before deploying OSMO, you need to setup the infrastructure for deploying OSMO. This includes creating a VPC and subnets for the Kubernetes cluster, PostgreSQL database, and Redis instance.

Infrastructure Overview
========================

The following diagram illustrates the infrastructure components needed for OSMO deployment on any cloud provider:

.. raw:: html

    <style>
        .infra-diagram {
            margin: 2em auto;
            max-width: 900px;
        }

        .infra-section {
            margin-bottom: 2em;
        }

        .section-label {
            color: #76B900;
            font-weight: bold;
            font-size: 0.9em;
            margin-bottom: 1em;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }

        .vpc-container {
            border: 3px dashed #76B900;
            border-radius: 12px;
            padding: 2em;
            position: relative;
            background: rgba(118, 185, 0, 0.05);
            margin-bottom: 2em;
        }

        .vpc-label {
            position: absolute;
            top: -12px;
            left: 20px;
            background: var(--color-background-primary, #1a1a1a);
            padding: 0 10px;
            color: #76B900;
            font-weight: bold;
            font-size: 0.95em;
        }

        /* Light mode override for label background */
        @media (prefers-color-scheme: light) {
            .vpc-label {
                background: white;
            }
        }

        [data-theme="light"] .vpc-label,
        html[data-theme="light"] .vpc-label,
        body[data-theme="light"] .vpc-label,
        .theme-light .vpc-label {
            background: white;
        }

        .infra-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 1.2em;
        }

        .infra-component {
            border: 2px solid #76B900;
            border-radius: 8px;
            padding: 1.5em 1em;
            text-align: center;
            background: rgba(118, 185, 0, 0.08);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .infra-component:hover {
            transform: translateY(-3px);
            box-shadow: 0 6px 16px rgba(118, 185, 0, 0.25);
        }

        .infra-name {
            font-weight: bold;
            color: #76B900;
            margin-bottom: 0.8em;
            font-size: 1.05em;
        }

        .infra-details {
            font-size: 0.85em;
            opacity: 0.85;
            line-height: 1.5;
        }

        .external-storage {
            max-width: 400px;
            margin: 0 auto;
        }

        .vpc-note {
            text-align: center;
            margin-top: 1.2em;
            padding-top: 1.2em;
            border-top: 1px solid rgba(118, 185, 0, 0.3);
            font-size: 0.88em;
            opacity: 0.8;
        }

        .connection-note {
            text-align: center;
            margin: 1.5em 0;
            font-size: 0.9em;
            color: #76B900;
            font-style: italic;
        }

        @media (max-width: 768px) {
            .infra-grid {
                grid-template-columns: 1fr;
            }
        }
    </style>

    <div class="infra-diagram">
        <div class="vpc-container">
            <div class="vpc-label">VPC / VNet (Private Network)</div>

            <div class="infra-grid">
                <div class="infra-component">
                    <div class="infra-name">Kubernetes Cluster</div>
                    <div class="infra-details">
                        Service Cluster<br/>
                        v1.30+<br/>
                        Multi-node recommended
                    </div>
                </div>

                <div class="infra-component">
                    <div class="infra-name">PostgreSQL</div>
                    <div class="infra-details">
                        v15.0+<br/>
                        Managed service<br/>
                        32 GB storage min
                    </div>
                </div>

                <div class="infra-component">
                    <div class="infra-name">Redis</div>
                    <div class="infra-details">
                        v7.0+<br/>
                        Managed service<br/>
                        4 GB memory min
                    </div>
                </div>
            </div>

            <div class="vpc-note">
                Components within VPC communicate over private network
            </div>
        </div>

        <div class="connection-note">
            ↕ Outbound Internet Access
        </div>

        <div class="infra-section">
            <div class="infra-component external-storage">
                <div class="infra-name">Cloud Storage</div>
                <div class="infra-details">
                    S3 / GCS / Azure Blob / TOS<br/>
                    For workflow logs and artifacts<br/>
                    Accessed via internet or VPC endpoint
                </div>
            </div>
        </div>
    </div>

Setup Options
=============

Option 1: Automated Setup with Terraform (Recommended)
-------------------------------------------------------

The fastest way to set up infrastructure is using our reference Terraform scripts:

**AWS**:
   - `AWS Terraform Example <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/aws/example>`_
   - Creates: VPC, EKS cluster, RDS PostgreSQL, ElastiCache Redis, S3 bucket
   - Time: ~20-30 minutes

**Azure**:
   - `Azure Terraform Example <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/azure/example>`_
   - Creates: VNet, AKS cluster, Azure Database for PostgreSQL, Azure Cache for Redis, Blob Storage
   - Time: ~20-30 minutes

Option 2: Manual Setup
-----------------------

Follow these steps to manually create the infrastructure:

1. **Create Network Infrastructure**

   - Create VPC (AWS), VNet (Azure), or VPC (GCP)
   - Configure subnets with appropriate CIDR blocks
   - Set up route tables and internet gateway
   - Configure security groups/network security groups

   **Cloud Provider Guides:**

   - **AWS**: `Working with VPCs <https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html>`__
   - **Azure**: `Create a virtual network <https://learn.microsoft.com/en-us/azure/virtual-network/quick-create-portal>`__
   - **GCP**: `Create VPC networks <https://cloud.google.com/vpc/docs/create-modify-vpc-networks>`__

2. **Create Kubernetes Cluster**

   - Use managed Kubernetes service (EKS, AKS, or GKE)
   - Kubernetes version v1.30.0 or higher
   - Configure with at least 3 worker nodes for high availability
   - See :doc:`system_reqs` for detailed requirements

   **Cloud Provider Guides:**

   - **AWS**: `Getting started with Amazon EKS <https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html>`__
   - **Azure**: `Deploy an AKS cluster <https://learn.microsoft.com/en-us/azure/aks/learn/quick-kubernetes-deploy-portal>`__
   - **GCP**: `Deploy a GKE cluster <https://cloud.google.com/kubernetes-engine/docs/deploy-app-cluster>`__

3. **Create PostgreSQL Database**

   - Use managed database service (RDS, Azure Database, Cloud SQL)
   - PostgreSQL version 15.0 or higher
   - Minimum 32 GB storage
   - Enable automatic backups
   - Place in private subnet within VPC

   **Cloud Provider Guides:**

   - **AWS**: `Amazon RDS for PostgreSQL <https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/CHAP_PostgreSQL.html>`__
   - **Azure**: `Azure Database for PostgreSQL <https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/quickstart-create-server-portal>`__
   - **GCP**: `Cloud SQL for PostgreSQL <https://cloud.google.com/sql/docs/postgres/create-instance>`__

4. **Create Redis Instance**

   - Use managed cache service (ElastiCache, Azure Cache, Memorystore)
   - Redis version 7.0 or higher
   - Minimum 4 GB memory
   - Enable encryption in transit
   - Place in private subnet within VPC

   **Cloud Provider Guides:**

   - **AWS**: `Amazon ElastiCache for Redis <https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/GettingStarted.html>`__
   - **Azure**: `Azure Cache for Redis <https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/quickstart-create-redis>`__
   - **GCP**: `Memorystore for Redis <https://cloud.google.com/memorystore/docs/redis/create-instance-console>`__

5. **Create Cloud Storage**

   - Create storage bucket (S3, Azure Blob, GCS bucket, or other supported cloud storage)
   - Enable versioning (recommended)
   - Configure lifecycle policies for log retention
   - See :doc:`create_storage/index` for provider-specific instructions


Cloud Provider Mapping
=======================

.. list-table::
   :header-rows: 1
   :widths: 25 25 25 25

   * - Component
     - AWS
     - Azure
     - GCP
   * - Network
     - VPC
     - Virtual Network
     - VPC
   * - Kubernetes
     - EKS
     - AKS
     - GKE
   * - PostgreSQL
     - RDS for PostgreSQL
     - Azure Database for PostgreSQL
     - Cloud SQL for PostgreSQL
   * - Redis
     - ElastiCache for Redis
     - Azure Cache for Redis
     - Memorystore for Redis
   * - Storage
     - S3
     - Blob Storage
     - Cloud Storage

Networking Configuration
========================

Ensure the following network connectivity:

- **Kubernetes ↔ PostgreSQL**: Private connection within VPC
- **Kubernetes ↔ Redis**: Private connection within VPC
- **Kubernetes → Cloud Storage**: Outbound internet access or VPC endpoint
- **User → Kubernetes**: Internet access via load balancer/ingress

Best Practices
========================

1. **Use managed services**: Cloud providers handle patching and updates
2. **Enable encryption**: Encryption at rest and in transit for all services
3. **Private subnets**: Keep databases and Redis in private subnets
4. **Minimal access**: Use security groups to restrict access to only required ports
5. **Service accounts**: Use cloud provider IAM for service-to-service authentication

Next Steps
==========

Once you have set up the infrastructure, proceed to :doc:`create_storage/index` to configure cloud storage credentials for OSMO.
