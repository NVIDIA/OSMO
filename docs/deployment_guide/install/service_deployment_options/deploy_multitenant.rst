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

.. _deploy_multitenant:

============================
Multi-tenant Deployment
============================

This guide provides instructions for deploying OSMO in a multi-tenant configuration suitable for service providers, large enterprises, or organizations that need to support multiple isolated tenants with shared infrastructure.

.. warning::
   Multi-tenant deployment is a complex configuration that requires careful planning, advanced Kubernetes operations knowledge.

Overview
========

.. image:: osmo_multi_tenant.png
   :alt: Multi-tenant Deployment
   :width: 100%

The multi-tenant deployment extends the full deployment with:

* **Tenant Isolation**: Complete data and compute isolation between tenants
* **Shared Infrastructure**: Efficient resource utilization across tenants
* **Centralized Management**: Single control plane for multiple tenants
* **Scalable Architecture**: Dynamic scaling per tenant requirements
* **Advanced Security**: Enhanced security boundaries and access controls
* **Resource Quotas**: Per-tenant resource allocation and limits

Prerequisites
=============

Multi-tenant deployment builds upon the full deployment requirements with additional considerations:

**Base Infrastructure**:

* Kubernetes cluster with version 1.25 or higher
* Helm 3.x installed
* Load balancer support
* SSL certificate management

**Multi-tenant Specific Requirements**:

* **Enhanced Resource Planning**: Significantly more compute, memory, and storage
* **Database Strategy**: Multiple PostgreSQL databases or database-per-tenant
* **Redis Strategy**: Multiple Redis instances or tenant-specific databases
* **Domain Management**: Subdomain or path-based tenant routing
* **Identity Management**: Multi-realm Keycloak or tenant-specific SSO

Planning Your Multi-tenant Deployment
======================================

Tenant Isolation Strategy
--------------------------

Choose your isolation level:

1. **Namespace Isolation** (Recommended)

   * Each tenant gets a dedicated Kubernetes namespace
   * Resource quotas and network policies per namespace
   * Easier management and troubleshooting

2. **Cluster Isolation** (Maximum Security)

   * Each tenant gets a dedicated Kubernetes cluster
   * Complete infrastructure isolation
   * Higher operational overhead


Data Isolation Strategy (Redis and Postgres)
--------------------------------------------

1. **Cloud hosted Database per Tenant**

   .. code-block:: yaml

      # Example: Tenant-specific database configuration
      services:
        postgres:
          enabled: false
          serviceName: postgres-url
          db: tenant_a_osmo  # Tenant-specific database
          user: tenant_a_user
        redis:
          enabled: false
          serviceName: redis-url
          db_number: 0  # Tenant-specific redis database

  When using cloud hosted redis and postgres, you can use the same url for all tenants and create tenant specific db and redis db to differentiate between tenants.

  **Database Setup per Tenant**:

  .. code-block:: bash

   # Create tenant-specific databases
   psql -U postgres -h your-db-host -p 5432 -d postgres
   CREATE DATABASE tenant_a_osmo;
   CREATE DATABASE tenant_b_osmo;

   # if using keycloak, you can use the following command to create the tenant-specific databases
   CREATE DATABASE keycloak_tenant_a;
   CREATE DATABASE keycloak_tenant_b;

   # Create tenant-specific users
   CREATE USER tenant_a_user WITH PASSWORD 'secure-password-a';
   CREATE USER tenant_b_user WITH PASSWORD 'secure-password-b';

   # Grant specific privileges needed for OSMO
   GRANT CONNECT, CREATE ON DATABASE tenant_a_osmo TO tenant_a_user;
   GRANT CONNECT, CREATE ON DATABASE keycloak_tenant_a TO tenant_a_user;

   GRANT CONNECT, CREATE ON DATABASE tenant_b_osmo TO tenant_b_user;
   GRANT CONNECT, CREATE ON DATABASE keycloak_tenant_b TO tenant_b_user;

