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

==============
Deploy Service
==============

This guide provides step-by-step instructions for deploying OSMO service
components on a Kubernetes cluster. It uses the unified ``osmo`` Helm chart in
control-plane-only mode and externally managed PostgreSQL, Valkey, and object
storage.

Components Overview
===================

OSMO deployment consists of several main components:

.. list-table::
   :header-rows: 1
   :widths: 30 70

   * - Component
     - Description
   * - API Service
     - Workflow operations and API endpoints
   * - Router Service
     - Routing traffic to the API Service
   * - Web UI Service
     - Web interface for users
   * - Worker Service
     - Background job processing
   * - Logger Service
     - Log collection and streaming
   * - Agent Service
     - Client communication and status updates
   * - Delayed Job Monitor
     - Monitoring and managing delayed background jobs
   * - Gateway
     - Authentication, authorization, and routing into the control plane

.. image:: service_components.svg
   :width: 80%
   :align: center

Prerequisites
-------------

The cluster must run Kubernetes 1.30 or newer. Install Helm 3.19 or newer,
``kubectl``, and Python 3, select the target cluster context, and confirm that
the control plane can reach PostgreSQL, Valkey, object storage, and your
identity provider. Create the deployment namespace before creating Secrets:

.. code-block:: bash

   $ kubectl create namespace osmo

The Secret manifests in this guide use ``stringData`` so their required keys
are clear. Replace every placeholder before applying them, restrict access to
the files, and never commit them to source control.

Configure PostgreSQL Connection
===============================

Create an empty PostgreSQL database for OSMO. The database user must be able to
create and update objects in that database. The username is non-secret
connection metadata configured in Helm values. Store the password under the
default ``db-password`` key and save the following as
``postgresql-secret.yaml``:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-postgresql
     namespace: osmo
   type: Opaque
   stringData:
     db-password: <postgresql-password>

.. code-block:: bash

   $ kubectl create --filename postgresql-secret.yaml

Reference the endpoint and Secret in ``osmo-values.yaml``:

If PostgreSQL uses a private CA, save the referenced trust Secret as
``postgresql-ca-secret.yaml`` and create it first:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-postgresql-ca
     namespace: osmo
   type: Opaque
   stringData:
     ca.crt: |
       -----BEGIN CERTIFICATE-----
       <base64-encoded-certificate-body>
       -----END CERTIFICATE-----

.. code-block:: bash

   $ kubectl create --filename postgresql-ca-secret.yaml

.. code-block:: yaml

   externalDependencies:
     postgresql:
       host: postgresql.example.com
       port: 5432
       database: osmo
       username: <postgresql-username>
       tls:
         enabled: true
         sslMode: verify-full
         caExistingSecret: osmo-postgresql-ca
         caKey: ca.crt

   secrets:
     postgresql:
       existingSecret: osmo-postgresql
       keys:
         password: db-password

Use ``sslMode: require`` and leave ``caExistingSecret`` empty only when the
connection must be encrypted but no CA bundle is available. This does not
authenticate the server; ``verify-full`` is preferred. For a server that does
not use TLS, set ``tls.enabled: false``.

Configure Valkey Connection
===========================

OSMO requires Valkey or Redis 7 or newer. Save a Secret whose default key is
``redis-password`` as ``valkey-secret.yaml``:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-valkey
     namespace: osmo
   type: Opaque
   stringData:
     redis-password: <valkey-password>

.. code-block:: bash

   $ kubectl create --filename valkey-secret.yaml

When Valkey uses a private CA, save its trust bundle as
``valkey-ca-secret.yaml``:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-valkey-ca
     namespace: osmo
   type: Opaque
   stringData:
     ca-bundle.crt: |
       -----BEGIN CERTIFICATE-----
       <base64-encoded-certificate-body>
       -----END CERTIFICATE-----

.. code-block:: bash

   $ kubectl create --filename valkey-ca-secret.yaml

Add the connection to ``osmo-values.yaml``:

.. code-block:: yaml

   externalDependencies:
     valkey:
       host: valkey.example.com
       port: 6379
       database: 0
       tls:
         enabled: true
         # Set these only when Valkey uses a private CA.
         caExistingSecret: osmo-valkey-ca
         caKey: ca-bundle.crt

   secrets:
     valkey:
       generate: false
       existingSecret: osmo-valkey
       keys:
         password: redis-password

