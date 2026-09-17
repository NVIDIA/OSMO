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

Deploy a fresh OSMO service with the unified ``osmo`` Helm chart. The simplest
path uses embedded PostgreSQL, Valkey, object storage, and Dex. The chart and
CloudNativePG create the required Secrets during installation, including the
database credentials and CA, storage credentials, master encryption key (MEK),
service signing identity, and administrator password. You do not need to create
any Secrets manually.

This example installs the control plane for development and evaluation. For a
complete service and compute deployment, see :ref:`deploy_minimal`. For
production, see :ref:`deploy_self_contained` or the chart's
`deployment profiles
<https://github.com/NVIDIA/OSMO/tree/main/deployments/charts/osmo/profiles>`_.
Embedded Dex uses memory-only sessions and signing keys and is intended for
development and evaluation.

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
=============

Use Kubernetes 1.30 or newer, Helm 3.19 or newer, ``kubectl``, and a default
dynamic StorageClass. Select the target cluster context and check storage:

.. code-block:: bash

   $ kubectl config current-context
   $ kubectl get storageclass

Embedded PostgreSQL requires the CloudNativePG operator. Install it if it is
not already available in the cluster:

.. code-block:: bash

   $ helm repo add cnpg https://cloudnative-pg.github.io/charts
   $ helm repo update cnpg
   $ helm upgrade --install cnpg cnpg/cloudnative-pg \
       --version 0.29.0 \
       --namespace cnpg-system --create-namespace \
       --wait --timeout 10m

Allow capacity for the OSMO services and the embedded dependencies. The default
persistent volume requests are 1 GiB for PostgreSQL, 512 MiB for Valkey, and
1 GiB for object storage. This service-only installation does not require
KAI Scheduler or a GPU operator.

.. _deploy_service_osmo_values:

Prepare Values
==============

Save the following as ``osmo-values.yaml``. It keeps the chart's embedded
dependencies and credential generation enabled, disables the compute plane,
and uses a local port-forward for browser and CLI access:

.. code-block:: yaml

   externalUrl: http://127.0.0.1:8080
   # Use the OSMO image version packaged with the selected chart.
   imageTag: ''

   planes:
     compute:
       enabled: false

   gateway:
     envoy:
       service:
         type: ClusterIP
     tls:
       enabled: true
       generated:
         enabled: true

There are no passwords, CA bundles, or existing Secret references to supply.
CloudNativePG creates PostgreSQL's password and CA Secrets. Embedded Valkey
uses its generated password without TLS, so it does not need a CA Secret.
OSMO also generates the internal TLS certificates enabled above. Keep embedded
Dex enabled to use the generated administrator login.

Use these values directly with the chart defaults. The
``split-plane-control.yaml`` profile selects external dependencies and requires
additional configuration; it is not needed for this fresh install.

.. _deploy_service_deploy_components:

Deploy Components
=================

Add the OSMO chart repository and choose a published unified chart version with
matching OSMO images. Use the same ``<chart-version>`` in every command:

.. code-block:: bash

   $ helm repo add osmo https://helm.ngc.nvidia.com/nvidia/osmo
   $ helm repo update osmo
   $ helm search repo osmo/osmo --versions
   $ helm show chart osmo/osmo --version <chart-version>

Render the release before installing it. The API flag tells the offline render
that the CloudNativePG operator is available:

.. code-block:: bash

   $ helm template osmo osmo/osmo --version <chart-version> \
       --namespace osmo \
       --api-versions postgresql.cnpg.io/v1 \
       --values osmo-values.yaml > /tmp/osmo-rendered.yaml

For charts containing PR #1414, add
``--set-string bootstrap.initializationId=my-new-osmo-installation`` to the
initial install below and use ``--timeout 140m``. See
:ref:`sequenced_bootstrap` for that version's lifecycle details.

Install the service and wait for bootstrap and migration Jobs:

.. code-block:: bash

   $ helm upgrade --install osmo osmo/osmo --version <chart-version> \
       --namespace osmo --create-namespace \
       --values osmo-values.yaml \
       --wait --wait-for-jobs --timeout 30m

.. _deployment_secrets_cleanup:

After successful bootstrap
--------------------------