2. **In-cluster Database Instance per Tenant**

   .. code-block:: yaml

      # Example: Shared database configuration
      services:
        postgres:
          enabled: true
          serviceName: postgres-url
          db: tenant_a_osmo  # Tenant-specific database
          user: tenant_a_user
        redis:
          enabled: true
          serviceName: redis-url
          db_number: 0  # Tenant-specific redis database

  When using in-cluster hosted redis and postgres, you will need to create a database instance per tenant to differentiate between tenants.

Configuration and Deployment
=============================

The multi-tenant deployment process extends the comprehensive deployment guide from :ref:`deploy_service`. You'll need to:

1. **Follow the base deployment process** for each tenant
2. **Implement tenant-specific configurations**
3. **Set up proper isolation boundaries**
4. **Configure centralized management**

Step 1: Keycloak Setup
----------------------

For each tenant, prepare the Keycloak following the instructions in :ref:`deploy_service`.

Create a values file for each tenant and deploy the Keycloak for each tenant.

.. code-block:: bash

   helm upgrade --install keycloak-tenant-a keycloak/keycloak \
     -f ./keycloak-tenant-a-values.yaml \
     --namespace osmo-tenant-a


Step 2: Per-Tenant Deployment
------------------------------

For each tenant, create dedicated values files based on the templates in :ref:`deploy_service`:

.. code-block:: yaml

   global:
     osmoClientImageTag: <version>
     osmoImageTag: <version>

   services:
     postgres:
       enabled: false
       serviceName: <your-postgres-host>
       db: tenant_a_osmo
       user: tenant_a_user

     redis:
       enabled: false
       serviceName: <your-redis-host>
       # Use tenant-specific Redis database or instance

     service:
       scaling:
         minReplicas: 1
         maxReplicas: 3
       hostname: tenant-a.osmo.company.com

       ingress:
         ingressClass: <your-ingress-class>
         annotations:
           # Tenant-specific routing rules

       resources:
         requests:
           cpu: "1"
           memory: "2Gi"
         limits:
           cpu: "4"
           memory: "8Gi"

   service-sidecar:
     envoy:
       jwt:
         providers:
         # if using keycloak, the issuer should be the tenant-specific keycloak url
         - issuer: https://auth-tenant-a.company.com/realms/tenant-a-realm
           audience: tenant-a-osmo
           jwks_uri: https://auth-tenant-a.company.com/realms/tenant-a-realm/protocol/openid-connect/certs

       oauth2Filter:
         # if using keycloak, the tokenEndpoint and authEndpoint should be the tenant-specific keycloak url
         tokenEndpoint: https://auth-tenant-a.company.com/realms/tenant-a-realm/protocol/openid-connect/token
         authEndpoint: https://auth-tenant-a.company.com/realms/tenant-a-realm/protocol/openid-connect/auth
         clientId: tenant-a-browser-flow

**Deploy each tenant**:

.. code-block:: bash

   # Create tenant namespace with resource quotas
   kubectl create namespace osmo-tenant-a

   # Create tenant-specific secrets
   kubectl create secret generic db-secret \
     --from-literal=db-password=<tenant-a-db-password> \
     --namespace osmo-tenant-a

   kubectl create secret docker-registry imagepullsecret \
     --docker-server=nvcr.io \
     --docker-username=<username> \
     --docker-password=<password> \
     --namespace osmo-tenant-a

   # Deploy OSMO for tenant A
   helm upgrade --install osmo-tenant-a osmo/service \
     -f ./tenant-a-osmo-values.yaml \
     --namespace osmo-tenant-a

   # Repeat for other components (router, ui)
   helm upgrade --install router-tenant-a osmo/router \
     -f ./tenant-a-router-values.yaml \
     --namespace osmo-tenant-a

   helm upgrade --install ui-tenant-a osmo/web-ui \
     -f ./tenant-a-ui-values.yaml \
     --namespace osmo-tenant-a

  # repeat for other tenants
  helm upgrade --install osmo-tenant-b osmo/service \
     -f ./tenant-b-osmo-values.yaml \
     --namespace osmo-tenant-b

  helm upgrade --install router-tenant-b osmo/router \
     -f ./tenant-b-router-values.yaml \
     --namespace osmo-tenant-b

   helm upgrade --install ui-tenant-b osmo/web-ui \
     -f ./tenant-b-ui-values.yaml \
     --namespace osmo-tenant-b