When ``caExistingSecret`` is set, its selected key must contain the complete
CA trust bundle. Leave it empty for a public CA. Set ``tls.enabled: false`` only
for a trusted network endpoint that does not provide TLS.

.. _configure_storage_access:
.. _configure_data:

Configure Storage Connection
============================

OSMO uses three locations for workflow state, logs, and application bundles.
All locations must use the same scheme: ``s3://``, ``azure://``, or
``swift://``.

Static credentials
------------------

Create one Secret containing the credential document. The following S3 or
S3-compatible example can be saved as ``object-storage-secret.yaml``:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-object-storage
     namespace: osmo
   type: Opaque
   stringData:
     object-storage.yaml: |
       access_key_id: <access-key-id>
       access_key: <secret-access-key>

.. code-block:: bash

   $ kubectl create --filename object-storage-secret.yaml

Reference the Secret and locations in ``osmo-values.yaml``:

.. code-block:: yaml

   externalDependencies:
     objectStorage:
       authentication:
         type: static
       locations:
         workflows: s3://osmo-workflows/workflows
         logs: s3://osmo-logs/logs
         apps: s3://osmo-apps/apps
       s3:
         region: us-east-1
         # Leave empty for AWS S3.
         overrideUrl: https://s3.example.com

   secrets:
     objectStorage:
       generate: false
       existingSecret: osmo-object-storage
       keys:
         credentials: object-storage.yaml

The three locations may share a bucket or container. Grant only the read/write
permissions needed for those prefixes.

Workload identity
-----------------

As an alternative, configure AWS IRSA, Azure Workload Identity, or GCP
Workload Identity and grant the identities used by the API, worker, and
workflow pods access to all three locations. For Azure Workload Identity, save
the workflow ServiceAccount as ``workflow-service-account.yaml`` and create it
before installing OSMO:

.. code-block:: yaml

   apiVersion: v1
   kind: ServiceAccount
   metadata:
     name: osmo-workflow
     namespace: osmo
     annotations:
       azure.workload.identity/client-id: <managed-identity-client-id>

.. code-block:: bash

   $ kubectl create --filename workflow-service-account.yaml

Select the provider SDK's default credential chain, add the identity to each
target pool's pod templates, and do not configure an object-storage Secret:

.. code-block:: yaml

   externalDependencies:
     objectStorage:
       authentication:
         type: sdkDefault
       locations:
         workflows: azure://<account>/<container>/workflows
         logs: azure://<account>/<container>/logs
         apps: azure://<account>/<container>/apps

   secrets:
     objectStorage:
       generate: false
       existingSecret: ''

   configuration:
     podTemplates:
       azure_workload_identity:
         metadata:
           labels:
             azure.workload.identity/use: "true"
         spec:
           serviceAccountName: osmo-workflow
     pools:
       default:
         common_pod_template:
         - default_ctrl
         - default_user
         - azure_workload_identity

   services:
     api:
       serviceAccount:
         annotations:
           azure.workload.identity/client-id: <managed-identity-client-id>
       pod:
         labels:
           azure.workload.identity/use: "true"
     worker:
       serviceAccount:
         create: true
         annotations:
           azure.workload.identity/client-id: <managed-identity-client-id>
       pod:
         labels:
           azure.workload.identity/use: "true"

The annotations and pod labels are provider-specific. Use the equivalent IRSA
or GKE annotations for AWS or GCP. Federate the exact ServiceAccount subjects
used by the release; with release name ``osmo`` they are ``osmo-api``,
``osmo-worker``, and ``osmo-workflow``.

.. _deployment_secrets:

Configure Other Secrets
=======================

The unified ``deployments/charts/osmo`` chart creates credentials for enabled
managed components during installation. For a new Quickstart or self-contained
installation, do not run the legacy ``kubectl create secret`` commands for the
MEK, service signing identity, embedded Dex, or managed backend tokens. Configure
Secret references and bootstrap settings in Helm values; bootstrap writes the
credential bytes directly to Kubernetes.

Automatic creation depends on the selected profile. The single-plane and
split-plane profiles use external dependencies and disable some credential
creation steps. An ``existingSecret`` reference alone does not always mean you
must pre-create the Secret: for the MEK and service auth it is also the name of
the output when OSMO bootstrap is enabled.

