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

# Timeline & Time Filtering Design

## Core Insight: Workflow-Bounded Logs

Unlike generic log viewers, our logs are **workflow-bounded**:

- Logs only exist after a workflow/task starts
- Logs end when the workflow/task terminates (or continue to NOW if running)
- There is no concept of "unbounded" time selection

This fundamentally shapes the UX: we don't need a generic date picker. We need a **workflow-aware time selector**.

---

## Workflow Lifecycle States

| State | start_time | end_time | Log Availability |
|-------|-----------|----------|------------------|
| Pending | undefined | undefined | No logs yet - show placeholder |
| Running | set | undefined | Logs from start_time to NOW |
| Terminated | set | set | Fixed log window: start_time to end_time |

**Safe bounds** (guaranteed to encompass all possible logs):
- **Lower bound**: `workflow.submit_time` (strictly before first log)
- **Upper bound**: `workflow.end_time ?? NOW` (strictly after last log)

---

## Backend Considerations

### Redis Stream Capping

Logs are stored in Redis Streams with `MAXLEN` (default: 10,000 lines). This means:

- For long-running workflows, early logs may be evicted
- `workflow.start_time` is not necessarily the earliest *available* log
- However, for time bounds, we use "safe bounds" not "available bounds"

### Log Streaming

- `useLogTail` streams new logs via SSE
- Receives `END_FLAG` when workflow terminates
- This provides real-time notification of workflow completion

---

## Unified Histogram as Time Selector

**Key decision**: The histogram IS the time picker.

Instead of a separate date/time picker popover, the histogram serves dual purposes:
1. **Visualization**: Shows log density over time
2. **Selection**: Drag to select time range directly on the visualization

```
[All] [First 5m] [Last 15m] [Last 1h]                       10:30 - NOW
+------------------------------------------------------------------------+
|    ▃▅█▇▃▂▁▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅               |
|    |<-------------- [===========|=========] ----------------->| NOW    |
|  10:30                       selection                        11:45    |
+------------------------------------------------------------------------+
```

### Why This Approach

1. **Context**: Users see log density while selecting - can target spikes/gaps
2. **Direct manipulation**: No abstraction layer between data and selection
3. **No modal interruption**: Inline, always-visible control
4. **Familiar pattern**: Similar to video timeline scrubbing
5. **Less UI**: No separate picker component needed

---

## Time Range Controls

Above the histogram, simple preset buttons + current range display:

```
[All] [First 5m] [Last 15m] [Last 1h]                    10:30 - NOW
```

### Presets

Presets are **relative to workflow**, not calendar:

| Preset | Meaning |
|--------|---------|
| All | Full workflow duration |
| First 5m | First 5 minutes from start_time |
| Last 15m | Last 15 minutes (from NOW or end_time) |
| Last 1h | Last hour (from NOW or end_time) |

### Streaming State (Implicit)

No explicit toggle. Streaming is determined by time range end:

- `end = undefined (NOW)` → streaming active, new logs appear
- `end = fixed time` → historical view, no streaming

---

## Histogram Selection Behavior

### Selection Overlay

- Semi-transparent highlight over selected range
- Bars outside selection are dimmed (opacity ~0.3), not hidden
- Visual drag handles at selection edges

### Interactions

| Action | Result |
|--------|--------|
| Drag handle | Adjust start/end of selection |
| Click bar | Zoom to that bucket's time range |
| Click preset | Apply preset range |

### Clamping

Selection is always clamped to workflow bounds:
- Cannot select before workflow.start_time
- Cannot select after workflow.end_time (or NOW if running)

---

## State Management

Time range state lives in `LogViewerContainer` (not Zustand store) because:

1. It affects data fetching (passed to `useLogData`)
2. It's specific to a workflow instance
3. It should reset when navigating to a different workflow

```typescript
interface TimeRange {
  start?: Date;  // undefined = workflow start
  end?: Date;    // undefined = NOW (streaming active)
}
```

**Streaming is implicit**: `end === undefined` means streaming, `end !== undefined` means historical view.

---

## Data Flow Summary

```
Page (workflow metadata)
    ↓ startTime, endTime, status
LogViewerContainer
    ↓ bounds, timeRange state, display settings
    ├── SearchBar (text search)
    ├── FacetBar (facet dropdowns)
    ├── Timeline (presets, histogram, range display)
    ├── LogList (entries)
    ├── Footer (display toggles, actions)
    └── useLogData (start, end, filters)
            ↓
        filterEntries (client-side filtering)
```

---

## Layout: 5-Section Design

### Final Layout

```
+------------------------------------------------------------------+
| [🔍 search logs...                                        2,450] | ← SearchBar
+------------------------------------------------------------------+
| [Level (1) ▾] [Task (2) ▾] [Source ▾]                            | ← FacetBar
+------------------------------------------------------------------+
| [All] [5m] [15m] [1h]                          10:30 - NOW       | ← Timeline
|  ▃▅█▇▃▂▁▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅             |
+------------------------------------------------------------------+
| LogList (full width)                                             | ← Logs
|                                                                  |
+------------------------------------------------------------------+
| [Wrap] [Task] [⬇]                                      [Refresh] | ← Footer
+------------------------------------------------------------------+
```

