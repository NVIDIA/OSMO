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
endpoint, JWKS URI/host, browser and CLI client IDs, user/roles claims, scopes,
logout endpoint, and Secret references into ``authentication.externalOidc``.
Set:

.. code-block:: yaml

   authentication:
     provider: externalOidc
     # Complete externalOidc contract goes here.
   embeddedDependencies:
     dex:
       enabled: false

Keep browser-client and cookie Secrets operator-owned. Increment their rollout
nonces when their contents rotate. For an HTTPS JWKS URI, set ``jwksHost`` to
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
The account signs in with ``authentication.embeddedDex.admin.email`` and appears
inside OSMO as ``authentication.embeddedDex.admin.username`` (``admin`` by
default). The signed Dex ``name`` claim supplies that identity. The gateway
assigns ``osmo-admin`` only to a token verified against embedded Dex with the
static administrator's immutable ``sub``; a matching username from another JWT
provider does not receive the grant. The configured username must use OSMO's
letters, digits, underscores, periods, ``@``, and hyphens syntax and begin and
end with a letter or digit. Changing the username renames the OSMO identity and
may require existing browser and CLI sessions to sign in again. Resources and
audit records created under the previous identity retain that recorded owner;
the chart does not rewrite application data during an identity rename.
The pre-install/pre-upgrade bootstrap Job creates or reconciles retained
administrator and OAuth credential Secrets; the separate post-install/
post-upgrade Job restarts Dex when Helm updates its config Secret. The Jobs
delete only Dex or OAuth2 Proxy Pods selected by release-specific labels and
record applied one-way identities on the hook-owned Secrets. They do not patch
Helm-managed Deployments, so Argo CD and other declarative reconcilers do not
observe rollout drift. This requires namespace-scoped ``list`` and ``delete``
Pod permissions for the bootstrap ServiceAccount. Retrieve the random password
only with an explicit Kubernetes Secret read; do not add it to values, Git,
Helm commands, or logs.

After a successful first install or sync:

1. Back up the retained embedded-Dex Secrets and verify ownership metadata.
2. Set ``authentication.embeddedDex.bootstrap.allowInitialGeneration: false``.
3. Sync again and confirm the pre-install/pre-upgrade Job validates rather than
   regenerates credentials, while the post-install/post-upgrade Job completes
   the Dex configuration rollout.

For Argo CD, these are two commits and two successful syncs. Helm pre-install
and pre-upgrade hooks map to ``PreSync``; Argo CD cannot derive this safety
boundary from hook type. The separate post hook remains responsible for the Dex
config restart after Helm-managed configuration changes.

Remove obsolete configuration
==============================

Remove the following values from all profiles and environment overlays:

* ``services.api.auth.enabled``
* ``gateway.oauth2Proxy.enabled``
* ``gateway.authz.enabled``
* ``gateway.envoy.defaultIdentity``
* ``gateway.envoy.jwt.allowMissing``

The chart rejects them. Their removal is intentional: an authenticated control
plane does not trust default or caller-supplied OSMO identity headers.

Rollback, restore, and uninstall
================================

Embedded credential generations are monotonic. Do not lower a generation to
perform a rollback; the Job rejects it. Helm rollback, failed upgrades, and
atomic upgrades do not restore retained Secret bytes. Restore the backed-up
Secrets only under their original names and ownership scope, then retry or roll
forward. Helm uninstall retains them. Delete them only as an explicit,
destructive cleanup after confirming that the release and its identity are no
longer needed.

Embedded Dex has memory-only sessions and signing state. A restart invalidates
active browser, refresh/offline, device, and authorization-code sessions. This
does not recreate the retained static credentials and does not create Dex CRDs,
PVCs, RBAC, or Kubernetes API access.