.. list-table::
   :header-rows: 1
   :widths: 22 40 38

   * - Credential
     - Created automatically
     - Supply an existing Secret when
   * - Master encryption key (MEK)
     - ``secrets.masterEncryptionKey.managementMode: osmo`` and
       ``bootstrap.enabled: true``; enabled by Quickstart and self-contained
     - Bootstrap is disabled, ownership is external, or database data is retained
   * - Service signing identity
     - ``secrets.serviceAuth.managementMode: osmo`` and
       ``bootstrap.enabled: true``; enabled by Quickstart and self-contained
     - Using the single-plane or split-plane defaults, or migrating an existing identity
   * - Backend and user bootstrap tokens
     - Each enabled ``authentication.bootstrap.identities`` entry with a
       ``tokens.<name>.managedSecret`` reference
     - The token uses ``existingSecret``; a remote compute cluster also needs a copy
   * - Embedded Dex passwords and OAuth credentials
     - Embedded Dex mode creates local passwords, browser-client and cookie
       credentials, and the hash-only Dex input Secret
     - Selecting external OIDC; its browser-client and cookie Secrets remain operator-owned
   * - Embedded PostgreSQL
     - CloudNativePG creates the application credential when
       ``postgresql.cluster.initdb.secret.name`` is empty
     - Using external PostgreSQL, or supplying an explicit embedded database credential
   * - Embedded Valkey and RustFS
     - Their enabled embedded components use ``secrets.valkey.generate: true``
       and ``secrets.objectStorage.generate: true``
     - Using external services or disabling credential generation
   * - Internal TLS
     - ``gateway.tls.enabled: true`` and ``gateway.tls.generated.enabled: true``
       create retained CA, trust, and leaf Secrets
     - Generated TLS is disabled and externally provisioned certificates are configured
   * - External storage, registry, and public edge credentials
     - Not generated by OSMO bootstrap
     - Static storage credentials, private image pulls, or the public TLS edge require them

CloudNativePG and the embedded dependency templates manage their own Secrets;
these are separate from OSMO's credential bootstrap. External storage can use
workload identity instead of a static Secret. See
:ref:`configure_storage_access` and the unified chart's
`external dependency configuration
<https://github.com/NVIDIA/OSMO/tree/main/deployments/charts/osmo#secrets>`_.

The Quickstart and self-contained profiles enable MEK and service-auth
bootstrap by default. The single-plane and split-plane base profiles disable
those steps; this guide's environment values explicitly enable them for a new
installation. Select one owner for each credential below.

MEK
---

The master encryption key (MEK) protects encrypted values stored in
PostgreSQL.

Chart-managed
^^^^^^^^^^^^^

For a new database, the chart can create the retained
``osmo-master-encryption-key`` Secret without placing key material in Helm
state:

.. code-block:: yaml

   secrets:
     masterEncryptionKey:
       managementMode: osmo
       existingSecret:
         name: osmo-master-encryption-key
         key: mek.yaml
       bootstrap:
         enabled: true

MEK bootstrap requires a fresh database and stopped database writers. It checks
that no users or user encryption keys exist and that chart consumers have not
started writing. Back up the generated Secret; never replace it while retaining
the database. Restore the original MEK for an existing database. After the first
successful installation, complete :ref:`deployment_secrets_cleanup`.

User-managed
^^^^^^^^^^^^

For a user-managed MEK, save the following as ``mek-secret.yaml``. The
``currentMek`` value must name an entry in ``meks``; each entry is a
base64-encoded symmetric JWK. Generate a random 32-byte key, encode it as
base64url without padding for the JWK's ``k`` field, then base64-encode the
complete ``{"k":"...","kid":"key1","kty":"oct"}`` document for the
``meks`` value:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-master-encryption-key
     namespace: osmo
   type: Opaque
   stringData:
     mek.yaml: |
       currentMek: key1
       meks:
         key1: <base64-encoded-symmetric-jwk>

.. code-block:: bash

   $ kubectl create --filename mek-secret.yaml

Set ``managementMode: external`` and ``bootstrap.enabled: false`` when the
Secret is user-managed.

Internal TLS
------------

