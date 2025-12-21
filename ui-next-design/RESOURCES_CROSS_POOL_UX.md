# Resources: Cross-Pool User Experience Design

> **Status**: Discovery & Ideation
> **Last Updated**: December 2025
> **Terminology**: We use "Resource" to align with OSMO documentation and CLI (`osmo resource`).

---

## The Problem

Today, resources are only accessible through pools:

```
Pools → Pool Detail → Resources Table → Resource Panel
```

But this creates friction for several user needs:

1. **"Where is resource X?"** — I know a resource name but have to guess which pool to check
2. **"Find me 4 free H100s"** — I need to search across all pools to find available capacity
3. **"What's running on this resource?"** — I see a resource but don't know what's using it
4. **"Show me all unhealthy resources"** — No system-wide view of resource health
5. **"This resource spans multiple pools"** — SHARED resources appear in multiple pools; which pool context matters?

---

## User Stories

### Story 1: Infrastructure Engineer Investigating an Issue

> "One of our H100 resources is reporting high temperature. I need to find it, see what's running on it, and possibly drain it."

**Current flow:** 
- Guess which pool → scroll through resources → find it → no visibility into running tasks
- Try another pool if wrong

**Ideal flow:**
- Search "resource-h100-42" → see resource details → view running tasks → take action

### Story 2: ML Engineer Looking for Capacity

> "I need 8 GPUs for a training job. Where should I submit my workflow?"

**Current flow:**
- Click through each pool → check quota → check resource availability → repeat

**Ideal flow:**
- Global search/filter for "8 GPUs free" → see ranked list of options → submit to best pool

### Story 3: Platform Admin Monitoring Fleet Health

> "I want to see if any resources are degraded or have issues across our entire infrastructure."

**Current flow:**
- Not possible. Must check each pool individually.

**Ideal flow:**
- Fleet dashboard showing resource conditions → filter by issues → take action

### Story 4: User Debugging a Failed Workflow

> "My workflow failed on resource X. I want to see what happened and if the resource is healthy."

**Current flow:**
- Copy resource name from workflow → go to pools → guess which pool → find resource

**Ideal flow:**
- Click resource name in workflow → resource detail page opens with full context

### Story 5: Understanding Resource Utilization

> "What's our GPU utilization across the fleet? Are we over or under provisioned?"

**Current flow:**
- Not possible to aggregate.

**Ideal flow:**
- Fleet overview with utilization metrics → drill into low-utilized or saturated resources

---

## Design Principles

1. **Resources are first-class citizens** — Not just children of pools
2. **Cross-cutting queries** — Search/filter across all pools
3. **Context preservation** — When coming from a pool, maintain that context
4. **Progressive disclosure** — Start simple, reveal complexity on demand
5. **Linkability** — Every resource should have a URL you can share

---

## UX Options to Explore

### Option A: Global Resource Search (Command Palette)

**Concept:** Don't add a resources page. Instead, make resources searchable via Cmd+K.

```
┌─────────────────────────────────────────────────────────┐
│ ⌘K  Search resources, pools, workflows...               │
├─────────────────────────────────────────────────────────┤
│ Resources matching "h100"                               │
│   ┌──────────────────────────────────────────────────┐  │
│   │ 🖥️ resource-h100-001    8 GPUs free  │ prod-gpu │  │
│   │ 🖥️ resource-h100-002    4 GPUs free  │ prod-gpu │  │
│   │ 🖥️ resource-h100-003    0 GPUs free  │ staging  │  │
│   └──────────────────────────────────────────────────┘  │
│                                                         │
│ Recent                                                  │
│   📋 Workflow: training-job-123                         │
│   📊 Pool: prod-gpu-cluster                             │
└─────────────────────────────────────────────────────────┘
```

**Pros:**
- Minimal UI additions
- Follows modern patterns (Linear, Vercel, VS Code)
- Works from anywhere

**Cons:**
- No persistent view of all resources
- Can't do complex filtering
- Not discoverable for new users

**Best for:** Quick navigation, power users

---

### Option B: Dedicated Resources Page (Fleet View)

