# Workflows Implementation Plan

## Design Decisions Summary

Based on our exploration, we've decided on:

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Navigation Pattern** | Progressive Drill-Down with Breadcrumb | Industry standard, familiar to users |
| **List View** | Flat table (like pools/resources) | Consistent with existing patterns |
| **Detail View** | DAG-primary with table toggle | Best for understanding workflow structure |
| **Breadcrumb Enhancement** | Page-level component (later) | Quick win, no shell changes initially |
| **Panel Pattern** | Bottom/right slide panel | Reuse existing DetailsPanel from DAG |

---

## Pages Overview

```
/workflows                    → Workflow List Page
/workflows/[name]             → Workflow Detail Page (DAG + Panel)
/tasks                        → Global Tasks Page (future)
```

---

## Milestone 1: Workflow List Page

**Goal**: Users can see, search, and filter all their workflows.

### Route: `/workflows`

### Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  WORKFLOWS                                                       │
├─────────────────────────────────────────────────────────────────┤
│  🔍 [status:RUNNING ×] [pool:ml-team ×] + Add filter...         │
├─────────────────────────────────────────────────────────────────┤
│  Name ↓            │ Status    │ User   │ Duration │ Pool      │
│  ───────────────────────────────────────────────────────────────│
│  train-model-abc   │ ● RUNNING │ alice  │ 2h 15m   │ ml-team   │
│  preprocess-def    │ ✗ FAILED  │ bob    │ 12m      │ ml-team   │
│  data-pipeline     │ ✓ DONE    │ alice  │ 45m      │ data      │
│  inference-batch   │ ○ PENDING │ carol  │ -        │ inference │
│  ...               │           │        │          │           │
└─────────────────────────────────────────────────────────────────┘
```

### Components to Build

| Component | Description | Reuse From |
|-----------|-------------|------------|
| `page.tsx` | Main page component | Pools pattern |
| `workflows-toolbar.tsx` | SmartSearch + actions | Pools toolbar |
| `workflows-data-table.tsx` | Virtualized table | DataTable component |
| `workflow-column-defs.tsx` | TanStack column definitions | Pools columns |

### Files to Create

```
/workflows/
├── page.tsx                              # Main page
├── components/
│   ├── workflows-toolbar.tsx             # SmartSearch toolbar
│   └── table/
│       ├── workflows-data-table.tsx      # Table wrapper
│       └── workflow-column-defs.tsx      # Column definitions
├── lib/
│   ├── workflow-columns.ts               # Column config
│   └── workflow-search-fields.ts         # SmartSearch fields
├── hooks/
│   └── use-workflows-data.ts             # API + filtering
└── stores/
    └── workflows-table-store.ts          # Zustand persistence