After the first successful installation, add the following to
``osmo-values.yaml`` to disable the install-only MEK and service-auth creation
steps. Keep the generated Secrets and their default references:

.. code-block:: yaml

   secrets:
     masterEncryptionKey:
       bootstrap:
         enabled: false
     serviceAuth:
       bootstrap:
         enabled: false

Apply the saved values. For a chart containing PR #1414, also add
``--set-string bootstrap.initializationId=`` and use ``--timeout 140m``.
Remove the initialization ID from saved values if you added it there:

.. code-block:: bash

   $ helm upgrade osmo osmo/osmo --version <chart-version> \
       --namespace osmo \
       --values osmo-values.yaml \
       --wait --wait-for-jobs --timeout 30m

For a Quickstart or minimal deployment installed from the repository with
command-line settings, preserve those settings using ``--reuse-values``:

.. code-block:: bash

   helm upgrade osmo deployments/charts/osmo \
     --namespace osmo \
     --reuse-values \
     --set secrets.masterEncryptionKey.bootstrap.enabled=false \
     --set secrets.serviceAuth.bootstrap.enabled=false \
     --wait --wait-for-jobs --timeout 20m

For charts containing PR #1414, also clear the initialization ID and use the
longer timeout described above. Save the disabled flags for future upgrades.
Other enabled bootstrap operations can still require Secret access. Back up
retained Secrets with their database and storage data; never generate a new
MEK for an existing database. Helm uninstall or rollback does not restore or
rotate Secret contents.

Verify and Sign In
==================

Check that the service, embedded dependencies, and bootstrap Jobs are ready:

.. code-block:: bash

   $ helm status osmo --namespace osmo
   $ kubectl --namespace osmo get pods,jobs,pvc,services
   $ kubectl --namespace osmo get secret \
       osmo-master-encryption-key osmo-service-auth osmo-embedded-dex-admin
   $ kubectl --namespace osmo wait --for=condition=Available deployment \
       --selector=app.kubernetes.io/instance=osmo --timeout=10m

Keep this port-forward running:

.. code-block:: bash

   $ kubectl --namespace osmo port-forward service/osmo-gateway 8080:80

In another private terminal, verify the API and retrieve the generated
administrator password:

.. code-block:: bash

   $ curl --fail http://127.0.0.1:8080/api/version
   $ kubectl --namespace osmo get secret osmo-embedded-dex-admin \
       --output jsonpath='{.data.password}' | base64 --decode
   $ printf '\n'

Open http://127.0.0.1:8080 and sign in as ``admin@osmo.local`` with that
password. Install the :ref:`OSMO CLI <cli_install>` and sign in:

.. code-block:: bash

   $ osmo login http://127.0.0.1:8080

The service is now ready. Running workflows also requires a compute backend;
continue with :ref:`deploy_backend` when you are ready to connect one. Before
connecting a remote backend, configure a gateway URL reachable from that
cluster and its workflow pods, and make object storage reachable from those
pods. Embedded object storage uses cluster DNS by default. The local
port-forward is only for this initial service evaluation.

.. _deploy_service_external_dependencies:

Optional: Use External Dependencies
===================================

Skip this section for the fresh install above. Use it only when you already
have PostgreSQL, Valkey, or object storage to connect to instead of the embedded
components. Configure each selected external dependency before the initial
install; changing to an external database later requires a data migration.
Merge the following settings into ``osmo-values.yaml``, keeping one mapping for
each top-level key.

External credentials belong to those services and cannot be generated by OSMO.
Static authentication therefore requires existing Secrets; object storage can
instead use workload identity. The examples use ``stringData`` so the keys are
clear. Replace placeholders, restrict file access, and never commit credentials.
Create the namespace before creating any external Secrets:

.. code-block:: bash

   $ kubectl create namespace osmo

Configure PostgreSQL Connection
-------------------------------

Disable embedded PostgreSQL and create an empty external database for OSMO.
The database user must be able to create and update objects in that database. The username is non-secret
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

With ``sslMode: verify-full``, the chart requires a CA Secret, even for a
publicly trusted certificate. Save the CA that signs the server certificate in
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

   embeddedDependencies:
     postgresql:
       enabled: false

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
---------------------------

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

   embeddedDependencies:
     valkey:
       enabled: false

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
----------------------------

