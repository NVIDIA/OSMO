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

==========
Networking
==========

.. warning::

   Setting up networking for OSMO requires cloud networking experience, including:

   - Creating and managing SSL/TLS certificates
   - Configuring DNS records and CNAMEs
   - Associating certificates with load balancers

   Please work with IT admins and DevOps team or refer to the cloud provider guides below.


Requirements
--------------

.. only:: html

  .. grid:: 1 2 2 3
      :gutter: 3

      .. grid-item-card:: :octicon:`server` Kubernetes Ingress Controller
          :link: https://kubernetes.io/docs/concepts/services-networking/ingress-controllers/
          :class-card: tool-card

          Install a Kubernetes load balancer in your cluster.

          **Required for**: Load balancing and traffic routing

      .. grid-item-card:: :octicon:`shield-check` Domain and Certificate

          **Requirements**:

          - Fully Qualified Domain Name (FQDN) for your OSMO instance
          - Valid SSL/TLS certificate for your domain

          **Example**: ``osmo.example.com``

      .. grid-item-card:: :octicon:`globe` DNS Configuration

          Configure DNS CNAME record pointing your FQDN to the load balancer endpoint.

          **Required for**: Domain name resolution

      .. grid-item-card:: :octicon:`key` Keycloak SSO

          Dedicated FQDN and certificate for the Keycloak instance.

          **Example**: ``auth-osmo.example.com``

      .. grid-item-card:: :octicon:`plug` Port Forwarding (Optional)
          :class-card: optional-card

          FQDN and certificate for wildcard subdomain for UI port forwarding.

          **Example**: ``*.osmo.example.com``

.. image:: network_components.svg
   :width: 80%
   :align: center

.. seealso::

   **CSP (Cloud Service Provider) Networking Guides:**

   .. list-table::
      :header-rows: 1
      :widths: 15 30 30 35

      * - CSP
        - DNS Management
        - Certificate Management
        - Load Balancer
      * - **AWS**
        - `Route 53 for DNS <https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/Welcome.html>`_
        - `AWS Certificate Manager <https://docs.aws.amazon.com/acm/latest/userguide/gs.html>`_
        - `ELB Certificate Management <https://docs.aws.amazon.com/elasticloadbalancing/latest/application/create-https-listener.html>`_
      * - **Azure**
        - `Azure DNS <https://learn.microsoft.com/en-us/azure/dns/dns-overview>`_
        - `Azure Certificates <https://learn.microsoft.com/en-us/azure/app-service/configure-ssl-certificate>`_
        - `Application Gateway SSL <https://learn.microsoft.com/en-us/azure/application-gateway/ssl-overview>`_
      * - **GCP**
        - `Cloud DNS <https://docs.cloud.google.com/dns/docs/overview>`_
        - `Certificate Manager <https://docs.cloud.google.com/certificate-manager/docs/overview>`_
        - `Load Balancer SSL <https://cloud.google.com/load-balancing/docs/ssl-certificates>`_




