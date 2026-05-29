<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# 07 — Decommission of legacy OSMO components

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Status: Phase 7, distributed across the timeline of phases 3-6.

## Goal

Remove components that the new architecture makes redundant. Each removal
ships only after the new path is proven on a feature subset, with a clear
rollback. Decommission isn't a single big-bang event — it's a steady
trimming distributed across phases 3-6.

## Components to remove (and when)

| Component | Replaced by | Phase / Trigger to remove |
|---|---|---|
| **Worker (Kombu / Celery)** | controller-runtime reconcile loops (Workflow Controller, TaskGroup Controller) | After Phase 6 cutover on each backend. |
| **Delayed Job Monitor** | Periodic reconcile in Workflow Controller (controller-runtime requeue) | After Phase 6 cutover (no in-flight legacy workflows). |
| **Redis (job queue + barriers + event streams)** | gRPC ClusterSession (commands + status); barriers TBD Phase 8 | After Worker + Delayed Job Monitor removed. |
| **PostgreSQL: workflow_state table (old OSMO)** | etcd via OSMOWorkflow / OSMOTaskGroup CRDs for live state, **new `osmo_workflows` table for history** (see [`01-crd-model.md`](./01-crd-model.md)) | After Phase 6c (read-shim fallback no longer needed) AND Phase 6 ETL backfill into the new table has completed. |
| **PostgreSQL: task_state table (old OSMO)** | etcd via OSMOTaskGroup CRDs for live; `osmo_workflow_groups` for history | Same as above. |
| **PostgreSQL: custom RBAC tables** (osmo_actions, role_policies, bindings) | K8s RBAC + OSMOPoolBinding | After Phase 5 pool/binding rollout completes. |
| **PostgreSQL: pool tables** | OSMOPool CRD | After Phase 5. |
| **PostgreSQL: accounting tables** | Prometheus metrics + the new `osmo_workflow_events` table for workflow-level event audit | After accounting dashboards switch to Prometheus (verify before removal). |
| **Legacy Operator per backend** | TaskGroup Controller + Backend Session Client | After Phase 6 per-backend cutover. |
| **Legacy Agent per backend** | Backend Session Client | Same. |
| **Old Python apiserver** (`service/core/`) | New Go apiserver | After Phase 6c cutover stable for N weeks. |

## Components that stay

| Component | Why kept |
|---|---|
| Logger | Unchanged role; still needed for log streaming. |
| Router | Simplified (less Postgres-driven), but the role remains for HTTP/WS routing to backends. |
| Authz sidecar | Unchanged. |
| **PostgreSQL** | Kept, but scoped to two new tables: `osmo_workflows` + `osmo_workflow_groups` + `osmo_workflow_events` (workflow history and event audit for past workflows). Old OSMO tables drop per the removal list above. See [`01-crd-model.md`](./01-crd-model.md) for the new schema. |
| S3 / object storage | Used for workflow data (inputs/outputs) and structured logs. Not used for workflow history — Postgres is the durable home for that. |
| Prometheus / Grafana / Loki | Observability stack. |
| ArgoCD | Deploy mechanism. |
| Vault | Secret store (Tokens, Postgres credentials, S3 credentials). |
| **KAI Scheduler** | Reconfigured to placement-only; still the gang scheduler. |

## Approach: per-component decommission checklist

Each removal follows the same shape:

1. **Verify replacement is live in production.** Synthetic workflows exercise
   the new path successfully.
2. **Stop writing to the legacy component.** Code paths that write are
   removed. Reads from the legacy component continue if anyone still depends.
3. **Soak.** Run on the new path for N weeks (default: 4) without issues.
4. **Stop reading.** Remove the read code paths. Component is now unused.
5. **Remove from deployment.** Strip the Helm chart, ArgoCD manifest,
   ConfigMap, Secrets. Component is now uninstalled.
6. **Reclaim resources.** Delete Postgres tables, drop Redis databases,
   free node capacity.
7. **Update docs / runbooks.** Remove references; archive the legacy
   runbook.

## Detailed cleanups

_To be filled in. For each component above, a short subsection with_:

- The specific code paths to remove.
- The ArgoCD application / Helm chart entries to strip.
- The Postgres `DROP TABLE` statements (in dependency order).
- The Helm values / ConfigMap entries to remove.
- Estimated effort.

## Risks / open questions

- **Premature removal.** If we delete a component before a dependency
  surfaces, we get incidents. Mitigation: soak periods between phases 4
  and 5 of the checklist; explicit "any consumers?" check before phase 4.
- **Disk reclaim**. Reclaiming etcd / Redis / Postgres disk after table
  drops requires VACUUM (Postgres) or compaction (Redis). Schedule during
  low-traffic windows.
- **Vault secrets cleanup**. Tokens / credentials for removed components
  should be revoked from Vault, not just deleted from K8s Secrets.
- **Monitoring during decommission**. Each removal step should be coupled
  to a Prometheus alert that fires if traffic to the legacy component
  appears post-removal (i.e., a path we missed).

## Out of scope

- Datasets service decommission. Tracked separately by the dataset team.
- Vault decommission. Out of scope; Vault stays.
- Multi-region or multi-cloud rollout coordination. Each region/cloud
  decommissions independently using this playbook.
