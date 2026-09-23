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

.. _external_dex_setup:

============================
External Dex as a sample IdP
============================

This guide deploys `Dex <https://dexidp.io/>`_ as a separate Helm release and
connects the unified OSMO chart to it. The OSMO chart normally installs an
embedded Dex with volatile storage. Disable that dependency when selecting the
external OIDC provider; the two settings must change together. The example
uses one local Dex password for evaluation. Replace the local password database
with an appropriate `Dex connector <https://dexidp.io/docs/connectors/>`_ and
persistent storage for a real deployment.

Use a Kubernetes cluster with Helm, ``kubectl``, ingress, DNS, and trusted TLS
for ``dex.example.com`` and ``osmo.example.com``. Users' browsers and OSMO
pods must be able to reach the same Dex issuer URL. The separate Dex release
can use a different namespace, configuration, and lifecycle from OSMO. This
page covers identity setup; use :doc:`deploy_self_contained` for the OSMO
cluster, storage, and site-values prerequisites.

Deploy the separate Dex release
===============================

Use the official Dex chart version 0.24.1, the version pinned by the OSMO
chart's embedded dependency. The sample has a confidential browser client
(``osmo-browser``) and a public device client (``osmo-cli``). OSMO's browser
callback must be registered exactly as
``https://osmo.example.com/oauth2/callback``. Dex's device endpoint supports
``osmo login --method code``; the default CLI PKCE flow uses the confidential
browser client and is not suitable for this two-client example.

Create the namespaces and two random credentials. The sample user's ``name``
claim is ``admin`` so it matches the retained OSMO bootstrap administrator.
Keep the password and client secret outside source control:

.. code-block:: bash

   kubectl create namespace dex
   kubectl create namespace osmo
   read -rsp 'Sample Dex admin password: ' DEX_PASSWORD; echo
   export DEX_PASSWORD
   DEX_PASSWORD_HASH=$(python3 -c 'import bcrypt, os; print(bcrypt.hashpw(os.environ["DEX_PASSWORD"].encode(), bcrypt.gensalt()).decode())')
   unset DEX_PASSWORD
   DEX_BROWSER_SECRET=$(openssl rand -hex 32)
   kubectl -n dex create secret generic external-dex-credentials \
     --from-literal=password-hash="$DEX_PASSWORD_HASH" \
     --from-literal=browser-client-secret="$DEX_BROWSER_SECRET"
   kubectl -n osmo create secret generic osmo-external-oidc \
     --from-literal=client_secret="$DEX_BROWSER_SECRET" \
     --from-literal=cookie_secret="$(openssl rand -hex 16)"
   unset DEX_PASSWORD_HASH DEX_BROWSER_SECRET

Install Python's ``bcrypt`` package first if it is not available. The
create-only Secret commands fail when a Secret already exists; use your normal
credential rotation process for existing installations. Provision
``dex-ingress-tls`` in the ``dex`` namespace with a certificate trusted by
OSMO's gateway pods. Configure DNS and your ingress controller for
``dex.example.com`` before installing OSMO.

Save the following as ``external-dex-values.yaml``. ``secretEnv`` and
``hashFromEnv`` read the credentials from the Dex Secret at runtime; the
credentials do not enter Helm values or rendered manifests.

.. code-block:: yaml

   config:
     issuer: https://dex.example.com
     storage:
       type: kubernetes
       config:
         inCluster: true
     web:
       http: 0.0.0.0:5556
     enablePasswordDB: true
     oauth2:
       passwordConnector: local
       skipApprovalScreen: true
     staticPasswords:
     - email: admin@example.com
       hashFromEnv: DEX_ADMIN_PASSWORD_HASH
       username: admin
       userID: admin
     staticClients:
     - id: osmo-browser
       name: OSMO browser
       secretEnv: DEX_BROWSER_CLIENT_SECRET
       redirectURIs:
       - https://osmo.example.com/oauth2/callback
     - id: osmo-cli
       name: OSMO CLI
       public: true
   envVars:
   - name: DEX_ADMIN_PASSWORD_HASH
     valueFrom:
       secretKeyRef:
         name: external-dex-credentials
         key: password-hash
   - name: DEX_BROWSER_CLIENT_SECRET
     valueFrom:
       secretKeyRef:
         name: external-dex-credentials
         key: browser-client-secret
   ingress:
     enabled: true
     className: nginx  # Replace with your ingress class.
     hosts:
     - host: dex.example.com
       paths:
       - path: /
         pathType: Prefix
     tls:
     - secretName: dex-ingress-tls
       hosts:
       - dex.example.com

.. code-block:: bash

   helm repo add dex https://charts.dexidp.io
   helm repo update dex
   helm upgrade --install external-dex dex/dex --version 0.24.1 \
     --namespace dex --values external-dex-values.yaml --wait
   kubectl -n dex rollout status deployment/external-dex
   curl -fsS https://dex.example.com/.well-known/openid-configuration

