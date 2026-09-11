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

A single-plane deployment runs the OSMO control and compute planes in one
Kubernetes cluster and one Helm release. PostgreSQL, Valkey, and object storage
remain external to the release so that platform state can use services managed
and backed up independently from the cluster.

Choose this model for one-site cloud, edge, or on-premises installations that
need managed stateful dependencies but do not need control-plane isolation or
multiple compute clusters. For a workstation evaluation, use the
:ref:`Quickstart <quickstart>`. To host the stateful dependencies in the same
cluster, use the :ref:`self-contained deployment <deploy_self_contained>`. Use
the :ref:`split-plane deployment <deploy_service>` when control and compute
must scale, upgrade, or fail independently.

Topology and trade-offs
=======================

The ``single-plane.yaml`` profile enables both planes. The unified ``osmo``
chart creates the control services, gateway, backend listener and worker, and
workflow configuration in the ``osmo`` namespace. Workflow Pods also run in
that namespace unless ``compute.workloadNamespace`` selects a different one.

.. code-block:: text

   Users and CLI
        |
   TLS edge or port-forward
        |
   OSMO gateway ------------------------------+
        |                                      |
   Control services                       Backend listener/worker
        |                                      |
   PostgreSQL + Valkey + object storage    Workflow Pods
       (external)                         (same Kubernetes cluster)

This topology has fewer moving parts than split-plane deployment and avoids
cross-cluster backend credentials and routing. It also creates a shared cluster
failure, security, capacity, maintenance, and upgrade boundary. A busy workflow
can compete with control services unless you separate them with node pools,
taints, and Pod templates. One cluster outage takes both planes offline, and a
single release cannot scale or upgrade them independently.

The profile is a base overlay, not a complete production configuration. It
uses one replica per component and disables ingress, TLS, authorization,
monitoring, autoscaling, and disruption budgets. Add site-appropriate identity,
edge, availability, observability, backup, network-policy, and resource settings
before production use.

Prerequisites
=============

Run the commands from the root of an OSMO repository clone. Select the target
cluster with ``kubectl`` before continuing.

Install or provide:

* Kubernetes 1.30 or newer with enough allocatable CPU, memory, and ephemeral
  storage for OSMO and the workflows you plan to run;
* Helm 3.19 or newer, ``kubectl``, ``openssl``, and the :ref:`OSMO CLI
  <cli_install>`;
* KAI Scheduler;
* PostgreSQL 15 or newer with an empty OSMO database;
* Valkey or Redis 7.0 or newer;
* S3-compatible, Azure Blob, or Swift object storage for workflow data, logs,
  and application bundles; and
* a TLS edge and DNS name for any gateway exposed beyond a trusted network.

The Kubernetes cluster must reach every external dependency and the OSMO image
registry. PostgreSQL and Valkey credentials need access to the configured
database. The object-storage identity needs read and write access to all three
configured locations.

Install KAI Scheduler 0.14.0 and verify that its Pods are Ready:

.. code-block:: bash

   helm upgrade --install kai-scheduler \
     https://github.com/NVIDIA/KAI-Scheduler/releases/download/v0.14.0/kai-scheduler-v0.14.0.tgz \
     --namespace kai-scheduler \
     --create-namespace \
     --wait \
     --timeout 10m
   kubectl --namespace kai-scheduler get pods

Prepare credentials
===================

Create the release namespace. Store each credential in a protected file so it
does not appear in shell history, process arguments, Helm values, or rendered
manifests.

.. code-block:: bash

   kubectl create namespace osmo

The object-storage file contains the SDK credentials used for the workflow,
log, and application locations. For S3-compatible storage it has this form:

.. code-block:: yaml

   access_key_id: <access-key-id>
   access_key: <secret-access-key>

Store the PostgreSQL CA certificate at
``/secure/path/postgresql-ca.crt`` and the complete Valkey CA bundle at
``/secure/path/valkey-ca-bundle.crt``.

The backend and default administrator tokens must be independent, high-entropy,
URL-safe values. Generate each directly into its protected file when an
external secret manager does not provide it:

.. code-block:: bash

   umask 077
   set -o pipefail
   openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' \
     > /secure/path/backend-token
   openssl rand -base64 32 | tr -d '\n=' | tr '/+' '_-' \
     > /secure/path/admin-token
   test -s /secure/path/backend-token
   test -s /secure/path/admin-token

Protect all credential files before creating the Kubernetes Secrets:

.. code-block:: bash

   chmod 600 \
     /secure/path/postgres-username \
     /secure/path/postgres-password \
     /secure/path/valkey-password \
     /secure/path/object-storage.yaml \
     /secure/path/postgresql-ca.crt \
     /secure/path/valkey-ca-bundle.crt \
     /secure/path/backend-token \
     /secure/path/admin-token

Create the Kubernetes Secrets expected by the profile:

.. code-block:: bash

   kubectl --namespace osmo create secret generic osmo-postgresql \
     --from-file=username=/secure/path/postgres-username \
     --from-file=db-password=/secure/path/postgres-password
   kubectl --namespace osmo create secret generic osmo-valkey \
     --from-file=redis-password=/secure/path/valkey-password
   kubectl --namespace osmo create secret generic osmo-object-storage \
     --from-file=object-storage.yaml=/secure/path/object-storage.yaml
   kubectl --namespace osmo create secret generic osmo-postgresql-ca \
     --from-file=ca.crt=/secure/path/postgresql-ca.crt
   kubectl --namespace osmo create secret generic osmo-valkey-ca \
     --from-file=ca-bundle.crt=/secure/path/valkey-ca-bundle.crt
   kubectl --namespace osmo create secret generic osmo-backend-token \
     --from-file=token=/secure/path/backend-token
   kubectl --namespace osmo create secret generic osmo-default-admin \
     --from-file=password=/secure/path/admin-token

For production, materialize these Secrets with your approved external-secret
integration. Retain the backend token, master encryption key, and service-auth
Secret for the lifetime of their data. Replacing them can disconnect the
backend or make retained data and tokens unusable.

Configure the site overlay
==========================

Copy the following S3-compatible example to a file outside the repository,
such as ``/secure/path/single-plane-values.yaml``. Replace every bracketed
value. Keep secrets out of this file.

.. code-block:: yaml

   externalUrl: https://osmo.example.com

   imageTag: <osmo-image-tag>
   runtimeImage:
     tag: <osmo-image-tag>

   compute:
     backendName: default

   externalDependencies:
     postgresql:
       host: <postgresql-host>
       port: 5432
       database: osmo
       username: <postgresql-username>
       tls:
         enabled: true
         sslMode: verify-full
         caExistingSecret: osmo-postgresql-ca
     valkey:
       host: <valkey-host>
       port: 6379
       database: 0
       tls:
         enabled: true
         caExistingSecret: osmo-valkey-ca
     objectStorage:
       authentication:
         type: static
       locations:
         workflows: s3://<workflow-bucket>/workflows
         logs: s3://<log-bucket>/logs
         apps: s3://<application-bucket>/apps
       s3:
         region: <region>
         overrideUrl: <s3-compatible-endpoint-or-empty>

   secrets:
     defaultAdmin:
       existingSecret: osmo-default-admin
       username: admin
     masterEncryptionKey:
       bootstrap:
         enabled: true
     serviceAuth:
       managementMode: osmo
       bootstrap:
         enabled: true

Use ``sslMode: require`` and leave ``caExistingSecret`` empty only when the
PostgreSQL server supports encryption but its CA cannot be supplied. Disable
TLS only on a trusted private network when the dependency does not support it.
For Valkey certificates signed by a CA in the container system trust store,
leave its ``caExistingSecret`` empty instead of creating ``osmo-valkey-ca``.

Azure Blob locations use
``azure://<account>/<container>/<prefix>``. With Azure Workload Identity or an
equivalent cloud identity, set
``externalDependencies.objectStorage.authentication.type`` to ``sdkDefault``,
leave ``secrets.objectStorage.existingSecret`` empty, and add the required
service-account annotations and Pod labels. The repository's
``deployments/scripts/deploy-osmo-single-plane.sh`` assembles these settings
from ``single-plane-azure.yaml`` and ``single-plane-values.jq``, including the
workflow ServiceAccount. Every Azure Storage Account must disable account-level
anonymous blob access, and every container must remain private.

The profile leaves the gateway as a ``ClusterIP`` and does not create an
Ingress or HTTPRoute. Configure an operator-managed edge before using the
public ``externalUrl``. The profile requires OSMO-issued JWTs and does not
accept unauthenticated requests. Configure your identity provider, OAuth2
proxy, and authorization policy before exposing the gateway to untrusted
networks; see :ref:`authentication_authorization`.

Install OSMO
============

Helm profiles are values overlays, not a ``profile`` setting. Apply the
provider-neutral profile first and the site overlay second so site values take
precedence:

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values /secure/path/single-plane-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 25m

