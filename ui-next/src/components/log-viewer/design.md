<!--
  Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.

  NVIDIA CORPORATION and its licensors retain all intellectual property
  and proprietary rights in and to this software, related documentation
  and any modifications thereto. Any use, reproduction, disclosure or
  distribution of this software and related documentation without an express
  license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Log Viewer - Design Document

> **TL;DR**: Build a GCP-inspired log viewer. Uses adapter pattern for backend-agnostic design.
> Current backend: plain-text HTTP streaming. Future: Loki. Histogram always visible.
> Navigation = scope (task panel shows task logs only).

---

## Quick Reference

| What | Where |
|------|-------|
| **Multi-agent start** | [Parallel Workstreams](#parallel-workstreams) |
| Types | `src/lib/api/log-adapter/types.ts` |
| Backend API | `GET /api/workflow/{name}/logs` |
| Entry point | `<LogViewer workflowId="X" taskName="Y" />` |
| Mock scenarios | `?log_scenario=error-heavy` (9 scenarios) |
| React 19 patterns | [React 19 / Next.js 16](#react-19--nextjs-16-compatibility) |
| Decisions | [Key Decisions](#key-decisions-summary) |

## Table of Contents

1. [Parallel Workstreams](#parallel-workstreams) - **START HERE** for multi-agent work
2. [UX Specification](#ux-specification) - Scope model, layout, interactions
3. [Requirements](#requirements) - P0/P1/P2 features
4. [Architecture](#architecture) - Adapter layer, types, hooks
5. [React 19 / Next.js 16](#react-19--nextjs-16-compatibility) - Concurrent patterns, SSR, nuqs
6. [Performance Strategy](#performance-strategy) - Virtualization, indexing
7. [Backend API](#current-backend-api) - Endpoint, parsing rules
8. [Mock System](#mock-system-for-development) - Scenarios for AI iteration
9. [Implementation Phases](#implementation-phases) - Sequential phase breakdown
10. [Key Decisions](#key-decisions-summary) - Major architectural choices

---

## Parallel Workstreams

> **For multi-agent coordination**: Independent workstreams that can run in parallel.
> Each workstream has its own files with no cross-dependencies until integration.

### Workstream Dependency Graph

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WORKSTREAM DEPENDENCIES                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [W0: Types & Constants] ──────────────────────────────────────────────────┐│
│         │                                                                   ││
│         ├──────────────────┬─────────────────────┬─────────────────────────┤│
│         ▼                  ▼                     ▼                         ││
│  [W1: Mocks]        [W2: Adapter]         [W3: Experimental]               ││
│  (parallel)         (parallel)            (parallel)                       ││
│         │                  │                     │                         ││
│         └──────────────────┼─────────────────────┘                         ││
│                            ▼                                                │
│                     [W4: UI Components]                                     │
│                     (after W1, W2, W3)                                     │
│                            │                                                │
│                            ▼                                                │
│                     [W5: Integration]                                       │
│                     (after W4)                                              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### W0: Types & Constants (BLOCKING - Do First)

**Agent**: Any (single agent, 30 min)

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/types.ts` | All canonical types |
| `src/lib/api/log-adapter/constants.ts` | Log levels, colors |

**Acceptance**: Files compile, types exported.

---

### W1: Mock System (Parallel)

**Agent**: Mock Specialist
**Depends on**: W0 (types)
**Blocked by**: Nothing after W0

| Task | File | Description |
|------|------|-------------|
| 1.1 | `src/mocks/generators/log-scenarios.ts` | Scenario configs |
| 1.2 | `src/mocks/generators/log-generator.ts` | Enhance with scenarios |
| 1.3 | `src/mocks/handlers.ts` | Add streaming log handler |

**Acceptance**: `?log_scenario=error-heavy` returns error-heavy logs.

---

### W2: Adapter Layer (Parallel)

**Agent**: Backend Integration
**Depends on**: W0 (types)
**Blocked by**: Nothing after W0

| Task | File | Description |
|------|------|-------------|
| 2.1 | `src/lib/api/log-adapter/adapters/log-parser.ts` | Parse log lines |
| 2.2 | `src/lib/api/log-adapter/adapters/log-index.ts` | In-memory index |
| 2.3 | `src/lib/api/log-adapter/adapters/plain-text-adapter.ts` | Implement adapter |
| 2.4 | `src/lib/api/log-adapter/index.ts` | Factory, exports |
| 2.5 | `src/lib/api/log-adapter/hooks/*.ts` | All React hooks |

**Acceptance**: `useLogQuery('workflow-name')` returns parsed `LogEntry[]`.

---

### W3: Experimental Page (Parallel)

**Agent**: Dev Tools
**Depends on**: W0 (types)
**Blocked by**: Nothing after W0

| Task | File | Description |
|------|------|-------------|
| 3.1 | `src/app/(dashboard)/experimental/log-viewer/page.tsx` | Page shell |
| 3.2 | `src/app/(dashboard)/experimental/log-viewer/log-viewer-playground.tsx` | Controls |
| 3.3 | `src/app/(dashboard)/experimental/log-viewer/components/*.tsx` | Selector, Sizer, Debug |
| 3.4 | `src/app/(dashboard)/experimental/experimental-client.tsx` | Register page |

**Acceptance**: Navigate to `/experimental/log-viewer`, see controls and placeholder.

---

### W4: UI Components (After W1, W2, W3)

**Agent**: UI Specialist
**Depends on**: W1, W2, W3 complete

| Task | File | Description |
|------|------|-------------|
| 4.1 | `src/components/log-viewer/lib/level-utils.ts` | Colors, icons |
| 4.2 | `src/components/log-viewer/store/log-viewer-store.ts` | Zustand state |
| 4.3 | `src/components/log-viewer/components/LogEntryRow.tsx` | Single row |
| 4.4 | `src/components/log-viewer/components/LogList.tsx` | Virtual list |
| 4.5 | `src/components/log-viewer/components/QueryBar.tsx` | FilterBar wrapper |
| 4.6 | `src/components/log-viewer/components/TimelineHistogram.tsx` | SVG histogram |
| 4.7 | `src/components/log-viewer/components/FieldsPane.tsx` | Facets sidebar |
| 4.8 | `src/components/log-viewer/components/LogToolbar.tsx` | Bottom toolbar |
| 4.9 | `src/components/log-viewer/components/LogViewer.tsx` | Main container |
| 4.10 | `src/components/log-viewer/index.ts` | Public exports |

**Acceptance**: LogViewer renders in experimental page with all features.

---

### W5: Production Integration (After W4)

**Agent**: Integration
**Depends on**: W4 complete

| Task | File | Description |
|------|------|-------------|
| 5.1 | Modify `TaskDetails.tsx` | Add LogViewer to Logs tab |
| 5.2 | Modify `WorkflowDetails.tsx` | Add LogViewer to Logs tab |
| 5.3 | Keyboard navigation | j/k, /, G, gg |
| 5.4 | Accessibility audit | ARIA, focus management |
| 5.5 | Performance test | 100K entries benchmark |

**Acceptance**: Logs tab works in production UI, passes a11y and perf tests.

---

### Agent Assignment Example

```
┌──────────────────────────────────────────────────────────────────┐
│  PARALLEL EXECUTION TIMELINE                                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Time ──────────────────────────────────────────────────────────►│
│                                                                  │
│  Agent 1: ██ W0 ██████████ W2 (Adapter) ████████ W4.1-4.4 ██████│
│  Agent 2:        ████████ W1 (Mocks) ███████████ W4.5-4.7 ██████│
│  Agent 3:        ████████ W3 (Experimental) ████ W4.8-4.10 █████│
│                                                                  │
│                                    └─── sync point ───┘          │
│                                                                  │
│  After sync: Any agent can do W5 (Integration)                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Target UI Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [level:error ×] [task:foo ×] [🔍 Filter logs...] [⏱ Time] [▶ Tail]     │
├─────────────────────────────────────────────────────────────────────────┤
│  HISTOGRAM: ████▓▓████░░░░████████▓▓░░░░████░░░░████▓▓██████          │
│             10:00        10:15        10:30        10:45               │
├──────────────┬──────────────────────────────────────────────────────────┤
│ FIELDS       │  LOG ENTRIES (245 results)                              │
│              │                                                          │
│ level        │  [▼] 10:00:03 ERROR Pod crashed: OOM killed             │
│ ● ERROR  12  │      └─ [Context: 5 lines] [Copy] [Pin]                 │
│ ○ WARN   45  │  [ ] 10:00:02 WARN  Memory usage at 95%                 │
│ ○ INFO  188  │  [ ] 10:00:01 INFO  Starting container...               │
│              │                                                          │
│ source       │  ──────────────────────────────────────────             │
│ ● task-1  89 │  EXPANDED CONTEXT:                                      │
│ ○ task-2  67 │  09:59:58 INFO  Checkpoint saved                        │
│              │  09:59:59 WARN  Memory pressure detected                │
│              │  10:00:03 ERROR Pod crashed: OOM killed    ← selected  │
│              │  10:00:04 INFO  Restarting pod...                       │
└──────────────┴──────────────────────────────────────────────────────────┘
```

---

## UX Specification

### Scope Model (Navigation = Scope)

Like ArgoCD/Kubernetes: navigation determines what logs you see.

```tsx
interface LogViewerProps {
  workflowId: string;
  groupName?: string;   // If set, scope to group
  taskName?: string;    // If set, scope to task
}
```

| Scope | Entry Point | Logs Shown | Available Filters |
|-------|-------------|------------|-------------------|
| **Task** | `TaskDetails.tsx` Logs tab | Single task only | retry, level, io_type, text, time |
| **Group** | `GroupDetails.tsx` Logs tab | Tasks in group | task (within group), level, io_type, text, time |
| **Workflow** | `WorkflowDetails.tsx` Logs tab | All tasks interleaved | task, level, io_type, text, time |
| **Full page** | `/logs` (future) | Any workflow | workflow, task, level, io_type, text, time |

**Progressive simplification**: More granular scope = fewer filter options = simpler UI.

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Retry: Latest ▼] [ERR] [WRN] [INF] [🔍 Search...]               [▶ Tail]   │
│ HISTOGRAM ████▓▓████░░░░████████▓▓░░░░████                     (always on)  │
│ ┌──────────┬────────────────────────────────────────────────────────────┐   │
│ │ Fields   │ Log entries                                               │   │
│ │ (if room)│ 10:00:03 ERROR Pod crashed: OOM killed while process...  │   │
│ └──────────┴────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Responsive (Content-Aware)

No fixed breakpoints. Measure container, adapt:

| Component | Threshold | Behavior |
|-----------|-----------|----------|
| FieldsPane | < 150px (20%) | Collapse to icon strip |
| Histogram | < 80px height | Switch to compact strip mode |
| QueryBar chips | < 200px | Overflow to dropdown |

### LogEntryRow

**Truncate, not scroll. Click to expand.**

| State | Style | Behavior |
|-------|-------|----------|
| Collapsed | Single line, `truncate` | Click expands |
| Expanded | `whitespace-pre-wrap break-words` | Actions: Context, Copy, Link |
| Hover | `bg-muted/50` | Pointer cursor |

### FieldsPane

Shows facet counts. **Hidden at task scope** (no task filter needed).

| Scope | Fields Shown |
|-------|--------------|
| Task | `level`, `io_type` (no FieldsPane - too granular) |
| Group | `task`, `level`, `io_type` |
| Workflow | `task`, `level`, `io_type` |

Click facet → adds chip to filter.

### State Management

**No session persistence.** Logs are cheap to refetch.

| State | Where | Survives Navigation? |
|-------|-------|---------------------|
| Filters | URL via `nuqs` | ✅ Yes (shareable) |
| UI (expanded rows, tailing) | Local state | ❌ No (resets) |
| Log data | TanStack Query cache | ✅ Auto-cached |

### Tailing

| State | Visual | Behavior |
|-------|--------|----------|
| Active | Green pulsing dot + "Live" | Auto-scroll to bottom |
| Paused | "Paused" + Resume btn | User scrolled up, new logs buffered |

### Histogram

**Always visible.** Two modes based on available height:

| Mode | When | Visual |
|------|------|--------|
| Full | height ≥ 80px | Stacked bar chart with time axis |
| Compact | height < 80px | Horizontal strip (colored segments) |

```
Full mode (80px+):
████ ERROR
▓▓▓▓ WARN
░░░░ INFO
────────────────────────────
10:00    10:15    10:30

Compact mode (<80px):
█████▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░█████▓▓▓▓▓░░░░░░░░░░░░
```

| Interaction | Result |
|-------------|--------|
| Click bar/segment | Filter to time bucket |
| Drag | Select time range |
| Hover | Tooltip with counts |

### Panel Collapsed

Edge strip with: count badge + error indicator (red dot). Click to expand.

### Component States

| State | Visual | Trigger |
|-------|--------|---------|
| **Loading** | Skeleton: histogram bar + 8 shimmer rows | Initial fetch |
| **Empty** | Icon + "No logs available" + hint text | Zero entries |
| **Error** | Error banner (red) + retry button + existing logs kept | Fetch failed |
| **Streaming** | Pulsing dot + "Live" badge | Tailing active |
| **Paused** | "Paused" pill + "Resume" button | User scrolled up |
| **Filtered** | Filter chip(s) visible + result count | Active filters |

```tsx
// Loading skeleton
<div className="animate-pulse">
  <div className="h-10 bg-muted rounded mb-2" />      {/* Histogram */}
  {Array.from({ length: 8 }).map((_, i) => (
    <div key={i} className="h-6 bg-muted rounded mb-1" />
  ))}
</div>

// Empty state
<div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
  <FileText className="h-12 w-12 mb-4" />
  <p className="text-lg font-medium">No logs available</p>
  <p className="text-sm">Logs will appear when the task starts running.</p>
</div>

// Error state (preserves existing logs)
<div className="border-destructive bg-destructive/10 border rounded p-3 mb-2">
  <p className="text-destructive text-sm">Failed to load logs: {error.message}</p>
  <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
</div>
{/* Existing logs still visible below */}
```

---

## Requirements

### Functional Requirements

#### P0 - Must Have

| ID | Requirement | Description |
|----|-------------|-------------|
| F1 | Log Display | Render log entries with timestamp, level indicator, and message |
| F2 | ANSI Handling | Strip ANSI escape codes for clean text display |
| F3 | Level Filtering | Filter logs by severity level (DEBUG, INFO, WARN, ERROR, FATAL) |
| F4 | Text Search | Search/filter log content with text or regex |
| F5 | Live Tailing | Stream new logs in real-time for running tasks |
| F6 | Time Range | Select time window for historical log viewing |
| F7 | Download | Export visible/filtered logs as file |

#### P1 - Should Have

| ID | Requirement | Description |
|----|-------------|-------------|
| F8 | Timeline Histogram | Visual histogram of log volume over time, colored by severity |
| F9 | Fields Pane | Sidebar showing field values with counts, click to filter |
| F10 | Context Expansion | Show N lines before/after a selected log entry |
| F11 | Pin Entry | Keep a log entry visible while scrolling/filtering |
| F12 | Copy Link | Copy shareable link to specific log entry |

#### P2 - Nice to Have

| ID | Requirement | Description |
|----|-------------|-------------|
| F13 | Query Language | Reuse FilterBar with log-specific fields (level:, task:, text:) |
| F14 | Saved Queries | Save and recall frequently used filters |
| F15 | Pattern Detection | Group similar log messages automatically |
| F16 | Trace Correlation | Link logs to traces/spans when available |

### Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NF1 | Initial Load | < 500ms for first 100 lines |
| NF2 | Filter Response | < 500ms for label-based filters |
| NF3 | Scroll Performance | 60fps smooth scrolling |
| NF4 | Memory Usage | < 100MB for 100K log lines |
| NF5 | Large Files | Handle 100MB+ log files gracefully |
| NF6 | Accessibility | Keyboard navigable, screen reader support |

---

## Architecture

### Type Definitions

> **CANONICAL SOURCE**: All type definitions are in the [Loki-Ready Adapter Architecture](#loki-ready-adapter-architecture) section.
> The types below are summaries. See `src/lib/api/log-adapter/types.ts` for implementations.

| Type | Description | File Location |
|------|-------------|---------------|
| `LogEntry` | Single log line with labels | `types.ts` |
| `LogLabels` | Structured metadata (workflow, task, level, etc.) | `types.ts` |
| `LogLevel` | Severity: debug, info, warn, error, fatal | `types.ts` |
| `LogQuery` | Query parameters for fetching logs | `types.ts` |
| `LogQueryResult` | Paginated query response | `types.ts` |
| `HistogramBucket` | Timeline bucket with counts by level | `types.ts` |
| `HistogramResult` | Full histogram response | `types.ts` |
| `FieldFacet` | Field value counts for FieldsPane | `types.ts` |
| `AdapterCapabilities` | Feature flags for progressive enhancement | `types.ts` |
| `LogAdapter` | Interface that backends implement | `types.ts` |

### Component Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              LogViewer                                  │
│  (Main container - orchestrates all sub-components)                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ QueryBar (wraps FilterBar)                                       │   │
│  │ [level:error ×] [task:foo ×] [🔍 Filter logs...] [⏱ Time] [▶ Tail]│   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ TimelineHistogram                                                │   │
│  │ ████▓▓████░░░░████████▓▓░░░░████░░░░████▓▓██████                │   │
│  │ [Drag handles for time selection]                                │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────────────┬──────────────────────────────────────────────────┐   │
│  │ FieldsPane   │ LogList (TanStack Virtual)                       │   │
│  │              │                                                   │   │
│  │ level        │ ┌─────────────────────────────────────────────┐  │   │
│  │ ● ERROR  12  │ │ LogEntryRow                                 │  │   │
│  │ ○ WARN   45  │ │ 10:00:03 ERROR Pod crashed: OOM killed     │  │   │
│  │              │ └─────────────────────────────────────────────┘  │   │
│  │ source       │ ┌─────────────────────────────────────────────┐  │   │
│  │ ● task-1  89 │ │ LogEntryRow (expanded with context)        │  │   │
│  │              │ │ ...                                         │  │   │
│  └──────────────┴──────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │ LogToolbar (sticky bottom)                                       │   │
│  │ [Results: 245] [Download] [Tail: ON] [Scroll to bottom]         │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── lib/api/log-adapter/
│   ├── index.ts                              # Factory, context provider, exports
│   ├── types.ts                              # CANONICAL: LogEntry, LogQuery, etc.
│   ├── constants.ts                          # Log levels, colors (shared)
│   │
│   ├── adapters/
│   │   ├── plain-text-adapter.ts             # Current: fetch + parse + filter
│   │   ├── log-parser.ts                     # OSMO format → LogEntry (plain-text only)
│   │   └── log-index.ts                      # Client-side index (plain-text only)
│   │
│   └── hooks/
│       ├── use-log-query.ts                  # TanStack Query for log fetching
│       ├── use-log-histogram.ts              # Histogram data hook
│       ├── use-log-facets.ts                 # Facet counts hook
│       ├── use-log-tail.ts                   # HTTP streaming tailing
│       └── use-log-capabilities.ts           # Feature detection
│
└── components/log-viewer/                    # UI components (NO backend logic)
    ├── design.md                             # This document
    ├── index.ts                              # Public exports
├── lib/
    │   └── level-utils.ts                    # Colors, icons, badges
├── store/
    │   └── log-viewer-store.ts               # Zustand: UI state only
├── components/
    │   ├── LogViewer.tsx                     # Main container
    │   ├── QueryBar.tsx                      # Wraps FilterBar with log-specific fields
    │   ├── TimelineHistogram.tsx             # Severity histogram (custom SVG)
    │   ├── FieldsPane.tsx                    # Left sidebar with facets
    │   ├── LogList.tsx                       # Virtualized log list
    │   ├── LogEntryRow.tsx                   # Single log line
    │   ├── LogContext.tsx                    # Expanded context view
    │   └── LogToolbar.tsx                    # Bottom toolbar
    └── log-viewer.css                        # Component styles
```

**Separation of Concerns:**

| Layer | Location | Responsibility |
|-------|----------|----------------|
| **Types** | `lib/api/log-adapter/types.ts` | Canonical type definitions |
| **Constants** | `lib/api/log-adapter/constants.ts` | Shared: log levels, colors |
| **Adapters** | `lib/api/log-adapter/adapters/` | Backend implementations + their utils |
| **Hooks** | `lib/api/log-adapter/hooks/` | React data hooks |
| **UI Utils** | `components/log-viewer/lib/` | Level colors, icons, badges |
| **UI State** | `components/log-viewer/store/` | Selection, expansion, tailing toggle |
| **UI Components** | `components/log-viewer/components/` | Pure rendering, receive data via hooks |

**Why this separation?**

1. **Parser/index colocated with plain-text-adapter**: They're tightly coupled - Loki won't need them
2. **Constants at root**: Log levels are universal across all adapters
3. **Easy Loki migration**: Just add `loki-adapter.ts` - no parser, no client-side index
4. **UI stays pure**: Components receive `LogEntry[]` and render. No knowledge of backend format.

### State Management

> **Types**: Uses canonical types from `src/lib/api/log-adapter/types.ts`

**No session persistence needed.** Logs are cheap to refetch. State resets on navigation.

- **Filters**: Stored in URL via `nuqs` (shareable, survives refresh)
- **UI state**: Local component state (resets on unmount - acceptable)
- **Log data**: TanStack Query cache (automatic)

```typescript
// src/components/log-viewer/store/log-viewer-store.ts
// Lightweight store - NO persistence, resets on navigation

import type { LogLevel } from '@/lib/api/log-adapter/types';

interface LogViewerState {
  // UI state only (filters are in URL via nuqs)
  expandedEntryIds: Set<string>;
  isTailing: boolean;
  wrapLines: boolean;

  // Actions
  toggleExpand: (id: string) => void;
  setTailing: (enabled: boolean) => void;
  setWrapLines: (wrap: boolean) => void;
  reset: () => void;
}

// Log entries, histogram, and facets come from TanStack Query hooks
// Filters come from URL via nuqs
```

### QueryBar (Reuses FilterBar)

> **Key decision**: Reuse `@/components/filter-bar` instead of building custom query UI.
> This provides proven UX, keyboard navigation (cmdk), and chip-based filtering.
> Chips can be transparently converted to LogQL when Loki is deployed.

```typescript
// src/components/log-viewer/components/QueryBar.tsx

import { FilterBar, type SearchField, type SearchChip } from '@/components/filter-bar';
import type { LogEntry, LogLevel } from '@/lib/api/log-adapter/types';

// Log-specific field definitions
const LOG_FIELDS: SearchField<LogEntry>[] = [
  {
    id: 'level',
    label: 'Level',
    prefix: 'level:',
    getValues: () => ['error', 'warn', 'info', 'debug', 'fatal'],
    exhaustive: true,  // Complete list, no "Seen in your data" hint
    match: (entry, value) => entry.level === value,
  },
  {
    id: 'task',
    label: 'Task',
    prefix: 'task:',
    getValues: (entries) => [...new Set(entries.map(e => e.labels.task))],
    match: (entry, value) => entry.labels.task === value,
  },
  {
    id: 'io_type',
    label: 'Source',
    prefix: 'source:',
    getValues: () => ['stdout', 'stderr', 'osmo_ctrl', 'download', 'upload'],
    exhaustive: true,
    match: (entry, value) => entry.labels.io_type === value,
  },
  {
    id: 'text',
    label: 'Contains',
    prefix: 'text:',
    getValues: () => [],  // Free text, no autocomplete
    freeFormHint: 'Search in log message',
    match: (entry, value) => entry.message.toLowerCase().includes(value.toLowerCase()),
  },
];

// Level presets for quick filtering
const LEVEL_PRESETS = [
  { id: 'errors', label: 'Errors', chip: { field: 'level', value: 'error', label: 'Level: error' } },
  { id: 'warnings', label: 'Warnings', chip: { field: 'level', value: 'warn', label: 'Level: warn' } },
];

export function QueryBar({
  entries,
  chips,
  onChipsChange,
}: {
  entries: LogEntry[];
  chips: SearchChip[];
  onChipsChange: (chips: SearchChip[]) => void;
}) {
  return (
    <FilterBar
      data={entries}
      fields={LOG_FIELDS}
      chips={chips}
      onChipsChange={onChipsChange}
      placeholder="Filter logs... (try 'level:', 'task:', or free text)"
      presets={[{ label: 'Quick filters', items: LEVEL_PRESETS }]}
    />
  );
}
```

**User experience:**
- Type `level:` → autocomplete shows error, warn, info, debug
- Type `task:` → autocomplete shows task names from current logs
- Type `error timeout` → free text search in messages
- Click preset → instant filter
- Chips are visual, removable, keyboard-navigable

**Loki migration:**
- `SearchChip[]` → LogQL conversion in adapter (see [LokiAdapter](#future-lokiadapter-reference-only))
- UI stays 100% the same

### URL State Schema (nuqs)

Shareable URLs encode filter state. Uses `nuqs` for type-safe URL params.

```typescript
// src/components/log-viewer/lib/url-params.ts

import { parseAsString, parseAsArrayOf, parseAsInteger, parseAsIsoDateTime } from 'nuqs';

export const logViewerSearchParams = {
  // Text search
  q: parseAsString,                              // ?q=error+memory

  // Level filter (multi-select)
  level: parseAsArrayOf(parseAsString, ','),     // ?level=error,warn

  // Task filter
  task: parseAsString,                           // ?task=data-prep

  // Retry filter
  retry: parseAsInteger,                         // ?retry=2

  // Time range
  from: parseAsIsoDateTime,                      // ?from=2024-01-15T10:00:00Z
  to: parseAsIsoDateTime,                        // ?to=2024-01-15T11:00:00Z

  // Selected log entry (for deep linking)
  entry: parseAsString,                          // ?entry=abc123
};

// Example URL:
// /workflows/training-job/logs?q=CUDA&level=error,warn&task=data-prep&from=2024-01-15T10:00:00Z
```

**URL param naming conventions** (match existing OSMO patterns):
- Short names for common params (`q`, `task`)
- ISO 8601 for dates
- Comma-separated for arrays
- No redundant prefixes (not `log_level`, just `level`)

---

## React 19 / Next.js 16 Compatibility

> **Stack**: Next.js 16, React 19, TailwindCSS 4, TanStack Query/Virtual, Zustand, nuqs

### Component Boundaries

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Server Component (page.tsx)                                                  │
│ - Fetch initial workflow metadata (name, status, task list)                 │
│ - Static shell renders immediately (PPR)                                    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Client Component (LogViewer.tsx) - "use client"                        │  │
│  │ - All interactivity, state, hooks                                      │  │
│  │ - Log fetching via TanStack Query + HTTP streaming                     │  │
│  │ - Virtual scrolling, filtering, tailing                                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**LogViewer is a client component** - it's inherently interactive.

### React 19 Patterns (Required)

| Feature | Usage in LogViewer |
|---------|-------------------|
| `startTransition` | Wrap filter/search state updates (non-blocking) |
| `useDeferredValue` | Search input → deferred query (no typing lag) |
| `use()` | Reading context in conditionals (if needed) |
| Concurrent rendering | Index updates don't block scroll |

```tsx
// QueryBar search - don't block typing
const [searchInput, setSearchInput] = useState('');
const deferredSearch = useDeferredValue(searchInput);

// Heavy filter updates - don't block UI
function handleLevelFilter(level: LogLevel) {
  startTransition(() => {
    setActiveFilters(prev => ({ ...prev, level }));
  });
}

// Log index updates - non-blocking
function handleNewLogs(entries: LogEntry[]) {
  startTransition(() => {
    logIndex.addEntries(entries);
  });
}
```

### Performance Patterns (Required)

Per `ui.mdc` rules:

| Pattern | Implementation |
|---------|---------------|
| TanStack Virtual | Mandatory for log list (always >50 items) |
| CSS containment | `contain-strict` on scroll container |
| Data attributes | Row click handlers via `data-index`, not closures |
| Static styles | No inline `style={{}}`, use Tailwind classes |
| `Map.get()` | Use `logIndex.byId.get(id)` not `entries.find()` |
| `for...of` | Hot paths in parser/index use imperative loops |
| `memo()` | Wrap `LogEntryRow`, `HistogramBar` |
| GPU animation | Expand/collapse via `transform`, not `height` |

```tsx
// Virtual list container - REQUIRED classes
<div
  ref={parentRef}
  className="contain-strict content-visibility-auto overflow-auto"
  style={{ containIntrinsicSize: 'auto 50px' }}
>
  <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
    {virtualizer.getVirtualItems().map(virtualRow => (
      <LogEntryRow
        key={virtualRow.key}
        data-index={virtualRow.index}
        style={{
          position: 'absolute',
          top: 0,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      />
    ))}
  </div>
</div>
```

### Streaming SSR Considerations

| Aspect | Strategy |
|--------|----------|
| Initial shell | Server renders toolbar, empty list placeholder (instant) |
| Log data | Client fetches after hydration (no SSR for logs) |
| Metadata | Workflow name, status can be server-rendered |
| Suspense | Wrap LogViewer in Suspense with skeleton fallback |

```tsx
// page.tsx (Server Component)
export default async function WorkflowLogsPage({ params }: Props) {
  const workflow = await getWorkflow(params.name);  // Server fetch

  return (
    <div>
      <h1>{workflow.name}</h1>  {/* Static, PPR */}
      <Suspense fallback={<LogViewerSkeleton />}>
        <LogViewer workflowId={workflow.id} />  {/* Client, streams */}
      </Suspense>
    </div>
  );
}
```

### URL State with nuqs

Filter state lives in URL for shareability and SSR compatibility:

```tsx
// Use nuqs for URL-synced state
import { parseAsString, parseAsArrayOf, useQueryState } from 'nuqs';

export function useLogFilters() {
  const [level, setLevel] = useQueryState('level', parseAsString);
  const [task, setTask] = useQueryState('task', parseAsString);
  const [search, setSearch] = useQueryState('q', parseAsString);
  const [timeStart, setTimeStart] = useQueryState('from', parseAsString);
  const [timeEnd, setTimeEnd] = useQueryState('to', parseAsString);

  return { level, task, search, timeStart, timeEnd, setLevel, setTask, ... };
}
```

---

## Performance Strategy

### Frontend Performance

| Technique | Purpose | Implementation |
|-----------|---------|----------------|
| **Virtualization** | Only render visible rows | TanStack Virtual with 50px row height |
| **Debounced search** | Reduce API calls | 300ms debounce on search input |
| **Cached parsing** | Don't re-parse logs | Parsed `LogEntry` stored in index |
| **Flow-controlled tail** | Prevent UI blocking | Batch writes, max 60 updates/sec |
| **Lazy histogram** | Fast initial load | Load histogram after log list |
| **Chunked loading** | Handle large files | Load 1000 lines at a time |

### Data Fetching Strategy

```
Initial Load:
1. Fetch last 100 log lines (fast, small payload)
2. Render immediately
3. Fetch histogram in background
4. Fetch field counts in background

Pagination (Explicit User Actions):
- NO infinite scroll (log fetching is expensive)
- "Load older logs" button at TOP of list → fetches previous page
- "Load newer logs" button at BOTTOM → fetches next page (for historical)
- Keep max 10,000 entries in memory
- Prune oldest when limit exceeded

Live Tail (HTTP Streaming):
- Single fetch request, stream via ReadableStream
- Connection stays open until workflow completes (END_FLAG)
- Batch new entries, render in RAF
- Auto-scroll unless user scrolled up
```

### Error Handling Strategy

| Scenario | Behavior |
|----------|----------|
| Network error during streaming | Show error toast, keep existing logs visible, offer "Retry" button |
| Connection drops mid-workflow | Show "Disconnected" indicator, keep logs, auto-retry with backoff |
| 404 (workflow not found) | Show error state with message, no logs to preserve |
| Empty log file | Show "No logs available" message |
| Corrupted/unparseable lines | Skip line, increment error counter, show warning if many failures |

**Key principle**: Never flush already-fetched logs on error. Users can still search/filter what they have.

### Memory Budget

| Component | Max Size | Strategy |
|-----------|----------|----------|
| Log entries | 10,000 entries (~50MB) | Ring buffer, drop oldest |
| Histogram | 1,000 buckets | Fixed size, resample on zoom |
| Field counts | 100 values per field | Top N only, "Other" bucket |
| DOM nodes | ~50 visible rows | Virtualization |

---

## Backend Considerations

### Current Backend API

> **Source of Truth**: `external/src/service/core/workflow/workflow_service.py`

#### REST Endpoint (Implemented)

```
GET /api/workflow/{name}/logs
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | path | ✅ | Workflow ID |
| `task_name` | query | ❌ | Filter to specific task |
| `retry_id` | query | ❌ | Filter to specific retry (defaults to latest) |
| `last_n_lines` | query | ❌ | Limit response to last N lines |
| `query` | query | ❌ | Regex pattern to filter lines |

**Response**: `text/plain` - Raw log lines, one per line

**Response Format** (each line):
```
2024/01/15 10:30:45 [task-name] Log message content here
2024/01/15 10:30:45 [task-name retry-1] Log message with retry
2024/01/15 10:30:46 [task-name][osmo] Control message from osmo
```

### Log Format Specification

> **Source of Truth**: `external/src/utils/connectors/redis.py` (formatting) and
> `external/src/runtime/pkg/messages/messages.go` (Go types)

#### Log Line Format

The `redis_log_formatter` function formats logs into one of these patterns:

| Pattern | When Used | Example |
|---------|-----------|---------|
| `{date} [{source}][osmo] {text}` | osmo_ctrl, download, upload (retry=0) | `2026/01/19 00:40:05 [train][osmo] Downloading Start` |
| `{date} [{source} retry-{N}][osmo] {text}` | osmo_ctrl, download, upload (retry>0) | `2026/01/19 00:40:05 [train retry-1][osmo] Downloading Start` |
| `{date} [{source}] {text}` | stdout, stderr (retry=0) | `2026/01/19 00:41:36 [train] Successfully built groot` |
| `{date} [{source} retry-{N}] {text}` | stdout, stderr (retry>0) | `2026/01/19 00:41:36 [train retry-2] Building wheel...` |
| `{text}` | DUMP type (raw output, no formatting) | Progress bars, special output |

#### IOType Enum (Log Sources)

```python
# From external/src/utils/connectors/redis.py
class IOType(enum.Enum):
    STDOUT = 'STDOUT'       # User process stdout
    STDERR = 'STDERR'       # User process stderr
    OSMO_CTRL = 'OSMO_CTRL' # OSMO control messages
    DOWNLOAD = 'DOWNLOAD'   # Data download progress
    UPLOAD = 'UPLOAD'       # Data upload progress
    DUMP = 'DUMP'           # Raw output (no timestamp/prefix)
    END_FLAG = 'END_FLAG'   # Stream termination marker
    LOG_DONE = 'LOG_DONE'   # Logs finished signal
    METRICS = 'METRICS'     # Metrics data (not displayed)
    BARRIER = 'BARRIER'     # Task synchronization (not displayed)
```

**Display grouping**:
- `ctrl_logs()` = `[osmo]` suffix: OSMO_CTRL, DOWNLOAD, UPLOAD
- `workflow_logs()` = user output: STDOUT, STDERR, DOWNLOAD, UPLOAD

#### Log Source (Task Name)

The `source` field in `LogStreamBody` is the **task name** (e.g., `train`, `transfer_data`).
- Set by `cmdArgs.LogSource` in the Go ctrl container
- Same as `task_name` parameter passed to WebSocket connection

#### Log Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         LOG FLOW FOR A SINGLE TASK                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  User Container                  Ctrl Container (sidecar)                   │
│  ┌─────────────┐                ┌─────────────────────────────────────────┐ │
│  │ User script │                │                                         │ │
│  │   stdout ──────────────────────▶ MessageOut ──▶ CreateLog(STDOUT)     │ │
│  │   stderr ──────────────────────▶ MessageErr ──▶ CreateLog(STDERR)     │ │
│  └─────────────┘                │                                         │ │
│                                 │ OSMO operations:                         │ │
│                                 │   osmoChan ──▶ CreateLog(OSMO_CTRL)     │ │
│                                 │   downloadChan ──▶ CreateLog(DOWNLOAD)  │ │
│                                 │   uploadChan ──▶ CreateLog(UPLOAD)      │ │
│                                 │                       ↓                  │ │
│                                 │              CircularBuffer (queue)      │ │
│                                 │                       ↓                  │ │
│                                 │              WebSocket → FastAPI         │ │
│                                 └─────────────────────────────────────────┘ │
│                                                      ↓                       │
│                                            Redis XADD (stream)               │
│                                                      ↓                       │
│                                        redis_log_formatter (on read)         │
│                                                      ↓                       │
│                                        Plain text response to UI             │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Why Logs Interweave

For a single task, logs from **5 different sources** interweave in real-time:

1. **STDOUT** - User script print statements
2. **STDERR** - User script errors/warnings
3. **OSMO_CTRL** - OSMO control messages (task lifecycle)
4. **DOWNLOAD** - Data download progress (before user script runs)
5. **UPLOAD** - Data upload progress (after user script completes)

These are all processed through `putLogs()` via separate Go channels and merged
into a single `CircularBuffer`, then sent over WebSocket in order of arrival.

**Example interweaving** (from real logs):
```
2026/01/19 00:40:05 [train][osmo] Downloading Start        ← DOWNLOAD phase
2026/01/19 00:40:05 [train][osmo] All Inputs Gathered      ← DOWNLOAD complete
2026/01/19 00:40:06 [train] Obtaining file:///...          ← STDOUT (pip install)
2026/01/19 00:41:40 [train] ERROR: pip's dependency...     ← STDOUT (pip error)
2026/01/19 00:41:40 [train] Successfully installed timm    ← STDOUT (pip success)
2026/01/19 00:02:24 [transfer_data][osmo] Upload Start     ← UPLOAD phase
2026/01/19 00:02:29 [transfer_data][osmo] 100%| 303/303... ← UPLOAD progress (tqdm)
```

### Parsing Rules (for `log-parser.ts`)

| Field | Regex Pattern | Notes |
|-------|---------------|-------|
| Timestamp | `^(\d{4}/\d{2}/\d{2} \d{2}:\d{2}:\d{2})` | UTC, no timezone |
| Task + Retry | `\[([^\]\s]+)(?:\s+retry-(\d+))?\]` | Capture groups: task, retry |
| Is OSMO | `\]\[osmo\]` after first bracket | If present, io_type is ctrl/download/upload |
| Message | Everything after all brackets | May contain ANSI codes |

**Log level detection** (heuristic from message content):
- `ERROR:` or `Error:` → error
- `WARNING:` or `WARN:` → warn
- `INFO:` → info
- `DEBUG:` → debug
- No prefix → info (default)

**Example Parser Output**:
```typescript
// Input: "2026/01/19 00:41:40 [train] ERROR: pip's dependency resolver..."
{
  id: "2026-01-19T00:41:40.000Z-abc123",
  timestamp: new Date("2026-01-19T00:41:40"),
  line: "2026/01/19 00:41:40 [train] ERROR: pip's dependency resolver...",
  labels: {
    workflow: "training-job-123",  // From query context
    task: "train",
    retry: "0",
    level: "error",                // Detected from "ERROR:" prefix
    io_type: "stdout",             // No [osmo] suffix
  }
}

// Input: "2026/01/19 00:40:05 [train][osmo] Downloading Start"
{
  id: "2026-01-19T00:40:05.000Z-def456",
  timestamp: new Date("2026-01-19T00:40:05"),
  line: "2026/01/19 00:40:05 [train][osmo] Downloading Start",
  labels: {
    workflow: "training-job-123",
    task: "train",
    retry: "0",
    level: "info",
    io_type: "osmo_ctrl",          // Has [osmo] suffix
  }
}
```

**Backend Logic**:
1. If workflow logs are in Redis (running workflow) → reads from Redis XSTREAM
2. If workflow logs are in S3 (completed workflow) → downloads from S3
3. Applies `query` regex filter server-side
4. Returns plain text response

#### HTTP Streaming (Running Workflows)

> ✅ **The REST endpoint supports true HTTP streaming** for running workflows.
> It uses FastAPI's `StreamingResponse` with an async generator that blocks on Redis `XREAD`.

**How it works** (from `external/src/utils/connectors/redis.py`):

```python
# redis_log_streamer - async generator that yields logs as they arrive
while not skip_streaming:
    logs = await redis_client.xread({name: start_id}, 1)  # Blocks until new data
    # ... yield log ...
    if log.io_type == IOType.END_FLAG:
        break  # Workflow completed, stop streaming
```

**Backend routes automatically**:
- `redis://` scheme → HTTP Streaming via async generator (live logs)
- `s3://` scheme → Streaming download of completed log file

#### Live Tailing Strategy (Current)

The UI can consume the streaming response using the Fetch API's `ReadableStream`:

```typescript
// In use-log-tail.ts
async function* streamLogs(workflowId: string, taskName?: string): AsyncGenerator<string> {
  const url = `/api/workflow/${workflowId}/logs` + (taskName ? `?task_name=${taskName}` : '');
  const response = await fetch(url);
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value, { stream: true });
  }
}
```

**Connection behavior**:
- **Running workflow**: Connection stays open, logs stream as they arrive
- **Completed workflow**: Streams entire log file, then closes
- **END_FLAG**: Backend sends when workflow completes, stream ends

### Current State (Plain Text)

```
Logs stored as:
- During execution: Redis circular buffer (HTTP streaming via REST API)
- After execution: S3 text files (static)

Log flow:
  Go ctrl container → WebSocket → FastAPI server → Redis XADD → Redis Streams
                                       ↓
                           (After workflow completion)
                                       ↓
                    CleanupWorkflow job → S3 upload → Delete from Redis

No indexing, no structured metadata in storage.
```

### Decision: Loki for Future Backend

After analysis of query patterns and operational requirements:

### Current Architecture

The REST endpoint uses HTTP streaming with different backends based on workflow state:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CURRENT LOG ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  LIVE LOGS (Running Workflows)                                       │    │
│  │                                                                      │    │
│  │  UI ──▶ fetch() ──▶ FastAPI StreamingResponse ──▶ Redis XREAD       │    │
│  │         ReadableStream                              (blocks)         │    │
│  │                                                                      │    │
│  │  Connection stays open, logs stream as they arrive until END_FLAG   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  HISTORICAL LOGS (Completed Workflows)                               │    │
│  │                                                                      │    │
│  │  UI ──▶ fetch() ──▶ FastAPI StreamingResponse ──▶ S3 download       │    │
│  │         ReadableStream                              (streams file)   │    │
│  │                                                                      │    │
│  │  Streams entire log file, then connection closes                     │    │
│  │  Future: Loki (label queries instant, content search fast)          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  The backend automatically routes based on log URL scheme:                   │
│  • redis:// or rediss:// → Streaming from Redis XSTREAM                    │
│  • s3:// → Streaming download from S3                                       │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Loki-Ready Adapter Architecture

The adapter layer abstracts backend differences so the UI works with current plain-text
logs today, and can switch to Loki in the future with **zero UI component changes**.

**What we build now:** PlainTextAdapter + types designed for Loki compatibility
**What we build later:** LokiAdapter (when backend deploys Loki)

### File Structure

```
src/lib/api/log-adapter/
├── index.ts                    # Exports, factory, context provider
├── types.ts                    # Loki-aligned type definitions (canonical)
├── constants.ts                # Log levels, field names
├── adapters/
│   └── plain-text-adapter.ts   # Current backend implementation
└── hooks/
    ├── use-log-query.ts        # Main data hook (TanStack Query + manual pagination)
    ├── use-log-histogram.ts    # Timeline aggregation (client-side computed)
    ├── use-log-facets.ts       # Fields pane data (client-side computed)
    ├── use-log-tail.ts         # Live tailing (HTTP streaming via ReadableStream)
    └── use-log-capabilities.ts # Feature detection for progressive enhancement
```

### Core Types (Loki-Aligned)

```typescript
// src/lib/api/log-adapter/types.ts

/**
 * Log entry - modeled after Loki's stream format
 * Current backend parses into this shape, Loki returns it natively
 */
export interface LogEntry {
  /** Unique ID: timestamp-nanos + hash for current, Loki stream ID for future */
  id: string;

  /** Timestamp (Loki uses nanoseconds, we normalize to Date) */
  timestamp: Date;

  /** Raw log line as stored */
  line: string;

  /**
   * Structured labels - the key to Loki compatibility
   * Current: parsed from log line format
   * Loki: native stream labels
   */
  labels: LogLabels;
}

/**
 * Labels match your ingestion format AND Loki's label model
 * Keep this list small - Loki works best with low cardinality
 */
export interface LogLabels {
  workflow: string;           // Workflow ID
  task?: string;              // Task name within workflow
  retry?: string;             // Retry attempt (string for Loki compat)
  level?: LogLevel;           // Parsed severity
  io_type?: 'stdout' | 'stderr' | 'osmo_ctrl' | 'download' | 'upload';
  [key: string]: string | undefined;  // Extensible
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Query parameters - maps cleanly to LogQL
 */
export interface LogQuery {
  // Required context
  workflowId: string;

  // Label filters (instant in Loki)
  taskName?: string;
  retryId?: number;
  levels?: LogLevel[];
  ioTypes?: string[];

  // Time range
  start?: Date;
  end?: Date;

  // Content filter (slower in Loki, but supported)
  search?: string;
  searchMode?: 'contains' | 'regex';

  // Pagination
  limit?: number;
  direction?: 'forward' | 'backward';
  cursor?: string;
}

/**
 * Query result - same shape regardless of backend
 */
export interface LogQueryResult {
  entries: LogEntry[];
  nextCursor?: string;
  hasMore: boolean;
  stats?: {
    scannedBytes?: number;
    queryTimeMs?: number;
  };
}

/**
 * Histogram bucket for timeline visualization
 */
export interface HistogramBucket {
  timestamp: Date;
  counts: Partial<Record<LogLevel, number>>;
  total: number;
}

export interface HistogramResult {
  buckets: HistogramBucket[];
  intervalMs: number;
}

/**
 * Field facet for Fields pane
 */
export interface FieldFacet {
  field: string;
  values: Array<{ value: string; count: number }>;
}

/**
 * Adapter capabilities - UI uses for progressive enhancement
 */
export interface AdapterCapabilities {
  labelFilteringOptimized: boolean;   // True = instant label filters
  contentSearchOptimized: boolean;    // True = indexed content search
  serverSideHistogram: boolean;       // True = server computes histogram
  serverSideFacets: boolean;          // True = server computes facets
  maxEfficientRangeMs?: number;       // Max time range for efficient queries
}

/**
 * The adapter interface - both backends implement this
 */
export interface LogAdapter {
  readonly capabilities: AdapterCapabilities;

  query(params: LogQuery): Promise<LogQueryResult>;
  histogram(params: Omit<LogQuery, 'cursor' | 'limit'>, buckets?: number): Promise<HistogramResult>;
  facets(params: Omit<LogQuery, 'cursor' | 'limit'>, fields: string[]): Promise<FieldFacet[]>;
}
```

### PlainTextAdapter (Build Now)

The adapter we ship, designed with Loki-compatible types:

```typescript
// src/lib/api/log-adapter/adapters/plain-text-adapter.ts

export class PlainTextAdapter implements LogAdapter {
  readonly capabilities: AdapterCapabilities = {
    labelFilteringOptimized: false,    // Client-side filtering
    contentSearchOptimized: false,     // Regex on full file
    serverSideHistogram: false,        // Computed client-side
    serverSideFacets: false,           // Computed client-side
  };

  async query(params: LogQuery): Promise<LogQueryResult> {
    // 1. Fetch from /api/workflow/{id}/logs
    // 2. Parse plain text into LogEntry[] with labels
    // 3. Apply client-side filters (levels, time range, regex)
    // 4. Return paginated results
  }

  async histogram(params, bucketCount = 50): Promise<HistogramResult> {
    // Fetch logs, compute buckets client-side
    // Less efficient but functional
  }

  async facets(params, fields): Promise<FieldFacet[]> {
    // Fetch logs, count field values client-side
  }
}
```

**Key design choices for Loki compatibility:**
- Parse log lines into `LogEntry` with structured `labels` (workflow, task, level, retry)
- Use same `LogQuery` interface that maps to LogQL
- Return same `LogQueryResult` shape Loki would return
- Compute histogram/facets client-side (Loki will do this server-side)

### Future LokiAdapter (Reference Only)

When Loki is deployed, a new adapter can be added that:
- Translates `SearchChip[]` → LogQL queries (see below)
- Calls Loki's `/loki/api/v1/query_range` endpoint
- Uses Loki's metric queries for server-side histogram
- Uses `/loki/api/v1/label/{field}/values` for facets
- Sets `capabilities.labelFilteringOptimized = true`, etc.

**Chips → LogQL Conversion:**

```typescript
// src/lib/api/log-adapter/adapters/loki-adapter.ts (future)

function chipsToLogQL(chips: SearchChip[], baseStream: string): string {
  const labels: string[] = [];
  const lineFilters: string[] = [];

  for (const chip of chips) {
    if (chip.field === 'text') {
      // Free text → line filter
      lineFilters.push(`|= "${chip.value}"`);
    } else {
      // Label filter
      labels.push(`${chip.field}="${chip.value}"`);
    }
  }

  // Build LogQL: {job="osmo", level="error"} |= "timeout"
  const labelPart = labels.length ? `, ${labels.join(', ')}` : '';
  const selector = `{${baseStream}${labelPart}}`;
  return selector + (lineFilters.length ? ' ' + lineFilters.join(' ') : '');
}

// Examples:
// [{ field: 'level', value: 'error' }]
//   → {job="osmo", level="error"}
//
// [{ field: 'task', value: 'foo' }, { field: 'text', value: 'timeout' }]
//   → {job="osmo", task="foo"} |= "timeout"
//
// [{ field: 'text', value: 'error' }, { field: 'text', value: 'failed' }]
//   → {job="osmo"} |= "error" |= "failed"
```

**No UI changes required** - FilterBar chips work identically, only adapter translation changes.

### Live Tailing (HTTP Streaming)

> ✅ **True HTTP streaming supported** - see [Backend API](#current-backend-api) for details.
> Uses Fetch API's `ReadableStream` to consume the streaming response.

```typescript
// src/lib/api/log-adapter/hooks/use-log-tail.ts

import { useEffect, useState, useRef, useCallback } from 'react';
import type { LogEntry } from '../types';
import { parseLogLine } from '../adapters/log-parser';

export function useLogTail({
  workflowId,
  taskName,
  enabled
}: {
  workflowId: string;
  taskName?: string;
  enabled: boolean;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const url = new URL(`/api/workflow/${workflowId}/logs`, window.location.origin);
    if (taskName) url.searchParams.set('task_name', taskName);

    try {
      setIsStreaming(true);
      const response = await fetch(url, { signal: controller.signal });
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';  // Keep incomplete line in buffer

        const newEntries = lines
          .filter(Boolean)
          .map(line => parseLogLine(line, workflowId));

        if (newEntries.length > 0) {
          setEntries(prev => [...prev, ...newEntries]);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err);
      }
    } finally {
      setIsStreaming(false);
    }
  }, [workflowId, taskName]);

  useEffect(() => {
    if (enabled) {
      startStream();
    }
    return () => {
      abortControllerRef.current?.abort();
    };
  }, [enabled, startStream]);

  return {
    entries,
    isStreaming,
    error,
    clear: () => setEntries([]),
    restart: startStream,
  };
}
```

**Key behaviors**:
- Connection stays open while workflow is running
- Logs stream in real-time as they're written to Redis
- Stream ends when workflow completes (backend sends END_FLAG)
- Abort controller allows clean cancellation

### Adapter Factory & Context

```typescript
// src/lib/api/log-adapter/index.ts

// For now, only PlainTextAdapter exists
// Factory pattern allows easy addition of LokiAdapter later
export function createAdapter(): LogAdapter {
  return new PlainTextAdapter();
}

// React Context
export function LogAdapterProvider({ children }: { children: React.ReactNode }) {
  const adapter = useMemo(() => createAdapter(), []);
  return <LogAdapterContext.Provider value={adapter}>{children}</LogAdapterContext.Provider>;
}

export function useLogAdapter(): LogAdapter {
  return useContext(LogAdapterContext);
}
```

**Future extension point:** When Loki is ready, update `createAdapter()` to check
`process.env.NEXT_PUBLIC_LOKI_URL` and return `LokiAdapter` if configured.

### React Query Hooks

```typescript
// src/lib/api/log-adapter/hooks/use-log-query.ts

export function useLogQuery(params: LogQuery) {
  const adapter = useLogAdapter();

  // Manual pagination - user clicks "Load older" / "Load newer"
  // NOT infinite scroll (log fetching is expensive)
  return useQuery({
    queryKey: ['logs', params],
    queryFn: () => adapter.query(params),
    staleTime: params.end ? Infinity : 10000,  // Historical = cached forever
  });
}

// For loading more logs in either direction
export function useLogQueryPaginated(params: LogQuery) {
  const adapter = useLogAdapter();

  return useInfiniteQuery({
    queryKey: ['logs-paginated', params],
    queryFn: ({ pageParam }) => adapter.query({ ...params, cursor: pageParam?.cursor, direction: pageParam?.direction }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? { cursor: lastPage.nextCursor, direction: 'forward' } : undefined,
    getPreviousPageParam: (firstPage) => firstPage.hasPrevious ? { cursor: firstPage.prevCursor, direction: 'backward' } : undefined,
    staleTime: params.end ? Infinity : 10000,
    // Manual triggers only - no auto-fetching
  });
}

// src/lib/api/log-adapter/hooks/use-log-histogram.ts
export function useLogHistogram(params, bucketCount = 50) {
  const adapter = useLogAdapter();
  return useQuery({
    queryKey: ['logs-histogram', params, bucketCount],
    queryFn: () => adapter.histogram(params, bucketCount),
    staleTime: 30000,
  });
}

// src/lib/api/log-adapter/hooks/use-log-capabilities.ts
export function useLogCapabilities() {
  const adapter = useLogAdapter();
  return adapter.capabilities;
}
```

### Progressive Enhancement in UI

```tsx
// Components adapt based on capabilities
function LogViewer({ workflowId }: Props) {
  const capabilities = useLogCapabilities();

  return (
    <div>
      <QueryBar
        searchHint={
          capabilities.contentSearchOptimized
            ? undefined
            : 'Tip: Filter by level or task first for faster results'
        }
      />

      <TimelineHistogram
        isApproximate={!capabilities.serverSideHistogram}
      />

      <FieldsPane
        isOptimized={capabilities.serverSideFacets}
      />
    </div>
  );
}
```

### Why This Architecture Enables Easy Loki Migration

| Aspect | Now (Plain Text) | Later (Loki) | UI Component Change |
|--------|:----------------:|:------------:|:-------------------:|
| Log fetching | ✅ Works | ✅ Works | None |
| Level filtering | ✅ Client-side | ✅ Server (fast) | None |
| Content search | ✅ Backend regex | ✅ LogQL filter | None |
| Histogram | ✅ Client-computed | ✅ Server-computed | None |
| Facets | ✅ Client-computed | ✅ Server-computed | None |
| Tailing | ✅ HTTP Streaming | ✅ WebSocket stream | None (hook abstracts) |
| Performance hints | Shows "slow" | Shows "fast" | None |

**When Loki is deployed (future):**
1. Add `loki-adapter.ts` implementing `LogAdapter` interface
2. Update `createAdapter()` to check env var and return LokiAdapter
3. Set `NEXT_PUBLIC_LOKI_URL=http://loki:3100`
4. **No UI component changes needed**

---

## UI Library Dependencies

### Existing shadcn/ui Components (17 available)

| Component | Use in Log Viewer |
|-----------|-------------------|
| `button` | Run, Tail, Download, Copy buttons |
| `input` | Search input |
| `select` | Time range presets |
| `dropdown-menu` | Options menu, context actions |
| `tooltip` | Hover info on histogram bars, buttons |
| `dialog` | Expanded full-screen log view |
| `badge` | Log level indicators, result count |
| `card` | Container sections |
| `skeleton` | Loading states |
| `collapsible` | Expandable context sections |
| `toggle` | Simple toggles |
| `command` (cmdk) | Quick actions, search palette |
| `context-menu` | Right-click on log entry |
| `tabs` | Already used in panel |
| `separator` | Dividers |
| `sheet` | Slide-out settings |
| `progress` | Loading indicator |

### shadcn/ui Components to Add (5 needed)

| Component | Required By | Use Case |
|-----------|-------------|----------|
| `checkbox` | Phase 4 | Multi-select levels in FieldsPane |
| `toggle-group` | Phase 3 | Level filter buttons (ERROR/WARN/INFO) |
| `slider` | Phase 3 | Time range selection in histogram |
| `popover` | Phase 2 | Filter dropdown, time range picker |
| `switch` | Phase 2 | Tail on/off toggle, wrap lines |

### Existing Libraries (no additions needed)

All libraries below are already installed in `package.json`:

#### State Management

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `zustand` | 5.0.9 | Log viewer store (UI state only, no persistence) |
| `immer` | 11.1.3 | Immutable state updates via zustand/middleware/immer |
| `nuqs` | 2.8.6 | URL state for shareable links (search, time range, levels) |

**Note**: Unlike table stores, log viewer does NOT need `persist` middleware.
Logs are cheap to refetch. State resets on navigation.

#### Data Fetching & Caching

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `@tanstack/react-query` | 5.90.12 | Log data fetching, infinite scroll, refetch |

**Existing Pattern to Follow**: `src/lib/api/pagination/use-paginated-data.ts`
- `useInfiniteQuery` for cursor/offset-based pagination
- Flattens pages into single items array
- Configurable staleTime, gcTime, prefetchThreshold
- Automatic reset on queryKey change (filter/sort)

**Log Viewer Usage**:
```typescript
// Manual pagination - user clicks "Load older" / "Load newer"
const { data, fetchNextPage, fetchPreviousPage, hasNextPage, hasPreviousPage } = useInfiniteQuery({
  queryKey: ['logs', workflowName, taskName, query],
  queryFn: ({ pageParam }) => adapter.query({ ...query, cursor: pageParam?.cursor }),
  getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
  getPreviousPageParam: (firstPage) => firstPage.hasPrevious ? firstPage.prevCursor : undefined,
});

// UI renders "Load older logs" and "Load newer logs" buttons
// NO auto-fetching on scroll - explicit user action required
```

#### Virtualization & Rendering

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `@tanstack/react-virtual` | 3.13.12 | Virtualized log list (core performance) |

**Existing Pattern to Follow**: `src/hooks/use-virtualizer-compat.ts`
- React Compiler compatible wrapper
- Uses `startTransition` instead of `flushSync`
- Direct `Virtualizer` class usage for better control

**Log Viewer Usage**:
- Variable row heights (wrapped lines expand)
- Sticky headers for timestamp groupings
- Scroll-to-index for jump to entry

#### Utility Hooks (from @react-hookz/web)

| Hook | Use in Log Viewer |
|------|-------------------|
| `useSyncedRef` | Stable refs for callbacks in effects |
| `useIsomorphicLayoutEffect` | SSR-safe layout effect |
| `useRafCallback` | RAF-throttled scroll handlers |
| `usePrevious` | Detect filter changes for auto-scroll |
| `useDocumentVisibility` | Pause tailing when tab inactive |

#### Utility Hooks (from usehooks-ts)

| Hook | Use in Log Viewer |
|------|-------------------|
| `useDebounceCallback` | Debounced search input (300ms) |
| `useResizeObserver` | Responsive histogram sizing |
| `useEventCallback` | Stable callbacks for event handlers |
| `useBoolean` | Toggle states (wrap lines, regex mode) |
| `useInterval` | Reconnection retry for streaming |
| `useUnmount` | Cleanup on unmount |
| `useCopyToClipboard` | Copy log entry/link |

#### Gestures & Interaction

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `@use-gesture/react` | 10.3.1 | Histogram drag selection for time range |
| `react-hotkeys-hook` | 5.2.3 | Keyboard navigation (j/k, /, G, gg) |

**Existing Pattern to Follow**: `src/components/panel/side-panel.tsx`
- `useDrag` from @use-gesture/react for resize handles
- Combines with CSS transitions for smooth UX

#### Time & Parsing

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `chrono-node` | 2.9.0 | Natural language time input ("last 1 hour", "yesterday") |

**Log Viewer Usage**:
```typescript
import * as chrono from 'chrono-node';
const parsed = chrono.parseDate('last 30 minutes'); // → Date object
```

#### Icons & Styling

| Library | Version | Use in Log Viewer |
|---------|:-------:|-------------------|
| `lucide-react` | 0.562.0 | All icons (Search, Filter, Download, etc.) |
| `class-variance-authority` | 0.7.1 | LogEntryRow variants (level colors) |
| `clsx` + `tailwind-merge` | - | Conditional classes with @/lib/utils cn() |

---

### Custom Implementations Required

These need to be built from scratch (no suitable existing library):

| Component/Lib | Complexity | Lines Est. | Notes |
|---------------|:----------:|:----------:|-------|
| `log-parser.ts` | Medium | ~150 | **Critical** - optimized for OSMO format, strips ANSI |
| `log-index.ts` | Medium | ~200 | In-memory index for fast filtering |
| `level-utils.ts` | Low | ~40 | Level colors, icons, ordering |
| `TimelineHistogram` | Medium | ~200 | Custom SVG bars with severity colors |
| `FieldsPane` | Medium | ~150 | Faceted filter sidebar with counts |
| `LogContext` | Medium | ~100 | Expanded context view |
| `LogEntryRow` | Low | ~100 | Single log line with level badge |
| `LogList` | Medium | ~150 | TanStack Virtual wrapper |

---

### Log Parser & Index Implementation (Critical Path)

> **Performance-critical code** - runs on every log line during streaming.
> Optimized for the known OSMO log format (see [Log Format Specification](#log-format-specification)).

#### Parser Design Principles

1. **Fixed-format parsing**: OSMO logs have a known format, so we use position-based parsing where possible
2. **Pre-compiled regexes**: Compile patterns once at module load, reuse for all lines
3. **Early exit on first char**: Check if line starts with digit before running regex
4. **Batch-friendly**: Parse multiple lines without intermediate allocations

#### Optimized Parser Implementation

```typescript
// src/lib/api/log-adapter/adapters/log-parser.ts

import type { LogEntry, LogLevel } from '@/lib/api/log-adapter/types';

// Pre-compiled at module load (not per-call)
const TIMESTAMP_RE = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/;
const TASK_RE = /^\[([^\]\s]+)(?:\s+retry-(\d+))?\]/;
const OSMO_RE = /^\[osmo\]/;
const ANSI_RE = /\x1b\[[0-9;]*m/g;  // Strip ANSI escape codes

// Level patterns ordered by frequency
const LEVEL_PATTERNS: ReadonlyArray<readonly [RegExp, LogLevel]> = [
  [/^ERROR[:\s]/i, 'error'],
  [/^WARN(?:ING)?[:\s]/i, 'warn'],
  [/^INFO[:\s]/i, 'info'],
  [/^DEBUG[:\s]/i, 'debug'],
  [/^FATAL[:\s]/i, 'fatal'],
];

let idCounter = 0;

export function parseLogLine(line: string, workflowId: string): LogEntry | null {
  if (!line) return null;

  // Fast path: timestamp lines start with digit
  if (line.charCodeAt(0) < 48 || line.charCodeAt(0) > 57) {
    return parseDumpLine(line, workflowId);
  }

  const tsMatch = TIMESTAMP_RE.exec(line);
  if (!tsMatch) return parseDumpLine(line, workflowId);

  // Parse timestamp from groups (faster than Date.parse)
  const timestamp = new Date(Date.UTC(
    +tsMatch[1], +tsMatch[2] - 1, +tsMatch[3],
    +tsMatch[4], +tsMatch[5], +tsMatch[6]
  ));

  // After timestamp: "YYYY/MM/DD HH:MM:SS " = 20 chars
  let pos = 20;
  const taskMatch = TASK_RE.exec(line.slice(pos));
  if (!taskMatch) return parseDumpLine(line, workflowId);

  const task = taskMatch[1];
  const retry = taskMatch[2] ?? '0';
  pos += taskMatch[0].length;

  // Check for [osmo] suffix
  const afterTask = line.slice(pos);
  const isOsmo = OSMO_RE.test(afterTask);
  if (isOsmo) pos += 6;

  // Skip space, extract message, strip ANSI codes
  if (line.charCodeAt(pos) === 32) pos++;
  const message = line.slice(pos).replace(ANSI_RE, '');
  const level = detectLevel(message);

  return {
    id: `${timestamp.getTime()}-${++idCounter}`,
    timestamp,
    line,
    labels: {
      workflow: workflowId,
      task,
      retry,
      level,
      io_type: isOsmo ? 'osmo_ctrl' : 'stdout',
    },
  };
}

function parseDumpLine(line: string, workflowId: string): LogEntry {
  return {
    id: `dump-${Date.now()}-${++idCounter}`,
    timestamp: new Date(),
    line,
    labels: { workflow: workflowId, level: 'info', io_type: 'dump' },
  };
}

function detectLevel(msg: string): LogLevel {
  const first = msg.charCodeAt(0) | 32;
  if (first !== 101 && first !== 119 && first !== 105 &&
      first !== 100 && first !== 102) return 'info';
  for (const [re, lvl] of LEVEL_PATTERNS) {
    if (re.test(msg)) return lvl;
  }
  return 'info';
}

export function parseLogBatch(text: string, workflowId: string): LogEntry[] {
  const lines = text.split('\n');
  const entries: LogEntry[] = [];
  for (const line of lines) {
    const entry = parseLogLine(line, workflowId);
    if (entry) entries.push(entry);
  }
  return entries;
}
```

#### Log Index for Fast Filtering

```typescript
// src/lib/api/log-adapter/adapters/log-index.ts

import type { LogEntry, LogLevel } from '@/lib/api/log-adapter/types';

/**
 * In-memory index enabling O(1) label filtering and pre-computed facets.
 * Histogram buckets are computed incrementally as logs stream in.
 */
export class LogIndex {
  private entries: LogEntry[] = [];
  private byLevel = new Map<LogLevel, Set<number>>();
  private byTask = new Map<string, Set<number>>();
  private levelCounts = new Map<LogLevel, number>();
  private taskCounts = new Map<string, number>();
  private buckets = new Map<number, Map<LogLevel, number>>();
  private bucketMs = 60_000;

  addEntries(newEntries: LogEntry[]): void {
    const base = this.entries.length;
    for (let i = 0; i < newEntries.length; i++) {
      const e = newEntries[i];
      const idx = base + i;
      this.entries.push(e);

      const level = e.labels.level ?? 'info';
      this.indexAdd(this.byLevel, level, idx);
      this.levelCounts.set(level, (this.levelCounts.get(level) ?? 0) + 1);

      if (e.labels.task) {
        this.indexAdd(this.byTask, e.labels.task, idx);
        this.taskCounts.set(e.labels.task, (this.taskCounts.get(e.labels.task) ?? 0) + 1);
      }

      const bk = Math.floor(e.timestamp.getTime() / this.bucketMs);
      if (!this.buckets.has(bk)) this.buckets.set(bk, new Map());
      const b = this.buckets.get(bk)!;
      b.set(level, (b.get(level) ?? 0) + 1);
    }
  }

  private indexAdd<K>(m: Map<K, Set<number>>, k: K, i: number): void {
    let s = m.get(k); if (!s) { s = new Set(); m.set(k, s); } s.add(i);
  }

  filter(opts: { levels?: LogLevel[]; tasks?: string[]; search?: string }): LogEntry[] {
    let idx: Set<number> | null = null;
    if (opts.levels?.length) idx = this.union(opts.levels.map(l => this.byLevel.get(l)));
    if (opts.tasks?.length) {
      const ti = this.union(opts.tasks.map(t => this.byTask.get(t)));
      idx = idx ? this.intersect(idx, ti) : ti;
    }
    const cands = idx ? [...idx].sort((a,b) => a-b).map(i => this.entries[i]) : this.entries;
    if (opts.search) {
      const re = new RegExp(opts.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      return cands.filter(e => re.test(e.line));
    }
    return cands;
  }

  private union(sets: (Set<number> | undefined)[]): Set<number> {
    const r = new Set<number>();
    for (const s of sets) if (s) for (const v of s) r.add(v);
    return r;
  }
  private intersect(a: Set<number>, b: Set<number>): Set<number> {
    const r = new Set<number>();
    for (const v of a) if (b.has(v)) r.add(v);
    return r;
  }

  getFacets() { return { levels: this.levelCounts, tasks: this.taskCounts }; }

  getHistogram() {
    return [...this.buckets.entries()]
      .sort(([a],[b]) => a - b)
      .map(([k, c]) => ({
        timestamp: new Date(k * this.bucketMs),
        counts: c,
        total: [...c.values()].reduce((a,b) => a+b, 0),
      }));
  }

  get size() { return this.entries.length; }
  getAll() { return this.entries; }
  clear() {
    this.entries = [];
    this.byLevel.clear(); this.byTask.clear();
    this.levelCounts.clear(); this.taskCounts.clear();
    this.buckets.clear();
  }
}
```

#### Performance Characteristics

| Operation | Complexity | Notes |
|-----------|:----------:|-------|
| Parse 1 line | O(1) | Fixed-format, no backtracking |
| Parse 100K lines | O(N) | ~50ms on modern hardware |
| Filter by level | O(K) | K = matching entries (index lookup) |
| Filter level + task | O(min) | Set intersection |
| Text search | O(N) | Regex on candidates |
| Get facets | O(1) | Pre-computed counts |
| Get histogram | O(B) | B ≈ 100 buckets |

#### Memory Budget (100K entries)

| Component | Size | Notes |
|-----------|:----:|-------|
| Entry objects | ~20MB | ~200 bytes each |
| Level index | ~400KB | 5 Sets × 20K avg |
| Task index | ~400KB | 10 tasks × 10K avg |
| Histogram | ~4KB | 100 buckets × 5 levels |
| **Total** | **~21MB** | Well under 50MB budget |

---

### Performance Optimization Libraries

Already available in the codebase:

| Optimization | Library/Pattern | Implementation |
|--------------|-----------------|----------------|
| **Virtualization** | `@tanstack/react-virtual` | Only render visible rows (~50 at a time) |
| **Debounced search** | `usehooks-ts/useDebounceCallback` | 300ms debounce on search input |
| **RAF throttling** | `@react-hookz/web/useRafCallback` | 60fps scroll event handling |
| **Memoization** | React `memo`, `useMemo` | Cache filtered results, computed histograms |
| **Stable callbacks** | `useEventCallback` | Prevent unnecessary re-renders |
| **Visibility pause** | `@react-hookz/web/useDocumentVisibility` | Pause streaming when tab inactive |
| **Immer** | `zustand/middleware/immer` | Efficient immutable updates |
| **Query caching** | `@tanstack/react-query` | Automatic caching, stale-while-revalidate |

**Performance Targets**:
- 100K log entries: < 100ms initial render (virtualized)
- Search: < 300ms response time (debounced + cached)
- Tail: 60fps updates, max 100 entries/batch
- Memory: < 50MB for 100K entries (line refs, not full text)

---

## Implementation Phases

> **Source of Truth**: Canonical types are in `src/lib/api/log-adapter/types.ts`
> **Backend API**: `GET /api/workflow/{name}/logs` (see [Backend API](#current-backend-api))

### Phase 0: Prerequisites + Experimental Page

**Goal**: Set up dev environment for rapid iteration

**Tasks:**

1. Add shadcn/ui components:
```bash
# Run in external/ui-next/
npx shadcn@latest add popover switch toggle-group slider checkbox
```

2. Create experimental page skeleton:

| File | Description |
|------|-------------|
| `src/app/(dashboard)/experimental/log-viewer/page.tsx` | Server component (dev-only) |
| `src/app/(dashboard)/experimental/log-viewer/log-viewer-playground.tsx` | Main playground client |
| `src/mocks/generators/log-scenarios.ts` | Scenario configurations |

3. Register in experimental index:
```typescript
// src/app/(dashboard)/experimental/experimental-client.tsx
import { ScrollText } from "lucide-react";

const experimentalPages: ExperimentalPage[] = [
  {
    title: "Log Viewer",
    href: "/experimental/log-viewer",
    description: "Log viewer component playground with mock scenarios",
    icon: ScrollText,
  },
];
```

**Acceptance**: Navigate to `/experimental/log-viewer`, see scenario selector and empty placeholder for LogViewer.

---

### Phase 1: Core Foundation

**Goal**: Build adapter layer and basic rendering components

**Create these files**:

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/types.ts` | Canonical types (copy from [Core Types](#core-types-loki-aligned)) |
| `src/lib/api/log-adapter/constants.ts` | Log level colors, field names |
| `src/lib/api/log-adapter/index.ts` | Factory, context provider |
| `src/lib/api/log-adapter/adapters/plain-text-adapter.ts` | Implements `LogAdapter` |
| `src/lib/api/log-adapter/adapters/log-parser.ts` | Parse log lines → `LogEntry`, strips ANSI (see [Parser Implementation](#log-parser--index-implementation-critical-path)) |
| `src/lib/api/log-adapter/adapters/log-index.ts` | In-memory index for fast filtering (see [Log Index](#log-index-for-fast-filtering)) |
| `src/components/log-viewer/lib/level-utils.ts` | Level colors, icons |
| `src/components/log-viewer/components/LogEntryRow.tsx` | Single log line |
| `src/components/log-viewer/components/LogList.tsx` | TanStack Virtual list |

**Acceptance**: Can render a hardcoded array of log lines with level badges.

---

### Phase 2: Basic Viewer

**Goal**: Integrate with backend, add search and download

**Create these files**:

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/hooks/use-log-query.ts` | TanStack Query with manual pagination |
| `src/components/log-viewer/store/log-viewer-store.ts` | Zustand UI state |
| `src/components/log-viewer/components/QueryBar.tsx` | Wraps FilterBar with log fields (see [QueryBar](#querybar-reuses-filterbar)) |
| `src/components/log-viewer/components/LogToolbar.tsx` | Download, tail toggle |
| `src/components/log-viewer/components/LogViewer.tsx` | Main container |
| `src/components/log-viewer/index.ts` | Public exports |

**Integration point**: Replace `EmptyTabPrompt` in `TaskDetails.tsx` Logs tab with `<LogViewer />`.

**Acceptance**: Can fetch and display logs from `/api/workflow/{name}/logs`, search works.

---

### Phase 3: Timeline & Filtering

**Goal**: Add histogram and level filtering

**Create these files**:

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/hooks/use-log-histogram.ts` | Compute buckets client-side |
| `src/components/log-viewer/components/TimelineHistogram.tsx` | Custom SVG bars |

**Modify existing**:
- `QueryBar.tsx`: Add time range picker (`popover` + date inputs) alongside FilterBar

**Acceptance**: Histogram shows log distribution, clicking bar filters to that time, level buttons work.

---

### Phase 4: Fields Pane & Context

**Goal**: Add faceted filtering and context expansion

**Create these files**:

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/hooks/use-log-facets.ts` | Compute field counts client-side |
| `src/components/log-viewer/components/FieldsPane.tsx` | Left sidebar with facets |
| `src/components/log-viewer/components/LogContext.tsx` | Expanded context view |

**Modify existing**:
- `LogViewer.tsx`: Add left sidebar layout with `FieldsPane`
- `LogEntryRow.tsx`: Add expand button, integrate `LogContext`

**Acceptance**: Fields sidebar shows task/level counts, clicking filters logs, expanding shows context.

---

### Phase 5: Live Tailing

**Goal**: Add HTTP streaming-based live updates

**Create these files**:

| File | Description |
|------|-------------|
| `src/lib/api/log-adapter/hooks/use-log-tail.ts` | HTTP streaming via ReadableStream |

**Modify existing**:
- `LogViewer.tsx`: Integrate tailing hook, auto-scroll logic
- `LogToolbar.tsx`: Add tailing indicator (pulsing dot), pause/resume

**Acceptance**: Logs stream in real-time when tailing (connection stays open), auto-scroll works, pauses on scroll up.

---

### Phase 6: Polish & Integration

**Goal**: Keyboard nav, accessibility, performance

**Keyboard Shortcuts (vim-style):**

| Key | Action | Scope |
|-----|--------|-------|
| `j` / `↓` | Next entry | List focused |
| `k` / `↑` | Previous entry | List focused |
| `Enter` | Expand/collapse entry | Entry selected |
| `/` | Focus search | Anywhere |
| `Escape` | Clear search / close expanded | Depends |
| `G` | Jump to bottom (latest) | List focused |
| `g` `g` | Jump to top (oldest) | List focused |
| `c` | Copy selected entry | Entry selected |
| `l` | Copy link to entry | Entry selected |
| `t` | Toggle tailing | Anywhere |

**Accessibility (ARIA):**

```tsx
// LogList.tsx - roving tabindex pattern
<div
  role="log"
  aria-label="Workflow logs"
  aria-live="polite"       // Announce new entries when tailing
  aria-busy={isStreaming}
>
  {entries.map((entry, i) => (
    <div
      role="article"
      aria-posinset={i + 1}
      aria-setsize={entries.length}
      tabIndex={i === focusedIndex ? 0 : -1}
      aria-expanded={expandedIds.has(entry.id)}
    >
      {/* entry content */}
    </div>
  ))}
</div>

// Screen reader announcements
const { announcer } = useServices();
useEffect(() => {
  if (newEntriesCount > 0 && isTailing) {
    announcer.announce(`${newEntriesCount} new log entries`, 'polite');
  }
}, [newEntriesCount]);
```

**Tasks**:
- Add to `WorkflowDetails.tsx` Logs tab (workflow-level logs)
- Implement keyboard shortcuts above
- Copy log entry, copy shareable link
- Screen reader announcements for new entries
- Focus management on expand/collapse
- Performance testing with 100K+ entries

---

## Mock System for Development

> **Goal**: High-fidelity mock system for rapid AI-assisted iteration without real backend.

### Log Scenarios

Pre-defined scenarios selectable via URL param `?log_scenario=X`:

| Scenario | Description | Volume | Use Case |
|----------|-------------|--------|----------|
| `normal` | Typical training workflow | 500-2k lines | Default happy path |
| `error-heavy` | 30% errors, 20% warns | 500-1k lines | Error UI testing |
| `high-volume` | Large workflow | 100k+ lines | Performance testing |
| `empty` | Zero logs | 0 lines | Empty state UI |
| `streaming` | Trickle 1-5 lines/sec | Unbounded | Tailing simulation |
| `retries` | Tasks with retry-1, retry-2 | 1k lines | Retry filtering |
| `multiline` | Stack traces, JSON blobs | 500 lines | Multi-line expansion |
| `ansi` | ANSI escape codes | 200 lines | Strip testing |
| `mixed` | All IOTypes interleaved | 2k lines | IOType filtering |

### Enhanced LogGenerator

Extend `src/mocks/generators/log-generator.ts`:

```typescript
interface LogScenarioConfig {
  name: string;
  volume: { min: number; max: number };
  levelDistribution: Record<LogLevel, number>;
  ioTypeDistribution: Record<IOType, number>;
  features: {
    retries: boolean;
    multiLine: boolean;
    ansiCodes: boolean;
    streaming: boolean;
    streamDelayMs?: number;  // For streaming scenario
  };
}

const LOG_SCENARIOS: Record<string, LogScenarioConfig> = {
  normal: {
    volume: { min: 500, max: 2000 },
    levelDistribution: { info: 0.85, warn: 0.1, error: 0.04, debug: 0.01 },
    ioTypeDistribution: { stdout: 0.6, osmo_ctrl: 0.3, stderr: 0.05, download: 0.025, upload: 0.025 },
    features: { retries: false, multiLine: false, ansiCodes: false, streaming: false },
  },
  'error-heavy': {
    volume: { min: 500, max: 1000 },
    levelDistribution: { info: 0.5, warn: 0.2, error: 0.28, debug: 0.02 },
    // ...
  },
  streaming: {
    volume: { min: 10000, max: 50000 },
    features: { streaming: true, streamDelayMs: 200 },
    // ...
  },
  // ... other scenarios
};
```

### Log Format (Match Real Backend Exactly)

Parser-compatible format from `external/src/utils/connectors/redis.py`:

```
{YYYY/MM/DD HH:mm:ss} [{task_name}] {message}                    # Normal stdout
{YYYY/MM/DD HH:mm:ss} [{task_name} retry-{N}] {message}          # Retry stdout
{YYYY/MM/DD HH:mm:ss} [{task_name}][osmo] {message}              # OSMO control
{YYYY/MM/DD HH:mm:ss} [{task_name} retry-{N}][osmo] {message}    # Retry OSMO
{message}                                                         # DUMP (raw)
```

### HTTP Streaming Handler

MSW handler simulating FastAPI `StreamingResponse`:

```typescript
// src/mocks/handlers.ts - Enhanced log handler
http.get("/api/workflow/:name/logs", async function* ({ request, params }) {
  const url = new URL(request.url);
  const scenario = url.searchParams.get('log_scenario') || 'normal';
  const taskFilter = url.searchParams.get('task_name');
  const lastN = parseInt(url.searchParams.get('last_n_lines') || '0');

  const config = LOG_SCENARIOS[scenario];
  const generator = logGenerator.createStream(params.name, config);

  // For streaming scenario, return ReadableStream
  if (config.features.streaming) {
    const stream = new ReadableStream({
      async start(controller) {
        for await (const chunk of generator) {
          controller.enqueue(new TextEncoder().encode(chunk));
          await delay(config.features.streamDelayMs);
        }
        controller.close();
      }
    });

    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // For non-streaming, return all at once
  const logs = logGenerator.generateWorkflowLogs(params.name, scenario);
  return HttpResponse.text(logs);
});
```

### Developer Controls

URL params for testing (dev only):

| Param | Values | Effect |
|-------|--------|--------|
| `log_scenario` | `normal`, `error-heavy`, `high-volume`, etc. | Select scenario |
| `log_delay` | `0-5000` (ms) | Override stream delay |
| `log_count` | Number | Override line count |
| `log_error_rate` | `0-1` | Override error rate |

### Directory Structure

```
src/mocks/generators/
├── log-generator.ts           # Enhanced generator
├── log-scenarios.ts           # Scenario configs (NEW)
└── log-stream-generator.ts    # Async streaming generator (NEW)
```

### Test Helpers

```typescript
// Test utility for log viewer tests
import { setLogScenario, resetLogScenario } from '@/mocks/generators';

describe('LogViewer', () => {
  beforeEach(() => setLogScenario('normal'));
  afterEach(() => resetLogScenario());

  it('handles high volume logs', () => {
    setLogScenario('high-volume');
    // ... test
  });

  it('shows errors prominently', () => {
    setLogScenario('error-heavy');
    // ... test
  });
});
```

### Experimental Page (`/experimental/log-viewer`)

Dedicated page for developing and testing the log viewer:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  🧪 Log Viewer Playground                                    [Dev Only]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Scenario: [normal ▼]  Container: [Panel ▼]  Workflow: [train-llama-01 ▼]  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                                                                     │   │
│  │              < LogViewer component renders here >                   │   │
│  │                                                                     │   │
│  │              (resizable container to test responsive)               │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Controls:                                                                  │
│  [▶ Start Tailing] [⏸ Pause] [🔄 Reset] [📊 Show Stats]                    │
│                                                                             │
│  Debug Panel:                                                               │
│  • Entries in memory: 1,234                                                │
│  • Render time: 2.3ms                                                      │
│  • Index size: 45KB                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Controls:**

| Control | Options | Purpose |
|---------|---------|---------|
| Scenario | Dropdown of all scenarios | Quick switch test data |
| Container | `Panel (400px)`, `Wide (800px)`, `Full`, `Custom` | Test responsive |
| Workflow | Mock workflow names | Switch context |
| Task | Tasks within workflow | Test task scope |
| Tailing | Start/Pause/Reset | Test streaming |
| Stats | Toggle debug panel | Performance monitoring |

**Files:**

```
src/app/(dashboard)/experimental/log-viewer/
├── page.tsx                    # Server component (dev-only redirect)
├── log-viewer-playground.tsx   # Client component with controls
└── components/
    ├── ScenarioSelector.tsx    # Dropdown with scenario descriptions
    ├── ContainerSizer.tsx      # Resizable container wrapper
    └── DebugPanel.tsx          # Memory, render stats
```

### Production Integration (Mock Mode)

When LogViewer is used in production pages (e.g., `TaskDetails.tsx`), mocks work automatically via MSW:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Mock Architecture                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Production UI Pages                    Mock Infrastructure                 │
│  ─────────────────────                  ──────────────────                  │
│                                                                             │
│  WorkflowDetails.tsx ──────┐                                                │
│  TaskDetails.tsx ──────────┼─→ fetch('/api/workflow/:name/logs')            │
│  LogViewer.tsx ────────────┘            │                                   │
│                                         ▼                                   │
│                              ┌─────────────────────┐                        │
│                              │   MSW Handler       │◄── log-scenarios.ts    │
│                              │   (handlers.ts)     │◄── log-generator.ts    │
│                              └─────────────────────┘                        │
│                                         │                                   │
│                                         ▼                                   │
│                              ┌─────────────────────┐                        │
│                              │  HTTP Streaming     │  For tailing:          │
│                              │  (ReadableStream)   │  chunks trickle in     │
│                              └─────────────────────┘                        │
│                                                                             │
│  Comparison to Shell:                                                       │
│  ─────────────────────                                                      │
│  • Shell uses WebSocket → mock-ws-server.mjs (separate Node process)       │
│  • Logs use HTTP Stream → MSW handler (same process, no extra server)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Why HTTP streaming works in MSW (no separate server needed):**

```typescript
// handlers.ts - MSW supports ReadableStream natively
http.get("/api/workflow/:name/logs", async ({ request, params }) => {
  const url = new URL(request.url);
  const scenario = url.searchParams.get('_scenario') || 'normal';
  const isStreaming = scenario === 'streaming';

  if (isStreaming) {
    // Return ReadableStream that emits chunks over time
    const stream = new ReadableStream({
      async start(controller) {
        const entries = logGenerator.generateEntries(params.name, scenario);
        for (const entry of entries) {
          controller.enqueue(new TextEncoder().encode(entry + '\n'));
          await new Promise(r => setTimeout(r, 200)); // Trickle delay
        }
        controller.close();
      }
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  // Non-streaming: return all at once
  const logs = logGenerator.generateWorkflowLogs(params.name, scenario);
  return HttpResponse.text(logs);
});
```

**Scenario Selection in Production Pages:**

```typescript
// Option 1: URL param (dev only)
// /workflows/train-llama-01?_log_scenario=error-heavy

// Option 2: Console API (like existing __mockConfig)
window.__logMock = {
  setScenario: (s: string) => { currentScenario = s; },
  getScenario: () => currentScenario,
  help: () => console.log('Available: normal, error-heavy, streaming, ...'),
};

// Option 3: MockProvider integration
// src/mocks/MockProvider.tsx - add log controls to existing __mockConfig
window.__mockConfig.setLogScenario = async (scenario) => { ... };
```

**Key Difference from Shell Mocks:**

| Aspect | Shell (PTY) | Logs |
|--------|-------------|------|
| Protocol | WebSocket (bidirectional) | HTTP Streaming (unidirectional) |
| Mock Server | `mock-ws-server.mjs` (port 3001) | MSW handler (in-process) |
| Interactivity | User types commands | Read-only stream |
| State | Session-based | Stateless per request |

### Implementation Priority

| Priority | Task | Why |
|----------|------|-----|
| P0 | Experimental page skeleton | Preview as we build |
| P0 | `log-scenarios.ts` with scenario configs | Foundation for all testing |
| P0 | Enhanced `log-generator.ts` with scenario support | Core mock functionality |
| P1 | HTTP streaming MSW handler | Tailing simulation (no extra server!) |
| P1 | `__mockConfig.setLogScenario()` | Console control in prod pages |
| P1 | Resizable container + debug panel | Performance iteration |
| P2 | Test helpers | Automated testing |

---

## Key Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Component type | Client component | Interactive, state-heavy |
| React 19 | `startTransition` + `useDeferredValue` | Non-blocking filter/search |
| Virtual scroll | TanStack Virtual + `contain-strict` | Required for >50 items |
| Backend | Loki (future) | Build PlainTextAdapter now, LokiAdapter later |
| Tailing | HTTP Streaming | FastAPI `StreamingResponse` → `fetch` + `ReadableStream` |
| Histogram | Always visible (full/compact modes) | Full: bars, Compact: strip when < 80px |
| Scope | Navigation = Scope | Task panel → task logs only (like ArgoCD) |
| State persistence | None (stateless) | Cheap to refetch, filters in URL via `nuqs` |
| Pagination | Explicit "Load older/newer" | Logs expensive, no infinite scroll |
| Error handling | Preserve logs | Show error, keep existing logs visible |
| Log levels | Parse from message | Detect `ERROR:`, `WARN:`, etc. prefix |
| ANSI | Strip | `text.replace(/\x1b\[[0-9;]*m/g, '')` |
| Query UI | Reuse FilterBar | Chips → LogQL transparent conversion |