**5 sections:**

| Section | Purpose |
|---------|---------|
| SearchBar | Text search + result count |
| FacetBar | Category filtering (facet dropdowns) |
| Timeline | Time filtering (presets + histogram) |
| Logs | Full-width log entries |
| Footer | Display options + actions + future controls |

### SearchBar

```
+------------------------------------------------------------------+
| [🔍 search logs...                                        2,450] |
+------------------------------------------------------------------+
```

**Search input:**
- Free text search only (no chips)
- Placeholder: "search logs..."
- Suffix: entry count (e.g., "2,450")
- Matches against log message content

**Purpose**: Text search (focused, clean)

### FacetBar (Line 2)

```
+------------------------------------------------------------------+
| [Level (1) ▾] [Task (2) ▾] [Source ▾]                            |
+------------------------------------------------------------------+
```

**Facet dropdown buttons with selection count badges:**
- `[Level ▾]` = no selections
- `[Level (1) ▾]` = 1 value selected
- `[Level (2) ▾]` = 2 values selected

**Purpose**: "Filter by category"

**No chips in bar** - selected values visible inside dropdown (checked items)

**No Live toggle** - streaming state is implicit (see below)

### Facet Dropdown Behavior

Clicking `[Level (1) ▾]` opens popover with counts:

```
+------------------------+
|  ☐ debug      (1,203)  |
|  ☐ info         (892)  |
|  ☐ warn          (45)  |
|  ☑ error         (42)  | ← checked = active filter
+------------------------+
```

- Checkboxes for multi-select
- Counts from facet data
- Selection updates button badge (no chips in bar)
- Can include "Clear" action to reset facet

### Timeline Section

```
+------------------------------------------------------------------+
| [All] [5m] [15m] [1h]                          10:30 - NOW       |
|  ▃▅█▇▃▂▁▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅▇█▆▄▂▃▅▇█▅▃▁▂▄▆█▇▄▂▃▅             |
+------------------------------------------------------------------+
```

- Preset buttons (relative to workflow bounds)
- Current range display  
- Histogram with drag-to-select

### Footer

```
+------------------------------------------------------------------+
| [Wrap] [Task] [⬇]                                      [Refresh] |
+------------------------------------------------------------------+
```

**Left side (display options):**
- Wrap lines toggle
- Show task labels toggle
- Download button

**Right side (actions):**
- Refresh button
- (Future: export, share, settings, etc.)

**Purpose**: Stable "control dock" for display settings and actions

### What Gets Merged/Removed

| Before | After |
|--------|-------|
| QueryBar search | → SearchBar (free text only) |
| QueryBar chips | → Removed (facets use count badges instead) |
| FieldsPane (sidebar) | → Facet dropdowns in FacetBar |
| LogToolbar count | → SearchBar input (suffix) |
| LogToolbar wrap/task | → Footer (left) |
| LogToolbar download | → Footer (left) |
| LogToolbar refresh | → Footer (right) |
| LogToolbar live/tail | → Removed (implicit from time range) |

### Separation of Concerns

| Input | Type | Location |
|-------|------|----------|
| Text search | Free text match | SearchBar input |
| Level filter | Facet selection | FacetBar dropdown (count badge) |
| Task filter | Facet selection | FacetBar dropdown (count badge) |
| Source filter | Facet selection | FacetBar dropdown (count badge) |
| Time filter | Range selection | Timeline |

---

## Streaming Behavior (Simplified)

### No Explicit Live Toggle

Streaming state is implicit from the time range:

| Time Range End | Streaming | Behavior |
|---------------|-----------|----------|
| `NOW` (undefined) | Active | New logs added to list |
| Fixed time | Inactive | Historical view |

### Scroll Behavior

**Key principle**: Scrolling up does NOT pause streaming. Entries keep arriving.

| User Action | Result |
|-------------|--------|
| At bottom | Auto-scroll as new entries arrive |
| Scroll up | Stay at position, entries still added at bottom |
| Scroll to bottom | Resume auto-scroll |

**Benefits:**
- Never miss logs
- No pause/resume complexity
- No buffer flushing
- Simpler mental model

### Timeline Shows Status

The timeline range display indicates streaming state:

```
| [All] [5m] [15m] [1h]                          10:30 - NOW       |
                                                          ^^^
                                                     "NOW" = streaming
```

```
| [All] [5m] [15m] [1h]                     10:30 - 11:00:00       |
                                                 ^^^^^^^^
                                              fixed = historical
```

### Benefits

1. **More log space**: No sidebar (full width)
2. **Focused sections**: Each bar has single purpose
3. **Clean hierarchy**: Search → Facets → Time → Logs → Controls
4. **Room to grow**: Footer can accommodate future controls
5. **Facets prominent**: Dropdown buttons always visible

---

## Open Questions

1. **Histogram during selection**: Should histogram show ALL data or just selected range?
   - Current thinking: ALL data, with selection overlay highlighting the range

2. **URL sync**: Should time range be persisted in URL query params?
   - Pros: Shareable links, browser back/forward
   - Cons: Added complexity, stale times in old URLs

3. **Bucket click behavior**: Zoom to bucket or add to selection?
   - Current thinking: Zoom (replace selection with bucket's time range)
