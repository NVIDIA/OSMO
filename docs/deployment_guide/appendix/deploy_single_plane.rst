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

.. _deploy_single_plane:

=======================
Single-plane Deployment
=======================

A single-plane deployment runs the OSMO control plane and compute plane in one
Kubernetes cluster. PostgreSQL, Valkey or Redis, and object storage remain
external to the Helm release. This profile is useful for development,
evaluation, and small installations that do not need independent control and
compute clusters.

The unified ``osmo`` chart installs both planes in one Helm release.

.. image:: deploy_single_plane.svg
   :align: center
   :width: 80%

This guide uses a ``ClusterIP`` gateway and local port forwarding. Before a
production deployment, add a TLS ingress or HTTPRoute, use an external identity
provider, set a reachable HTTPS ``externalUrl``, and apply the availability,
backup, and monitoring requirements for your site.

Prerequisites
=============

Prepare the following before installing OSMO:

* A Kubernetes 1.30 or newer cluster with at least two platform nodes labeled
  ``osmo.nvidia.com/node-pool=control-plane`` and at least one workflow node
  labeled ``osmo.nvidia.com/node-pool=compute``, with at least four vCPUs per
  node.
* KAI Scheduler 0.15.3.
* PostgreSQL 15 or newer with an empty database for OSMO.
* Valkey or Redis 7 or newer.
* One private object-storage container or bucket for workflow state, logs, and
  application bundles.
* ``kubectl``, Helm, and the OSMO CLI on the administrator workstation.

The Kubernetes nodes and OSMO pods must be able to resolve and reach the three
external services. Keep credentials in a secret manager or private files, not
in values files or shell history.

Label the platform and workflow nodes before installing dependencies:

.. code-block:: bash

   kubectl label node <platform-node-1> <platform-node-2> \
     osmo.nvidia.com/node-pool=control-plane
   kubectl label node <compute-node-1> \
     osmo.nvidia.com/node-pool=compute
   kubectl get nodes --label-columns=osmo.nvidia.com/node-pool

Install Cluster Dependencies
============================

Install the tested scheduler release before OSMO, using the same flags as the
standard :ref:`KAI Scheduler installation <installing_kai>`:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.15.3/kai-scheduler-v0.15.3.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --values deployments/charts/osmo/examples/kai-values.yaml \
     --values deployments/charts/osmo/examples/kai-selectors.yaml \
     --wait \
     --timeout 10m
   kubectl --namespace kai-scheduler wait \
     --for=condition=Available=True \
     --timeout=10m config.kai.scheduler/kai-config
   kubectl wait --for=condition=Available \
     --timeout=10m schedulingshard/default
   kubectl --namespace kai-scheduler wait \
     --for=condition=Available \
     --timeout=10m deployment --all

Prepare Values and Secrets
==========================

Create the namespace:

.. code-block:: bash

   kubectl create namespace osmo

Follow the existing service deployment instructions to configure the required
Secrets and their matching values:

* :ref:`PostgreSQL <deploy_service_postgresql>`
* :ref:`Valkey or Redis <deploy_service_valkey>`
* :ref:`Object storage <configure_storage_access>`
* :ref:`Secret ownership choices <deploy_service_secret_ownership>`

The chart automatically creates and populates the retained
``osmo-backend-token`` Secret for the compute plane. The example below also
selects chart-managed master encryption and service-auth Secrets.

Create ``single-plane-values.yaml`` with non-secret endpoints. This file layers
after ``profiles/single-plane.yaml``:

.. code-block:: yaml

   externalUrl: http://127.0.0.1:9000

   externalDependencies:
     postgresql:
       host: <postgres-host>
       port: 5432
       database: <postgres-database>
       username: <postgres-username>
       tls:
         enabled: false
     valkey:
       host: <valkey-or-redis-host>
       port: <tls-port>
       database: 0
       tls:
         enabled: true
     objectStorage:
       authentication:
         type: static
       locations:
         workflows: <scheme>://<bucket-or-container>/workflows
         logs: <scheme>://<bucket-or-container>/logs
         apps: <scheme>://<bucket-or-container>/apps

   secrets:
     objectStorage:
       generate: false
       existingSecret: osmo-object-storage
     masterEncryptionKey:
       managementMode: osmo
       bootstrap:
         enabled: true
     serviceAuth:
       managementMode: osmo
       bootstrap:
         enabled: true

   configuration:
     service:
       service_base_url: http://osmo-gateway.osmo.svc:80

The checked ``kai-selectors.yaml`` overlay places KAI on ``control-plane``
nodes. The ``node-selectors.yaml`` overlay places OSMO platform Pods there and
the built-in workflow Pod templates on ``compute`` nodes. Copy and edit both
files if your cluster uses different labels. Keep ``single-plane-values.yaml``
last in the values order so site settings can deliberately override the shared
placement.

Configure an External IdP
=========================

