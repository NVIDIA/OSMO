<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# 06 — Migration from existing OSMO

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Status: Phase 6, follows 3+4+5.

## Goal

Move existing OSMO deployments to the new CRD-based platform **without
losing access to workflow history**. Existing users should:

- Continue to submit and run workflows during the migration window.
- Continue to list and inspect their historical workflows (including ones
  submitted before cutover).
- Experience the change as a transparent infrastructure swap, not a forced
  re-onboarding.

## Detailed design

### Migration strategy: dual-write + read-shim, then cutover

Three phases internal to Phase 6:

**6a. Dual-write window.** New workflows submitted via the new CRD API
write to both old Postgres (for backwards-compatible listing) and the new
history table (for forward compatibility). Old workflows still execute on
the legacy worker. Both paths coexist.

**6b. Read shim period.** New apiserver becomes the only frontend. Its
query API reads from new Postgres first; if the workflow isn't there
(legacy workflow submitted before cutover), it falls back to reading
from old Postgres. UI is unchanged from the user's perspective.

**6c. Cutover.** Legacy worker / delayed-job-monitor / Kombu / Redis is
turned off. Old Postgres tables (workflow / task state) become read-only
and stay around for historical query lookups until backfilled.

### Backfill of historical workflows

Two options for historical workflows in old Postgres:

1. **Read-on-demand (default)**. The shim reads from old Postgres when the
   new `osmo_workflows` (see [`01-crd-model.md`](./01-crd-model.md))
   doesn't have the row. Old Postgres stays around as a read-only legacy
   store; no bulk migration needed. Simpler, but old Postgres is a
   permanent dependency until decommission.

2. **ETL backfill**. A one-time job copies rows from old Postgres into the
   new `osmo_workflows` and (where reconstructable from old event logs)
   `osmo_workflow_events` tables, transforming the schema. After successful
   backfill, old Postgres can be retired (see
   [`07-decommission.md`](./07-decommission.md)).

Recommendation: ship (1) for the cutover, then run (2) as a non-blocking
follow-up. Reverse-engineering the old schema transformation is substantial
work; doing it under time pressure during cutover is risky.

**Old → new schema mapping** (sketch; refined during ETL design):

| Old Postgres table | New Postgres table | Notes |
|---|---|---|
| `workflows` (state machine) | `osmo_workflows` | Phase mapping; gpu/runtime denormalization needs derivation |
| `task_groups` | `osmo_workflow_groups` | 1:1 row mapping |
| `workflow_events` (if present) | `osmo_workflow_events` | Best-effort — old event capture may be incomplete |
| `datasets`, `credentials` | (not migrated) | Deprecated separately or replaced by K8s Secrets |
| RBAC tables | (not migrated) | Replaced by K8s RBAC + OSMOPoolBinding |

### API compatibility shim

The new apiserver exposes the existing OSMO HTTP API surface. Internally:

- **Submits** → new CRD path.
- **List / get** → new history Postgres, falling back to old Postgres on
  miss.
- **Cancel** → new CRD finalizer path; legacy workflows are cancelled via
  the legacy path until they drain naturally.
- **Other endpoints** (datasets, profile, etc.) → unchanged where they
  still apply; removed where they're deprecated.

Versioning: the API contract is preserved at the HTTP layer. Internal
representation changes are invisible to clients.

### CLI/UI scope during migration

**No parallel CLI rewrite is in scope for this project.** The existing
Python OSMO CLI continues to work against the compatibility shim because
the shim preserves the HTTP API surface — the CLI never sees the
underlying CRD model. Same applies to the existing OSMO UI. A future,
separate Go-native CLI rewrite is possible but is not bundled with the
CRD migration.

### Per-cluster rollout

The control plane swap happens once. Backend clusters migrate one at a
time:

1. Stand up the new backend stack (Kueue + KAI placement-only + Backend
   Session Client) alongside the existing OSMO Operator on that backend.
2. Drain the legacy queue on the backend (let in-flight workflows finish).
3. Cut over: the legacy Operator process is shut down; new Backend Session
   Client takes over.
4. Verify with synthetic test workflows.
5. Move to the next backend.

Each backend cutover is ~1 week of work (operations + verification).

### Rollback story

Three failure modes have rollback paths:

| Failure | Rollback |
|---|---|
| New apiserver bug | Revert apiserver Deployment; the shim's fallback-to-old-Postgres keeps history readable. New submissions return to legacy path. |
| New backend session client crashes | Switch the backend's controller-deployment back to legacy Operator. In-flight new-style workflows on that cluster stall until session restored or evicted. |
| New CRDs cause etcd pressure | Cluster-scope CRD reaper script runs; legacy path resumes. |

Rollback is most painful **after** ETL backfill phase (6c+), because the
old Postgres rows may have been deleted. Keep old Postgres as read-only
until the entire migration is judged stable (target: 3 months after final
cutover).

## Implementation plan

_To be filled in. Major work items_:

1. **API compatibility shim** in the new apiserver: route old endpoints to
   new CRD path or new history Postgres.
2. **Read-shim fallback to old Postgres** for query API.
3. **Dual-write logic** in the new apiserver: write to both stores during 6a.
4. **Per-backend cutover playbook**: documentation + runbook.
5. **Synthetic verification suite**: workflows that exercise common cases
   end-to-end; run after each backend cutover.
6. **ETL backfill** (post-cutover): map old schema → new schema.

## Risks / open questions

- **Cutover sequencing.** Does the apiserver cut over before all backends,
  or in lockstep? Cutting over apiserver first means the new apiserver must
  speak to both legacy backends (via existing OSMO RPC) and new backends
  (via ClusterSession). Adds complexity. Recommendation: stand up new
  backends in parallel with legacy, cut over apiserver only when at least
  one new backend can serve traffic.
- **Legacy workflows in flight at cutover.** Workflows submitted to the
  legacy path before cutover and still running after — drain them on the
  legacy Operator until they finish, or migrate them mid-flight? Drain is
  simpler.
- **Old Postgres operational burden.** How long do we keep it readable?
  Default: 6 months after final backend cutover, then retire (assumes ETL
  backfill happens in those 6 months).
- **API contract evolution.** Some old endpoints (datasets, profile) are
  deprecated separately. Coordination with their respective deprecation
  timelines.

## Out of scope

- Migrating user accounts / RBAC. Replaced by K8s RBAC + OSMOPoolBinding;
  separate migration handled per-customer with their existing identity
  infrastructure.
- Migrating dataset references. Datasets are being deprecated; handled by
  the dataset team, not this project.
- Cross-control-plane migration (multi-region). Out of v1.
