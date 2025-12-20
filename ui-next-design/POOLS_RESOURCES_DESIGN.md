# Pools & Resources: UI Redesign

## Domain Understanding

### Hierarchy

```
Cluster
└── Pool (shared group of machines)
    ├── Status: ONLINE | OFFLINE | MAINTENANCE
    ├── Quota: limit on HIGH/NORMAL priority workflows
    ├── Platforms (hardware types within pool)
    │   └── Platform (e.g., "dgx-a100", "dgx-h100")
    │       ├── Access configs (privileged, host network, mounts)
    │       └── Resources/Nodes
    └── Resources/Nodes (individual machines)
        ├── Type: SHARED | RESERVED
        └── Capacity: CPU, Memory, Storage, GPU
```

### User Questions (in order of frequency)

1. **"Do I have capacity to run my workflow?"** → Pool quota overview
2. **"What pools am I part of?"** → Pool list with my access
3. **"What hardware is available?"** → Platforms in my pool
4. **"Why is my workflow queued?"** → Pool/node utilization
5. **"What's the config for this platform?"** → Platform details (drill down)

---

## Problems with Current UI

| Issue | Impact |
|-------|--------|
| Pools and Resources are separate pages | Forces navigation to understand relationship |
| All columns visible at once | Overwhelming; hard to find what matters |
| Used/Free toggle affects whole view | Should be contextual per-metric |
| Filter slide-out is complex | Too many options upfront |
| Gauge panels take 40% of width | Visual noise for power users |
| No status-based visual hierarchy | All pools look the same regardless of state |

---

## Proposed Design: Progressive Disclosure

### Single Page: `/pools`

Combines pools and resources with drill-down. Resources page becomes a deep-link.

### Level 1: Pool List (Default View)

With 30+ pools, cards don't scale. Use a **compact list with inline quota bars**.