``gateway.tls`` protects traffic from Envoy to the OSMO services; it does not
configure public edge TLS.

Chart-managed
^^^^^^^^^^^^^

Chart-managed mode creates and retains an internal CA, trust bundle, and one
leaf Secret per service:

.. code-block:: yaml

   gateway:
     tls:
       enabled: true
       generated:
         enabled: true

Back up the retained TLS Secrets. Do not regenerate a missing CA for an
existing installation; restore it.

User-managed
^^^^^^^^^^^^

For user-managed TLS, create a CA Secret containing ``ca.crt`` and a
``kubernetes.io/tls`` Secret containing ``tls.crt`` and ``tls.key`` for each
enabled upstream. Each certificate's DNS subject alternative name must match
the corresponding in-cluster Service host. Save the following as
``internal-tls-secrets.yaml``, adding one TLS Secret document for every enabled
upstream:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-internal-ca
     namespace: osmo
   type: Opaque
   stringData:
     ca.crt: |
       -----BEGIN CERTIFICATE-----
       <base64-encoded-ca-certificate-body>
       -----END CERTIFICATE-----
   ---
   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-api-tls
     namespace: osmo
   type: kubernetes.io/tls
   stringData:
     tls.crt: |
       -----BEGIN CERTIFICATE-----
       <base64-encoded-api-certificate-body>
       -----END CERTIFICATE-----
     tls.key: |
       -----BEGIN PRIVATE KEY-----
       <base64-encoded-api-private-key-body>
       -----END PRIVATE KEY-----

.. code-block:: bash

   $ kubectl create --filename internal-tls-secrets.yaml

Point OSMO at the Secret names as follows:

.. code-block:: yaml

   gateway:
     tls:
       enabled: true
       generated:
         enabled: false
       caSecret: osmo-internal-ca
       upstreamCerts:
         api: osmo-api-tls
         router: osmo-router-tls
         agent: osmo-agent-tls
         logger: osmo-logger-tls
         # Required only when services.mcp.enabled is true.
         mcp: ''

Change ``gateway.tls.rolloutNonce`` after rotating user-managed TLS Secrets.

Service auth
------------

Service auth is OSMO's stable JWT signing identity.

Chart-managed
^^^^^^^^^^^^^

The chart can create the retained ``osmo-service-auth`` Secret for a new
installation:

.. code-block:: yaml

   secrets:
     serviceAuth:
       managementMode: osmo
       existingSecret:
         name: osmo-service-auth
         key: authentication-config.json
       bootstrap:
         enabled: true

Back up the Secret and complete :ref:`deployment_secrets_cleanup` after the
first successful installation. Existing installations must preserve or migrate
their signing identity; follow the chart's `service-auth migration instructions
<https://github.com/NVIDIA/OSMO/tree/main/deployments/charts/osmo#service-auth-identity>`_
instead of generating a replacement.

User-managed
^^^^^^^^^^^^

For a user-managed identity, generate the file with the OSMO service image:

.. code-block:: bash

   $ mkdir --mode 0700 service-auth
   $ docker run --rm --user "$(id -u):$(id -g)" \
       --entrypoint service-auth-bootstrap \
       --volume "$PWD/service-auth:/output" \
       nvcr.io/nvidia/osmo/service:<image-tag> \
       generate --output /output/authentication-config.json

Copy the generated JSON into ``service-auth-secret.yaml`` and create the
Secret before installation:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-service-auth
     namespace: osmo
   type: Opaque
   stringData:
     authentication-config.json: |
       <contents-of-service-auth/authentication-config.json>

.. code-block:: bash

   $ kubectl create --filename service-auth-secret.yaml

The JSON document must contain ``active_key`` and a matching entry in ``keys``
with valid ``public_key`` and ``private_key`` JWK values. Set
``managementMode: external`` and ``bootstrap.enabled: false``. Change
``rolloutNonce`` after an intentional update.

.. _sequenced_bootstrap:

Charts containing PR #1414
------------------------------

`PR #1414 <https://github.com/NVIDIA/OSMO/pull/1414>`_ consolidates ordinary
bootstrap into one Job, in this order: TLS, identities, service auth, MEK, and
object-storage buckets, followed by consumer readiness checks. It retains the
per-step values above; disabled steps do not run. CA and MEK rotations and
database migrations remain separate operations. Use this section only with a
chart and matching images that include that change.

