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

- Kubernetes load balancer (see the `Kubernetes Ingress Controllers <https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/>`_) installed in your Kubernetes cluster
- Fully Qualified Domain Name (FQDN) and a certificate for your domain (i.e., ``osmo.my-domain.com``).
- When using keycloak as the SSO provider, an additional FQDN and certificate for the keycloak instance (i.e., ``auth-osmo.my-domain.com``) is required.

.. seealso::

   Cloud provider domain name and certificate documentation:

   - **AWS**: `Route 53 for DNS <https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html>`_ | `AWS Certificate Manager <https://docs.aws.amazon.com/acm/latest/userguide/gs.html>`_
   - **Azure**: `Azure DNS <https://learn.microsoft.com/en-us/azure/dns/dns-overview>`_ | `Azure App Service Certificates <https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate>`_
   - **GCP**: `Cloud DNS <https://cloud.google.com/dns/docs/overview>`_ | `Certificate Manager <https://cloud.google.com/certificate-manager/docs/overview>`_

- (Optional) FQDN and a certificate for wildcard subdomain (i.e., ``*.osmo.my-domain.com``) for UI port forwarding
