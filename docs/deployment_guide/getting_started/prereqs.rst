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


.. _prerequisites:

==============
Prerequisites
==============

Before deploying OSMO, ensure you have the following prerequisites:

CSP Specific
--------------------------

- Kubernetes cluster with version 1.27 or higher.
- PostgreSQL database with version 15 or higher.
- Redis instance with version 7.0 or higher.
- Virtual Private Network (VPC) with subnets for the Kubernetes cluster, PostgreSQL database, and Redis instance.

.. note::
  A sample terraform setup on AWS and Azure is available in our repository: `AWS <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/aws/example>`_ and `Azure <https://github.com/NVIDIA/OSMO/tree/main/deployments/terraform/azure/example>`_

Tools
-------------------

- `Helm CLI <https://helm.sh/docs/intro/install>`_ installed
- `kubectl <https://kubernetes.io/docs/tasks/tools/install-kubectl/>`_ installed
- `psql <https://www.postgresql.org/docs/current/app-psql.html>`_ installed
- `OSMO CLI <https://nvidia.github.io/OSMO/user_guide/getting_started/install/>`_ installed

Networking
------------------------

.. important::

   Setting up networking for OSMO requires cloud networking experience, including:

   - Creating and managing SSL/TLS certificates
   - Configuring DNS records and CNAMEs
   - Associating certificates with load balancers

   If you do not have experience with these tasks, work with someone who does (e.g., your cloud infrastructure or DevOps team) or refer to the cloud provider guides below.

**Required Networking Components:**

- Kubernetes load balancer (see `Kubernetes Ingress Controllers <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`_) installed in your Kubernetes cluster
- Fully Qualified Domain Name (FQDN) and a certificate for your domain (e.g., ``osmo.my-domain.com``)
- DNS CNAME record pointing your FQDN to the load balancer endpoint
- When using keycloak as the SSO provider, an additional FQDN and certificate for the keycloak instance (e.g., ``auth-osmo.my-domain.com``) is required

.. seealso::

   **Cloud Provider Networking Documentation:**

   - **AWS**: `Route 53 for DNS <https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html>`_ | `AWS Certificate Manager <https://docs.aws.amazon.com/acm/latest/userguide/gs.html>`_ | `ELB Certificate Management <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html>`_
   - **Azure**: `Azure DNS <https://learn.microsoft.com/en-us/azure/dns/dns-overview>`_ | `Azure Certificates <https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate>`_ | `Application Gateway SSL <https://learn.microsoft.com/en-us/azure/application-gateway/ssl-overview>`_
   - **GCP**: `Cloud DNS <https://cloud.google.com/dns/docs/overview>`_ | `Certificate Manager <https://cloud.google.com/certificate-manager/docs/overview>`_ | `Load Balancer SSL <https://cloud.google.com/load-balancing/docs/ssl-certificates>`_

**Optional:**

- FQDN and certificate for wildcard subdomain (e.g., ``*.osmo.my-domain.com``) for UI port forwarding