For an intentionally new installation, add a unique, non-secret ID to the
initial Helm install command:

.. code-block:: bash

   --set-string bootstrap.initializationId=my-new-osmo-installation

Use ``--wait --wait-for-jobs --timeout 140m`` for install and upgrade commands;
this accommodates the default all-enabled bootstrap deadline. After successful
initialization, remove the ID from saved values. With ``--reuse-values``, clear
it explicitly using ``--set-string bootstrap.initializationId=`` during the
cleanup upgrade in :ref:`deployment_secrets_cleanup`, and use the longer timeout.

For an upgrade from the earlier chart, leave the ID empty and retain the
existing credential declarations for the first upgrade. Bootstrap validates
and adopts those credentials. Add new identity declarations in a later upgrade.
Do not set a new initialization ID to repair a missing retained Secret.

Keep the runtime-owned ``<fullname>-bootstrap-state`` ConfigMap with the retained
Secrets. Missing, changed, or foreign credential identities fail closed;
deleting a Secret is not a rotation procedure. Follow the chart's
`bootstrap recovery instructions
<https://github.com/NVIDIA/OSMO/blob/548ccd9bfe7ca1dcfe0e69d9e5039a45b77ef8b3/deployments/charts/osmo/README.md#one-bootstrap-job>`_
for credential replacement, adoption, and recovery.

If a bootstrap attempt fails, capture the Job logs and events, correct the
cause, then change ``bootstrap.attempt``. A Helm timeout does not prove the Job
has stopped. Never delete an active Job, Pod, or Lease to bypass execution
ownership. After a successful replacement, remove a retained failed Job only
once its old execution is confirmed terminal. Recreating a Secret with the same
bytes changes its UID and is not a supported way to bypass retained identity
checks.

.. _deploy_service_osmo_values:

Prepare Values
==============

The chart packages a ``profiles/split-plane-control.yaml`` base profile for an
HA control plane with external PostgreSQL, Valkey, and object storage. The
profile enables the control plane, disables the compute plane and embedded
stateful dependencies, uses the chart application version for OSMO images, and
configures autoscaling, disruption budgets, and topology spreading. The
deployment commands below layer ``osmo-values.yaml`` after that profile.

Combine only the site-specific settings above in ``osmo-values.yaml``. This
static-credential example uses the chart defaults for embedded Dex and uses
chart-managed MEK, service auth, and internal TLS. Replace every angle-bracket
placeholder:

.. code-block:: yaml

   externalUrl: https://osmo.example.com

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
         caKey: ca.crt
     valkey:
       host: <valkey-host>
       port: 6379
       database: 0
       tls:
         enabled: true
     objectStorage:
       authentication:
         type: static
       locations:
         workflows: s3://<bucket>/workflows
         logs: s3://<bucket>/logs
         apps: s3://<bucket>/apps
       s3:
         region: <region>
         overrideUrl: ''

   secrets:
     postgresql:
       existingSecret: osmo-postgresql
     valkey:
       generate: false
       existingSecret: osmo-valkey
     objectStorage:
       generate: false
       existingSecret: osmo-object-storage
     masterEncryptionKey:
       managementMode: osmo
       existingSecret:
         name: osmo-master-encryption-key
         key: mek.yaml
       bootstrap:
         enabled: true
     serviceAuth:
       managementMode: osmo
       existingSecret:
         name: osmo-service-auth
         key: authentication-config.json
       bootstrap:
         enabled: true

   gateway:
     envoy:
       service:
         type: LoadBalancer
     tls:
       enabled: true
       generated:
         enabled: true

Configure an External IdP
=========================

By default, the unified chart enables an embedded Dex identity provider and
bootstraps a statically configured admin identity. Embedded Dex uses volatile
memory storage and is intended only to speed up development and evaluation;
it is not suitable for production deployments. For production, disable Dex
and use your organization's external OIDC identity provider. External browser
client and cookie Secrets remain operator-owned even when bootstrap is enabled;
embedded Dex generates its own OAuth credentials automatically.

Before continuing, follow
:doc:`../appendix/authentication/identity_provider_setup` to register the
required confidential browser and public CLI clients and collect their IDs,
endpoints, and claims. Then save the browser client secret and a random
32-byte cookie secret as ``external-oidc-secret.yaml``:

.. code-block:: bash

   $ openssl rand -base64 32

Use the command output as ``cookie_secret``:

.. code-block:: yaml

   apiVersion: v1
   kind: Secret
   metadata:
     name: osmo-external-oidc
     namespace: osmo
   type: Opaque
   stringData:
     client_secret: <oidc-browser-client-secret>
     cookie_secret: <random-32-byte-cookie-secret>

.. code-block:: bash

   $ kubectl create --filename external-oidc-secret.yaml

Disable embedded Dex and replace the ``authentication`` block in
``osmo-values.yaml``. Endpoint URLs are explicit so providers without complete
OIDC discovery remain supported:

.. code-block:: yaml

   embeddedDependencies:
     dex:
       enabled: false

   authentication:
     provider: externalOidc
     bootstrap:
       identities:
         admin:
           enabled: false
     externalOidc:
       issuer: https://idp.example.com
       browserClientId: <browser-client-id>
       cliClientId: <device-client-id>
       authorizationEndpoint: https://idp.example.com/authorize
       tokenEndpoint: https://idp.example.com/token
       deviceEndpoint: https://idp.example.com/device
       jwksUri: https://idp.example.com/keys
       jwksHost: idp.example.com
       userClaim: sub
       rolesClaim: roles
       scopes: [openid, email, profile]
       logoutEndpoint: https://idp.example.com/logout
       browserClientSecret:
         existingSecret: osmo-external-oidc
         key: client_secret
       cookieSecret:
         existingSecret: osmo-external-oidc
         key: cookie_secret

See :doc:`../appendix/authentication/idp_role_mapping` for role mapping.

.. _deploy_service_deploy_components:

Deploy Components
=================

Add the published OSMO chart repository and select the chart version to deploy.
Pull that version once to obtain its matching control-plane profile for the
values layering below:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
   $ helm repo update
   $ helm pull osmo/osmo --version <chart-version> \
       --untar --untardir /tmp/osmo-chart
   $ helm show chart osmo/osmo --version <chart-version>

Render and lint the release before changing the cluster:

.. code-block:: bash

   $ helm lint /tmp/osmo-chart/osmo \
       --values /tmp/osmo-chart/osmo/profiles/split-plane-control.yaml \
       --values osmo-values.yaml
   $ helm template osmo osmo/osmo --version <chart-version> \
       --namespace osmo \
       --values /tmp/osmo-chart/osmo/profiles/split-plane-control.yaml \
       --values osmo-values.yaml > /tmp/osmo-rendered.yaml

For charts containing PR #1414, apply the initialization ID and timeout from
:ref:`sequenced_bootstrap` to the initial install and cleanup commands below.

Install the control plane and wait for bootstrap and migration Jobs:

.. code-block:: bash

   $ helm upgrade --install osmo osmo/osmo --version <chart-version> \
       --namespace osmo \
       --values /tmp/osmo-chart/osmo/profiles/split-plane-control.yaml \
       --values osmo-values.yaml \
       --wait --wait-for-jobs --timeout 30m

.. _deployment_secrets_cleanup:

After successful bootstrap
--------------------------

After a successful chart-managed MEK and service-auth bootstrap, change both
``bootstrap.enabled`` values to ``false`` in your saved environment values:

.. code-block:: yaml

   secrets:
     masterEncryptionKey:
       bootstrap:
         enabled: false
     serviceAuth:
       bootstrap:
         enabled: false

Keep the Secret references and ``managementMode`` unchanged. For this guide,
save the flags in ``osmo-values.yaml`` and apply a cleanup upgrade:

.. code-block:: bash

   $ helm upgrade osmo osmo/osmo --version <chart-version> \
       --namespace osmo \
       --values /tmp/osmo-chart/osmo/profiles/split-plane-control.yaml \
       --values osmo-values.yaml \
       --wait --timeout 30m

For a Quickstart or minimal deployment installed from the repository with
command-line settings, preserve those settings using ``--reuse-values``:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --reuse-values \
     --set secrets.masterEncryptionKey.bootstrap.enabled=false \
     --set secrets.serviceAuth.bootstrap.enabled=false \
     --wait --wait-for-jobs --timeout 20m

