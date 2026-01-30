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
  "Available" during drain.

## Research and Constraints

This section documents the KAI Scheduler behaviors that informed our design, based on
official documentation and empirical validation.

### KAI Scheduler Behavior (Confirmed)

The following behaviors are confirmed by official KAI Scheduler / Run:ai documentation:

| Behavior | Source | Implication |
|----------|--------|-------------|
| **Leaf queues required for job submissions** | [Demystifying KAI Queues](https://medium.com/@singh1203.ss/demystifying-queues-in-nvidia-kai-scheduler-82ece7ef543c), [Ray KAI Integration](https://docs.ray.io/en/latest/cluster/kubernetes/k8s-ecosystem/kai-scheduler.html) | Parent queues are containers only; jobs must target leaf queues |
| **Quota = guaranteed resources** | [Run:ai Scheduler Concepts](https://run-ai-docs.nvidia.com/self-hosted/2.20/platform-management/runai-scheduler/scheduling/concepts) | Non-preemptible workloads are constrained to their queue's quota |
| **Over-quota = cluster-wide unused resources** | [Run:ai How the Scheduler Works](https://run-ai-docs.nvidia.com/self-hosted/2.20/platform-management/runai-scheduler/scheduling/how-the-scheduler-works) | Over-quota does NOT come from unused sibling quota |
| **Non-preemptible workloads cannot use over-quota** | [Run:ai Workload Priority](https://run-ai-docs.nvidia.com/saas/platform-management/runai-scheduler/scheduling/workload-priority-control) | HIGH/NORMAL priority jobs must stay within guaranteed quota |
| **Preemption/reclaim restores fairness** | [NVIDIA Blog: KAI Scheduler](https://developer.nvidia.com/blog/nvidia-open-sources-runai-scheduler-to-foster-community-collaboration/) | Over-quota workloads can be preempted when other queues need resources |

### Key Constraints (What KAI Does NOT Do)

These limitations informed critical design decisions:

1. **KAI does NOT reserve idle children's quota**
   - If a parent queue has children with quotas, and those children are idle, KAI will
     allow parent-level jobs to consume resources up to the parent's total quota.
   - This means child guarantees can be violated if we submit directly to the parent queue.
   - **Mitigation**: Use the "shadow queue" pattern (see below).

2. **KAI does NOT enforce `sum(children.quota) <= parent.quota` at admission**
   - The scheduler allows over-subscription; enforcement is dynamic at scheduling time.
   - **Mitigation**: OSMO admission must enforce this constraint.

3. **KAI does NOT provide automatic "shadow" or "shared" queues**
   - There is no built-in mechanism for a parent's unallocated portion to become a
     separate leaf queue.
   - **Mitigation**: OSMO creates and manages a `--_shared` queue for each pool.

4. **KAI does NOT validate queue membership via admission webhooks**
   - Jobs submitted directly to Kubernetes (bypassing OSMO) are not validated.
   - **Mitigation**: Document as accepted risk; OSMO is the authoritative gate.

### Shadow Queue Pattern (Design Inspiration)

To preserve child queue guarantees while allowing parent-level submissions, we adopt the
"shadow queue" pattern recommended in KAI Scheduler best practices:

```
Problem: Parent jobs can consume child quota when children are idle

Solution: Create an explicit leaf queue ("shadow queue") for parent submissions

Before (problematic):
  osmo-default → osmo-pool-team (parent AND leaf, quota=100)
                 └── Jobs submitted here can consume child quota

After (shadow queue pattern):
  osmo-default → osmo-pool-team (parent container, quota=100)
                 ├── osmo-pool-team--_shared (leaf, quota=10)  ← parent submissions go here
                 ├── osmo-pool-team--a (leaf, quota=30)
                 ├── osmo-pool-team--b (leaf, quota=40)
                 └── osmo-pool-team--c (leaf, quota=20)
```

**Key insight**: ALL pools now have a `--_shared` leaf queue, even those without subpools.
This provides a consistent pattern and ensures pools are always properly structured for
KAI's hierarchical queue model.

### Sources

- [NVIDIA KAI-Scheduler GitHub](https://github.com/NVIDIA/KAI-Scheduler)
- [Run:ai Scheduler Concepts and Principles](https://run-ai-docs.nvidia.com/self-hosted/2.20/platform-management/runai-scheduler/scheduling/concepts)
- [Run:ai How the Scheduler Works](https://run-ai-docs.nvidia.com/self-hosted/2.20/platform-management/runai-scheduler/scheduling/how-the-scheduler-works)
- [NVIDIA Blog: KAI Scheduler Open Source](https://developer.nvidia.com/blog/nvidia-open-sources-runai-scheduler-to-foster-community-collaboration/)
- [Ray + KAI Scheduler Integration](https://docs.ray.io/en/latest/cluster/kubernetes/k8s-ecosystem/kai-scheduler.html)
- [Demystifying Queues in KAI Scheduler](https://medium.com/@singh1203.ss/demystifying-queues-in-nvidia-kai-scheduler-82ece7ef543c)

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
- **Reserved names**: `_shared` is reserved for the internal shadow queue; subpool names
  starting with `_` are rejected
- **Shadow queue name**: `{parent}--_shared` (internal, not user-visible)

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

> **Note**: Only subpools in states `ACTIVE` and `DELETING` are shown in this table. `ARCHIVED` subpools are omitted to ensure GPU quota accounting remains balanced and clear.

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

#### Shadow Queue Routing

- **Parent submissions (`--pool team`)**: routed to `team--_shared` queue internally
- **Subpool submissions (`--pool team--a`)**: routed to `team--a` queue directly
- **Shadow queue is invisible**: users see pool names, not internal queue names

#### Admission Rules

- **Parent submissions (HIGH/NORMAL)**: must satisfy `requested_gpus <= _shared.quota`
  - Where `_shared.quota = parent_quota - sum(subpool_quotas)` (i.e., unallocated)
- **Parent submissions (LOW)**: allowed to exceed quota (preemptible, uses over-quota)
- **Subpool submissions**:
  - Allowed if `ACTIVE`
  - Blocked if `DELETING` or `ARCHIVED`

#### Quota Management

- **Quota updates**:
  - Allowed only if `ACTIVE`
  - Decreases are soft: existing workflows continue; Available may go negative
    until drained
  - Shadow queue quota is automatically adjusted to maintain invariant
- **Delete**:
  - If no running workflows: immediate `ARCHIVED` and quota returns to `_shared`
  - Else: `DELETING` (frozen: no updates/submissions) until drained → `ARCHIVED`
- **Reuse name**: allowed by reactivating an `ARCHIVED` subpool name back to `ACTIVE`

#### Shadow Queue Invariant

At all times: `_shared.quota + sum(active_subpool_quotas) = parent.quota`

### Subpool State

```
  create    ┌────────┐   delete   ┌───────────┐   drained  ┌──────────┐
  ────────► │ ACTIVE │ ─────────► │ DELETING  │ ─────────► │ ARCHIVED │
            └────────┘            └───────────┘            └──────────┘
                ▲                                                  │
                │                                                  │
                └──────────────── recreate ────────────────────────┘
```

**State behavior**:
- **ACTIVE**: All operations allowed (read, update quota, delete, submit jobs)
- **DELETING**: Read-only. No updates allowed (cannot delete, update quota, or recreate) until drained to ARCHIVED
- **ARCHIVED**: Read-only. Can only recreate to transition back to ACTIVE

### Inheritance (subpools are quota partitions only)

Subpools inherit all parent pool configuration. Only these differ:
- name (`parent--subpool`), parent edge, quota, and subpool state

### KAI Queue Hierarchy

All pools use the shadow queue pattern for consistent KAI integration:

**Pool WITHOUT subpools** (shadow queue gets 100% of quota):

```
osmo-default-{namespace}
└── osmo-pool-{namespace}-team (parent container, quota=100)
    └── osmo-pool-{namespace}-team--_shared (leaf, quota=100)
```

**Pool WITH subpools** (shadow queue gets unallocated portion):

```
osmo-default-{namespace}
└── osmo-pool-{namespace}-team (parent container, quota=100)
    ├── osmo-pool-{namespace}-team--_shared (leaf, quota=10)   # unallocated portion
    ├── osmo-pool-{namespace}-team--a (leaf, quota=30)         # subpool
    ├── osmo-pool-{namespace}-team--b (leaf, quota=40)         # subpool
    └── osmo-pool-{namespace}-team--c (leaf, quota=20)         # subpool
```

Key points:
- **ALL pools have a `--_shared` leaf queue**, even those without subpools
- `_shared` is a reserved name; users cannot create a subpool with this name
- Parent pool submissions (`--pool team`) route to `team--_shared` internally
- Subpool submissions (`--pool team--a`) route directly to `team--a`
- The `--_shared` queue is invisible to users; they see the parent pool name

Subpools become child KAI queues. Same naming convention as pools. Priority, borrowing, and preemption work at each level.

### KAI Scheduler Integration Notes

KAI Scheduler supports hierarchical queues and resource distribution per queue
(quota/limits/priority), which matches the core needs of subpools (see [NVIDIA/KAI-Scheduler](https://github.com/NVIDIA/KAI-Scheduler)).

#### Critical: OSMO Is the Single Enforcement Point

Based on our [research](#research-and-constraints), KAI Scheduler does NOT:
- Reserve idle children's quota (parent jobs can consume child quota if children are idle)
- Enforce `sum(children.quota) <= parent.quota` at admission time
- Provide automatic routing of parent submissions to a "shared" queue

**Therefore, OSMO admission is the ONLY mechanism that guarantees child quotas are protected.**
KAI queue configuration provides runtime fairness and preemption, but OSMO is the
authoritative gate that prevents over-allocation.

#### Required Behaviors and How We Achieve Them

1. **Creating subpools does not interfere with existing workflows**
   - Existing workflows submitted to the parent pool remain in the `--_shared` queue
     and are not migrated.
   - Subpool creation only affects **future scheduling** and
     **future admission** decisions.
   - We avoid introducing any mechanism that would preempt/evict already-running
     parent workloads as a result of creating queues.

2. **Once subpools exist, the parent cannot over-allocate with new workflows**
   - This is enforced in **OSMO admission** (authoritative):
     - For parent submissions at HIGH/NORMAL: enforce `requested_gpus <= unallocated`
     - Where `unallocated = parent_quota - sum(child_quotas)`
   - OSMO routes parent submissions to the `--_shared` queue, which has quota = unallocated.
   - KAI enforces that non-preemptible jobs stay within their queue's quota.

3. **Shadow queue synchronization**
   - When a subpool is created: `_shared.quota -= new_subpool.quota`
   - When a subpool quota is updated: `_shared.quota += old_quota - new_quota`
   - When a subpool is deleted/archived: `_shared.quota += deleted_subpool.quota`
   - Invariant: `_shared.quota + sum(subpool_quotas) = parent.quota`

#### Priority Mapping

| OSMO Priority | KAI Behavior | Over-Quota? | Preemptible? |
|---------------|--------------|-------------|--------------|
| HIGH | Non-preemptible, must stay within queue quota | No | No |
| NORMAL | Non-preemptible, must stay within queue quota | No | No |
| LOW | Preemptible, can use cluster-wide over-quota | Yes | Yes |

#### Negative Available Visibility

- Even with the admission gate, parent direct HIGH/NORMAL usage that predates
  subpool creation may temporarily exceed unallocated (parent Available is negative).
  During that drain period, subpools may not achieve their full quota immediately,
  even though they remain `ACTIVE`.

#### Bypass Risk (Accepted Limitation)

If workloads are submitted directly to Kubernetes (bypassing OSMO), they will be
scheduled according to KAI rules without OSMO's quota enforcement. This is an
accepted limitation; OSMO is designed as the primary submission interface.

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

Subpools are pool entries in the `pools` table, but **all operations** use dedicated `/subpool`
endpoints to enforce parent context, maintain consistent API semantics, and clearly distinguish
subpool-specific behavior (quota constraints, state-machine semantics).

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/configs/pool/{parent}/subpool/{subpool}` | GET | Read subpool |
| `/api/configs/pool/{parent}/subpool` | GET | List subpools of parent |
| `/api/configs/pool/{parent}/subpool` | POST | Create subpool under parent |
| `/api/configs/pool/{parent}/subpool/{subpool}` | PATCH | Update quota (quota-only) |
| `/api/configs/pool/{parent}/subpool/{subpool}` | DELETE | Delete (smart, state-managed) |

**Design rationale**: All operations use dedicated `/subpool` endpoints to provide consistent
API semantics, enforce parent context, clearly distinguish subpool-specific behavior
(quota-only updates, parent-constrained creates, state-machine deletes) from top-level pool operations,
and simplify authorization enforcement by making pool and subpool access controls distinct and explicit.

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
| Shadow queue for all pools? | **Yes (`--_shared`)** | KAI requires leaf queues for job submissions; consistent pattern for all pools regardless of whether they have subpools |
| Shadow queue visibility? | **Hidden** | Users submit to `team`, OSMO routes to `team--_shared` internally; simplifies UX |
| Reserved subpool names? | **`_shared`** | Prevent user collision with internal shadow queue; names starting with `_` are reserved |
| Inherit all config from parent? | **Yes** | No drift, one source of truth |
| Subpool-specific user access? | **No** | Simpler, inherits from parent |
| Retention policy for ARCHIVED? | **Never hard delete** | Audit trail; no garbage collection |
| Notifications on state transitions? | **No** | Status visible in CLI |
| Subpool names globally unique? | **No** (scoped) | Avoid cross-team name collisions; use canonical `{parent}--{subpool}` for uniqueness |
| Rounding | **floor** | Whole GPU quotas only; remainder stays in parent unallocated |
| Delimiter in pool names? | **Reject `--`** | Enforce delimiter rule on all pools (existing and new) to avoid naming conflicts |
| Drain monitoring interval | **15 min (configurable)** | Expose via workflow config field for tuning |
| OSMO as single enforcement point? | **Yes** | KAI does not reserve idle children's quota; OSMO admission is the only defense |
| Bypass protection (direct K8s)? | **Accepted risk** | Workloads bypassing OSMO may violate quotas; document as limitation |
| Subpool API endpoints? | **Hybrid** | Writes use `/pool/{parent}/subpool` (enforce parent context, quota constraints, state semantics); reads use existing pool endpoint with canonical name (`/pool/{parent}--{subpool}`) since subpools are pool table entries |

### Alternatives Considered

- **Per-user caps (no subpools)**:
  - Pros: simpler config surface
  - Cons: does not map to "team partitions", hard to manage sharing, weaker guarantees
- **Separate top-level pools (no parent)**:
  - Pros: existing pool semantics
  - Cons: loses shared unallocated capacity and makes "shared-but-fair" harder; more config duplication
- **Scheduler-only enforcement**:
  - Pros: less OSMO admission logic
  - Cons: does not deterministically prevent new parent over-allocation; OSMO should be the authoritative gate
- **Direct parent queue submissions (no shadow queue)**:
  - Pros: simpler queue structure
  - Cons: KAI does not reserve idle children's quota; parent jobs can consume child guarantees
  - This was rejected based on [research findings](#research-and-constraints)
- **Shadow queue only for pools with subpools**:
  - Pros: fewer queues for simple pools
  - Cons: inconsistent pattern; requires migration when first subpool is added
  - Rejected in favor of uniform "all pools have shadow queue" pattern

### Backwards Compatibility

#### Pools Without Subpools (Functionally Identical)

For pools that do not have subpools, behavior is identical to current behavior:

| Aspect | Current Behavior | New Behavior | User Impact |
|--------|------------------|--------------|-------------|
| User command | `osmo workflow submit --pool team` | Same | None |
| Internal queue | `osmo-pool-ns-team` | `osmo-pool-ns-team--_shared` | Invisible |
| Quota enforcement | Pool's `resources.gpu.guarantee` | Same value on `_shared` queue | None |
| Priority behavior | HIGH/NORMAL in-quota, LOW over-quota | Same | None |
| CLI display | `osmo pool list --quota` shows quota | Same (aggregate) | None |

**Key guarantee**: Users with existing pools (no subpools) will see no change in
behavior, CLI output, or quota enforcement. The only difference is the internal
KAI queue name, which is not visible to users.

#### Existing Workflows

- Existing running workloads are not migrated/evicted when subpools are created.
- Existing workflows in the parent pool remain in the `--_shared` queue.
- No preemption or disruption occurs as a result of subpool creation.

#### Display Changes (Visibility Only)

- Parent "Available" may become negative during drain for pre-existing usage.
- This is a visibility change (new column semantics) rather than a behavioral break.

#### Migration Path

No migration is required for existing workflows:
1. On deployment, OSMO will create `--_shared` queues for all existing pools
2. Existing workflows continue running in their original queues until completion
3. New submissions route to `--_shared` queues automatically

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

## Acceptance Criteria

The following scenarios define expected behavior and serve as test cases.

### AC1: Pools Without Subpools Behave Identically to Current Behavior

```
GIVEN:
  - Pool "team" with quota 100 GPUs (no subpools)

WHEN:
  - User runs: osmo workflow submit --pool team --priority HIGH job.yaml
  - Job requests 50 GPUs

THEN:
  - Job is submitted to KAI queue "osmo-pool-ns-team--_shared"
  - team--_shared has quota = 100 (entire pool quota)
  - Job is scheduled within quota
  - osmo pool list shows: team | 100 | 50 | 50 (quota/used/available)
  - User experience is identical to current behavior (no visible change)
```

### AC2: Shadow Queue Gets Full Quota When No Subpools Exist

```
GIVEN:
  - Pool "team" with quota 100 GPUs
  - No subpools defined

THEN:
  - KAI queues created:
    - osmo-pool-ns-team (parent container, quota=100)
    - osmo-pool-ns-team--_shared (leaf, quota=100)

  - Invariant: _shared.quota = pool.quota (when no children)
```

### AC3: Shadow Queue Adjusted When Subpools Added

```
GIVEN:
  - Pool "team" with quota 100 GPUs
  - No subpools (team--_shared quota = 100)

WHEN:
  - Admin runs: osmo pool subpool create team a --quota 30

THEN:
  - KAI queues updated:
    - osmo-pool-ns-team--_shared (quota: 100 → 70)
    - osmo-pool-ns-team--a (NEW, quota=30)

  - Invariant maintained: _shared.quota + sum(subpool_quotas) = pool.quota
    70 + 30 = 100 ✓
```

### AC4: Child Guarantees Protected from Parent Submissions

```
GIVEN:
  - Pool "team" (quota=100)
  - Subpools: team--a (30), team--b (40), team--c (20)
  - Shared: team--_shared (10)
  - All queues idle (0 usage)

WHEN:
  - User submits HIGH priority job requesting 15 GPUs to "team"

THEN:
  - Job routed to team--_shared queue
  - Job REJECTED by OSMO admission (requested 15 > _shared.quota 10)
  - Children's guarantees remain protected

WHEN (alternative - LOW priority):
  - User submits LOW priority job requesting 15 GPUs to "team"

THEN:
  - Job routed to team--_shared queue
  - Job scheduled: 10 in-quota + 5 over-quota (preemptible)
  - If child "a" later submits HIGH job for 30, KAI may preempt
    the over-quota portion to give child its guarantee
```

### AC5: Subpool Submission Routing

```
GIVEN:
  - Pool "team" with subpool "team--a" (quota=30)

WHEN:
  - User runs: osmo workflow submit --pool team--a job.yaml

THEN:
  - Job routed to KAI queue "osmo-pool-ns-team--a" (NOT team--_shared)
  - Job uses team--a's quota (30)
```

### AC6: Subpool Deletion Returns Quota to Shared

```
GIVEN:
  - Pool "team" (quota=100)
  - Subpools: team--a (30), team--b (40)
  - Shared: team--_shared (30)

WHEN:
  - Admin runs: osmo pool subpool delete team a
  - team--a has 0 running workflows

THEN:
  - team--a transitions to ARCHIVED immediately
  - team--_shared quota: 30 → 60
  - Invariant maintained: 60 + 40 = 100 ✓
  - KAI queue for team--a is removed
```

### AC7: Non-Preemptible Jobs Cannot Exceed Quota

```
GIVEN:
  - team--_shared (quota=10)
  - Current usage: 8 GPUs (HIGH priority)

WHEN:
  - User submits HIGH priority job requesting 5 GPUs to "team"

THEN:
  - Job stays PENDING (8 + 5 = 13 > quota 10)
  - Non-preemptible jobs cannot use over-quota

WHEN (alternative - LOW priority):
  - User submits LOW priority job requesting 5 GPUs to "team"

THEN:
  - Job scheduled: 2 in-quota + 3 over-quota (preemptible)
```

### AC8: Quota Update Synchronizes Shared Queue

```
GIVEN:
  - Pool "team" (quota=100)
  - Subpools: team--a (30), team--b (40)
  - Shared: team--_shared (30)

WHEN:
  - Admin runs: osmo pool subpool update team b --quota 50

THEN:
  - team--b quota: 40 → 50
  - team--_shared quota: 30 → 20
  - Invariant maintained: 30 + 50 + 20 = 100 ✓
```

## Implementation Plan

1. **Schema & Models**
   - Add subpool fields to `pools` (reuse table with a parent edge)
   - Update the Pool model to include subpool fields
   - Add `_shared` as reserved subpool name validation
2. **Shadow Queue Infrastructure**
   - Update `get_queue_spec()` to create parent + `--_shared` queues for ALL pools
   - Update `create_group_k8s_resources()` to route parent submissions to `--_shared`
   - Implement shadow queue quota synchronization on subpool changes
3. **Core Logic**
   - Enforce `sum(child_quotas) <= parent_quota` on create/update
   - Enforce parent admission cap: `requested_gpus <= _shared.quota` for parent HIGH/NORMAL submissions
   - Compute negative Available for parent (and subpool on shrink/delete) for display
   - Implement delete/drain behavior (`DELETING` → `ARCHIVED`)
   - Maintain invariant: `_shared.quota + sum(subpool_quotas) = parent.quota`
4. **KAI Integration**
   - Create hierarchical queues: parent container → `_shared` + subpools
   - Ensure creating subpools does not disrupt existing workloads (no migration/eviction)
   - Remove KAI queue when subpool transitions to `ARCHIVED`
5. **APIs**
   - Implement subpool write endpoints (`POST`, `PATCH`, `DELETE`) under `/pool/{parent}/subpool`
   - Subpool reads use existing pool endpoint with canonical name (`/pool/{parent}--{subpool}`)
   - Validate reserved names (reject `_shared` and names starting with `_`)
6. **CLI**
   - Add `osmo pool subpool` commands and update list output to show hierarchy + negative Available
7. **Tests & Docs**
   - E2E tests for create/update/delete and admission behavior
   - Verify acceptance criteria AC1-AC8
   - Verify backwards compatibility for pools without subpools

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
- `get_queue_spec()` creates one queue per pool (currently as leaf queues).
- `create_group_k8s_resources()` assigns the queue label to pods.

Shadow queue changes:
- **Queue creation** (`get_queue_spec()`):
  - For each pool, create a parent queue AND a `--_shared` leaf queue
  - Parent queue: `osmo-pool-{namespace}-{pool_name}` with `parentQueue: osmo-default-{namespace}`
  - Shared queue: `osmo-pool-{namespace}-{pool_name}--_shared` with `parentQueue: osmo-pool-{namespace}-{pool_name}`
  - For pools without subpools: `_shared.quota = pool.quota`
  - For pools with subpools: `_shared.quota = pool.quota - sum(subpool_quotas)`
- **Subpool queues**: Create leaf queue for each `ACTIVE` / `DELETING` subpool (exclude `ARCHIVED`)
- **Job routing** (`create_group_k8s_resources()`):
  - If `pool_name` contains `--` (is a subpool): use `osmo-pool-{namespace}-{pool_name}`
  - Else (parent pool): use `osmo-pool-{namespace}-{pool_name}--_shared`

Example queue names:
- `osmo-pool-ns-team` (parent container)
- `osmo-pool-ns-team--_shared` (shadow leaf for parent submissions)
- `osmo-pool-ns-team--a` (subpool leaf)

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
