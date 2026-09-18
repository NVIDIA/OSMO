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

The unified ``osmo`` chart installs both planes in one Helm release. Do not
install the legacy ``service`` or ``backend-operator`` charts for this model.

.. image:: deploy_single_plane.svg
   :align: center
   :width: 80%

This guide uses a ``ClusterIP`` gateway and local port forwarding. Before a
production deployment, add a TLS ingress or HTTPRoute, use an external identity
provider, set a reachable HTTPS ``externalUrl``, and apply the availability,
backup, and monitoring requirements for your site.

Infrastructure prerequisites
============================

Prepare the following before installing OSMO:

* A Kubernetes 1.30 or newer cluster with at least three schedulable CPU nodes
  and at least four vCPUs per node.
* KAI Scheduler 0.12.10.
* PostgreSQL 15 or newer with an empty database for OSMO.
* Valkey or Redis 7 or newer.
* One private object-storage container or bucket for workflow state, logs, and
  application bundles.
* ``kubectl``, Helm, and the OSMO CLI on the administrator workstation.

The Kubernetes nodes and OSMO pods must be able to resolve and reach the three
external services. Keep credentials in a secret manager or private files, not
in values files or shell history.

Install KAI Scheduler
=====================

Install the tested scheduler release before OSMO, using the same flags as the
standard :ref:`KAI Scheduler installation <installing_kai>`:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.12.10/kai-scheduler-v0.12.10.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --wait \
     --timeout 10m

Create the OSMO Secrets
=======================

Create the namespace:

.. code-block:: bash

   kubectl create namespace osmo

Follow the existing service deployment instructions to configure the required
Secrets and their matching values:

* :ref:`PostgreSQL <deploy_service_postgresql>`
* :ref:`Valkey or Redis <deploy_service_valkey>`
* :ref:`Object storage <configure_storage_access>`
* :ref:`Other Secrets <deploy_service_other_secrets>`

The chart automatically creates and populates the retained
``osmo-backend-token`` Secret for the compute plane. Do not create that Secret
manually. The example below also selects chart-managed master encryption and
service-auth Secrets.

Prepare the site values
=======================

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

Install the unified chart
=========================

Use a chart version and OSMO images from the same release. When installing from
a source checkout, build its dependencies and install the local unified chart:

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values single-plane-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 30m

Log in
======

Forward the gateway in a dedicated terminal:

.. code-block:: bash

   kubectl --namespace osmo port-forward service/osmo-gateway 9000:80

The profile uses embedded Dex by default. Run the standard browser login and
sign in as ``admin@osmo.local`` with the password stored in
``osmo-embedded-dex-admin``:

.. code-block:: bash

   export OSMO_URL=http://127.0.0.1:9000
   kubectl get secret osmo-embedded-dex-admin --namespace osmo \
     --output jsonpath='{.data.password}' | base64 --decode
   printf '\n'
   osmo login "$OSMO_URL"

The password command writes the credential to the terminal. Run it only in a
private terminal and do not paste its output into logs or issue trackers.

For non-interactive validation, read the chart-managed administrator token into
a mode-0600 file without printing it, then use token login:

.. code-block:: bash

   ADMIN_TOKEN_FILE=$(mktemp)
   chmod 600 "$ADMIN_TOKEN_FILE"
   kubectl get secret osmo-admin-token --namespace osmo \
     --output jsonpath='{.data.token}' | base64 --decode >"$ADMIN_TOKEN_FILE"
   osmo login "$OSMO_URL" --method token --token-file "$ADMIN_TOKEN_FILE"
   rm -f -- "$ADMIN_TOKEN_FILE"

For production, configure ``authentication.provider: externalOidc`` instead.
Follow :ref:`identity_provider_setup`; the default ``osmo login`` uses browser
authorization-code flow with PKCE, and ``osmo login --method code`` explicitly
selects device authorization.

Verify the deployment
=====================

Confirm that the control-plane, gateway, and compute-plane Deployments are
available and that the backend reports resources:

.. code-block:: bash

   kubectl get deployments --namespace osmo
   kubectl get pods --namespace osmo
   kubectl wait --namespace osmo --for=condition=available deployment --all \
     --timeout=10m
   osmo pool list
   osmo resource list --pool default

Submit the CPU and object-storage smoke workflows from the repository:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default --format-type json
   osmo workflow submit deployments/workflows/verify-object-storage.yaml \
     --pool default --format-type json
   osmo workflow query <workflow-name> --format-type json

Repeat the query until each workflow reports ``COMPLETED``. The first workflow
validates CPU scheduling and compute-plane status reporting. The second also
validates upload and download through the configured object storage.

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
* **Workflows remain pending:** verify KAI 0.12.10 is running, inspect
  ``osmo workflow events <workflow-name>``, and check node capacity with
  ``osmo resource list --pool default``.
* **Images cannot be pulled:** use released chart and image versions that
  match. Keep private registry overrides and pull credentials in a private
  site values file and Kubernetes Secret, never in the published guide.

Cleanup
========

Uninstalling the chart preserves retained Secrets. Back them up before deleting
the namespace or external database:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   helm uninstall kai-scheduler --namespace kai-scheduler --wait