```

### API Integration

**Endpoint**: `GET /api/workflow`

**Parameters to support**:
- `offset`, `limit` - Pagination
- `statuses` - Multi-select status filter
- `pools` - Pool filter
- `users` - User filter
- `priority` - Priority filter
- `tags` - Tag filter
- `submitted_after`, `submitted_before` - Date range
- `name` - Name search
- `order` - Sort order

### Columns

| Column | Field | Sortable | Width | Cell Type |
|--------|-------|----------|-------|-----------|
| Name | `name` | ✓ | flex | Link (monospace) |
| Status | `status` | ✓ | 100px | StatusBadge |
| User | `user` | ✓ | 120px | Text |
| Submitted | `submit_time` | ✓ | 110px | RelativeTime |
| Duration | `duration` | ✓ | 90px | Duration/Timer |
| Queue Time | `queued_time` | ✓ | 90px | Duration (optional) |
| Pool | `pool` | ✓ | 100px | Text |
| Priority | `priority` | ✓ | 80px | Badge |
| App | `app_name` | ✗ | 120px | Text (optional) |

### SmartSearch Fields

| Field | Syntax | Autocomplete |
|-------|--------|--------------|
| `status` | `status:RUNNING` | WorkflowStatus enum |
| `pool` | `pool:ml-team` | Available pools |
| `user` | `user:alice` | Known users |
| `priority` | `priority:HIGH` | HIGH, NORMAL, LOW |
| `tag` | `tag:training` | Workflow tags |
| Free text | any text | Workflow names |

### Acceptance Criteria

- [ ] Table displays workflows with all columns
- [ ] Clicking row navigates to `/workflows/[name]`
- [ ] SmartSearch filters work (status, pool, user)
- [ ] URL syncs with filters (shareable links)
- [ ] Sorting works on sortable columns
- [ ] Infinite scroll pagination
- [ ] Status badge colors match DAG constants

---

## Milestone 2: Workflow Detail Page (Basic)

**Goal**: Users can view workflow structure (DAG) and drill into groups/tasks.

### Route: `/workflows/[name]`

### Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Workflows   train-model-abc   ● RUNNING   [Cancel] [Logs]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│            ┌─────────┐      ┌─────────┐      ┌─────────┐       │
│            │  fetch  │─────▶│  train  │─────▶│ export  │       │
│            │   ✓ 3   │      │  ● 5/8  │      │  ○ 0/2  │       │
│            └─────────┘      └─────────┘      └─────────┘       │
│                               ↑ click                           │
├─────────────────────────────────────────────────────────────────┤
│  Group: train (8 tasks)                              [×] Close │
│  ─────────────────────────────────────────────────────────────  │
│  Task        │ Status    │ Duration │ Node        │ Exit Code  │
│  train-0     │ ✓ DONE    │ 45m      │ dgx-a100-1  │ 0          │
│  train-1     │ ● RUNNING │ 32m      │ dgx-a100-2  │ -          │
│  train-2     │ ○ WAITING │ -        │ -           │ -          │
└─────────────────────────────────────────────────────────────────┘
```

### Components to Build

| Component | Description | Reuse From |
|-----------|-------------|------------|
| `page.tsx` | Detail page | New |
| `workflow-header.tsx` | Name, status, actions | New |
| `workflow-dag.tsx` | DAG visualization | reactflow-dag |
| (panel) | Group/Task details | DetailsPanel from reactflow-dag |

### Files to Create

```
/workflows/[name]/
├── page.tsx                              # Detail page
├── components/
│   ├── workflow-header.tsx               # Header with actions
│   └── workflow-dag.tsx                  # DAG wrapper
└── hooks/
    └── use-workflow-detail.ts            # Fetch single workflow
```

### Reused from reactflow-dag

```
/dev/workflow-explorer/reactflow-dag/
├── components/
│   ├── GroupNode.tsx                     # ✓ Reuse
│   ├── DetailsPanel/                     # ✓ Reuse entirely
│   │   ├── DetailsPanel.tsx
│   │   ├── GroupDetails.tsx
│   │   └── TaskDetails.tsx
│   └── GroupPanel/                       # ✓ Reuse
│       ├── SmartSearch.tsx
│       └── TaskTable.tsx
├── hooks/
│   ├── use-dag-state.ts                  # ✓ Reuse
│   └── use-resizable-panel.ts            # ✓ Reuse
├── layout/
│   └── elk-layout.ts                     # ✓ Reuse
├── utils/
│   └── status.ts                         # ✓ Reuse
└── constants.ts                          # ✓ Reuse (status styles)
```

### API Integration

**Endpoint**: `GET /api/workflow/{name}?verbose=true`

Returns full workflow with groups and tasks.

### Header Actions

| Action | Behavior |
|--------|----------|
| Back (←) | Navigate to `/workflows` |
| Cancel | `POST /api/workflow/{name}/cancel` |
| Logs | Open workflow logs (new tab or modal) |
| (future) Retry | Re-submit failed workflow |

### Acceptance Criteria

- [ ] Header shows workflow name, status, duration
- [ ] DAG renders correctly with all groups
- [ ] Clicking group opens DetailsPanel
- [ ] Clicking task in panel shows TaskDetails
- [ ] Cancel action works (with confirmation)
- [ ] Logs link opens workflow logs

---

## Milestone 3: Table View Toggle

**Goal**: Users can switch between DAG and table view for bulk task inspection.

### Wireframe (Table View)