Embedded Dex is suitable only for evaluation. Before a production install,
follow the canonical :ref:`external IdP guidance
<deploy_service_external_idp>`. Add its ``embeddedDependencies.dex`` and
``authentication`` blocks to ``single-plane-values.yaml`` and create the
referenced OIDC Secret before installing OSMO.

Install OSMO
============

Use a chart version and OSMO images from the same release. When installing from
a source checkout, build its dependencies and install the local unified chart:

The command uses Helm 4's ``--wait=legacy`` strategy. With Helm 3, replace
``--wait=legacy`` with ``--wait``.

.. code-block:: bash

   helm repo add osmo-dex https://charts.dexidp.io
   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo add osmo-rustfs https://charts.rustfs.com
   helm repo update
   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values deployments/charts/osmo/examples/node-selectors.yaml \
     --values single-plane-values.yaml \
     --wait=legacy \
     --wait-for-jobs \
     --timeout 30m

Log In
======

Forward the gateway in a dedicated terminal:

.. code-block:: bash

   kubectl --namespace osmo port-forward service/osmo-gateway 9000:80

The profile uses embedded Dex by default. Retrieve its generated password:

.. code-block:: bash

   OSMO_URL=http://127.0.0.1:9000
   kubectl get secret osmo-embedded-dex-admin --namespace osmo \
     --output jsonpath='{.data.password}' | base64 --decode
   printf '\n'

Visit ``$OSMO_URL`` and sign in as ``admin@osmo.local`` with that password.

To validate with the OSMO CLI, read the chart-managed administrator token into
a protected temporary file, then use token login:

.. code-block:: bash

   set -o pipefail
   umask 077
   OSMO_TOKEN_FILE="$(mktemp)" &&
   kubectl get secret osmo-admin-token --namespace osmo \
     --output jsonpath='{.data.token}' | base64 --decode > "$OSMO_TOKEN_FILE" &&
   osmo login "$OSMO_URL" --method token --token-file "$OSMO_TOKEN_FILE"
   OSMO_LOGIN_STATUS=$?
   rm -f -- "${OSMO_TOKEN_FILE:-}" || OSMO_LOGIN_STATUS=$?
   unset OSMO_TOKEN_FILE
   test "$OSMO_LOGIN_STATUS" -eq 0

Verify the Deployment
=====================

Confirm that the release, control-plane, gateway, compute-plane, KAI, and API
are ready and that the backend reports resources:

.. code-block:: bash

   helm status osmo --namespace osmo
   kubectl get deployments --namespace osmo
   kubectl get pods --namespace osmo
   kubectl wait --namespace osmo --for=condition=available deployment --all \
     --timeout=10m
   kubectl --namespace kai-scheduler wait --for=condition=Available \
     deployment --all --timeout=10m
   curl --fail "$OSMO_URL/api/version"
   osmo pool list
   osmo resource list --pool default

Submit the CPU and object-storage smoke workflows from the repository:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default --format-type json
   osmo workflow submit deployments/workflows/verify-object-storage.yaml \
     --pool default --format-type json
   OSMO_WORKFLOW_ID=<returned-workflow-id>
   osmo workflow query "$OSMO_WORKFLOW_ID" --format-type json

For each submission, set ``OSMO_WORKFLOW_ID`` to the returned workflow ID and
repeat the query until its status is ``COMPLETED``. A ``FAILED``, ``CANCELLED``,
or timed-out workflow is a validation failure. The first workflow validates CPU
scheduling and compute-plane status reporting. The second also validates upload
and download through the configured object storage.

Troubleshooting
===============

* **A bootstrap Job fails:** inspect ``kubectl get jobs,pods -n osmo`` and the
  failed Job logs. Correct the dependency or Secret, increment that bootstrap
  block's ``attempt`` value, and run ``helm upgrade`` again.
* **Database connection fails:** verify host, database, username, Secret key
  ``db-password``, TLS mode, DNS, and network reachability from an OSMO pod.
* **Valkey connection fails:** verify the endpoint, TLS port, Secret key
  ``redis-password``, and CA configuration.
* **Object storage fails:** verify all three URI prefixes, the
  ``object-storage.yaml`` credential document, endpoint, and provider
  permissions.
* **Workflows remain pending:** verify KAI 0.15.3 is running, inspect
  ``osmo workflow events "$OSMO_WORKFLOW_ID"``, and check node capacity with
  ``osmo resource list --pool default``.
* **Images cannot be pulled:** use released chart and image versions that
  match. Keep private registry overrides and pull credentials in a private
  site values file and Kubernetes Secret, never in the published guide.

Upgrade and Recovery
====================

Reuse the same profile, selector overlay, and site values for upgrades. Keep
each production credential's source of truth in your organization's secret
manager. Either provision the Kubernetes Secret externally before installation,
or import a bootstrap-generated value, switch that Secret to external
management, and disable its bootstrap. Back up credentials with the state they
protect.

Cleanup
========

Uninstalling the chart preserves retained Secrets. Back them up before deleting
the namespace or external database:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   helm uninstall kai-scheduler --namespace kai-scheduler --wait
