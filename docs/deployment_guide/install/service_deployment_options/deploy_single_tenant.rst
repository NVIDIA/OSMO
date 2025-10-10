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

.. _deploy_single_tenant:

============================
Single-Tenant Deployment
============================

This guide provides instructions for deploying OSMO in a full production configuration suitable for single-tenant enterprise use. This deployment includes authentication, external databases, and all production features.


Overview
========

.. image:: osmo_full.png
   :alt: Full Deployment
   :width: 100%

The single-tenant deployment includes:

* Complete OSMO service stack (Service, Router, UI)
* External PostgreSQL database
* External Redis cache
* SSO authentication via Keycloak or compatible SSO provider
* Load balancer and ingress configuration
* Production-grade resource allocation
* Monitoring and observability features
* Connection to single or multiple backend clusters on different networks and CSPs

Prerequisites
=============

This deployment requires significant infrastructure preparation. Please ensure you have completed the prerequisites and configurations outlined in :ref:`deploy_service`.

The key prerequisites include:

* Kubernetes cluster with version 1.25 or higher
* Helm 3.x installed
* External PostgreSQL database (version 15.0+)
* External Redis instance (version 7.0+)
* Domain name and SSL certificates
* Load balancer support
* Keycloak or compatible SSO provider

Configuration and Deployment
=============================

The full deployment process covers:

1. **Database Setup** - Configuring external PostgreSQL and Redis
2. **SSO Authentication** - Setting up Keycloak with proper client configuration
3. **Helm Values Configuration** - Complete values file examples for all components
4. **Component Deployment** - Deploying OSMO, Router, UI, and backend operator services

Full Deployment
===============================

For the full deployment of the OSMO service stack, you'll use the comprehensive values configuration shown in :ref:`deploy_service`.

Execute these commands in order after preparing your values files:

.. code-block:: bash

   # Create namespace
   kubectl create namespace osmo

   # Create secrets
   kubectl create secret generic db-secret --from-literal=db-password=<password> -n osmo
   kubectl create secret generic redis-secret --from-literal=redis-password=<password> -n osmo
   kubectl create secret docker-registry imagepullsecret --docker-server=nvcr.io --docker-username=<username> --docker-password=<password> -n osmo

   # Deploy components
   helm upgrade --install service osmo/service -f ./osmo_values.yaml -n osmo
   helm upgrade --install router osmo/router -f ./router_values.yaml -n osmo
   helm upgrade --install ui osmo/web-ui -f ./ui_values.yaml -n osmo


For the full deployment of the OSMO backend operator, you'll need to create the ``backend_operator_values.yaml`` file by following the instructions in :ref:`register_cb`.

If you are using multiple CSPs, you'll need to create the ``backend_operator_values.yaml`` file for each CSP by following the instructions in :ref:`register_cb`.

Follow the instructions in :ref:`installing_required_dependencies` to install the dependencies for all your clusters.


Next Steps
==========

After completing the full deployment:

1. **Configure Compute Backends**: Follow :ref:`register_cb` to register compute resources
2. **Set Up Data Backends**: Configure data storage as described in :ref:`data`

Production Considerations
=========================

High Availability
-----------------

* Deploy multiple replicas of each service
* Implement proper backup and disaster recovery

Monitoring
----------

* Enable OpenTelemetry for metrics collection
* Configure log aggregation
* Set up alerting for critical events
* Monitor resource usage and performance

Scaling
-------

* Configure horizontal pod autoscaling based on resource usage
* Monitor and adjust resource requests/limits
* Plan for database instance scaling (recommended to use at least 2 cpu and 8gb memory)


Troubleshooting
===============

For troubleshooting guidance, monitoring setup, and common issues resolution, refer to the comprehensive troubleshooting section in :doc:`../deploy_service`.

Common full deployment issues include:

* SSL certificate configuration
* SSO integration problems
* Load balancer routing issues
* Database connectivity problems
* Resource constraints in production workloads