For charts containing PR #1414, clear the initialization ID and use the longer
timeout in :ref:`sequenced_bootstrap`. Disabling these steps removes their
creation permissions; other enabled bootstrap operations can still require
Secret access. Save the disabled flags in the values used for future upgrades.
Back up retained Secrets with their database and storage data. Helm uninstall
or rollback does not restore or rotate their contents.

Configure public DNS and edge TLS for ``externalUrl`` after the gateway's
LoadBalancer address is assigned. ``gateway.tls`` does not terminate public
TLS; use your load balancer, Ingress, or Gateway API implementation for that.

Verify
======

Check the release without reading Secret values:

.. code-block:: bash

   $ helm status osmo --namespace osmo
   $ kubectl --namespace osmo get pods,jobs,services
   $ kubectl --namespace osmo get secret \
       osmo-master-encryption-key osmo-service-auth
   $ kubectl --namespace osmo wait --for=condition=Available deployment \
       --selector=app.kubernetes.io/instance=osmo --timeout=10m

Verify the API through the same gateway used by clients. A port-forward avoids
waiting for public DNS during initial validation:

.. code-block:: bash

   $ kubectl --namespace osmo port-forward service/osmo-gateway 8080:80

In another terminal:

.. code-block:: bash

   $ curl --fail http://127.0.0.1:8080/api/version

Sign in through the UI or CLI, list pools and resources, and submit a small CPU
workflow. Confirm that PostgreSQL contains the new workflow, Valkey remains
reachable, and objects appear under the configured workflow, log, and app
locations.

Troubleshooting
===============

Start with release events and failed containers or Jobs:

.. code-block:: bash

   $ helm status osmo --namespace osmo
   $ kubectl --namespace osmo get pods,jobs
   $ kubectl --namespace osmo describe pod <pod-name>
   $ kubectl --namespace osmo logs <pod-name> --all-containers --previous
   $ kubectl --namespace osmo logs job/<job-name>

Common failures include:

* **Values validation fails before install**: run ``helm lint`` and check that
  all external dependencies have endpoints and Secret references. Static
  object storage requires a Secret; ``sdkDefault`` forbids one.
* **A bootstrap executable is not found**: the chart and OSMO images are from
  different releases. Use the same pinned ``<chart-version>`` for every Helm
  command and do not override the control-plane profile's chart-version image
  selection.
* **PostgreSQL connection or migration fails**: verify DNS, network policy,
  database ownership, the configured username, the ``db-password`` Secret key,
  TLS mode, and CA bundle. Do not enable ``databaseMigration`` for a new
  database merely to retry connectivity.
* **Valkey readiness fails**: confirm Valkey/Redis is version 7 or newer, the
  selected database exists, ``redis-password`` is correct, and the TLS trust
  bundle is complete.
* **Object-storage operations fail**: confirm all three locations use one URI
  scheme and that the API and worker identity or static credential can read and
  write each prefix. For workload identity, inspect the rendered ServiceAccount
  names and federation subjects.
* **MEK bootstrap fails**: use it only with a new database. Correct the cause
  and increment ``secrets.masterEncryptionKey.bootstrap.attempt`` to retry. Do
  not generate a replacement for an installation with retained encrypted data.
* **Service-auth bootstrap fails**: correct image pull or RBAC issues and
  increment ``secrets.serviceAuth.bootstrap.attempt``. Do not replace the
  retained signing identity during an ordinary upgrade.
* **Internal TLS bootstrap fails**: with generated TLS, restore any missing
  retained CA rather than enabling initial generation. With user-managed TLS,
  verify ``ca.crt``, ``tls.crt``, ``tls.key``, and each Service DNS SAN.
* **Authentication redirects or JWKS fetches fail**: verify ``externalUrl``,
  issuer and endpoint URLs, ``jwksHost``, client IDs, Secret keys, and public
  edge TLS. Embedded Dex must be disabled when ``provider: externalOidc``.
* **Gateway has no public address**: inspect the ``osmo-gateway`` Service and
  cloud load-balancer events, or keep the Service internal and configure
  ``ingress`` or ``httproute`` instead.

For all chart values and lifecycle procedures, refer to the unified chart
`README <https://github.com/NVIDIA/OSMO/blob/main/deployments/charts/osmo/README.md>`_.
