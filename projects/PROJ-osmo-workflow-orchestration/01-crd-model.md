<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# 01 — Data model: CRDs + Postgres projection

Sub-doc of [`PROJ-osmo-workflow-orchestration.md`](./PROJ-osmo-workflow-orchestration.md).
Status: CRDs in Phase 1 (live); Postgres projection in Phase 4 (next after NIM+Ray).

## Goal

OSMO's data model has two stores with distinct roles:

- **Etcd (via CRDs)**: source of truth for **live** state. Three CRDs in
  Phase 1+2; two more (`OSMOPool`, `OSMOPoolBinding`) in Phase 5.
- **Postgres**: durable history-and-query store for workflows + their
  task events. Lives across the **full workflow lifecycle including post-TTL
  history** that etcd no longer holds. Indexed for fast queries at 10M+
  rows. Retention is configurable (default 6-12 months); past retention,
  the oldest monthly partition is dropped.

These compose into one logical data model — etcd holds live state;
Postgres holds the durable queryable record. **Postgres is load-bearing
across phases 3-7** — every part of the design that emits or reads
workflow-related data touches it.

## The three CRDs

| CRD | Scope | Lives in | Role |
|---|---|---|---|
| `OSMOWorkflow` | Namespaced | Control cluster only | User-submitted DAG. DAG resolution, status rollup, TTL, cross-cluster cleanup finalizer. |
| `OSMOTaskGroup` | Namespaced | Wherever the node runs | One DAG node. Carries `runtimeType` + opaque `runtimeConfig`. |
| `OSMOCluster` | Cluster | Control cluster only | Backend registry. Status: liveness, supported runtimes, capacity. |

Two additional CRDs land in Phase 5 (covered in
[`04-scheduling.md`](./04-scheduling.md)):

- `OSMOPool` — cluster-scoped logical grouping.
- `OSMOPoolBinding` — RoleBinding-shaped binding of subjects to pools.

**OSMOTaskGroup.status carries phase + message + conditions only.** It does
NOT carry an events list. Events live in Postgres (next section), not on the
CRD. This is a deliberate choice to keep CRD size bounded and to survive
OTG TTL — `kubectl describe osmotaskgroup` shows current state; historical
events are queried from Postgres or fetched lazily from the backend via the
session.

_The full field-by-field reference for each CRD lives in
`api/v1alpha1/types.go`, `workflow_types.go`, `cluster_types.go`,
`runtime_kai.go`, `zz_generated_deepcopy.go` in the implementation
worktree. This doc captures the semantic model; fields evolve in code._

## The Postgres projection

### Architecture: etcd canonical for live; Postgres canonical for history

```
                              ┌─────────────────────────────────┐
                              │ apiserver                       │
SUBMIT  ─────►  INSERT row    │  - LIST/FILTER → Postgres       │
                in Postgres   │  - GET → etcd (if live) else PG │
                + CREATE CR   │  - aggregates → Postgres+PromQL │
                in etcd       │                                 │
                              └────────┬────────────────────────┘
                                       │
                              ┌────────┴──────────────────────┐
                              ▼                                ▼
                        ┌──────────┐                    ┌──────────────┐
                        │  etcd    │                    │  Postgres    │
                        │ (live)   │                    │  (history)   │
                        │          │                    │              │
                        │ CR per   │                    │ row per      │
                        │ workflow │                    │ workflow     │
                        │          │                    │ + events     │
                        │ ~10K     │                    │ ~10M-100M    │
                        │ active   │                    │ rows         │
                        └──────────┘                    └──────────────┘
                              ▲                                ▲
                              │                                │
                              │  reconcile updates             │  workflow controller
                              │  CR.status                     │  upserts row on
                              │                                │  every status change
                              │                                │
                              │                                │  backend session client
                              │                                │  pushes WorkflowTaskEvent
                              │                                │  batches; control plane
                              │                                │  ingests to events table
                              │                                │
                              │  on TTL: delete CR             │  past retention:
                              │                                │  drop oldest monthly
                              │                                │  partition
                              └────────────────────────────────┘
```

| Event | etcd | Postgres |
|---|---|---|
| Submit | CR created `Phase=Pending` | row inserted |
| Reconcile (status change) | CR.status updated | row UPSERTed |
| Curated task event from backend | (not stored) | events row INSERTed |
| Terminal (Succeeded/Failed) | CR.status terminal | row UPSERTed `completion_time` |
| TTL fires | CR deleted | row stays |
| Retention expiry (partition older than configured cutoff) | — | partition dropped — workflow + its events removed |

The boundary: "is this workflow still potentially being acted on?" If yes,
it has a CR. If no, it's just data in Postgres — until the partition
drops, then the workflow is gone from queryable history.

### `osmo_workflows` table

Workflow-level projection. One row per workflow, FK target for events.

