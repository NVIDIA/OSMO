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

The cluster must run Kubernetes 1.28 or newer. Install Helm 3.19 or newer,
``kubectl``, and Python 3, select the target cluster context, and confirm that
the control plane can reach PostgreSQL, Valkey, object storage, and your
identity provider. Create the deployment namespace before creating Secrets:

.. code-block:: bash

   $ kubectl create namespace osmo

Configure PostgreSQL Connection
===============================

Create an empty PostgreSQL database for OSMO. The database user must be able to
create and update objects in that database. Store the username and password in
a Secret; the default keys are ``username`` and ``db-password``:

.. code-block:: bash

   $ umask 077
   $ OSMO_POSTGRES_SECRET_DIR=$(mktemp -d)
   $ trap 'rm -rf -- "$OSMO_POSTGRES_SECRET_DIR"' EXIT
   $ read -rp 'PostgreSQL username: ' OSMO_POSTGRES_USERNAME
   $ read -rsp 'PostgreSQL password: ' OSMO_POSTGRES_PASSWORD; printf '\n'
   $ printf '%s' "$OSMO_POSTGRES_USERNAME" > "$OSMO_POSTGRES_SECRET_DIR/username"
   $ printf '%s' "$OSMO_POSTGRES_PASSWORD" > "$OSMO_POSTGRES_SECRET_DIR/db-password"
   $ unset OSMO_POSTGRES_USERNAME OSMO_POSTGRES_PASSWORD
   $ kubectl --namespace osmo create secret generic osmo-postgresql \
       --from-file=username="$OSMO_POSTGRES_SECRET_DIR/username" \
       --from-file=db-password="$OSMO_POSTGRES_SECRET_DIR/db-password"
   $ rm -rf -- "$OSMO_POSTGRES_SECRET_DIR"; trap - EXIT

Reference the endpoint and Secret in ``osmo-values.yaml``:

If PostgreSQL uses a private CA, create the referenced trust Secret first:

.. code-block:: bash

   $ kubectl --namespace osmo create secret generic osmo-postgresql-ca \
       --from-file=ca.crt=<path-to-postgresql-ca.pem>

.. code-block:: yaml

   externalDependencies:
     postgresql:
       host: postgresql.example.com
       port: 5432
       database: osmo
       username: osmo
       tls:
         enabled: true
         sslMode: verify-full
         caExistingSecret: osmo-postgresql-ca
         caKey: ca.crt

   secrets:
     postgresql:
       existingSecret: osmo-postgresql
       keys:
         username: username
         password: db-password

Use ``sslMode: require`` and leave ``caExistingSecret`` empty only when the
connection must be encrypted but no CA bundle is available. This does not
authenticate the server; ``verify-full`` is preferred. For a server that does
not use TLS, set ``tls.enabled: false``.

Configure Valkey Connection
===========================

OSMO requires Valkey or Redis 7 or newer. Create a Secret whose default key is
``redis-password``:

.. code-block:: bash

   $ umask 077
   $ OSMO_VALKEY_SECRET_FILE=$(mktemp)
   $ trap 'rm -f -- "$OSMO_VALKEY_SECRET_FILE"' EXIT
   $ read -rsp 'Valkey password: ' OSMO_VALKEY_PASSWORD; printf '\n'
   $ printf '%s' "$OSMO_VALKEY_PASSWORD" > "$OSMO_VALKEY_SECRET_FILE"
   $ unset OSMO_VALKEY_PASSWORD
   $ kubectl --namespace osmo create secret generic osmo-valkey \
       --from-file=redis-password="$OSMO_VALKEY_SECRET_FILE"
   $ rm -f -- "$OSMO_VALKEY_SECRET_FILE"; trap - EXIT

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
         caExistingSecret: ''
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

Create one YAML credential document. The following example is for S3 or an
S3-compatible service:

.. code-block:: bash

   $ umask 077
   $ OSMO_STORAGE_SECRET_FILE=$(mktemp)
   $ trap 'rm -f -- "$OSMO_STORAGE_SECRET_FILE"' EXIT
   $ read -rp 'Object-storage access key ID: ' OSMO_STORAGE_ACCESS_KEY_ID
   $ read -rsp 'Object-storage secret access key: ' OSMO_STORAGE_ACCESS_KEY; printf '\n'
   $ ACCESS_KEY_ID="$OSMO_STORAGE_ACCESS_KEY_ID" ACCESS_KEY="$OSMO_STORAGE_ACCESS_KEY" \
       python3 -c 'import json, os; print(json.dumps({"access_key_id": os.environ["ACCESS_KEY_ID"], "access_key": os.environ["ACCESS_KEY"]}))' \
       > "$OSMO_STORAGE_SECRET_FILE"
   $ unset OSMO_STORAGE_ACCESS_KEY_ID OSMO_STORAGE_ACCESS_KEY ACCESS_KEY_ID ACCESS_KEY
   $ kubectl --namespace osmo create secret generic osmo-object-storage \
       --from-file=object-storage.yaml="$OSMO_STORAGE_SECRET_FILE"
   $ rm -f -- "$OSMO_STORAGE_SECRET_FILE"; trap - EXIT

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
permissions needed for those prefixes. Do not put credentials in Helm values.