The first installation creates the retained ``osmo-master-encryption-key`` and
``osmo-service-auth`` Secrets through short-lived bootstrap Jobs without
placing key material in Helm state. After the install succeeds, set both
``secrets.masterEncryptionKey.bootstrap.enabled`` and
``secrets.serviceAuth.bootstrap.enabled`` to ``false`` in the site overlay,
then remove their temporary Secret-creation permissions:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values /secure/path/single-plane-values.yaml \
     --wait \
     --timeout 25m

Do not re-enable either bootstrap setting during routine upgrades.

Validate the deployment
=======================

Inspect the release without reading Secret values:

.. code-block:: bash

   helm status osmo --namespace osmo
   kubectl --namespace osmo get pods,services,jobs
   kubectl --namespace osmo get service osmo-gateway

Every long-running OSMO Pod should become Ready. The ``osmo-backend-listener``
and ``osmo-backend-worker`` Pods can restart while the API starts, but should
stabilize after the API is Ready.

If the public edge is not ready, forward the ``ClusterIP`` gateway in a
separate terminal:

.. code-block:: bash

   kubectl --namespace osmo \
     port-forward service/osmo-gateway 9000:80

Set the matching URL, authenticate with the token file, and wait for the
default backend to report resources:

.. code-block:: bash

   export OSMO_URL=http://127.0.0.1:9000
   curl --fail "$OSMO_URL/api/version"
   osmo login "$OSMO_URL" \
     --method=token \
     --token-file=/secure/path/admin-token
   osmo resource list --pool default

Submit the canonical CPU smoke workflow:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-hello.yaml \
     --pool default \
     --format-type json
   osmo workflow query <workflow-id> --format-type json

Then verify an upload and download through the configured object storage:

.. code-block:: bash

   osmo workflow submit deployments/workflows/verify-object-storage.yaml \
     --pool default \
     --format-type json
   osmo workflow query <workflow-id> --format-type json

Repeat each query until its status is ``COMPLETED``. A ``FAILED``,
``CANCELLED``, or timed-out workflow is a validation failure. The second
workflow passes data between two tasks through the configured object-storage
backend.

Troubleshooting
===============

Start with release status, workloads, and recent events:

.. code-block:: bash

   helm status osmo --namespace osmo
   kubectl --namespace osmo get pods,jobs
   kubectl --namespace osmo get events --sort-by=.lastTimestamp

Common causes include:

* Database migration failures: verify the database exists, the PostgreSQL
  username has schema permissions, the endpoint is reachable, and the TLS CA
  and mode match the server.
* Repeated Valkey connection failures: verify the host, port, password, ``TLS``
  setting, and CA bundle. Managed Redis services commonly use a ``TLS``-only
  port.
* Backend authentication failures: confirm the same ``osmo-backend-token``
  Secret is mounted by the API, backend listener, and backend worker.
* A pool with no resources: wait for the backend heartbeat, confirm KAI is
  healthy, and check node capacity and workflow Pod events.
* Object-storage failures: confirm all locations use the same URI scheme and
  that the static or workload identity can read and write every location.
* OAuth redirect loops or rejected tokens: make the public URL, issuer,
  audience, JWKS URL, client settings, and role claim consistent between OSMO
  and the identity provider.

Upgrade and recovery
====================

Back up PostgreSQL, object storage, and retained credential Secrets before an
upgrade. Keep the master encryption key with the database backup. Review the
rendered change, then apply the same profile and site values with both bootstrap
settings disabled:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/single-plane.yaml \
     --values /secure/path/single-plane-values.yaml \
     --wait \
     --wait-for-jobs \
     --timeout 25m

The chart does not configure backup or recovery for external dependencies.
Test their restore procedures and a full OSMO recovery on a separate cluster.

Clean up
========

Uninstall the release when you want to remove its active workloads:

.. code-block:: bash

   helm uninstall osmo --namespace osmo --wait
   kubectl --namespace osmo get secrets

Retained credentials and external PostgreSQL, Valkey, and object-storage data
survive the Helm uninstall. Back them up before deletion. For a disposable
installation, delete the namespace only after confirming that no recovery is
required:

.. code-block:: bash

   kubectl delete namespace osmo \
     --wait=true \
     --timeout=10m

Remove KAI Scheduler only when no other workloads use it.

What's next
===========

Before production use, configure :ref:`authentication and authorization
<authentication_authorization>`, :ref:`observability <adding_observability>`,
tested backups, an HA edge, network isolation, and resource placement. Move to
the :ref:`split-plane deployment <deploy_service>` when you add compute
clusters or need independent control- and compute-plane operations.