```
┌─────────────────────────────────────────────────────────────────┐
│  ← Workflows   train-model-abc   ● RUNNING      [DAG │ TABLE] │
├─────────────────────────────────────────────────────────────────┤
│  🔍 Search tasks...                                             │
├─────────────────────────────────────────────────────────────────┤
│  ▼ fetch (3 tasks)                               ✓ COMPLETED   │
│  ─────────────────────────────────────────────────────────────  │
│    fetch-0       │ ✓ DONE    │ 5m   │ dgx-a100-1               │
│    fetch-1       │ ✓ DONE    │ 5m   │ dgx-a100-2               │
│    fetch-2       │ ✓ DONE    │ 5m   │ dgx-a100-3               │
├─────────────────────────────────────────────────────────────────┤
│  ▼ train (8 tasks)                               ● RUNNING     │
│  ─────────────────────────────────────────────────────────────  │
│    train-0       │ ✓ DONE    │ 45m  │ dgx-a100-1               │
│    train-1       │ ● RUNNING │ 32m  │ dgx-a100-2               │
│    train-2       │ ○ WAITING │ -    │ -                        │
│    ...                                                          │
├─────────────────────────────────────────────────────────────────┤
│  ▶ export (2 tasks)                              ○ WAITING     │
└─────────────────────────────────────────────────────────────────┘
```

### Components to Build

| Component | Description |
|-----------|-------------|
| `view-toggle.tsx` | DAG / Table toggle button |
| `workflow-table-view.tsx` | Collapsible grouped table |
| `group-row.tsx` | Expandable group header |
| `task-row.tsx` | Task row within group |

### Files to Create

```
/workflows/[name]/
├── components/
│   ├── view-toggle.tsx
│   └── table-view/
│       ├── workflow-table-view.tsx
│       ├── group-row.tsx
│       └── task-row.tsx
```

### Acceptance Criteria

- [ ] Toggle button switches between DAG and Table
- [ ] Table shows all groups with task counts
- [ ] Groups are collapsible
- [ ] Clicking task opens same DetailsPanel as DAG
- [ ] Search filters tasks across all groups
- [ ] URL param preserves view choice (`?view=table`)

---

## Milestone 4: Enhanced Breadcrumb Navigation

**Goal**: Users can quickly switch between workflows/groups/tasks from breadcrumb.

### Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  ← train-model-abc ▼  ›  train (8) ▼  ›  train-1               │
│         │                    │              └── current task    │
│         │                    └── group switcher dropdown        │
│         └── workflow switcher dropdown                          │
├─────────────────────────────────────────────────────────────────┤
│  Task: train-1                                                  │
│  ...                                                            │
└─────────────────────────────────────────────────────────────────┘
```

### Components to Build

| Component | Description |
|-----------|-------------|
| `workflow-breadcrumb.tsx` | Enhanced breadcrumb with dropdowns |
| `workflow-switcher.tsx` | Dropdown to switch workflows |
| `group-switcher.tsx` | Dropdown to switch groups |
| `task-switcher.tsx` | Dropdown to switch tasks |

### Files to Create

```
/workflows/[name]/
├── components/
│   ├── breadcrumb/
│   │   ├── workflow-breadcrumb.tsx
│   │   ├── workflow-switcher.tsx
│   │   ├── group-switcher.tsx
│   │   └── task-switcher.tsx
```

### Acceptance Criteria

- [ ] Breadcrumb shows: workflow › group › task
- [ ] Clicking dropdown shows sibling items
- [ ] Recent items shown in workflow switcher
- [ ] Search within large lists
- [ ] Status indicators in dropdowns

---

## Milestone 5: Global Tasks Page (Future)

**Goal**: Users can search tasks across all workflows.

### Route: `/tasks`

### Wireframe

```
┌─────────────────────────────────────────────────────────────────┐
│  TASKS                                                          │
├─────────────────────────────────────────────────────────────────┤
│  🔍 [status:RUNNING ×] [node:dgx-a100* ×] + Add filter...      │
├─────────────────────────────────────────────────────────────────┤
│  Task Name     │ Workflow      │ Status  │ Duration │ Node     │
│  ───────────────────────────────────────────────────────────────│
│  train-0       │ train-abc     │ ● RUN   │ 45m      │ dgx-a100 │
│  train-1       │ train-abc     │ ● RUN   │ 32m      │ dgx-a100 │
│  inference-0   │ infer-xyz     │ ● RUN   │ 1h       │ dgx-h100 │
│  ...           │               │         │          │          │
└─────────────────────────────────────────────────────────────────┘
```

### API Integration

**Endpoint**: `GET /api/task`

Supports cross-workflow filtering by status, node, pool, user.

### Acceptance Criteria

- [ ] Table displays tasks from all workflows
- [ ] Clicking workflow column navigates to workflow detail
- [ ] Filter by node, status, pool
- [ ] Sort by duration, start time

---

## Milestone 6: Real-Time & Polish

**Goal**: Live updates and production-ready polish.

### Features

| Feature | Description |
|---------|-------------|
| **Polling** | Auto-refresh running workflows (5s/30s/manual toggle) |
| **Live duration** | Running task timers update in real-time |
| **Batch cancel** | Select multiple workflows, cancel all |
| **Saved filters** | Save filter combinations |
| **Keyboard nav** | Arrow keys, Enter to open |

### Acceptance Criteria

- [ ] Running workflows auto-update
- [ ] Duration timer counts up for running tasks
- [ ] Select + Cancel multiple workflows
- [ ] Filter presets can be saved

---

## Shared Components to Build

| Component | Location | Used By |
|-----------|----------|---------|
| `StatusBadge` | `@/components/status-badge.tsx` | List, Detail, Tasks |
| `DurationTimer` | `@/components/duration-timer.tsx` | List, Detail, Tasks |
| `RelativeTime` | `@/components/relative-time.tsx` | List, Tasks |
| `PriorityBadge` | `@/components/priority-badge.tsx` | List |

---

## Dependencies

### Must Complete First

- [x] Existing DataTable component (complete)
- [x] Existing reactflow-dag components (complete)
- [x] Mock data generators (complete)

### Can Build in Parallel

- Milestone 1 (List) and Milestone 2 (Detail) can start simultaneously
- Milestone 3 (Table Toggle) requires Milestone 2
- Milestone 4 (Breadcrumb) can start after Milestone 2
- Milestone 5 (Tasks) is independent

---

## Implementation Order

```
Week 1-2: Milestone 1 (Workflow List)
          ├── Column definitions
          ├── Data hook
          ├── SmartSearch integration
          └── Basic table

Week 2-3: Milestone 2 (Workflow Detail - Basic)
          ├── Header component
          ├── DAG integration
          ├── Panel wiring
          └── Navigation

Week 3-4: Milestone 3 (Table View Toggle)
          ├── Toggle button
          ├── Collapsible groups
          └── Task rows

Week 4-5: Milestone 4 (Enhanced Breadcrumb)
          ├── Breadcrumb component
          ├── Switcher dropdowns
          └── Search integration

Week 5-6: Milestone 5 (Global Tasks - if needed)

Week 6+:  Milestone 6 (Polish)
          ├── Polling
          ├── Batch operations
          └── Keyboard navigation
```

---

## Open Questions

1. **Side panel on list page?**
   - Option A: No panel, just navigate to detail page
   - Option B: Panel like pools for quick preview
   - **Proposed**: Option A (simpler, can add panel later)

2. **Default list view?**
   - Option A: All workflows (my + others)
   - Option B: My workflows only, toggle to see all
   - **Proposed**: Option B (most users care about their own)

3. **Table view as default?**
   - For very large workflows, table might be better default
   - **Proposed**: DAG default, remember user preference

4. **Polling interval?**
   - 5s is aggressive, 30s might miss updates
   - **Proposed**: User-selectable (5s / 30s / manual)

---

## Next Steps

1. **Review this plan** - Confirm milestones and scope
2. **Finalize open questions** - Make decisions
3. **Start Milestone 1** - Workflow list page
4. **Parallel: Move DAG components** - Prepare for reuse

Ready to confirm and begin implementation?