```
┌─────────────────────────────────────────────────────────────────┐
│  Pools                                        Search pools... 🔍│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ⭐ YOUR DEFAULT POOL                                           │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ 🟢 research-gpu                          ████████░░ 80/100  │
│  │    4 platforms · 12 nodes                     20 available  │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  ALL POOLS (29)                                    Sort: Name ▼ │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ 🟢 ai-research                           ██████░░░░ 45/75   │
│  │    2 platforms · 8 nodes                                    │
│  ├─────────────────────────────────────────────────────────────┤
│  │ 🟢 batch-processing                      ███░░░░░░░ 30/100  │
│  │    1 platform · 20 nodes                                    │
│  ├─────────────────────────────────────────────────────────────┤
│  │ 🟢 inference-prod                        █████████░ 90/100  │
│  │    2 platforms · 16 nodes                                   │
│  ├─────────────────────────────────────────────────────────────┤
│  │ 🟡 training-large         MAINTENANCE    ░░░░░░░░░░ —       │
│  │    4 platforms · 32 nodes                                   │
│  ├─────────────────────────────────────────────────────────────┤
│  │ 🔴 dev-sandbox            OFFLINE        ░░░░░░░░░░ —       │
│  │    1 platform · 2 nodes                                     │
│  ├─────────────────────────────────────────────────────────────┤
│  │ ...                                                         │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Design for scale:**

| Feature | Why |
|---------|-----|
| **Default pool pinned** | User's primary pool always visible at top |
| **Compact rows** | ~50px height = 12+ pools visible without scroll |
| **Search prominent** | Type to filter instantly |
| **Inline quota bar** | No click needed to see capacity |
| **Status + name on same line** | Scannable at a glance |
| **OFFLINE/MAINTENANCE dimmed** | Visual hierarchy by availability |
| **Sort dropdown** | Name, Status, Availability |

**Interactions:**
- Click row → Pool detail (Level 2)
- Hover row → subtle highlight, star icon to set as default
- Search → instant filter by name

### Level 2: Pool Detail (Click a row)

URL: `/pools/research-gpu`

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Pools / research-gpu                               🟢 ONLINE │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ GPU Quota                                                   │
│  │ ████████████████████░░░░░  80 / 100 GPUs                    │
│  │ 20 available for HIGH/NORMAL priority                       │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
│  Platforms                                              View all │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐      │
│  │ dgx-a100       │ │ dgx-h100       │ │ cpu-only       │      │
│  │ 8 nodes        │ │ 4 nodes        │ │ 2 nodes        │      │
│  │ 64 GPUs        │ │ 32 GPUs        │ │ 0 GPUs         │      │
│  └────────────────┘ └────────────────┘ └────────────────┘      │
│                                                                 │
│  Nodes                                          Search... [⌘K]  │
│  ┌─────────────────────────────────────────────────────────────┐
│  │ Node          Platform     GPU          CPU        Memory   │
│  ├─────────────────────────────────────────────────────────────┤
│  │ node-001      dgx-a100     6/8          12/64      48/512   │
│  │ node-002      dgx-a100     8/8 (full)   32/64      128/512  │
│  │ node-003      dgx-h100     0/8          4/128      32/1024  │
│  │ ...                                                         │
│  └─────────────────────────────────────────────────────────────┘
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key decisions:**
- Breadcrumb navigation (back to pools)
- Quota bar is prominent with availability message
- Platforms shown as chips (quick overview)
- Node table is compact; click row to expand
- Search nodes inline (no separate filter panel)

### Level 3: Node Detail (Click a row or `/resources/node-001`)

Slide-over panel (not new page):

```
┌─────────────────────────────────────────┐
│  node-001                          ✕    │
│  dgx-a100 · research-gpu                │
├─────────────────────────────────────────┤
│                                         │
│  Resource Capacity                      │
│  ┌─────────────────────────────────────┐
│  │ GPU      ████████░░  6/8            │
│  │ CPU      ██░░░░░░░░  12/64          │
│  │ Memory   █░░░░░░░░░  48/512 Gi      │
│  │ Storage  ████░░░░░░  400/1000 Gi    │
│  └─────────────────────────────────────┘
│                                         │
│  Configuration                          │
│  ┌─────────────────────────────────────┐
│  │ Privileged Mode    ✓ Allowed        │
│  │ Host Network       ✗ Not allowed    │
│  └─────────────────────────────────────┘
│                                         │
│  Default Mounts                         │
│  • /mnt/shared → /shared                │
│  • /mnt/datasets → /data                │
│                                         │
│  Allowed Mounts                         │
│  • /scratch → /scratch                  │
│                                         │
│  ──────────────────────────────────────│
│  Active Workflows on this Node    (3)  │
│  • workflow-abc123  running  2h ago    │
│  • workflow-def456  running  45m ago   │
│  • workflow-ghi789  queued             │
│                                         │
└─────────────────────────────────────────┘
```

---

## Removed Complexity

| Old Feature | Decision | Rationale |
|-------------|----------|-----------|
| Used/Free toggle | **Removed** | Show used/total (e.g., "6/8") - both in one |
| Gauges panel | **Removed** | Progress bars inline are clearer |
| Filter slide-out | **Simplified** | Just search + platform dropdown |
| Separate Resources page | **Merged** | Resources are always in context of pool |
| AggregatePanels | **Removed** | Pool card shows summary; no aggregates needed |

---

## URL Structure

```
/pools                      → Pool cards (Level 1)
/pools/:poolName            → Pool detail with nodes (Level 2)
/pools/:poolName/:nodeName  → Node detail panel (Level 3)

# Deep link for node (redirects to pool context)
/resources/:nodeName        → Redirects to /pools/:pool/:nodeName
```

---

## Data Flow

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│ Pool Cards  │ ──► │ Pool Detail      │ ──► │ Node Panel  │
│             │     │                  │     │             │
│ GET /pool   │     │ GET /pool_quota  │     │ GET         │
│ _quota      │     │ GET /resources   │     │ /resources/ │
│             │     │   ?pool=X        │     │   {node}    │
└─────────────┘     └──────────────────┘     └─────────────┘
```

---

## Component Structure

```
src/app/(dashboard)/pools/
├── page.tsx                    # Pool list (Level 1)
├── [poolName]/
│   ├── page.tsx                # Pool detail with node table (Level 2)
│   └── components/
│       ├── pool-header.tsx     # Breadcrumb + status badge
│       ├── quota-bar.tsx       # GPU quota visualization
│       ├── platform-chips.tsx  # Platform quick view
│       └── node-table.tsx      # Sortable, searchable node list
└── components/
    ├── pool-row.tsx            # Individual pool row with quota bar
    ├── pool-search.tsx         # Search input with keyboard shortcut
    └── node-panel.tsx          # Slide-over node detail (Level 3)
```

---

## Next Steps

1. **Build Pool Cards page** - start with the grid layout
2. **Build Pool Detail page** - quota bar + node table
3. **Build Node Panel** - slide-over with capacity bars
4. **Wire to API** - use existing endpoints
5. **Add search/filter** - simple inline approach