**Concept:** Add a top-level "Resources" page showing all resources across pools.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Resources                                                Fleet Overview │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │  🟢 142 Healthy    🟡 3 Degraded    🔴 1 Unhealthy    ⚪ 8 Unused   │ │
│ │  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │ │
│ │  GPU: 340/512 (66%)    CPU: 2840/4096 cores    Memory: 12/20 TB    │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌────────────────────────────────────────────────────────────────────┐  │
│ │ 🔍 Search...  │ Pool ▾ │ Platform ▾ │ GPU ≥ ▾ │ Health ▾ │         │  │
│ └────────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│ ┌───────────────────────────────────────────────────────────────────────┐
│ │ Resource           │ Pools        │ Platform │ GPU    │ CPU │ Health│
│ ├───────────────────────────────────────────────────────────────────────┤
│ │ resource-h100-001  │ prod, dev    │ x86-h100 │ 8/8    │ 96  │  🟢   │
│ │ resource-h100-002  │ prod         │ x86-h100 │ 4/8    │ 96  │  🟢   │
│ │ resource-a100-001  │ staging      │ x86-a100 │ 0/4    │ 64  │  🟡   │
│ └───────────────────────────────────────────────────────────────────────┘
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Complete fleet visibility
- Rich filtering (find resources with X GPUs free, specific platform, etc.)
- Natural home for fleet health monitoring
- Supports complex queries

**Cons:**
- New navigation item
- Potentially overwhelming for small deployments
- Need to decide: does clicking a resource go to a new page or panel?

**Best for:** Platform admins, large deployments, resource planning

---

### Option C: Resources Tab Within Pools (Contextual Crossover)

**Concept:** Keep resources under pools, but add cross-pool awareness.

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Pools / prod-gpu-cluster                                    🟢 Active │
├─────────────────────────────────────────────────────────────────────────┤
│ ┌──────────┐ ┌──────────┐ ┌──────────┐                                  │
│ │ Overview │ │Resources │ │   Jobs   │                                  │
│ └──────────┘ └────✓─────┘ └──────────┘                                  │
│                                                                         │
│ Resources in prod-gpu-cluster                                           │
│ ┌───────────────────────────────────────────────────────────────────────┐
│ │ Resource           │ Also in      │ Platform │ GPU    │ Running      │
│ ├───────────────────────────────────────────────────────────────────────┤
│ │ resource-h100-001  │ +1 pool      │ x86-h100 │ 8/8    │ 2 tasks      │
│ │ resource-h100-002  │ —            │ x86-h100 │ 4/8    │ 1 task       │
│ └───────────────────────────────────────────────────────────────────────┘
│                                                                         │
│ 💡 This resource is shared with: dev-gpu-cluster                        │
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Evolutionary (builds on existing)
- Context-aware
- Shows cross-pool relationships in context

**Cons:**
- Still requires knowing which pool to start from
- No fleet-wide view
- Can't answer "find me any resource with X"

**Best for:** Understanding resource sharing between pools

---

### Option D: Resource Detail Page (Entity-First)

**Concept:** Resources get their own URL and detail page (like `/resources/resource-h100-001`).

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ← Resources / resource-h100-001                                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│ resource-h100-001                                      🟢 Healthy       │
│ x86-h100 · Backend: kubernetes-prod                                     │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Pool Memberships                                                    │ │
│ │ ┌───────────┐  ┌────────────┐  ┌────────────┐                       │ │
│ │ │ prod-gpu  │  │ dev-gpu    │  │ staging    │                       │ │
│ │ │ x86-h100  │  │ x86-h100   │  │ x86-h100   │                       │ │
│ │ └───────────┘  └────────────┘  └────────────┘                       │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Capacity                                                            │ │
│ │ GPU     ████████████████░░░░  6/8 used (75%)                        │ │
│ │ CPU     ██████░░░░░░░░░░░░░░  32/96 cores                           │ │
│ │ Memory  ████░░░░░░░░░░░░░░░░  128/512 Gi                            │ │
│ │ Storage ██░░░░░░░░░░░░░░░░░░  200/2000 Gi                           │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Running Tasks (3)                                           View All│ │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │
│ │ │ 🔵 training-job-123/train    4 GPU  │  user-a │ 2h 15m running │ │ │
│ │ │ 🔵 eval-456/inference        2 GPU  │  user-b │ 45m running    │ │ │
│ │ │ 🟢 preprocess-789/setup      0 GPU  │  user-a │ 5m running     │ │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Recent Activity                                                     │ │
│ │ • Task preprocess-789/setup started                        5m ago   │ │
│ │ • Task completed-job/train completed                      12m ago   │ │
│ │ • Resource health check passed                             1h ago   │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
│                                                                         │
│ ┌─────────────────────────────────────────────────────────────────────┐ │
│ │ Configuration                                                       │ │
│ │ Host Network: ✅ Allowed    Privileged: ❌ Not allowed              │ │
│ │ Default Mounts: /scratch, /datasets                                 │ │
│ └─────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

