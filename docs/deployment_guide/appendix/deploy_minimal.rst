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

.. _deploy_minimal:

==================
Minimal Deployment
==================

The ``minimal`` profile installs the OSMO control and compute planes as one
Helm release on an existing Kubernetes cluster. It uses ordinary existing
Kubernetes Secrets and the standard Kubernetes scheduler.

.. warning::

   The reference profile disables production identity integration. Do not
   expose its gateway to untrusted networks without configuring OAuth2,
   authorization, TLS, and network policy.

Prerequisites
=============

* A conformant Kubernetes cluster.
* A default ``ReadWriteOnce`` StorageClass when embedded PostgreSQL and Redis
  are enabled.
* Access to the configured OSMO images.
* A Secret containing ``db-password``, ``redis-password``, ``backend-token``,
  and ``mek.yaml``.

The Secret may be created directly or reconciled by another Secret controller.
For NVault, use the ``split-control`` or a customized ``minimal`` profile with
``secretManagement.mode: external-secrets``.

Prepare Values
==============

Copy the reference profile and customize the copy:

.. code-block:: bash

   $ cp deployments/charts/osmo/profiles/minimal.yaml osmo-minimal.yaml

Set image versions, storage endpoints, Secret names, gateway exposure, and
identity settings in ``osmo-minimal.yaml``. Do not pass raw Secret values with
``--set``.

Install
-------

.. code-block:: bash

   $ helm dependency build --skip-refresh deployments/charts/osmo
   $ helm lint deployments/charts/osmo --values osmo-minimal.yaml
   $ helm template osmo deployments/charts/osmo \
       --namespace osmo-system \
       --values osmo-minimal.yaml > /tmp/osmo-minimal-rendered.yaml
   $ helm upgrade --install osmo deployments/charts/osmo \
       --namespace osmo-system \
       --create-namespace \
       --values osmo-minimal.yaml \
       --wait \
       --rollback-on-failure \
       --timeout 15m

Verify
======

.. code-block:: bash

   $ helm status osmo --namespace osmo-system
   $ helm test osmo --namespace osmo-system --logs
   $ kubectl get deployments,pods --namespace osmo-system

After the backend reports online, submit
``deployments/workflows/verify-hello.yaml`` through the OSMO CLI to validate a
complete workflow and log round trip.

Upgrade and Uninstall
=====================

Render and review every values or chart change before upgrading. Keep the chart
and image versions pinned, use ``--rollback-on-failure``, and re-run
``helm test --logs`` after the upgrade.

.. code-block:: bash

   $ helm uninstall osmo --namespace osmo-system

Persistent volumes and externally managed Secrets may remain according to
their Kubernetes retention policies.