Workload identity
-----------------

As an alternative, configure AWS IRSA, Azure Workload Identity, or GCP
Workload Identity and grant the identities used by the API and worker access to
all three locations. Select the provider SDK's default credential chain and do
not configure an object-storage Secret:

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
rendered by the release; with release name ``osmo`` they are ``osmo-api`` and
``osmo-worker``.

Configure Other Secrets
=======================

MEK
---

The master encryption key (MEK) protects encrypted values stored in
PostgreSQL. For a new database, the chart can create the retained
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

Back up that Secret after installation. Never replace it while retaining the
database. After the first successful installation, set ``bootstrap.enabled``
to ``false``.

For a user-managed MEK, create a Secret whose selected key is ``mek.yaml``.
The file must contain ``currentMek`` naming an entry in ``meks``; each entry is
a base64-encoded symmetric JWK:

.. code-block:: bash

   $ umask 077
   $ OSMO_MEK_FILE=$(mktemp)
   $ trap 'rm -f -- "$OSMO_MEK_FILE"' EXIT
   $ OSMO_RANDOM_KEY=$(openssl rand 32 | openssl base64 -A | tr '+/' '-_' | tr -d '=')
   $ OSMO_ENCODED_JWK=$(printf '{"k":"%s","kid":"key1","kty":"oct"}' \
       "$OSMO_RANDOM_KEY" | base64 | tr -d '\n')
   $ printf 'currentMek: key1\nmeks:\n  key1: %s\n' "$OSMO_ENCODED_JWK" > "$OSMO_MEK_FILE"
   $ unset OSMO_RANDOM_KEY OSMO_ENCODED_JWK
   $ kubectl --namespace osmo create secret generic osmo-master-encryption-key \
       --from-file=mek.yaml="$OSMO_MEK_FILE"
   $ rm -f -- "$OSMO_MEK_FILE"; trap - EXIT

Set ``managementMode: external`` and ``bootstrap.enabled: false`` when the
Secret is user-managed.

Internal TLS
------------

``gateway.tls`` protects traffic from Envoy to the OSMO services; it does not
configure public edge TLS. Chart-managed mode creates and retains an internal
CA, trust bundle, and one leaf Secret per service:

.. code-block:: yaml

   gateway:
     tls:
       enabled: true
       generated:
         enabled: true

Back up the retained TLS Secrets. Do not regenerate a missing CA for an
existing installation; restore it.

For user-managed TLS, create a CA Secret containing ``ca.crt`` and a
``kubernetes.io/tls`` Secret containing ``tls.crt`` and ``tls.key`` for each
enabled upstream. Each certificate's DNS subject alternative name must match
the corresponding in-cluster Service host. Point OSMO at them as follows:

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

Service auth is OSMO's stable JWT signing identity. The chart can create the
retained ``osmo-service-auth`` Secret for a new installation:

.. code-block:: yaml

   secrets:
     serviceAuth:
       managementMode: osmo
       existingSecret:
         name: osmo-service-auth
         key: authentication-config.json
       bootstrap:
         enabled: true

Back up the Secret, then set ``bootstrap.enabled`` to ``false`` after the first
successful installation.

For a user-managed identity, generate the file with the OSMO service image and
create the Secret before installation:

.. code-block:: bash

   $ umask 077
   $ OSMO_SERVICE_AUTH_DIR=$(mktemp -d)
   $ trap 'rm -rf -- "$OSMO_SERVICE_AUTH_DIR"' EXIT
   $ docker run --rm --user "$(id -u):$(id -g)" \
       --entrypoint service-auth-bootstrap \
       --volume "$OSMO_SERVICE_AUTH_DIR:/output" \
       nvcr.io/nvidia/osmo/service:<image-tag> \
       generate --output /output/authentication-config.json
   $ kubectl --namespace osmo create secret generic osmo-service-auth \
       --from-file=authentication-config.json="$OSMO_SERVICE_AUTH_DIR/authentication-config.json"
   $ rm -rf -- "$OSMO_SERVICE_AUTH_DIR"; trap - EXIT