**Pros:**
- Complete resource information in one place
- Shareable URL
- Shows running tasks (answers "what's using this resource?")
- Natural entry point from search results, workflow failures, etc.
- Can link from anywhere (pool detail, workflow task, search)

**Cons:**
- Need to consider how this relates to pool-scoped resource panel
- More pages to maintain

**Best for:** Investigation, debugging, understanding a specific resource

---

## Recommended Approach: Layered Architecture

Combine multiple options for different needs:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           NAVIGATION                                    │
│                                                                         │
│   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐                │
│   │  Home   │   │ Pools   │   │Resources│   │Workflows│                │
│   └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘                │
│        │             │             │             │                      │
│        │             │             │             │                      │
│        ▼             ▼             ▼             ▼                      │
│   Dashboard      Pool List    Resource Fleet Workflow List              │
│   (summary)      (by pool)    (cross-pool)  (by status)                 │
│                      │             │                                    │
│                      ▼             ▼                                    │
│                  Pool Detail   Resource Detail                          │
│                  (w/resources) (full page)                              │
│                      │             ▲                                    │
│                      │             │                                    │
│                      └─────────────┘                                    │
│                    (links between)                                      │
│                                                                         │
│   ╔═══════════════════════════════════════════════════════════════════╗ │
│   ║  ⌘K  Global Search - find anything from anywhere                  ║ │
│   ╚═══════════════════════════════════════════════════════════════════╝ │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Quick Access (Command Palette)

- **Cmd+K** opens global search
- Search resources by name, hostname, platform
- Quick navigation to any resource
- Available from anywhere

### Layer 2: Fleet View (Resources Page)

- Top-level navigation item: "Resources"
- Shows all resources across all pools
- Rich filtering: by pool, platform, GPU availability, health status
- Fleet-wide metrics at the top
- Click resource → Resource Detail Page

### Layer 3: Pool Context (Enhanced Pool Detail)

- Existing pool detail page
- Resources table with "Also in" column showing other pools
- Click resource → Resource Detail Page (with pool context in URL/breadcrumb)
- Add quick links to tasks running on this resource

### Layer 4: Resource Detail Page (Deep Dive)

- Full-page resource information
- URL: `/resources/{resourceName}` or `/resources/{resourceName}?context=pool-name`
- Shows: all pool memberships, capacity, running tasks, history, config
- Actions: drain, view logs, etc. (future)

---

## Information Design

### What Information Does Each View Need?

| View | Primary Info | Secondary Info | Actions |
|------|--------------|----------------|---------|
| **Search Results** | Resource name, pool(s), GPU free | Platform | Navigate |
| **Fleet View** | Resource, pools, platform, capacity, health | Backend | Filter, sort, bulk select |
| **Pool Resource Table** | Resource, platform, capacity | Other pools | Click to detail |
| **Resource Detail** | Everything | History, tasks | Drain, investigate |

### Resource Health Semantics

| Status | Meaning | Visual |
|--------|---------|--------|
| **Healthy** | All conditions passing | 🟢 Green dot |
| **Degraded** | Some conditions failing, still schedulable | 🟡 Yellow dot |
| **Unhealthy** | Critical conditions failing, not schedulable | 🔴 Red dot |
| **Unused** | No pool membership, or UNUSED resource type | ⚪ Gray dot |

---

## Filtering & Search Capabilities

### Global Resource Search (Cmd+K)

```
Query Types:
├── By name:       "resource-h100-001"
├── By prefix:     "resource-h100-*"
├── By platform:   "platform:x86-h100"
├── By pool:       "pool:prod-gpu"
└── Combined:      "pool:prod platform:h100"
```

