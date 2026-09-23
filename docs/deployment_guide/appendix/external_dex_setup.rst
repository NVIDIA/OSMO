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

================================
External Dex as a sample IdP
================================

This example runs `Dex <https://dexidp.io/>`_ as a separate Helm release and
connects OSMO to its OIDC issuer. It uses Dex's local password database for one
sample user; replace that with a suitable `Dex connector
<https://dexidp.io/docs/connectors/>`_ for a real identity source. The Dex
chart and OSMO chart can have independent versions, namespaces, and lifecycle.

The current ``deployments/charts/osmo`` chart has **no embedded Dex**: its
``Chart.yaml`` lists only PostgreSQL, Valkey, and RustFS dependencies. There is
therefore no ``dex.enabled`` value to turn off. To replace a Dex release from
an older deployment, remove that separate release after the new issuer is
working; do not pass an unrecognized ``dex.enabled=false`` value to this chart.
The OSMO values below enable authentication and point it at the separate Dex
release. This example does not depend on the Quickstart configuration.

Prerequisites
=============

Use a Kubernetes cluster with an ingress controller, TLS certificates, DNS,
``kubectl``, Helm 3, OpenSSL, and Python with ``bcrypt`` installed for the
sample password hash. Choose HTTPS hostnames for OSMO and Dex, for example
``osmo.example.com`` and ``dex.example.com``. Both must resolve from users'
browsers; Dex must also be reachable with a trusted certificate from OSMO's
OAuth2 Proxy and Envoy pods. The OSMO chart needs its normal database, storage,
and compute prerequisites; see the `unified chart README
<https://github.com/NVIDIA/OSMO/blob/main/deployments/charts/osmo/README.md>`_
for those deployment steps. Apply the OIDC overlay below to that chart's values.

Deploy Dex separately
=====================

Create separate namespaces and choose a browser client secret and a password
for the sample user. Keep these values out of Helm values and version control.
The Dex configuration Secret contains both the browser client secret and the
password hash, so restrict access to it and back it up with the Dex identity.
For this example, generate a temporary config file locally:

.. code-block:: bash

   kubectl create namespace dex
   kubectl create namespace osmo
   read -rsp 'Sample Dex user password: ' DEX_PASSWORD; echo
   export DEX_PASSWORD
   DEX_PASSWORD_HASH=$(python3 -c 'import bcrypt, os; print(bcrypt.hashpw(os.environ["DEX_PASSWORD"].encode(), bcrypt.gensalt()).decode())')
   unset DEX_PASSWORD
   DEX_BROWSER_SECRET=$(openssl rand -hex 32)
   umask 077
   cat > dex-config.yaml <<EOF
   issuer: https://dex.example.com
   storage:
     type: kubernetes
     config:
       inCluster: true
   web:
     http: 0.0.0.0:5556
   enablePasswordDB: true
   staticPasswords:
   - email: alice@example.com
     hash: "$DEX_PASSWORD_HASH"
     username: alice
     userID: alice
   staticClients:
   - id: osmo-browser
     name: OSMO browser
     secret: "$DEX_BROWSER_SECRET"
     redirectURIs:
     - https://osmo.example.com/oauth2/callback
   - id: osmo-cli
     name: OSMO CLI
     public: true
     redirectURIs:
     - http://localhost:49152
   EOF
   kubectl -n dex create secret generic dex-config --from-file=config.yaml=dex-config.yaml
   kubectl -n osmo create secret generic oauth2-proxy-secrets \
     --from-literal=client_secret="$DEX_BROWSER_SECRET" \
     --from-literal=cookie_secret="$(openssl rand -base64 32)"
   rm dex-config.yaml
   unset DEX_PASSWORD_HASH DEX_BROWSER_SECRET

Replace both example hostnames and the sample user before running the commands.
For an existing namespace or Secret, manage it through your normal secret
rotation process instead of repeating the create-only commands. The CLI is a
public PKCE client: it has no secret and uses the exact loopback redirect URI
above with ``--callback-port=49152``. Dex does not need a device client for
this PKCE example; leave OSMO's device endpoint and client ID empty. The
password flow is not used.

Create ``dex-values.yaml`` (no credentials in this file):

.. code-block:: yaml

   configSecret:
     create: false
     name: dex-config
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

Provision ``dex-ingress-tls`` in the ``dex`` namespace with a trusted
certificate for ``dex.example.com``; configure DNS and your ingress controller
for this hostname. Then install the official Dex chart as a separate release:

.. code-block:: bash

   helm repo add dex https://charts.dexidp.io
   helm repo update dex
   helm upgrade --install dex dex/dex --version 0.24.1 \
     --namespace dex -f dex-values.yaml --wait
   kubectl -n dex rollout status deployment/dex
   curl -fsS https://dex.example.com/.well-known/openid-configuration

The discovery document's ``issuer`` must be exactly
``https://dex.example.com``. Its authorization, token, and JWKS endpoints are
``https://dex.example.com/auth``, ``https://dex.example.com/token``, and
``https://dex.example.com/keys``. Dex has no logout endpoint in this example.

Configure OSMO
==============

Add the following to the OSMO chart values alongside your environment's other
required settings. The command below uses the ``self-contained`` production
profile; supply its required Secrets and dependency values as described in the
unified chart README, or select another production profile. This overlay only
specifies the IdP integration. TLS for ``osmo.example.com`` must terminate
at your OSMO ingress or edge, and ``externalUrl`` must match the browser's URL.

.. code-block:: yaml

   externalUrl: https://osmo.example.com
   services:
     api:
       auth:
         enabled: true
         browserEndpoint: https://dex.example.com/auth
         browserClientId: osmo-cli
         tokenEndpoint: https://dex.example.com/token
         # No deviceEndpoint, deviceClientId, or logoutEndpoint for this example.
   gateway:
     authz:
       enabled: true
     envoy:
       defaultIdentity:
         user: ''
         roles: ''
         allowedPools: ''
       idp:
         host: dex.example.com
       jwt:
         allowMissing: false
         providers:
         - issuer: https://dex.example.com
           audience: osmo-cli
           jwks_uri: https://dex.example.com/keys
           user_claim: sub
           cluster: idp
         - issuer: https://dex.example.com
           audience: osmo-browser
           jwks_uri: https://dex.example.com/keys
           user_claim: sub
           cluster: idp
         - issuer: osmo
           audience: osmo
           jwks_uri: https://osmo-api/api/auth/keys
           user_claim: unique_name
           cluster: osmo-api-jwks
     oauth2Proxy:
       enabled: true
       provider: oidc
       oidcIssuerUrl: https://dex.example.com
       clientId: osmo-browser
       scope: openid email profile
       cookieDomain: osmo.example.com
   secrets:
     oauthClientSecret:
       existingSecret: oauth2-proxy-secrets
       keys:
         value: client_secret
     oauthCookieSecret:
       generate: false
       existingSecret: oauth2-proxy-secrets
       keys:
         value: cookie_secret

The two Dex JWT providers reflect the two client audiences; the ``osmo``
provider preserves OSMO-issued access tokens. The issuer must match Dex's
``issuer`` and discovery document exactly. ``gateway.envoy.idp.host`` creates
the HTTPS JWKS cluster. ``sub`` is used as the OSMO user ID for both clients
(``alice`` for this sample user). The CLI does not request the ``email`` scope,
so its ID token must not rely on an email claim for the user ID. Keep Dex's
subject stable across connector changes.
The sample Dex user has no ``roles`` claim, so assign OSMO roles through the
OSMO user API, or configure a connector that supplies a ``roles`` array and
map those claims as described in :doc:`authentication/idp_role_mapping`.
Never retain the chart defaults' development ``testuser`` identity when
exposing the gateway.

Install or upgrade OSMO using your complete values and the overlay above:

.. code-block:: bash

   helm dependency build deployments/charts/osmo
   helm upgrade --install osmo deployments/charts/osmo \
     --namespace osmo \
     -f deployments/charts/osmo/profiles/self-contained.yaml \
     -f osmo-values.yaml -f external-dex-osmo.yaml \
     --wait --wait-for-jobs --timeout 20m

Verify the login flow
=====================

Check discovery and the two deployments, then sign in as
``alice@example.com``. The OSMO browser login redirects to Dex and returns to
``https://osmo.example.com/oauth2/callback``. The CLI uses the public client
and the fixed loopback callback:

.. code-block:: bash

   kubectl -n dex get pods
   kubectl -n osmo get pods
   curl -fsS https://dex.example.com/.well-known/openid-configuration
   osmo login https://osmo.example.com --method=pkce --callback-port=49152
   osmo profile show

As an OSMO administrator, assign the sample identity a role before testing
protected operations (for example,
``osmo user update alice --add-roles osmo-user``). Check
:doc:`authentication/managing_users` for user provisioning and
:doc:`authentication/roles_policies` for pool permissions. A successful Dex
login without an OSMO role can still receive a 403 on protected operations.
If login fails, check Dex discovery and issuer, the registered redirect URI,
OAuth2 Proxy logs, Envoy's JWKS reachability, and whether the ID token's
``aud`` matches the corresponding client ID.
