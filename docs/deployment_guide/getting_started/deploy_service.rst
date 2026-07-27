..
  SPDX-FileCopyrightText: Copyright (c) 2025-2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.

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

.. _deploy_service:

=========================
Deploy the OSMO Platform
=========================

OSMO is installed through the ``osmo`` umbrella Helm chart. The chart composes
the control-plane services and backend operator behind one values contract and
supports converged and split-plane deployments.

Choose a Profile
================

* ``single-node.yaml`` for local development and evaluation.
* ``minimal.yaml`` for a small converged installation.
* ``split-control.yaml`` for a control cluster.
* ``split-compute.yaml`` for a compute cluster.

Cloud networks, Kubernetes clusters, managed data services, IAM, DNS, ingress
controllers, External Secrets Operator, and GPU Operator are platform-owned
prerequisites.

.. _deploy_service_osmo_values:

Prepare OSMO Values
===================

Copy the closest profile into an environment-owned file:

.. code-block:: bash

   $ cp deployments/charts/osmo/profiles/split-control.yaml osmo-control.yaml

Configure:

* pinned OSMO image registry and tag;
* PostgreSQL, Redis, and object-storage endpoints;
* existing Secret names or ExternalSecret mappings;
* ``global.hostname`` and gateway exposure;
* OAuth2, authorization, TLS, and identity-provider settings; and
* optional KAI scheduling only when its CRDs already exist.

Production deployments should use
``secretManagement.mode: external-secrets`` with an NVault-backed
``SecretStore`` or ``ClusterSecretStore``. The Master Encryption Key belongs in
the ``mek.yaml`` key of a Kubernetes Secret.

Render and Review
=================

.. code-block:: bash

   $ helm dependency build --skip-refresh deployments/charts/osmo
   $ helm lint deployments/charts/osmo --values osmo-control.yaml
   $ helm template osmo-control deployments/charts/osmo \
       --namespace osmo-system \
       --values osmo-control.yaml > /tmp/osmo-control-rendered.yaml

Review namespaces, cluster-scoped RBAC, images, persistence, gateway exposure,
ExternalSecrets, scheduler selection, and Secret references.

Install and Verify
==================

.. code-block:: bash

   $ helm upgrade --install osmo-control deployments/charts/osmo \
       --namespace osmo-system \
       --create-namespace \
       --values osmo-control.yaml \
       --wait \
       --rollback-on-failure \
       --timeout 15m
   $ helm test osmo-control --namespace osmo-system --logs

The chart's hooks validate cluster capabilities, required Secrets, service
readiness, the gateway API, workflow callback URL, and backend heartbeat.

For a split deployment, continue with :ref:`deploy_backend` in the compute
cluster.

Operations
==========

Keep the values file and chart version in source control. Render upgrades
before applying them, inspect ``helm history``, and run ``helm test --logs``
after every change. Database migrations and MEK compatibility require explicit
release qualification; a Helm rollback does not automatically reverse an
external database migration.