Check that discovery reports issuer ``https://dex.example.com``. Dex's
``authorization``, ``token``, ``device``, and ``JWKS`` endpoints in this example are
``/auth``, ``/token``, ``/device/code``, and ``/keys`` under that issuer.

Point OSMO at Dex
=================

Save the following as ``external-dex-osmo.yaml``. Layer it after your normal
OSMO profile and site values. These are the current unified chart's
``authentication`` keys; direct ``gateway.oauth2Proxy`` and
``gateway.envoy.jwt`` values are chart-managed. The bootstrap administrator
keeps an OSMO access token but has no embedded-Dex password. The token's role
is not automatically assigned to the Dex login; assign it after installation
as shown below. For production, use Dex connector claims and
:doc:`authentication/idp_role_mapping` to grant roles rather than relying on a
local sample account.

.. code-block:: yaml

   externalUrl: https://osmo.example.com
   embeddedDependencies:
     dex:
       enabled: false
   authentication:
     provider: externalOidc
     bootstrap:
       identities:
         admin:
           dex:
             enabled: false
     externalOidc:
       issuer: https://dex.example.com
       browserClientId: osmo-browser
       cliClientId: osmo-cli
       authorizationEndpoint: https://dex.example.com/auth
       tokenEndpoint: https://dex.example.com/token
       deviceEndpoint: https://dex.example.com/device/code
       jwksUri: https://dex.example.com/keys
       jwksHost: dex.example.com
       userClaim: name
       rolesClaim: roles
       scopes: [openid, email, profile]
       browserClientSecret:
         existingSecret: osmo-external-oidc
         key: client_secret
       cookieSecret:
         existingSecret: osmo-external-oidc
         key: cookie_secret

The issuer must match Dex discovery exactly, and ``jwksHost`` must match the
DNS host of ``jwksUri``. The browser client ID and secret must match Dex's
confidential client; the device client ID must match its public client. Dex's
sample local password database emits no ``roles`` array, so the example
assigns ``osmo-admin`` directly to ``admin`` in OSMO. With an upstream
connector, set ``rolesClaim`` to the array claim Dex actually emits (for
example ``groups``), request its scope, and map its values to OSMO roles.
``name`` maps this local user's browser and device tokens to the OSMO
``admin`` identity. Dex encodes its ``sub`` claim, so ``sub`` does not equal
the sample username. The CLI does not request the ``email`` scope. For a
real connector, choose a stable, unique claim and provision or map OSMO users
accordingly.

Build the pinned chart dependencies and install OSMO with your complete site
values. The following uses the self-contained profile; follow
:doc:`deploy_self_contained` for its required node labels, TLS edge, storage,
network, and values files.

The command uses Helm 4's ``--wait=legacy`` strategy. With Helm 3, replace
``--wait=legacy`` with ``--wait``.

.. code-block:: bash

   helm repo add cnpg https://cloudnative-pg.github.io/charts
   helm repo add osmo-rustfs https://charts.rustfs.com
   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     --values deployments/charts/osmo/profiles/self-contained.yaml \
     --values deployments/charts/osmo/examples/node-selectors.yaml \
     --values self-contained-environment-values.yaml \
     --values external-dex-osmo.yaml \
     --wait=legacy --wait-for-jobs --timeout 30m

Verify login
============

Confirm the OSMO release has no ``osmo-dex`` Deployment. Use the chart's
retained administrator token once to assign the sample Dex identity its OSMO
role. First visit ``https://osmo.example.com`` and sign in as
``admin@example.com`` with the sample password. This creates the ``admin``
user; protected pages may return 403 until the role is assigned. The browser
callback must be ``https://osmo.example.com/oauth2/callback``.

.. code-block:: bash

   kubectl -n dex get pods
   kubectl -n osmo get pods
   kubectl -n osmo get deployment osmo-dex  # Expected: NotFound.
   curl -fsS https://dex.example.com/.well-known/openid-configuration

Keep the bootstrap token in a private temporary file and remove it after
login. Then verify the public CLI device client and its OSMO user record:

.. code-block:: bash

   umask 077
   OSMO_TOKEN_FILE=$(mktemp)
   kubectl -n osmo get secret osmo-admin-token \
     --output jsonpath='{.data.token}' | base64 --decode > "$OSMO_TOKEN_FILE"
   osmo login https://osmo.example.com --method token \
     --token-file "$OSMO_TOKEN_FILE"
   rm -f -- "$OSMO_TOKEN_FILE"
   unset OSMO_TOKEN_FILE
   osmo user update admin --add-roles osmo-admin
   osmo logout
   osmo login https://osmo.example.com --method code
   osmo profile list
   osmo user get admin

The CLI's default PKCE flow requires a public browser client with a registered
loopback redirect URI;
this sample instead uses Dex's public device client. A successful sign-in
without a matching OSMO role can still receive a 403. ``osmo profile list``
shows the authenticated identity and token claims; manually assigned roles may
not appear there. ``osmo user get admin`` shows its OSMO role assignment.
Check the Dex token's ``iss``, ``aud``, ``sub``, and role claim, then the
OAuth2 Proxy and Envoy logs if login or authorization fails.