Step 3: Deploy Backend Operator per Tenant
-------------------------------------------

For each tenant, create a values file for the backend operator by following the instructions in :ref:`register_cb`.

.. code-block:: bash

  # create a namespace for the backend operator
  kubectl create namespace osmo-backend-operator-tenant-a

   helm upgrade --install backend-operator-tenant-a backend-operator/backend-operator \
     -f ./tenant-a-backend-operator-values.yaml \
     --namespace osmo-backend-operator-tenant-a

  # repeat for other tenants
  kubectl create namespace osmo-backend-operator-tenant-b

  helm upgrade --install backend-operator-tenant-b backend-operator/backend-operator \
     -f ./tenant-b-backend-operator-values.yaml \
     --namespace osmo-backend-operator-tenant-b

For the multi-tenant deployment, you will need to create the backend operator values file for each tenant. But the dependencies such as scheduler, GPU operator, and prometheus should be the same for all tenants.
Follow the instructions in :ref:`installing_required_dependencies` to install the dependencies for all tenants.

Step 4: Network Isolation (Optional)
------------------------------------

For the multi-tenant deployment, you can optionally implement network policies for tenant isolation. OSMO deployments and services across different tenants should not need to communicate with each other.
This is a sample network policy for tenant-a:

.. code-block:: yaml

   # tenant-a-network-policy.yaml
   apiVersion: networking.k8s.io/v1
   kind: NetworkPolicy
   metadata:
     name: tenant-a-isolation
     namespace: osmo-tenant-a
   spec:
     podSelector: {}
     policyTypes:
     - Ingress
     - Egress
     ingress:
     - from:
       - namespaceSelector:
           matchLabels:
             name: osmo-tenant-a
       - namespaceSelector:
           matchLabels:
             name: ingress-system
     egress:
     - to:
       - namespaceSelector:
           matchLabels:
             name: osmo-tenant-a
     - to: []
       ports:
       - protocol: UDP
         port: 53   # DNS
       - protocol: TCP
         port: 53   # DNS over TCP
       - protocol: TCP
         port: 443  # HTTPS
       - protocol: TCP
         port: 5432  # PostgreSQL
       - protocol: TCP
         port: 6379  # Redis

Multi-tenant Management
=======================

Tenant Lifecycle Management
---------------------------

**Tenant Onboarding**:

1. Create tenant-specific databases and Redis instances
2. Set up Keycloak realm and clients
3. Deploy OSMO stack with tenant configuration
4. Configure DNS and SSL certificates
5. Perform tenant validation tests

**Tenant Offboarding**:

1. Export tenant data and configurations
2. Remove tenant deployments
3. Clean up databases and storage
4. Remove DNS entries and certificates

Operational Considerations
==========================

Resource Management
-------------------

* Monitor resource usage across tenants
* Plan for burst capacity and auto-scaling
* Optimize resource allocation based on usage patterns

Security
--------

* Implement least-privilege access controls
* Monitor cross-tenant boundary violations
* Keep tenant data encrypted at rest and in transit

Backup and Disaster Recovery
-----------------------------

* Per-tenant backup schedules
* Isolated backup storage per tenant
* Tenant-specific recovery procedures


Troubleshooting
===============

Multi-tenant specific issues:

**Tenant Isolation Issues**:

* Check network policies and resource quotas
* Verify namespace-level RBAC configurations
* Monitor cross-tenant data access with postgres and redis

**Authentication Issues**:

* Verify tenant-specific Keycloak realm configurations
* Check JWT issuer and audience configurations
* Validate client configurations per tenant

For general troubleshooting, refer to :ref:`deploy_service`.

