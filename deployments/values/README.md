<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# OSMO Deployment Helm Values

Static, user-editable values files consumed by [`scripts/deploy-osmo-minimal.sh`](../scripts/deploy-osmo-minimal.sh).

The deploy script orchestrates `helm install` — these YAML files hold the values that don't change per-cluster. Per-cluster values (PG/Redis hosts, image tag, namespace, NGC pull secret name) are injected with `--set` at install time so users don't need to edit YAML for routine deploys.

To customize defaults beyond what `--set` covers, edit these files directly.

## Files

| File | Loaded when | Purpose |
|---|---|---|
| `service.yaml` | Always | Base values for the `service` chart (now bundles router + UI). Mirrors the [docs minimal-deploy values](../../docs/deployment_guide/appendix/deploy_minimal.rst). |
| `backend-operator.yaml` | Always | Base values for the `backend-operator` chart. |
| `gpu-pool.yaml` | When GPU nodes are detected (or `--gpu-node-pool`) | Adds `gpu_toleration` pod template + GPU platform on the default pool. |
| `pod-monitor-on.yaml` | When prometheus-operator CRDs are detected (or `OSMO_POD_MONITOR_ENABLED=true`) | Re-enables PodMonitor scraping. Off by default to avoid CRD-not-installed errors. |

In addition, the storage backend script ([`scripts/configure-storage.sh`](../scripts/configure-storage.sh)) writes a runtime fragment to `scripts/values/.storage-values.yaml` — that file is auto-generated and should not be hand-edited; it carries the workflow credential references for the backend you selected (`minio` / `azure-blob` / `byo`).

## Layering order

`helm install` applies values in argument order; later files override earlier ones. The deploy script uses:

```
-f values/service.yaml
[-f values/pod-monitor-on.yaml]               # if CRDs detected
[-f values/gpu-pool.yaml]                     # if GPU nodes detected
-f scripts/values/.storage-values.yaml         # runtime-rendered storage fragment
--set global.osmoImageLocation=...             # cluster-specific overrides
--set global.osmoImageTag=...
--set services.postgres.serviceName=...
--set services.redis.serviceName=...
... etc
```

## Security note: minimal mode auth

`service.yaml` ships with `gateway.oauth2Proxy.enabled: false` and `gateway.authz.enabled: false` — matching the [minimal deploy docs](../../docs/deployment_guide/appendix/deploy_minimal.rst). The gateway then trusts client-supplied `x-osmo-{user,roles,allowed-pools}` headers. **Do not expose this gateway to untrusted networks.** For production, use the standard deploy guide which keeps OAuth2 + authz enabled.
