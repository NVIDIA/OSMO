..
  SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  SPDX-License-Identifier: Apache-2.0

.. _migrating_to_embedded_dex:

=========================
Migrating authentication
=========================

The unified ``osmo`` chart makes authenticated control-plane deployment
mandatory. Choose one migration path before upgrading: retain an external OIDC
provider or adopt the default embedded Dex provider. Do not expect an old
unauthenticated release to upgrade without a deliberate provider and a
browser/CLI-reachable ``externalUrl``.

Retain external OIDC
====================

Move all previous issuer, authorization endpoint, token endpoint, device
endpoint, JWKS endpoint/host, browser and CLI client IDs, user/roles claims, scopes,
logout endpoint, and Secret references into ``authentication.externalOidc``.
Set:

.. code-block:: yaml

   authentication:
     provider: externalOidc
     # Complete externalOidc contract goes here.
   embeddedDependencies:
     dex:
       enabled: false

Keep browser-client and cookie Secrets operator-owned. Change their
``rolloutNonce`` values when their contents rotate. For an HTTPS JWKS endpoint, set ``jwksHost`` to
the exact DNS SAN on the JWKS server certificate: Envoy validates that certificate
against its system CA bundle. See :doc:`identity_provider_setup` for the full
required contract.

Adopt embedded Dex
==================

Set a reachable HTTP or HTTPS ``externalUrl`` and select (or retain) the default
``authentication.provider: embeddedDex``. Ensure
``embeddedDependencies.dex.enabled: true`` and ``configuration.enabled: true``.
The URL must be an origin without a path prefix; an optional port and trailing
slash are supported.
The default ``authentication.bootstrap.identities.admin`` entry signs in with
``admin@osmo.local``, appears inside OSMO as ``admin``, and receives the
``osmo-admin`` role. Each enabled user identity may configure its own
``username``, ``roles``, and ``dex.email``. The signed Dex ``name`` claim
supplies the visible OSMO identity. The gateway assigns declared roles only to
a token verified against embedded Dex with that entry's immutable ``sub``; a
matching username from another JWT provider does not receive the grant. The
configured username must use OSMO's letters, digits, underscores, periods,
``@``, and hyphens syntax and begin and end with a letter or digit. Changing a
username renames the OSMO identity and may require existing browser and CLI
sessions to sign in again. Resources and audit records created under the
previous identity retain that recorded owner; the chart does not rewrite
application data during an identity rename.

The identity map merges entries by key. Add entries to create more local users,
managed user tokens, or independent backend identities without replacing the
default entries. Set an entry's ``enabled`` field to ``false`` to disable a
default. A backend identity must have exactly the ``osmo-backend`` role and
cannot use Dex.

The pre-install/pre-upgrade bootstrap Job creates or reconciles retained
password, token, and OAuth credential Secrets; the separate post-install/
post-upgrade Job restarts Dex when Helm updates its config Secret. The Jobs
delete only Dex or OAuth2 Proxy Pods selected by release-specific labels and
record applied one-way identities on the hook-owned Secrets. They do not patch
Helm-managed Deployments, so Argo CD and other declarative deployment tools do
not observe rollout drift. This requires namespace-scoped ``list`` and ``delete``
Pod permissions for the bootstrap ServiceAccount. Retrieve the random password
only with an explicit Kubernetes Secret read; do not add it to values, Git,
Helm commands, or logs.
Missing managed credentials are generated automatically during any later Helm
or GitOps reconciliation. Existing valid credentials remain byte-for-byte
stable. To rotate one, delete only its named Secret and reconcile again.

Remove obsolete configuration
==============================

Remove the following values from all profiles and environment overlays:

* ``services.api.auth.enabled``
* ``gateway.oauth2Proxy.enabled``
* ``gateway.authz.enabled``
* ``gateway.envoy.defaultIdentity``
* ``gateway.envoy.jwt.allowMissing``
* ``authentication.embeddedDex.admin``
* ``authentication.embeddedDex.adminSecretName``
* ``authentication.embeddedDex.oauthSecretName``
* embedded-Dex credential generation fields
* ``secrets.defaultAdmin``
* ``secrets.backendApiTokens``

The chart rejects them. Their removal is intentional: an authenticated control
plane does not trust default or caller-supplied OSMO identity headers.

Rollback, restore, and uninstall
================================

Helm rollback, failed upgrades, and atomic upgrades do not restore retained
Secret bytes. The aggregate Dex Secret retains historical password hashes so a
rolled-back Dex configuration can still start; identities absent from the
active Dex configuration cannot sign in. Password and token Secrets also remain
stable until deliberately rotated. Helm uninstall retains them. Delete them
only as an explicit, destructive cleanup after confirming that the release and
its identity are no longer needed.

Embedded Dex has memory-only sessions and signing state. A restart invalidates
active browser, refresh/offline, device, and authorization-code sessions. This
does not recreate the retained static credentials and does not create Dex CRDs,
PVCs, RBAC, or Kubernetes API access.