```sql
CREATE TABLE osmo_workflows (
    id                 UUID PRIMARY KEY,
    name               TEXT NOT NULL,
    namespace          TEXT NOT NULL,
    owner              TEXT NOT NULL,
    pool               TEXT,
    assigned_cluster   TEXT,
    phase              TEXT NOT NULL,    -- Pending/Running/Succeeded/Failed
    priority           INT,
    submit_time        TIMESTAMPTZ NOT NULL,
    start_time         TIMESTAMPTZ,
    completion_time    TIMESTAMPTZ,

    -- denormalized for fast filtering
    gpu_types_used     TEXT[],
    total_gpu_count    INT,
    runtime_types_used TEXT[],

    spec_snapshot      JSONB,           -- full submitted spec at submission
    status_snapshot    JSONB,           -- last-known full status
    created_at         TIMESTAMPTZ DEFAULT NOW(),
    updated_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (namespace, name)
);

CREATE INDEX idx_workflows_owner_time
    ON osmo_workflows (owner, submit_time DESC);

CREATE INDEX idx_workflows_gpu_gin
    ON osmo_workflows USING GIN (gpu_types_used);

CREATE INDEX idx_workflows_phase_time
    ON osmo_workflows (phase, submit_time DESC);

CREATE INDEX idx_workflows_pool_time
    ON osmo_workflows (pool, submit_time DESC);
```

#### `osmo_workflow_groups` (per-group detail)

```sql
CREATE TABLE osmo_workflow_groups (
    id           UUID PRIMARY KEY,
    workflow_id  UUID NOT NULL REFERENCES osmo_workflows(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    runtime_type TEXT,
    gpu_type     TEXT,
    gpu_count    INT,
    cpu_request  TEXT,
    memory_request TEXT,
    phase        TEXT,
    UNIQUE (workflow_id, name)
);

CREATE INDEX idx_groups_workflow ON osmo_workflow_groups (workflow_id);
```

### `osmo_workflow_events` table

Curated per-task events. Fed by the runtime-side EventCurator (see
[`03-runtime-plugins.md`](./03-runtime-plugins.md)) and shipped via the
transport's `WorkflowTaskEventBatch` envelope (see
[`02-multicluster-transport.md`](./02-multicluster-transport.md)).

```sql
CREATE TABLE osmo_workflow_events (
    id              BIGSERIAL PRIMARY KEY,
    workflow_id     UUID NOT NULL REFERENCES osmo_workflows(id) ON DELETE CASCADE,
    group_name      TEXT NOT NULL,
    pod_name        TEXT,
    container_name  TEXT,
    cluster_id      TEXT NOT NULL,
    event_type      TEXT NOT NULL,     -- 'Normal' | 'Warning'
    reason          TEXT NOT NULL,     -- 'OOMKilled', 'ImagePullBackOff', ...
    message         TEXT,
    first_timestamp TIMESTAMPTZ NOT NULL,
    last_timestamp  TIMESTAMPTZ NOT NULL,
    count           INT NOT NULL DEFAULT 1
) PARTITION BY RANGE (last_timestamp);

CREATE INDEX idx_wf_events_workflow_time
    ON osmo_workflow_events (workflow_id, last_timestamp DESC);

CREATE INDEX idx_wf_events_reason_time
    ON osmo_workflow_events (reason, last_timestamp DESC);
```

Partitioned by month; the retention pruner drops the oldest partition
once it crosses the configured retention cutoff.

### Canonical queries

```sql
-- "Workflows submitted by user A using A100 between dates X-Y"
SELECT * FROM osmo_workflows
WHERE owner = $1
  AND $2 = ANY(gpu_types_used)
  AND submit_time BETWEEN $3 AND $4
ORDER BY submit_time DESC
LIMIT $5;

-- "Events for this past workflow" (works even when the CR is deleted)
SELECT type, reason, message, last_timestamp, count
FROM osmo_workflow_events
WHERE workflow_id = $1
ORDER BY last_timestamp DESC
LIMIT 50;

-- "All OOMKilled events in the last month for my pool"
SELECT w.id, w.name, w.owner, e.last_timestamp, e.message
FROM osmo_workflow_events e
JOIN osmo_workflows w ON w.id = e.workflow_id
WHERE e.reason = 'OOMKilled'
  AND e.last_timestamp >= NOW() - INTERVAL '1 month'
  AND w.pool = $1
ORDER BY e.last_timestamp DESC;
```

Latency targets (validated at 10M-row scale; see implementation plan):

- Workflow filter queries: 5-30 ms.
- Event drill-down per workflow: <50 ms.
- Aggregate event scans over a month: 50-200 ms with `idx_wf_events_reason_time`.

### Cursor pagination

Offset pagination is slow at scale. Use cursor pagination:

```sql
SELECT * FROM osmo_workflows
WHERE owner = $1
  AND (submit_time, id) < ($cursor_time, $cursor_id)
ORDER BY submit_time DESC, id DESC
LIMIT $page_size;
```

API response includes `next_cursor` (last row's submit_time + id) for the
next page. Constant-time pagination regardless of depth.

### Write ordering (single source of truth, no dual-write)

There is no dual-write window. Etcd is the canonical store for workflow state;
Postgres is a watch-derived projection. Each phase has exactly one writer to
the canonical store:

| Phase | Sequence | Failure mode |
|---|---|---|
| Submit | Apiserver CREATEs CR in etcd → 200 OK | If etcd write fails, return error to user. No partial state to clean up. |
| Reconcile | Workflow Controller UPDATEs CR.status in etcd | If etcd write fails, controller retries. Postgres has no involvement here. |
| Projection (derived) | Projector watches CR → UPSERTs `osmo_workflows` row | If Postgres write fails, the work item stays in the projector's workqueue and retries. Eventual consistency window: ms-seconds under normal load. |
| Event from backend | Backend session ack → Operator Service ingests → batched COPY into `osmo_workflow_events` | Backend retries on the next batch; idempotent via deterministic event ID. Events never touch etcd. |
| TTL | Workflow Controller DELETEs CR from etcd | Projector observes the DELETE event and finalizes the Postgres row (`completion_time` set; row stays for history). |

**Why this is simpler than dual-write**:

- Apiserver never writes Postgres. There's no "row in PG without CR" failure
  mode because the apiserver doesn't write the row.
- Workflow controller never writes Postgres. There's no "CR ahead of PG"
  drift because the controller doesn't write the row.
- The projector is the sole Postgres writer. Recovery on restart is
  automatic via the K8s informer's `List + Watch` resync.
- The classic dual-write inconsistency disappears because there's only one
  source of truth and one derivation path.

### Submit-then-query gap

Because the apiserver doesn't write Postgres on submit, there's a brief window
(typically hundreds of milliseconds) between `CREATE CR → 200 OK` and the
projector observing the watch event and INSERTing the Postgres row. During
this window:

- **GET-by-UID via apiserver**: falls back to etcd if the Postgres row isn't
  yet present. Apiserver tries Postgres first (cheaper), then etcd. Recent
  submits always resolve via the etcd fallback.
- **LIST queries**: served only from Postgres. A very-recent submit may not
  appear in a list for ~hundreds of ms. Acceptable for typical polling
  intervals (most UIs poll every 2-5s); the projection catches up well
  under one poll interval.
- **WATCH from external clients**: not supported in the query API (use the
  K8s watch on OSMOWorkflow CRs directly, which is always live).

This is the standard CQRS-like split: writes go to the canonical store
(etcd); reads have a small projection lag. The lag is bounded by the
projector's reconcile latency, not by an explicit poll interval.

### Components

| Component | Lives in | Role |
|---|---|---|
| `apiserver/store/postgres/` | Apiserver | Read-side connection pool. LIST/FILTER/aggregate queries against `osmo_workflows` + `osmo_workflow_events`. Cursor pagination. **Does not write to Postgres** for the workflow record — that's the projector's job. |
| `controller/projection/` | Dedicated controller (standalone Deployment in Phase 4) | **Sole writer to `osmo_workflows` / `osmo_workflow_groups`.** Watches OSMOWorkflow CRs via standard controller-runtime informer; UPSERTs Postgres on `Added` / `Modified` events; marks the row `completion_time` + final state on `Deleted`. Idempotent: same UID → same row. Recovery on restart is automatic — the informer's `List + Watch` reconciles the projector with the current etcd state. |
| `WorkflowEventIngest` | Operator Service | Receives `WorkflowTaskEventBatch` from backends; batched COPY into `osmo_workflow_events`. Events never had a dual-write problem — they live only in Postgres. See [`02-multicluster-transport.md`](./02-multicluster-transport.md). |
| Retention pruner | CronJob (e.g. monthly) | `DROP PARTITION` for `osmo_workflow_events` partitions older than configured retention; `DELETE FROM osmo_workflows WHERE completion_time < cutoff` (cascade removes group rows). |
| `golang-migrate` schema migrations | Operator-deployed | DDL changes; runs once per release. |

**Why a separate projector** (not a thread inside the workflow controller):

- **Separation of concerns**: workflow controller is the reconciler of business logic
  (DAG resolution, dispatch, finalizer cleanup). The projector is a pure derive — it
  has no opinions about workflow semantics, only about mirroring CR state to a
  relational schema. Mixing them means a Postgres outage degrades both.
- **Independent scaling**: at 100K active workflows the projector's load is dominated
  by Postgres write throughput; the workflow controller's is dominated by K8s API
  reconcile rate. Different scaling characteristics → different deployments.
- **Operational safety**: a buggy projector that wedges on a Postgres connection
  doesn't block workflow reconciliation.

## Lifecycle: an OSMOWorkflow through its stores

```
T0   user submits via apiserver
     apiserver CREATEs OSMOWorkflow CR in etcd (spec carries full submission)
     apiserver returns 200 OK to user
     ↓
T0+ε Projector observes the watch event
     Projector INSERTs osmo_workflows row (Phase=Pending)
       — spec_snapshot JSONB filled from the CR
     ↓
T1   Workflow Controller reconciles → DAG decisions
     dispatches OSMOTaskGroup CRs via transport
     UPDATEs CR.status (Phase=Running, dispatched groups, ...)
     Projector observes the status update → UPSERTs osmo_workflows row
     ↓
T2   Backend curates events as Pods transition
     EventCurator emits via WorkflowTaskEventBatch envelope
     Operator Service ingests → INSERT into osmo_workflow_events
       (separate path; never touches etcd)
     ↓
T3   Workflow reaches terminal (Succeeded/Failed)
     Workflow Controller writes terminal CR.status
     Projector observes → UPSERTs osmo_workflows row with completion_time
     ↓
T4   TTLSecondsAfterFinished fires
     Workflow Controller DELETEs OSMOWorkflow CR from etcd
     Projector observes the DELETE → marks osmo_workflows row final
       (no follow-up writes expected; row stays for history)
     ↓
T5   Retention expiry (configured, default 6-12 months past completion)
     Retention pruner drops the events partition + deletes workflow row
     Workflow is no longer queryable
```

CRDs are not asked to remember the past. Postgres is not asked to drive
live reconciliation. The apiserver and workflow controller write only
etcd; the projector is the sole Postgres writer for workflow state.

## Implementation plan

The Postgres infrastructure is foundational and lands in Phase 4.
Components touching it are distributed across phases:

| Phase | What lands |
|---|---|
| **Phase 1+2 (shipped)** | CRDs only. |
| **Phase 3 (NIM + Ray)** | Per-runtime EventCurator implementations. Events have no destination yet but the curation logic ships now so it's stable by the time Phase 4 ingest activates. |
| **Phase 4 (history)** | Postgres infra (Helm chart, schema migrations); apiserver query API; workflow controller projection; events ingest pipeline; retention pruner CronJob; UI history filters against the existing OSMO UI; scale validation at 10M+ rows. |
| **Phase 5 (scheduling)** | Pool/Binding rows added to Postgres for query coverage of OSMOPool-related historical queries. |
| **Phase 6 (migration)** | Backfill from existing OSMO Postgres. See [`06-migration-from-existing.md`](./06-migration-from-existing.md). |

## Risks / open questions

- **CRD versioning bump.** Phase 5 adds enough fields that we should consider
  promoting to v1beta1. Plan a bump alongside the Phase 5 work.
- **Schema validation tightness.** Today's CRDs use OpenAPI v3 schema but
  several fields are loose (`runtime.RawExtension` for runtimeConfig). Add
  per-runtimeType validation via webhook?
- **Owner identity format.** Email-shaped (`vivianp@nvidia.com`) — verify
  it's the right key.
- **Retention cutoff** — default 6-12 months in Postgres, then partition
  drop. Per-tenant override? Tenants with longer compliance retention pay
  for longer Postgres retention.

- **Orphan sweeper — not required for correctness.** The watch-based
  projector is the consistency mechanism: every CR change produces a
  derived Postgres update, and `List + Watch` on restart re-syncs from
  the current etcd state. An orphan sweeper (periodic scan of Postgres
  for rows whose CR is missing in etcd) is *not* needed for v1 because
  there's no dual-write window that could create orphans. It can be
  added later as a defensive safety net for bugs in the projector
  itself (e.g., a panic that wedges the watch loop) — but it's a
  diagnostic backstop, not a primary consistency mechanism. Expected
  background fire rate: ~zero.
- **HA Postgres.** Default: primary + standby + PgBouncer.
- **Schema evolution under live writes.** golang-migrate's locking is
  acceptable for this scale.
- **Query performance under autovacuum pressure.** At 10M+ rows with steady
  insert/update load, tune autovacuum baselines and document them in the
  runbook.

## Out of scope

- Per-runtime config schemas (covered in [`03-runtime-plugins.md`](./03-runtime-plugins.md)).
- Pool / pool-binding details (covered in [`04-scheduling.md`](./04-scheduling.md)).
- gRPC envelope types (covered in [`02-multicluster-transport.md`](./02-multicluster-transport.md)).
- Full-text search on workflow names/configs. Not in scope; if needed later,
  ElasticSearch as a separate add-on.
- Time-series analytics / BI dashboards. Use Prometheus + Grafana for
  cluster-wide metrics; Postgres history is for individual-workflow
  drill-down.
