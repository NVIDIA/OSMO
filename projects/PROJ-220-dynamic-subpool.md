<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

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
-->

# Dynamic Subpools for Resource Partitioning

**Author**: [Fernando Luo](https://github.com/fernandol-nvidia)<br>
**PIC**: [Feranndo Luo](https://github.com/fernandol-nvidia)<br>
**Proposal Issue**: [#220](https://github.com/nvidia/osmo/issues/220)

## Overview

Dynamic subpools split a pool’s GPU quota into guaranteed slices. Each subpool
gets its own reservation, and the parent keeps the remaining “unallocated” GPUs
for direct submissions.

### Motivation

Pool sharing today has no fairness mechanism: a single user or group can consume
the entire pool, leading to starvation for others and unpredictable access to resources.

### Problem

```
┌────────────────────────────────────────────────────────────────────┐
│  Pool: team (100 GPUs)                                             │
│                                                                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  User A: 80 GPUs  ████████████████████████████████████████  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────┐                                              │
│  │  User B: 20 GPUs │  ← "I can never get resources!"              │
│  └──────────────────┘                                              │
│  ┌───┐                                                             │
│  │ C │  ← "Pool is always full..."                                 │
│  └───┘                                                             │
└────────────────────────────────────────────────────────────────────┘
```

**Today**: Any user can consume the entire pool. No fairness mechanism exists.

## Use Cases

| Use Case | Description |
|---|---|
| Partition a shared pool by team or user | An admin creates subpools under a parent pool to reserve guaranteed GPU slices for multiple groups. |
| Preserve “shared” capacity | Users can continue submitting to the parent pool using the unallocated portion (remaining capacity not assigned to subpools). |
| Soft-decrease and drain | An admin reduces a subpool quota or deletes a subpool; existing running workloads continue while the system drains usage back to the new quota (Available may go negative). |
| Pause a subpool | A subpool in `DELETING` or `ARCHIVED` blocks new submissions while preserving audit history. |

## Requirements

| Title | Description | Type |
|---|---|---|
| Subpool CRUD | An admin shall be able to create, update (quota), and delete subpools under a parent pool. | Functional |
| Quota partitioning | The system shall enforce that subpools behave as quota partitions of a parent pool. | Functional |
| Parent admission cap | If a parent pool has subpools, OSMO shall reject new parent submissions at HIGH/NORMAL priority when requested GPUs exceed the parent’s unallocated amount. | Functional |
| Opportunistic LOW priority | LOW priority submissions shall remain opportunistic and may exceed quota/unallocated (preemptible). | Functional |
| State-based submission control | The system shall reject new submissions to subpools in `DELETING` or `ARCHIVED`. | Functional |
| Soft decreases | Quota reductions and deletes shall not terminate existing running workflows; Available may become negative until drained. | Functional |
| Audit trail | The system shall not hard delete subpools; it shall retain `ARCHIVED` history. | Non-Functional |
| Delimiter validation | The system shall reject pool names containing `--` (parent and subpool alike). | Functional |
| Role model inheritance | Subpool access shall be inherited from the parent pool (no subpool-specific roles). | Security |

## Architectural Details

High-level approach:

- Subpools are represented as child pools with a parent edge, sharing the
  parent’s configuration except for name, parent relationship, quota, and subpool state.
- Once subpools exist, OSMO admission blocks new parent submissions that would
  exceed the unallocated quota.
- KAI Scheduler hierarchical queues enforce fair distribution across queues at runtime.

User-facing changes:

- New CLI commands: `osmo pool subpool create|update|delete ...`
- Updated `osmo pool list` output to show parent/subpool hierarchy and negative
  “Available” during drain.

## Detailed Design

### Solution Summary: Subpools

```
┌────────────────────────────────────────────────────────────────────┐
│  Pool: team (100 GPUs)                                             │
│                                                                    │
│  ┌───────────────────────┐  ┌─────────────────────────────────┐    │
│  │  Subpool: team--a     │  │  Subpool: team--b               │    │
│  │  Quota: 30 GPUs       │  │  Quota: 40 GPUs                 │    │
│  │  ████████████         │  │  ████████████████               │    │
│  └───────────────────────┘  └─────────────────────────────────┘    │
│  ┌───────────────────────┐  ┌───────────────────────┐              │
│  │  Subpool: team--c     │  │  Unallocated          │              │
│  │  Quota: 20 GPUs       │  │  10 GPUs (parent)     │              │
│  │  ████████             │  │  ████                 │              │
│  └───────────────────────┘  └───────────────────────┘              │
└────────────────────────────────────────────────────────────────────┘
```

**Subpools** = quota partitions. Each gets a guaranteed slice. Fair by design.

### Naming

- **Canonical pool name**: `{parent}--{subpool}` (e.g. `team--a`)
- **Subpool short name**: `a` (unique within parent)
- **Delimiter rule**: `--` must not appear in any pool name or subpool short name

### CLI UX (what users see)

```bash
# Create / update / delete
osmo pool subpool create <parent> <subpool> --quota <gpus>
osmo pool subpool update <parent> <subpool> --quota <gpus>
osmo pool subpool delete <parent> <subpool>

# Submit
osmo workflow submit --pool <parent>     my-workflow.yaml   # parent uses unallocated
osmo workflow submit --pool <parent--subpool> my-workflow.yaml
```

Example `osmo pool list` output (HIGH/NORMAL only; Available can be negative while draining):

```
Pool            Status         Subpool State  GPU Quota        Used  Available
--------------  -------------  -------------  ---------------  ----  ---------
team            ONLINE         -              10 (Total: 100)  50    -40
├─ team--a      ONLINE         ACTIVE         30               5     25
├─ team--b      ONLINE         ACTIVE         40               10    30
└─ team--c      ONLINE         ACTIVE         20               0     20
```

Column semantics:
- **GPU Quota (parent)**: `unallocated (Total: parent_quota)`
- **Available (parent)**: `unallocated - parent_direct_high_normal`
  (negative means “GPUs to drain”)
- **Available (subpool)**: `subpool_quota - subpool_high_normal_used`
  - If `DELETING`, treat quota as 0 → `Available = 0 - used` until drained
  - If quota is reduced below current usage → `Available = new_quota - used`
    until drained

### Core Rules

- **Parent submissions (HIGH/NORMAL)**: must satisfy `requested_gpus <= unallocated`
- **Parent submissions (LOW)**: allowed to exceed (preemptible)
- **Subpool submissions**:
  - Allowed if `ACTIVE`
  - Blocked if `DELETING` or `ARCHIVED`
- **Quota updates**:
  - Allowed only if `ACTIVE`
  - Decreases are soft: existing workflows continue; Available may go negative
    until drained
- **Delete**:
  - If no running workflows: immediate `ARCHIVED` and quota returns to parent
  - Else: `DELETING` (frozen: no updates/submissions) until drained → `ARCHIVED`
- **Reuse name**: allowed by reactivating an `ARCHIVED` subpool name back to `ACTIVE`

### Subpool State

```
┌──────────┐            ┌────────┐   delete   ┌───────────┐   drained  ┌──────────┐
│  CREATE  │ ─────────► │ ACTIVE │ ─────────► │ DELETING  │ ─────────► │ ARCHIVED │
└──────────┘            └────────┘            └───────────┘            └──────────┘
```

### Inheritance (subpools are quota partitions only)

Subpools inherit all parent pool configuration. Only these differ:
- name (`parent--subpool`), parent edge, quota, and subpool state

### KAI Queue Hierarchy

```
osmo-default-{namespace}
└── osmo-pool-{namespace}-team (guarantee=100)
    ├── osmo-pool-{namespace}-team--a (guarantee=30)  # derived from canonical pool "team--a"
    ├── osmo-pool-{namespace}-team--b (guarantee=40)  # derived from canonical pool "team--b"
    └── osmo-pool-{namespace}-team--c (guarantee=20)  # derived from canonical pool "team--c"
```

Subpools become child KAI queues. Same naming convention as pools. Priority, borrowing, and preemption work at each level.

### KAI Scheduler Integration Notes

KAI Scheduler supports hierarchical queues and resource distribution per queue
(quota/limits/priority), which matches the core needs of subpools (see [NVIDIA/KAI-Scheduler](https://github.com/NVIDIA/KAI-Scheduler)).

Two required behaviors and how we achieve them:

1. **Creating subpools does not interfere with existing workflows**
   - Existing workflows submitted to the parent pool remain in the parent queue and
     are not migrated.
   - Subpool creation only affects **future scheduling** and
     **future admission** decisions.
   - We avoid introducing any mechanism that would preempt/evict already-running
     parent workloads as a result of creating queues.

2. **Once subpools exist, the parent cannot over-allocate with new workflows**
   - This is enforced in **OSMO admission** (authoritative):
     - For parent submissions at HIGH/NORMAL: enforce `requested_gpus <= unallocated`
     - Where `unallocated = parent_quota - sum(child_quotas)`
   - KAI queue configuration is a backstop for fairness, but OSMO is the gate
     that guarantees “no new parent over-allocation” deterministically.

Negative Available visibility:
- Even with the admission gate, parent direct HIGH/NORMAL usage that predates
  subpool creation may temporarily exceed unallocated (parent Available is negative).
  During that drain period, subpools may not achieve their full quota immediately,
  even though they remain `ACTIVE`.

### Database Schema

```sql
-- Subpools are implemented by reusing the existing pools table with a parent edge.
ALTER TABLE pools ADD COLUMN parent_pool TEXT REFERENCES pools(name);   -- NULL for top-level pools
ALTER TABLE pools ADD COLUMN subpool_name TEXT;                         -- NULL for top-level pools
ALTER TABLE pools ADD COLUMN subpool_state TEXT;                        -- NULL for top-level pools

-- Constraints (recommended)
-- UNIQUE (parent_pool, subpool_name)
-- CHECK ((parent_pool IS NULL) = (subpool_name IS NULL))
-- CHECK (subpool_name NOT LIKE '%--%')  -- delimiter cannot appear in names
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/configs/pool/{parent}/subpool` | GET | List subpools of parent |
| `/api/configs/pool/{parent}/subpool` | POST | Create subpool under parent |
| `/api/configs/pool/{parent}/subpool/{subpool}` | PUT | Update quota |
| `/api/configs/pool/{parent}/subpool/{subpool}` | DELETE | Delete (smart) |

### Security

#### Security Model

| Role | Permissions |
|------|-------------|
| `osmo-{pool}-admin` | Create, update, delete subpools |
| `osmo-{pool}-user` | Submit to parent pool **and all subpools** |

No subpool-specific roles. Access inherited from parent.

Implementation note:
- Subpool pool names are canonicalized as `{parent}--{subpool}`. This allows existing pool-role
  patterns (e.g. `osmo-team-*`) to naturally cover subpools via prefix matching.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Inherit all config from parent? | **Yes** | No drift, one source of truth |
| Subpool-specific user access? | **No** | Simpler, inherits from parent |
| Retention policy for ARCHIVED? | **Never hard delete** | Audit trail; no garbage collection |
| Notifications on state transitions? | **No** | Status visible in CLI |
| Subpool names globally unique? | **No** (scoped) | Avoid cross-team name collisions; use canonical `{parent}--{subpool}` for uniqueness |
| Rounding | **floor** | Whole GPU quotas only; remainder stays in parent unallocated |
| Delimiter in pool names? | **Reject `--`** | Enforce delimiter rule on all pools (existing and new) to avoid naming conflicts |
| Drain monitoring interval | **15 min (configurable)** | Expose via workflow config field for tuning |

### Alternatives Considered

- **Per-user caps (no subpools)**:
  - Pros: simpler config surface
  - Cons: does not map to “team partitions”, hard to manage sharing, weaker guarantees
- **Separate top-level pools (no parent)**:
  - Pros: existing pool semantics
  - Cons: loses shared unallocated capacity and makes “shared-but-fair” harder; more config duplication
- **Scheduler-only enforcement**:
  - Pros: less OSMO admission logic
  - Cons: does not deterministically prevent new parent over-allocation; OSMO should be the authoritative gate

### Backwards Compatibility

- Existing pools with no subpools behave exactly as today.
- Existing running workloads are not migrated/evicted when subpools are created.
- Parent “Available” may become negative during drain for pre-existing usage, but this is a visibility change
  rather than a behavioral break.

### Performance

- Admission adds lightweight checks (pool tree lookup + simple arithmetic) on submit.
- Periodic drain monitoring (if implemented) introduces low-rate background polling.

### Operations

- Requires a database migration to extend the `pools` table with subpool fields.
- Requires operational visibility for subpool states (`ACTIVE/DELETING/ARCHIVED`) and drain progress.

### Documentation

- CLI docs for `osmo pool subpool ...`
- Updated `osmo pool list` semantics (negative Available while draining)
- Admin/operator runbook notes for delete/drain behavior

### Testing

- Unit tests for:
  - unallocated/quota computations
  - admission checks (parent cap, subpool state)
  - state transitions on delete (immediate archive vs draining)
- Integration/E2E tests for:
  - create/update/delete subpools
  - hierarchical quota reporting in `pool list`
  - submission behavior for parent vs subpool across priorities

### Dependencies

- KAI Scheduler hierarchical queues (guarantees) must be available/compatible.
- Postgres schema migration tooling and deployment process.
- Delayed job infrastructure (if used for drain monitoring).

## Implementation Plan

1. **Schema & Models**
   - Add subpool fields to `pools` (reuse table with a parent edge)
   - Update the Pool model to include subpool fields
2. **Core Logic**
   - Enforce `sum(child_quotas) <= parent_quota` on create/update
   - Enforce parent admission cap: `requested_gpus <= unallocated` for parent HIGH/NORMAL submissions
   - Compute negative Available for parent (and subpool on shrink/delete) for display
   - Implement delete/drain behavior (`DELETING` → `ARCHIVED`)
3. **KAI Integration**
   - Create hierarchical queues for subpools under the parent queue
   - Ensure creating subpools does not disrupt existing workloads (no migration/eviction)
4. **APIs**
   - Implement subpool CRUD endpoints
5. **CLI**
   - Add `osmo pool subpool` commands and update list output to show hierarchy + negative Available
6. **Tests & Docs**
   - E2E tests for create/update/delete and admission behavior

## Open Questions

_None at this time._

## Additional Considerations

- **Delimiter validation**: Enforce that `--` cannot appear in any pool name (existing parents included).
  Reject pool creation/rename if the name contains `--`.
- **Drain monitoring interval**: Default to 15 minutes; make configurable via a workflow config field.
- **ARCHIVED retention**: Never garbage-collect. `ARCHIVED` subpools are retained indefinitely for audit.

## Appendix: Detailed Code Pointers & Starter Snippets

<details>
<summary>DB: pools table + Pool model (edit: <code>external/src/utils/connectors/postgres.py</code>)</summary>

Where to start:
- `PostgresConnector._init_tables()` creates the `pools` table.
- `PoolBase` / `Pool` are the Pydantic models for pools.

Starter schema diff (conceptual; real migration TBD):

```sql
ALTER TABLE pools ADD COLUMN parent_pool TEXT REFERENCES pools(name);
ALTER TABLE pools ADD COLUMN subpool_name TEXT;
ALTER TABLE pools ADD COLUMN subpool_state TEXT;

-- UNIQUE (parent_pool, subpool_name)
-- CHECK ((parent_pool IS NULL) = (subpool_name IS NULL))
-- CHECK (subpool_name NOT LIKE '%--%')
```

</details>

<details>
<summary>API: pool quota computation (edit: <code>external/src/service/core/workflow/workflow_service.py</code>)</summary>

Where to start:
- `/api/pool_quota` is implemented in `get_pool_quotas()`.
- Today it computes:
  - `quota_used` from **non-preemptible** tasks (HIGH/NORMAL)
  - `total_usage` from all tasks (includes LOW)

Subpool changes will likely land here (or in a helper):
- Build the pool tree (parent + children) from config.
- Compute `unallocated = parent_quota - sum(active_child_quotas)`.
- For display, compute parent Available as `unallocated - parent_direct_high_normal_used`
  (can be negative while draining).

</details>

<details>
<summary>Admission: enforce parent cap + subpool state checks (edit: <code>external/src/service/core/workflow/workflow_service.py</code>)</summary>

Where to start:
- `/api/pool/{pool_name}/workflow` is `submit_workflow()`.

Required checks:
- If `pool_name` is a **subpool**:
  - reject if state is `DELETING` or `ARCHIVED`
- If `pool_name` is a **parent with subpools** and priority is HIGH/NORMAL:
  - enforce `requested_gpus <= unallocated`
- LOW remains opportunistic (preemptible): allowed to exceed unallocated/quota.

</details>

<details>
<summary>CLI: current pool list implementation (edit: <code>external/src/cli/pool.py</code>)</summary>

Where to start:
- `list_pools()` calls `/api/pool_quota`.
- `_list_pool()` formats the table and currently uses server-provided:
  - `quota_used`, `quota_limit`, `quota_free`

Subpool changes:
- Update server response (preferred) to provide hierarchical data and the new columns.
- Or update CLI formatting to synthesize:
  - `GPU Quota` as `unallocated (Total: parent_quota)` for parents
  - `Available` possibly negative.

</details>

<details>
<summary>KAI queues: where queue objects are built (inspect: <code>external/src/utils/job/kb_objects.py</code>)</summary>

Where to start:
- `KaiK8sObjectFactory` is the entry point for building K8s objects.

Subpool changes:
- Ensure a queue exists for each `ACTIVE` / `DELETING` subpool (exclude `ARCHIVED`).
- Parent queue remains the parent of subpool queues.
- No migration/eviction of already-running workloads on subpool creation.

</details>

<details>
<summary>Jobs framework: where to add drain monitors / background work (inspect/edit: <code>external/src/utils/job/jobs.py</code>, <code>external/src/utils/job/jobs_base.py</code>)</summary>

Where to start:
- `FrontendJob` (and `send_delayed_job_to_queue`) lives in `external/src/utils/job/jobs.py`.
- Base job plumbing (serialization, dispatch) is in `external/src/utils/job/jobs_base.py`.

Subpool changes:
- Implement a new `FrontendJob` to monitor draining subpools and transition `DELETING` → `ARCHIVED`
  once no running workflows remain in that subpool.
- Use `send_delayed_job_to_queue()` for polling (simple + consistent with existing queue timeout jobs).

Suggested job: `CheckSubpoolDrain`

What it watches:
- A specific subpool in state `DELETING`
- “Drained” means: **no running workflows remain that are assigned to that subpool**

State diagram (job-driven):

```
delete request (has workflows)
┌────────┐      set subpool_state=DELETING       ┌───────────┐
│ ACTIVE │ ─────────────────────────────────────► │ DELETING  │
└────────┘                                       └───────────┘
                                                       │
                                                       │ poll (delayed job)
                                                       ▼
                                          ┌───────────────────────────┐
                                          │ CheckSubpoolDrain.execute │
                                          └───────────────────────────┘
                                            │
                         drained? (running workflows == 0 for subpool)
                        ┌───────────────┬─────────────────────────────┐
                        │ yes           │ no                          │
                        ▼               ▼                             ▼
              set subpool_state=ARCHIVED   re-enqueue self after N min (poll)
                        │
                        ▼
                   ┌──────────┐
                   │ ARCHIVED │
                   └──────────┘
```

Enqueue triggers (when to start the monitor):
- On `osmo pool subpool delete <parent> <subpool>`:
  - If “owned” running workflows == 0: archive immediately (no job needed)
  - Else: set `subpool_state=DELETING` and enqueue `CheckSubpoolDrain`
- (Optional) On quota decrease below current usage:
  - We may reuse the same monitor pattern to “watch Available return to >= 0” if desired,
    but this is *not required* for correctness since updates are soft.

Polling interval:
- Start with a constant interval (e.g. 1–5 minutes) and adjust later if needed.
- Implementation uses `FrontendJob.send_delayed_job_to_queue(datetime.timedelta(minutes=N))`
  which is already supported by the delayed job monitor.

Pseudo-code (structure only):

```python
class CheckSubpoolDrain(FrontendJob):
    parent_pool: str
    subpool_name: str  # canonical: "{parent}--{subpool}"

    def execute(self, context: JobExecutionContext, progress_writer: ...):
        # 1) Fetch subpool row; if already ARCHIVED, exit.
        # 2) Count running workflows owned by this subpool.
        # 3) If count == 0: transition to ARCHIVED (and trigger KAI queue update if needed).
        # 4) Else: re-enqueue self with delay.
        return JobResult(...)
```

</details>

<details>
<summary>Delayed job execution (inspect: <code>external/src/service/delayed_job_monitor/delayed_job_monitor.py</code>)</summary>

Where to start:
- `DelayedJobMonitor.run()` pulls delayed jobs from a Redis ZSET and enqueues them to the main job queue.

Subpool changes:
- If we implement a “check drain every N minutes” monitor job for subpools, this component is what
  actually makes delayed re-checks run.

</details>

<details>
<summary>Task/Status definitions (inspect: <code>external/src/utils/job/task.py</code>)</summary>

Where to start:
- `TaskGroupStatus` and `ExitCode` enums live here.

Subpool changes:
- Likely **no changes** unless we want a new user-facing failure mode (e.g., “rejected because subpool is DELETING”).
- Preemption already maps to `FAILED_PREEMPTED` (useful for LOW priority semantics).

</details>

<details>
<summary>Preemption detection (inspect: <code>external/src/operator/backend_listener.py</code>)</summary>

Where to start:
- `check_preemption_by_scheduler()` detects scheduler preemption and maps it to `FAILED_PREEMPTED`.

Subpool changes:
- Likely **no changes** for subpools directly; this is relevant to document/validate LOW priority behavior.
- If we ever add pool/subpool-specific labeling/metrics on preemption, this is a likely hook point.

</details>

<details>
<summary>Config service integration for pool/subpool configs (inspect: <code>external/src/service/core/config/config_service.py</code>)</summary>

Where to start:
- Pool config updates flow through this service.

Subpool changes:
- Add CRUD routes for subpools (or extend existing pool config endpoints) and ensure we:
  - validate `sum(child_quotas) <= parent_quota`
  - set `subpool_state` transitions
  - trigger backend queue updates (KAI) after config changes

</details>