### Fleet View Filters

| Filter | Type | Example Values |
|--------|------|----------------|
| Pool | Multi-select | prod-gpu, dev-gpu, staging |
| Platform | Multi-select | x86-h100, x86-a100, arm-cpu |
| GPU Available | Range/Min | ≥ 4 GPUs free |
| Health | Single-select | Healthy, Degraded, Unhealthy, All |
| Resource Type | Single-select | SHARED, RESERVED, UNUSED |

### Advanced Query Ideas (Future)

```
"Find resources that can run my workflow"
→ Input: workflow spec (or requirements)
→ Output: resources matching requirements, sorted by availability
```

---

## URL Structure

```
/resources                          # Fleet view (all resources)
/resources?pool=prod-gpu            # Fleet view filtered to pool
/resources?platform=x86-h100        # Fleet view filtered to platform
/resources?health=degraded          # Fleet view filtered to health

/resources/{resourceName}           # Resource detail page
/resources/{resourceName}?from=pool # Resource detail with breadcrumb context

/pools/{poolName}                   # Pool detail (existing)
/pools/{poolName}/resources         # Could redirect to /resources?pool={poolName}
```

---

## API Requirements

### Current Capabilities

| Need | Endpoint | Status |
|------|----------|--------|
| List resources in a pool | `GET /api/resources?pools=X` | ✅ Works |
| List all resources | `GET /api/resources` (no pool filter) | ⚠️ Need to verify |
| Resource detail | Multiple queries needed | ⚠️ Workaround exists |
| Tasks on a resource | `GET /api/tasks?node=X` | ⚠️ Need to verify |

### Ideal API Additions

1. **`GET /api/resources`** — Works without pool filter for fleet view
2. **`GET /api/resources/{resourceName}`** — Single-resource endpoint with full details
3. **`GET /api/tasks?resource={resourceName}`** — Tasks running on a specific resource
4. **Resource health aggregation** — Condition summarization

---

## Phased Implementation

### Phase 1: Foundation
- [ ] Verify API capabilities for cross-pool queries
- [ ] Add Cmd+K with resource search
- [ ] Resource detail page (basic)

### Phase 2: Fleet View
- [ ] Resources page with table
- [ ] Filtering by pool, platform
- [ ] Fleet metrics header

### Phase 3: Deep Integration
- [ ] Running tasks on resource detail
- [ ] Link from workflow task to resource
- [ ] Health status aggregation

### Phase 4: Power Features
- [ ] Advanced capacity filtering (≥ N GPUs)
- [ ] Resource comparison view
- [ ] Activity timeline
- [ ] Admin actions (drain, maintenance mode)

---

## Open Questions

1. **Should we show capacity utilization differently per pool?**
   - A SHARED resource's capacity is... shared. Do we show the same GPU usage in each pool, or is it context-dependent?

2. **How do we handle resources with conditions?**
   - Need to understand what conditions mean and how to surface them usefully

3. **What admin actions should be exposed?**
   - Drain resource? Set maintenance mode? These may require backend support

4. **How does this relate to tasks?**
   - Task list can filter by resource: `GET /api/tasks?node=X`
   - Should resource detail embed task list or link to filtered task view?

---

## Inspiration & References

| Product | What They Do Well |
|---------|-------------------|
| **Kubernetes Dashboard** | Resource detail page with conditions, events, running pods |
| **Datadog Infrastructure** | Fleet view with grouping, filtering, aggregation |
| **AWS EC2 Console** | Instance search, filtering, bulk actions |
| **Grafana** | Dense data, good for monitoring utilization |
| **Vercel** | Clean detail pages with activity timeline |

---

## Next Steps

1. **Validate API capabilities** — Can we query resources across pools? What's the task-to-resource relationship?
2. **User research** — Interview users about their resource-related pain points
3. **Prototype fleet view** — Start with a simple resources list page
4. **Prototype Cmd+K** — Add resource search to command palette
5. **Iterate** — Test with real users, refine based on feedback

---

## Related Documents

- [Information Architecture](./INFORMATION_ARCHITECTURE.md)
- [Redesign Plan](./REDESIGN_PLAN.md)
- [Resources Interaction Flows](./RESOURCES_INTERACTION_FLOWS.md)