The JSON document must contain ``active_key`` and a matching entry in ``keys``
with valid ``public_key`` and ``private_key`` JWK values. Set
``managementMode: external`` and ``bootstrap.enabled: false``. Change
``rolloutNonce`` after an intentional update.

.. _deploy_service_osmo_values:

Prepare Values
==============

Combine the settings above in ``osmo-values.yaml``. This static-credential
example uses embedded Dex and chart-bootstrapped MEK, service auth, and internal
TLS. Replace every angle-bracket placeholder:

.. code-block:: yaml

   planes:
     control:
       enabled: true
     compute:
       enabled: false

   imageTag: <image-tag>
   externalUrl: https://osmo.example.com

   embeddedDependencies:
     dex:
       enabled: true
     postgresql:
       enabled: false
     valkey:
       enabled: false
     objectStorage:
       enabled: false

   externalDependencies:
     postgresql:
       host: <postgresql-host>
       port: 5432
       database: osmo
       username: osmo
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

   authentication:
     provider: embeddedDex

   gateway:
     envoy:
       service:
         type: LoadBalancer
     tls:
       enabled: true
       generated:
         enabled: true

Embedded Dex uses volatile memory storage and is suitable for development and
evaluation only. Use an external identity provider for production.

Configure an External IdP
=========================

Register browser and device/CLI clients with your OIDC provider. Create a
Secret containing the browser client secret and a random 32-byte cookie secret:

.. code-block:: bash

   $ umask 077
   $ OSMO_OIDC_SECRET_DIR=$(mktemp -d)
   $ trap 'rm -rf -- "$OSMO_OIDC_SECRET_DIR"' EXIT
   $ read -rsp 'OIDC browser client secret: ' OSMO_BROWSER_CLIENT_SECRET; printf '\n'
   $ printf '%s' "$OSMO_BROWSER_CLIENT_SECRET" > "$OSMO_OIDC_SECRET_DIR/client_secret"
   $ unset OSMO_BROWSER_CLIENT_SECRET
   $ openssl rand -base64 32 > "$OSMO_OIDC_SECRET_DIR/cookie_secret"
   $ kubectl --namespace osmo create secret generic osmo-external-oidc \
       --from-file=client_secret="$OSMO_OIDC_SECRET_DIR/client_secret" \
       --from-file=cookie_secret="$OSMO_OIDC_SECRET_DIR/cookie_secret"
   $ rm -rf -- "$OSMO_OIDC_SECRET_DIR"; trap - EXIT

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

See :doc:`../appendix/authentication/identity_provider_setup` for
provider-specific application registration and
:doc:`../appendix/authentication/idp_role_mapping` for role mapping.

.. _deploy_service_deploy_components:

Deploy Components
=================

Check out the OSMO release you plan to deploy and build the unified chart's
dependencies. Run the remaining commands from the repository root. The
``imageTag`` in ``osmo-values.yaml`` must identify images built for that
release:

.. code-block:: bash

   $ git clone https://github.com/NVIDIA/OSMO.git
   $ cd OSMO
   $ git checkout <release-tag>
   $ helm dependency build deployments/charts/osmo
   $ helm show chart deployments/charts/osmo

Render and lint the release before changing the cluster:

.. code-block:: bash

   $ helm lint deployments/charts/osmo --values osmo-values.yaml
   $ helm template osmo deployments/charts/osmo \
       --namespace osmo --values osmo-values.yaml > /tmp/osmo-rendered.yaml

Install the control plane and wait for bootstrap and migration Jobs:

.. code-block:: bash

   $ helm upgrade --install osmo deployments/charts/osmo \
       --namespace osmo \
       --values osmo-values.yaml \
       --wait --wait-for-jobs --timeout 30m

After a successful chart-managed MEK and service-auth bootstrap, change both
``bootstrap.enabled`` values to ``false`` in ``osmo-values.yaml`` and apply a
cleanup upgrade:

.. code-block:: bash

   $ helm upgrade osmo deployments/charts/osmo \
       --namespace osmo \
       --values osmo-values.yaml \
       --wait --timeout 30m

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
  different releases. Check out the intended release and set ``imageTag`` to
  its matching image tag; do not deploy an unpinned development chart with an
  older ``latest`` image.
* **PostgreSQL connection or migration fails**: verify DNS, network policy,
  database ownership, the ``username`` and ``db-password`` keys, TLS mode, and
  CA bundle. Do not enable ``databaseMigration`` for a new database merely to
  retry connectivity.
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