OSMO uses three locations for workflow state, logs, and application bundles.
All locations must use the same scheme: ``s3://``, ``azure://``, or
``swift://``.

Static credentials
^^^^^^^^^^^^^^^^^^

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

   embeddedDependencies:
     objectStorage:
       enabled: false

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
^^^^^^^^^^^^^^^^^

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

   embeddedDependencies:
     objectStorage:
       enabled: false

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

Optional: Customize Secret Management
=====================================

Skip this section for the fresh install above: the chart defaults already
create the managed credentials. Use these settings only to change credential
ownership, restore an existing deployment, or understand which component owns
each Secret. An ``existingSecret`` reference can name the output of enabled
bootstrap; it does not always mean you must create the Secret yourself.

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
those steps; the fresh-install path above uses chart defaults, which enable
them. Select one owner for each credential below.

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
OSMO bootstrap into one Job, in this order: TLS, OSMO access tokens, service
auth, MEK, and object-storage buckets, followed by consumer readiness checks.
Dex passwords and OAuth credentials still use separate Helm hooks. The Job
retains the per-step values above; disabled steps do not run. CA and MEK
rotations and database migrations remain separate operations. Use this section
only with a chart and matching images that include that change.

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
<https://github.com/NVIDIA/OSMO/blob/cd396d7ce387b66c7ac8f8b4146e65f6fac5383f/deployments/charts/osmo/README.md#one-bootstrap-job>`_
for credential replacement, adoption, and recovery.

If a bootstrap attempt fails, capture the Job logs and events, correct the
cause, then change ``bootstrap.attempt``. A Helm timeout does not prove the Job
has stopped. Never delete an active Job, Pod, or Lease to bypass execution
ownership. After a successful replacement, remove a retained failed Job only
once its old execution is confirmed terminal. Recreating a Secret with the same
bytes changes its UID and is not a supported way to bypass retained identity
checks.

Optional: Configure an External IdP
===================================

By default, the unified chart enables an embedded Dex identity provider and
bootstraps a statically configured admin identity. Embedded Dex uses volatile
memory storage and is intended only to speed up development and evaluation;
it is not suitable for production deployments. For production, disable Dex
and use your organization's external OIDC identity provider. External browser
client and cookie Secrets remain operator-owned even when bootstrap is enabled;
embedded Dex generates its own OAuth credentials automatically.

For the fresh install above, keep embedded Dex and skip this section. To use
an external provider, follow
:doc:`../appendix/authentication/identity_provider_setup` to register the
required confidential browser and public CLI clients and collect their IDs,
endpoints, and claims. Set ``externalUrl`` in ``osmo-values.yaml`` to the
client-facing URL registered with the provider. For a public deployment,
configure matching DNS, gateway exposure through a load balancer or Ingress,
and public HTTPS termination. ``gateway.tls`` protects internal service traffic;
it does not provide public edge TLS. For local evaluation, keep the port-forward
and register exactly ``http://127.0.0.1:8080/oauth2/callback`` if your provider
allows it.

If the ``osmo`` namespace does not exist yet, create it before applying the
external OIDC Secret:

.. code-block:: bash

   $ kubectl create namespace osmo

Save the browser client secret and a random 32-byte cookie secret as
``external-oidc-secret.yaml``:

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
  embedded dependencies remain enabled for the fresh-install example. If using
  external dependencies, supply their endpoints and Secret references. Static
  object storage requires a Secret; ``sdkDefault`` forbids one.
* **A bootstrap executable is not found**: the chart and OSMO images are from
  different releases. Use the same pinned ``<chart-version>`` for every Helm
  command and keep ``imageTag: ''`` to select the chart application version.
* **Embedded dependency stays Pending**: check PVCs, the default StorageClass,
  node capacity, and CloudNativePG operator status.
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
  and increment ``secrets.masterEncryptionKey.bootstrap.attempt`` to retry
  (``bootstrap.attempt`` for charts containing PR #1414). Do not generate a
  replacement for an installation with retained encrypted data.
* **Service-auth bootstrap fails**: correct image pull or RBAC issues and
  increment ``secrets.serviceAuth.bootstrap.attempt`` (``bootstrap.attempt``
  for charts containing PR #1414). Do not replace the retained signing identity
  during an ordinary upgrade.
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
