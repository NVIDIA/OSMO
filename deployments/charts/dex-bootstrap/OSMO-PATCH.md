# OSMO Dex chart integration

Upstream: dexidp/helm-charts, chart `dex` version **0.24.1**, distributed from
`https://charts.dexidp.io`. The upstream LICENSE is retained in this directory.

Local version: **0.24.1-osmo.1**. The only template change exposes the existing
Deployment as `dex.deployment` and adds `deployment.enabled` (default `true`).
The OSMO parent sets it to false, invokes the same named template, and adds its
credential snapshot init container. Services, names, selectors, and other upstream
resources remain defined by this dependency.

Package through the normal Helm dependency build; no post-renderer is required.
On an upstream update, reapply this small extension and rerun the OSMO bootstrap
render and cluster lifecycle tests. The parent supplies a verified complete Dex
config file and removes the managed Secret environment inputs from the Dex container.
