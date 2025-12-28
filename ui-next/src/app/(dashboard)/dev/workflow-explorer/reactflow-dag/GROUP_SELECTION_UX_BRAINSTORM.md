<!--
  Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.

  NVIDIA CORPORATION and its licensors retain all intellectual property
  and proprietary rights in and to this software, related documentation
  and any modifications thereto. Any use, reproduction, disclosure or
  distribution of this software and related documentation without an express
  license agreement from NVIDIA CORPORATION is strictly prohibited.
-->

# Group Selection UX Brainstorm

This document explores user journeys and interaction patterns for node/group selection in the DAG visualization.

---

## ⚠️ Design Principle: Consistency Over Cleverness

**Problem with the multi-mode approach:**
Having different panel layouts based on context (single task vs group, narrow vs wide viewport) creates:
- **Cognitive load** - "Where am I? What layout is this?"
- **Broken muscle memory** - Users can't build habits when the UI keeps changing
- **Unpredictable experience** - Resize window → layout changes → confusion
- **Development complexity** - More modes = more bugs, more testing

**Principle:** One consistent panel structure that adapts gracefully, not transforms completely.

### The Consistent Panel

Instead of:
- Single-task → Simple panel
- Multi-task → Master-detail split
- Narrow viewport → Stacked layout
- Wide viewport → Side-by-side

**Propose:** One panel design that works everywhere:

```
┌─────────────────────────────────────────────────────────────────────┐
│  PANEL HEADER (always present)                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  Group/Task context • Status • Duration                      [✕]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  TASK LIST (if group has multiple tasks)                           │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Collapsible/scrollable task list                            │   │
│  │ Click task → updates content below                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  TASK DETAILS (always present, always same layout)                 │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [◀◀] Task Name [▶▶]                                         │   │
│  │ [Details] [Logs] [Events] [📊]                              │   │
│  │ (content area)                                               │   │
│  │                                                              │   │
│  │                                                              │   │
│  │ [Actions: Logs, Shell, etc.]                                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Key Consistency Rules

| Element | Behavior | Why |
|---------|----------|-----|
| **Panel position** | Always on right side | Predictable location |
| **Panel width** | Fixed or user-resizable, not auto-changing | User controls their space |
| **Task details layout** | Identical whether from single-task node or group | Same muscle memory |
| **Tab order** | Always: Details → Logs → Events → Dashboard | Predictable navigation |
| **Actions location** | Always at bottom of task details | Easy to find |
| **Prev/Next navigation** | Always available (disabled if only 1 task) | Consistent controls |

---

## 🤔 Multi-Task View: What Should Users See?

When a user clicks on a group with multiple tasks, what information is valuable?

### Option A: Minimal - Just a Task List

The simplest approach: Show a list of tasks, let user click to see details.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│                                   │
│  ❌ process-shards-17      48s   │
│  ❌ process-shards-42      52s   │
│  ❌ process-shards-08      31s   │
│  ─────────────────────────────── │
│  ✅ process-shards-01      49s   │
│  ✅ process-shards-02      51s   │
│  ✅ process-shards-03      48s   │
│  ... (44 more)                   │
│                                   │
├───────────────────────────────────┤
│  (Click a task to see details)   │
└───────────────────────────────────┘
```

**Pros:** Simple, familiar (like a file list)
**Cons:** No aggregate insight, user must click each task

---

### Option B: Summary Header + Task List

Add a summary section above the task list showing aggregate info.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│  STATUS                           │
│  ████████████████████░░░ 94%     │
│  ✅ 47 completed                  │
│  ❌ 3 failed                      │
│                                   │
│  TIMING                           │
│  Started    2:04:32 PM            │
│  Finished   2:47:18 PM            │
│  Duration   42m 46s               │
│  Avg task   51s                   │
├───────────────────────────────────┤
│  TASKS                            │
│  ❌ process-shards-17      48s   │
│  ❌ process-shards-42      52s   │
│  ... (48 more)                   │
└───────────────────────────────────┘
```

**Pros:** Quick health check without clicking anything
**Cons:** Takes vertical space, may push task list down

---

### Option C: Failure-Focused (When Failures Exist)

If there are failures, surface them prominently. Group by failure type.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│  FAILURES                         │
│                                   │
│  ❌ OOM Error (2 tasks)          │
│     process-shards-17             │
│     process-shards-42             │
│                                   │
│  ❌ Timeout (1 task)             │
│     process-shards-08             │
│                                   │
├───────────────────────────────────┤
│  COMPLETED (47)          [Show ▾]│
│  (collapsed by default)          │
└───────────────────────────────────┘
```

**Pros:** Immediately answers "what went wrong?"
**Cons:** Different structure when no failures, less useful for successful groups

---

### Option D: Status Tabs/Filters

Let user filter by status - show all, show failures, show running, etc.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│  [All] [Failed•3] [Running] [Done]│
├───────────────────────────────────┤
│  ❌ process-shards-17      48s   │
│  ❌ process-shards-42      52s   │
│  ❌ process-shards-08      31s   │
│                                   │
│  (showing 3 failed tasks)        │
└───────────────────────────────────┘
```

**Pros:** User controls what they see
**Cons:** Extra click to see what they want

---

### Option E: Expandable Sections

Collapsible sections for different status categories.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│  ▼ Failed (3)                     │
│    ❌ process-shards-17    48s   │
│    ❌ process-shards-42    52s   │
│    ❌ process-shards-08    31s   │
│                                   │
│  ▶ Completed (47)                │
│                                   │
│  ▶ Running (0)                   │
│                                   │
│  ▶ Pending (0)                   │
└───────────────────────────────────┘
```

**Pros:** Progressive disclosure, failures visible first
**Cons:** More complex interaction

---

### Option F: Dense Table View

Show all tasks in a compact, scannable table.

```
┌───────────────────────────────────┐
│  process-shards                   │
│  ⚠️ 3 of 50 failed • 42m    [✕]  │
├───────────────────────────────────┤
│  St│ Task              │ Dur│Node│
│  ──┼───────────────────┼────┼────│
│  ❌│ process-shards-17 │ 48s│ 12 │
│  ❌│ process-shards-42 │ 52s│ 08 │
│  ❌│ process-shards-08 │ 31s│ 15 │
│  ✅│ process-shards-01 │ 49s│ 01 │
│  ✅│ process-shards-02 │ 51s│ 02 │
│  ✅│ process-shards-03 │ 48s│ 03 │
│  ... (44 more rows)              │
└───────────────────────────────────┘
```

**Pros:** Efficient use of space, sortable
**Cons:** May feel overwhelming for 200+ tasks

---

### Comparison Matrix

| Option | Best For | Not Great For |
|--------|----------|---------------|
| **A: Minimal list** | Simple groups, <10 tasks | Finding patterns |
| **B: Summary header** | Quick health check | Maximizing task list space |
| **C: Failure-focused** | Debugging failures | Successful groups |
| **D: Status tabs** | User-driven exploration | Quick glance |
| **E: Expandable sections** | Mixed status groups | Very large groups |
| **F: Dense table** | Power users, large groups | Quick scanning |

---

### Questions to Consider

1. **What's the most common scenario?**
   - Checking if group completed? → Summary header
   - Debugging why tasks failed? → Failure-focused
   - Finding a specific task? → Table with search

2. **How many tasks are typical?**
   - 2-10 tasks → Simple list is fine
   - 10-100 tasks → Need filtering/grouping
   - 100+ tasks → Need search, virtualization

3. **What do users ask first?**
   - "Did it work?" → Status summary
   - "What failed?" → Failure list
   - "How long did it take?" → Timing info
   - "Where is task X?" → Searchable list

---

### Single Task vs Multi-Task: Same Panel, Different Density

**Single-task node selected:**
```
┌─────────────────────────────────────┐
│  download-model                     │
│  ✅ Completed • 2m 34s        [✕]  │
├─────────────────────────────────────┤
│  (no task list - only 1 task)       │
│  ─────────────────────────────────  │
│  [Details] [Logs] [Events] [📊]     │
│                                     │
│  Duration      2m 34s               │
│  Node          cpu-node-08          │
│  Pod           download-model-xyz   │
│  ...                                │
│                                     │
│  [📋 Logs] [📅 Events]             │
└─────────────────────────────────────┘
```

**Multi-task group selected:**
```
┌─────────────────────────────────────┐
│  process-shards                     │
│  ⚠️ 3 of 50 failed • 42m      [✕]  │
├─────────────────────────────────────┤
│  TASKS  [Failed ▾]   3 of 50       │
│  ┌─────────────────────────────────┐│
│  │ ❌ process-shards-17      48s ▶││
│  │ ❌ process-shards-42      52s  ││
│  │ ❌ process-shards-08      31s  ││
│  │ ✅ ...47 more                  ││
│  └─────────────────────────────────┘│
│  [🔄 Retry 3 Failed]               │
│  ─────────────────────────────────  │
│  [◀◀] process-shards-17 [▶▶]       │
│  [Details] [Logs] [Events] [📊]     │
│                                     │
│  Duration      48s                  │
│  Node          gpu-node-12          │
│  ...                                │
│                                     │
│  [📋 Logs] [🖥️ Shell]              │
└─────────────────────────────────────┘
```

**Same structure, same locations, same behavior.** The only difference is whether the task list section is visible.

### Responsive Behavior: Graceful Adaptation, Not Transformation

| Viewport | Adaptation | NOT This |
|----------|------------|----------|
| Wide (>1400px) | Panel can be wider, more room for content | ~~Split into columns~~ |
| Medium (1000-1400px) | Panel at comfortable width | ~~Stack differently~~ |
| Narrow (<1000px) | Panel slides over DAG as overlay | ~~Complete redesign~~ |

The **structure stays the same** - only the available space changes.

---

## 🎯 Executive Summary

**Key Insight:** One consistent panel structure that users can recognize and rely on, regardless of context.

### The Unified Panel

| Context | What Changes | What Stays The Same |
|---------|-------------|---------------------|
| Single-task node | Task list hidden | Header, task details, tabs, actions |
| Multi-task group | Task list visible | Header, task details, tabs, actions |
| Narrow viewport | Panel overlays DAG | Everything inside the panel |
| Wide viewport | Panel has more room | Everything inside the panel |

**Structure (always the same):**
```
┌───────────────────────────────────┐
│  HEADER: Group/Task • Status      │
├───────────────────────────────────┤
│  TASK LIST (if multi-task)        │
│  GROUP ACTIONS (if multi-task)    │
├───────────────────────────────────┤
│  [◀◀] Selected Task [▶▶]          │
│  [Details] [Logs] [Events] [📊]   │
│  (tab content)                    │
│  [Task Actions]                   │
└───────────────────────────────────┘
```

**User Journey:**
```
Click any node → Panel opens → Same layout every time
                     ↓
              [Details | Logs | Events | Dashboard]
                     ↓
              [Shell] [Port Forward] (modals)
```

**Benefits:**
- ✅ **Muscle memory** - Users know where everything is
- ✅ **Predictable** - No surprises when window resizes
- ✅ **Simpler to build** - One layout, not many modes
- ✅ **Easier to maintain** - Less conditional logic

---

## Current State Summary

| Node Type | Click Behavior | Panel Shown |
|-----------|---------------|-------------|
| Single-task node | Select task → open TaskDetailPanel | Task details |
| Multi-task group (collapsed) | Toggle expand | None |
| Multi-task group (expanded) | Toggle collapse | None |
| Task row within expanded group | Select task → open TaskDetailPanel | Task details |

**Gap identified:** No way to interact with a group *as a group*. Clicking only toggles expand/collapse.

---

## User Journey 1: "I Want to See Group Health at a Glance"

### Scenario
User has a workflow with 50 parallel data processing tasks in a group called `process-shards`. 3 tasks have failed. User wants to quickly understand:
- How many succeeded vs failed?
- What's the common failure pattern?
- Should I retry the failures or investigate?

### Current UX (Pain Points)
1. User sees red status on collapsed group
2. Click → expands to show 50 tasks
3. Must scroll through virtualized list to find failed ones
4. Click each failed task individually to see details
5. Mentally aggregate "oh, they all have the same error message"

### Proposed UX: Group Summary Panel

**Action:** User clicks group header (not the expand chevron)  
**Outcome:** Opens Group Details Panel showing aggregate information

```
┌─────────────────────────────────────────────────┐
│  ✕                                              │
│  ⚠️ process-shards                             │
│  3 of 50 tasks failed                           │
├─────────────────────────────────────────────────┤
│  STATUS BREAKDOWN                               │
│  ┌────────────────────────────────────────────┐ │
│  │ ████████████████████░░░░ │ 47 completed    │ │
│  │ ░░░░░░░░░░░░░░░░░░░░████ │  3 failed       │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  FAILURE SUMMARY                                │
│  ┌────────────────────────────────────────────┐ │
│  │ ❌ OOM Error (2 tasks)                     │ │
│  │    process-shards-17, process-shards-42   │→│ │
│  │ ❌ Timeout (1 task)                        │ │
│  │    process-shards-08                      │→│ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  TIMING                                         │
│  • First started: 2:04:32 PM                    │
│  • Last completed: 2:47:18 PM                   │
│  • Total duration: 42m 46s                      │
│  • Avg task duration: 51s                       │
│                                                 │
│  ACTIONS                                        │
│  ┌──────────────┐ ┌──────────────┐              │
│  │ 🔄 Retry 3   │ │ 📋 View Logs │              │
│  └──────────────┘ └──────────────┘              │
│  ┌────────────────────────────────┐             │
│  │ 🚫 Cancel Remaining            │             │
│  └────────────────────────────────┘             │
└─────────────────────────────────────────────────┘
```

---

## User Journey 2: "I Want to Drill Down into a Specific Task"

### Scenario
From the Group Summary Panel, user sees `OOM Error (2 tasks)` and wants to investigate `process-shards-17`.

### Proposed UX: Nested Navigation

**Action:** User clicks on a specific task name in the failure summary  
**Outcome:** Panel transitions to Task Detail Panel with breadcrumb back

```
┌─────────────────────────────────────────────────┐
│  ← process-shards                        ✕     │
│  ❌ process-shards-17                           │
│  Failed • OOM Error                             │
├─────────────────────────────────────────────────┤
│  TASK DETAILS                                   │
│  Group          process-shards                  │
│  Duration       48s                             │
│  Node           gpu-node-12                     │
│  Pod            process-shards-17-abc123        │
│  Started        2:15:32 PM                      │
│  Failed         2:16:20 PM                      │
│                                                 │
│  ERROR                                          │
│  ┌────────────────────────────────────────────┐ │
│  │ Container killed: OOMKilled                │ │
│  │ Memory limit: 8Gi                          │ │
│  │ Peak usage: 8.2Gi                          │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  ACTIONS                                        │
│  ┌──────────┐ ┌─────────────┐                   │
│  │ 📋 Logs  │ │ 🔄 Retry    │                   │
│  └──────────┘ └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

---

## User Journey 3: "I Want to Monitor Running Tasks in a Group"

### Scenario
User has a group `training` with 8 GPU training tasks running. They want to:
- See which ones are making progress
- Monitor resource utilization
- Be alerted to any issues

### Proposed UX: Live Group Dashboard

**Action:** User clicks on running group  
**Outcome:** Group Details Panel shows live progress

```
┌─────────────────────────────────────────────────┐
│  ✕                                              │
│  🔄 training                                    │
│  8 of 8 tasks running • 2h 14m elapsed          │
├─────────────────────────────────────────────────┤
│  PROGRESS                                       │
│  ┌────────────────────────────────────────────┐ │
│  │ ████████████████░░░░░░░░ │ ~67% complete   │ │
│  │ Estimated: ~1h remaining                    │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  RUNNING TASKS                     Duration     │
│  ┌────────────────────────────────────────────┐ │
│  │ 🔄 training-0  gpu-node-1  ████░░░  2h 14m │ │
│  │ 🔄 training-1  gpu-node-2  ████░░░  2h 14m │ │
│  │ 🔄 training-2  gpu-node-3  ███░░░░  2h 14m │ │
│  │ 🔄 training-3  gpu-node-4  ████░░░  2h 14m │ │
│  │ 🔄 training-4  gpu-node-5  ████░░░  2h 13m │ │
│  │ ... (3 more)                               │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  RESOURCE USAGE                                 │
│  GPU Memory:  ████████░░ 78% (avg)              │
│  GPU Util:    ██████░░░░ 62% (avg)              │
│                                                 │
│  ACTIONS                                        │
│  ┌─────────────────────┐ ┌──────────────────┐   │
│  │ 🖥️ Open Shell (any) │ │ 📋 Tail All Logs │   │
│  └─────────────────────┘ └──────────────────┘   │
│  ┌─────────────────────────────────────────┐    │
│  │ 🚫 Cancel Group                         │    │
│  └─────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

---

## User Journey 4: "I Want to Batch Operate on a Group"

### Scenario
User has a group `validation` with 200 tasks. 15 are stuck in `SCHEDULING` state for too long. User wants to cancel and retry just those.

### Proposed UX: Bulk Selection Mode

**Action:** User opens Group Details → enters selection mode  
**Outcome:** Can select specific tasks and apply bulk actions

```
┌─────────────────────────────────────────────────┐
│  ✕                                              │
│  ⏳ validation                                  │
│  185 completed • 15 scheduling (stuck?)         │
├─────────────────────────────────────────────────┤
│  FILTER BY STATUS                               │
│  ┌────────┐ ┌────────────┐ ┌───────────┐        │
│  │ All    │ │ Scheduling │ │ Completed │        │
│  └────────┘ └────────────┘ └───────────┘        │
│               ▲ selected                        │
│                                                 │
│  □ SELECT ALL (15)                              │
│  ┌────────────────────────────────────────────┐ │
│  │ ☑ validation-023   ⏳ Scheduling   45m     │ │
│  │ ☑ validation-024   ⏳ Scheduling   45m     │ │
│  │ ☑ validation-025   ⏳ Scheduling   44m     │ │
│  │ ☑ validation-031   ⏳ Scheduling   42m     │ │
│  │ ... (11 more selected)                     │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
│  BULK ACTIONS (15 selected)                     │
│  ┌──────────────┐ ┌───────────────────┐         │
│  │ 🚫 Cancel    │ │ 🔄 Cancel + Retry │         │
│  └──────────────┘ └───────────────────┘         │
└─────────────────────────────────────────────────┘
```

---

## User Journey 5: "I Need to Investigate This Failed Task"

### Scenario
User sees a failed task `training-gpu-03`. They've opened the task details panel and now need to:
1. Check the logs to see the error
2. Look at pod events (was it evicted? OOM killed?)
3. Check Grafana for resource usage patterns
4. (If running) open a shell to debug live

### Current UX (Pain Points)
1. User sees task details with limited info
2. Clicks "Logs" → opens new tab → loses context
3. Comes back, clicks "Events" → another tab
4. Clicks "Dashboard" → third tab
5. Now juggling 4 browser tabs, losing workflow context

### Proposed UX: Integrated Tool Views

**The task detail pane becomes a tool hub with tabbed/embedded views:**

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ process-shards                                                [Compact] [✕]   │
│  3 of 50 failed • 42m 46s total                                                   │
├────────────────────────────────────────────┬───────────────────────────────────────┤
│  TASKS                                     │  [◀◀]  process-shards-17  [▶▶]       │
│  ┌────────────────────────────────────────┐│  ❌ Failed • OOM Error                │
│  │ ...task list...                        ││                                       │
│  │                                        ││  ┌─────────────────────────────────┐  │
│  │                                        ││  │ [Details] [Logs] [Events] [📊]  │  │
│  │                                        ││  ├─────────────────────────────────┤  │
│  │                                        ││  │                                 │  │
│  │                                        ││  │   (tabbed content area)         │  │
│  │                                        ││  │                                 │  │
│  │                                        ││  │                                 │  │
│  │                                        ││  └─────────────────────────────────┘  │
│  │                                        ││                                       │
│  └────────────────────────────────────────┘│  [🖥️ Shell]  [🔗 Port Fwd]           │
└────────────────────────────────────────────┴───────────────────────────────────────┘
```

### Tab: Details (default)
```
┌─────────────────────────────────────────────────┐
│ [Details] [Logs] [Events] [📊]                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  TIMING BREAKDOWN                               │
│  Processing      2s                             │
│  Scheduling      12s                            │
│  Initializing    8s                             │
│  Running         26s                            │
│  ─────────────                                  │
│  Total           48s                            │
│                                                 │
│  DETAILS                                        │
│  Node     gpu-node-12                           │
│  Pod      shards-17-abc123                      │
│  Exit     137 (OOMKilled)                      │
│                                                 │
│  FAILURE REASON                                 │
│  ┌─────────────────────────────────────────┐    │
│  │ Container killed: OOMKilled            │    │
│  │ Memory limit exceeded (8Gi)            │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Tab: Logs (embedded log viewer)

**Key insight:** When user is in Logs tab and uses ◀◀/▶▶ to navigate tasks, **stay on Logs tab** - don't reset to Details. This enables rapid log comparison across tasks.

```
┌─────────────────────────────────────────────────┐
│ [Details] [Logs•] [Events] [📊]                 │
├─────────────────────────────────────────────────┤
│ 🔍 [Filter...        ] [Wrap ☑] [↓ Auto-scroll]│
│ ─────────────────────────────────────────────── │
│ 2024-01-15 14:16:12 INFO  Loading checkpoint... │
│ 2024-01-15 14:16:14 INFO  Model loaded (7.2GB)  │
│ 2024-01-15 14:16:15 INFO  Starting batch 1/100  │
│ 2024-01-15 14:16:18 WARN  Memory pressure 7.8GB │
│ 2024-01-15 14:16:19 WARN  Memory pressure 7.9GB │
│ 2024-01-15 14:16:20 ERROR OOM: Cannot allocate  │
│ 2024-01-15 14:16:20 FATAL Container killed      │
│ ─────────────────────────────────────────────── │
│ Showing last 100 lines (of 2,847)              │
│ [↗ Full Logs]  [⬇ Download]  [📋 Copy]         │
└─────────────────────────────────────────────────┘
```

#### What is "Full Logs"?

| View | What It Is | Use Case |
|------|-----------|----------|
| **Embedded preview** | Last ~100 lines in the panel | Quick check: "what went wrong?" |
| **Full Logs (external)** | Complete log file in dedicated viewer or new tab | Deep investigation, search entire history |

**Full Logs** opens the complete log stream. Options:
- External URL (current behavior) → Opens log aggregator (Loki, etc.)
- Dedicated full-screen log viewer → More integrated experience
- Download as file → Offline analysis

#### Quick Jump to Other Tasks' Logs

**Option A: Tab persistence with Prev/Next**
When in Logs tab, ◀◀/▶▶ navigates tasks but keeps you on Logs:

```
┌─────────────────────────────────────────────────┐
│  [◀◀]  process-shards-17  [▶▶]                 │
│  ─────────────────────────────────────────────  │
│  [Details] [Logs•] [Events] [📊]                │
│  ─────────────────────────────────────────────  │
│  (logs for process-shards-17)                   │
│                                                 │
│  ─── User clicks [▶▶] ───                      │
│                                                 │
│  [◀◀]  process-shards-42  [▶▶]                 │
│  ─────────────────────────────────────────────  │
│  [Details] [Logs•] [Events] [📊]  ← stays here │
│  ─────────────────────────────────────────────  │
│  (logs for process-shards-42)                   │
└─────────────────────────────────────────────────┘
```

**Option B: Inline logs button in task table**
Direct jump to logs from the task list (already proposed):

```
│ St⬇│ Task Name          │ Dur │ 📋  │ Node │
├────┼────────────────────┼─────┼─────┼──────┤
│ ❌ │ process-shards-17  │ 48s │ [↗] │  12  │  ← Click [↗] → opens logs directly
│ ❌ │ process-shards-42  │ 52s │ [↗] │  08  │
```

**Option C: Multi-task log comparison (future)**
Split view showing logs from 2 tasks side-by-side:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Compare Logs: process-shards-17  vs  process-shards-01                    │
├──────────────────────────────────┬──────────────────────────────────────────┤
│  ❌ process-shards-17 (failed)   │  ✅ process-shards-01 (success)         │
├──────────────────────────────────┼──────────────────────────────────────────┤
│ 14:16:18 WARN Memory 7.8GB      │ 14:04:18 INFO Memory 6.2GB              │
│ 14:16:19 WARN Memory 7.9GB      │ 14:04:19 INFO Memory 6.3GB              │
│ 14:16:20 ERROR OOM              │ 14:04:20 INFO Batch complete            │
│ 14:16:20 FATAL Killed           │ 14:04:21 INFO Success                   │
└──────────────────────────────────┴──────────────────────────────────────────┘
```

**Recommendation:** Options A + B for v1, Option C as future enhancement

### Tab: Events (pod events)
```
┌─────────────────────────────────────────────────┐
│ [Details] [Logs] [Events•] [📊]                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  14:16:20  ⚠️  OOMKilled                       │
│  Container exceeded memory limit               │
│                                                 │
│  14:16:08  ✓  Started                          │
│  Container started successfully                │
│                                                 │
│  14:16:05  ✓  Pulled                           │
│  Successfully pulled image                     │
│                                                 │
│  14:15:45  ⏳ Pulling                          │
│  Pulling image "nvcr.io/nvidia/pytorch:24.01"  │
│                                                 │
│  14:15:32  ✓  Scheduled                        │
│  Successfully assigned to gpu-node-12          │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Tab: Dashboard (embedded Grafana iframe or summary)
```
┌─────────────────────────────────────────────────┐
│ [Details] [Logs] [Events] [📊•]                 │
├─────────────────────────────────────────────────┤
│                                                 │
│  RESOURCE USAGE (from Grafana)                  │
│                                                 │
│  GPU Memory                                     │
│  ████████████████████▓▓▓▓ 8.2 / 8.0 GB ⚠️     │
│  ▲ Peak at 14:16:19                            │
│                                                 │
│  GPU Utilization                                │
│  ████████████░░░░░░░░░░░░ 52%                  │
│                                                 │
│  CPU                                            │
│  ██░░░░░░░░░░░░░░░░░░░░░░ 8%                   │
│                                                 │
│  ─────────────────────────────────────────────  │
│  [↗ Open Full Dashboard in Grafana]            │
│                                                 │
└─────────────────────────────────────────────────┘
```

### Shell / Terminal (modal or drawer)

**Key insight:** Users often need to jump between shells of different running tasks (e.g., check GPU utilization across nodes).

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  🖥️ Shell                                                                  [✕]    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ [training-0 ▾]  gpu-node-01                            [+ New Tab] [Split]  │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                    │
│  root@training-0-abc123:/workspace$ nvidia-smi                                    │
│  +-----------------------------------------------------------------------------+   │
│  | NVIDIA-SMI 535.104.05   Driver Version: 535.104.05   CUDA Version: 12.2    |   │
│  |-------------------------------+----------------------+----------------------|   │
│  |   0  NVIDIA A100-SXM...  On   | 00000000:00:04.0 Off |                    0 |   │
│  | N/A   42C    P0    68W / 400W |   7892MiB / 81920MiB |     45%      Default |   │
│  +-------------------------------+----------------------+----------------------+   │
│                                                                                    │
│  root@training-0-abc123:/workspace$ _                                             │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

#### Quick Task Switch in Shell

**Dropdown selector** allows jumping to another running task's shell without closing:

```
┌──────────────────────────────────────┐
│ [training-0 ▾]                       │
├──────────────────────────────────────┤
│ ● training-0  (gpu-node-01) ← active │
│ ○ training-1  (gpu-node-02)          │
│ ○ training-2  (gpu-node-03)          │
│ ○ training-3  (gpu-node-04)          │
│ ─────────────────────────────────    │
│ ○ training-4  (gpu-node-05)          │
│ ○ training-5  (gpu-node-06)          │
│ ○ training-6  (gpu-node-07)          │
│ ○ training-7  (gpu-node-08)          │
└──────────────────────────────────────┘
(Only shows RUNNING tasks)
```

#### Multiple Shell Tabs (future)

Power users might want multiple shells open:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  🖥️ Shell                                                                  [✕]    │
│  ┌──────────────────────────────────────────────────────────────────────────────┐ │
│  │ [training-0] [training-3] [training-7]  [+]                                 │ │
│  └──────────────────────────────────────────────────────────────────────────────┘ │
├────────────────────────────────────────────────────────────────────────────────────┤
│  (terminal content for selected tab)                                              │
└────────────────────────────────────────────────────────────────────────────────────┘
```

#### Split Terminal View (future)

Compare two terminals side-by-side:

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  🖥️ Shell (Split View)                                                    [✕]    │
├───────────────────────────────────────┬────────────────────────────────────────────┤
│  [training-0 ▾] gpu-node-01           │  [training-3 ▾] gpu-node-04               │
├───────────────────────────────────────┼────────────────────────────────────────────┤
│  $ nvidia-smi                         │  $ nvidia-smi                              │
│  GPU 0: 45% util, 7.8GB/80GB          │  GPU 0: 92% util, 12.1GB/80GB             │
│  $ _                                  │  $ _                                       │
└───────────────────────────────────────┴────────────────────────────────────────────┘
```

---

### Design Decision: Tool Integration Model

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Tabs in detail pane** | Switch between Details/Logs/Events/Dashboard | Keeps context, no new tabs | Limited space |
| **B: Slide-out panels** | Logs slides out from right, covering more | More room for content | Covers task list |
| **C: External links only** | Open Logs/Grafana in new tabs | Simple, full-featured | Loses workflow context |
| **D: Split panel (resizable)** | Logs below details, resizable | See details + logs together | Vertical space limited |
| **E: Modal/Drawer** | Full-height drawer for logs/shell | Maximum space | Covers everything |

**Recommendation:** Hybrid approach:
- **Tabs** for quick preview (first ~50 lines of logs, event summary, resource chart)
- **"Open Full" button** for complete external view when needed
- **Modal** for interactive tools (Shell, Port Forward)

---

## User Journey 6: "Single Task Node - Keep It Simple"

### Scenario
User clicks on a single-task node like `download-model`.

### Proposed UX: Direct to Task Details (No Change)

**Action:** User clicks single-task node  
**Outcome:** Opens Task Detail Panel directly (current behavior)

**Rationale:** No intermediate group panel needed - there's no aggregate to show.

```
┌─────────────────────────────────────────────────┐
│  ✕                                              │
│  ✅ download-model                              │
│  Completed • 2m 34s                             │
├─────────────────────────────────────────────────┤
│  TASK DETAILS                                   │
│  Duration       2m 34s                          │
│  Node           cpu-node-08                     │
│  Pod            download-model-xyz789           │
│  Started        1:58:12 PM                      │
│  Completed      2:00:46 PM                      │
│                                                 │
│  ACTIONS                                        │
│  ┌──────────┐ ┌─────────────┐                   │
│  │ 📋 Logs  │ │ 🔄 Retry    │                   │
│  └──────────┘ └─────────────┘                   │
└─────────────────────────────────────────────────┘
```

---

## Interaction Model Summary

### Click Behaviors (Proposed)

| Element | Single Click | Double Click | Long Press (future) |
|---------|-------------|--------------|---------------------|
| Single-task node | Open Task Details | - | Context menu |
| Multi-task group header | Open Group Details | Toggle expand | Context menu |
| Expand chevron (▶/▼) | Toggle expand | - | - |
| Task row (in list) | Open Task Details | - | Context menu |

### Panel States

**Original (narrow panel, breadcrumb navigation):**
```
┌──────────────────────────────────────────────────────────────┐
│                 SELECTION STATE (Breadcrumb)                 │
├──────────────────────────────────────────────────────────────┤
│   Nothing Selected                                           │
│         │                                                    │
│         ├──► Click single-task ──► Task Details Panel        │
│         │                                                    │
│         └──► Click multi-task ──► Group Details Panel        │
│                   │                                          │
│                   └──► Click task ──► Task Details           │
│                            │           (breadcrumb back)     │
│                            │                                 │
│                            └──► Click breadcrumb ──► Group   │
└──────────────────────────────────────────────────────────────┘
```

**🆕 Recommended (50% panel, master-detail):**
```
┌──────────────────────────────────────────────────────────────┐
│               SELECTION STATE (Master-Detail)                │
├──────────────────────────────────────────────────────────────┤
│   Nothing Selected                                           │
│         │                                                    │
│         ├──► Click single-task ──► Task Details (25-33%)     │
│         │                                                    │
│         └──► Click multi-task ──► Master-Detail Panel (50%)  │
│                                   ┌───────────┬──────────┐   │
│                                   │ Task List │ Details  │   │
│                                   │           │          │   │
│                                   │ click ───►│ updates  │   │
│                                   │           │ in place │   │
│                                   └───────────┴──────────┘   │
│                                                              │
│   ✅ No navigation needed - context always visible!          │
└──────────────────────────────────────────────────────────────┘
```

---

## Group Details Panel: Content Comparison by Status

### Waiting/Scheduling Group
```
┌─────────────────────────────────────┐
│ QUEUE POSITION                      │
│ • Est. wait time: ~15 min           │
│ • Position: 23 of 150 pending       │
│ • Requested: 8x A100-80GB           │
│                                     │
│ DEPENDENCIES                        │
│ • Waiting for: preprocess (running) │
│                                     │
│ ACTIONS                             │
│ [🚫 Cancel Group]                   │
└─────────────────────────────────────┘
```

### Running Group
```
┌─────────────────────────────────────┐
│ PROGRESS                            │
│ • 8/8 running • 2h 14m elapsed      │
│ • Est. remaining: ~1h               │
│                                     │
│ RESOURCE USAGE (aggregated)         │
│ • GPU util: 62% avg                 │
│ • Memory: 78% avg                   │
│                                     │
│ TASK LIST (live, sortable)          │
│ [task rows with progress bars]      │
│                                     │
│ ACTIONS                             │
│ [🖥️ Shell] [📋 Logs] [🚫 Cancel]    │
└─────────────────────────────────────┘
```

### Completed Group
```
┌─────────────────────────────────────┐
│ SUMMARY                             │
│ • 50/50 completed ✓                 │
│ • Total duration: 42m               │
│ • Avg task: 51s                     │
│                                     │
│ TIMING                              │
│ • Started: 2:04:32 PM               │
│ • Completed: 2:47:18 PM             │
│                                     │
│ TASK LIST (sortable by duration)    │
│ [task rows]                         │
│                                     │
│ ACTIONS                             │
│ [📋 Download Logs] [🔄 Re-run]      │
└─────────────────────────────────────┘
```

### Failed Group (Partial)
```
┌─────────────────────────────────────┐
│ STATUS BREAKDOWN                    │
│ █████████████████░░░ 47/50          │
│ • 47 completed                      │
│ • 3 failed                          │
│                                     │
│ FAILURE SUMMARY (grouped by type)   │
│ ❌ OOM Error (2)                    │
│    → task-17, task-42               │
│ ❌ Timeout (1)                      │
│    → task-08                        │
│                                     │
│ ACTIONS                             │
│ [🔄 Retry Failed (3)]               │
│ [🚫 Cancel & Retry All]             │
│ [📋 Export Failure Report]          │
└─────────────────────────────────────┘
```

---

## 📋 Learnings from Legacy UI (`external/ui`) and Current Patterns

The existing codebases have proven patterns we should incorporate:

---

### From Legacy UI (`external/ui`) - Production Battle-Tested

The legacy UI at `external/ui` is the current production system. Key patterns:

#### **TasksTable** (workflows/components/TasksTable.tsx)

| Feature | Value | Apply? |
|---------|-------|--------|
| **TanStack Table** | Headless, fully-featured table | ✅ Consider for complex tables |
| **Multi-column sorting** | Shift+click to sort by multiple columns | ✅ Yes |
| **Column visibility toggle** | Show/hide columns modal | ⚠️ Maybe (for advanced users) |
| **Task name as link** | Click to select, shows selection state | ✅ Yes |
| **Direct logs link** | "Logs" button in table row | ✅ Yes - inline action |
| **Node as clickable tag** | Opens node details tool | ✅ Yes |
| **Exit code with color** | Green = 0, Red = error | ✅ Yes |
| **Status filter integration** | Filter by multiple statuses | ✅ Yes |
| **Pagination** | For large result sets | ⚠️ Maybe (virtualization may be better) |

**Columns in legacy TasksTable:**
```
Task | Logs | Node | IP | Status | Exit Code | Start Time | End Time
```

#### **TaskDetails** (workflows/components/TaskDetails.tsx)

| Feature | Value | Apply? |
|---------|-------|--------|
| **Prev/Next navigation** | `<<` / `>>` arrows to navigate tasks | ✅ Yes! Great for keyboard flow |
| **Phase durations** | Processing, Scheduling, Initializing, Running times separately | ✅ Yes - detailed timing breakdown |
| **Failure message display** | Shows full failure_message | ✅ Yes |
| **Sticky actions** | Actions footer is sticky at bottom | ✅ Yes |
| **Node as clickable tag** | Opens node details | ✅ Yes |
| **Exit code linked to docs** | Links to exit code documentation | ✅ Yes |
| **Lead task indicator** | Shows if task is lead | ⚠️ Maybe |

#### **TaskActions** (workflows/components/TaskActions.tsx)

| Action | When Available | Apply? |
|--------|----------------|--------|
| **Task Logs** | Always (if logs URL exists) | ✅ Yes |
| **Task Error Logs** | If error_logs exists | ✅ Yes |
| **Task Events** | If events exist | ✅ Yes |
| **Dashboard** | If dashboard_url exists | ✅ Yes |
| **Shell** | Only if RUNNING | ✅ Yes |
| **Port Forwarding** | Only if RUNNING + enabled | ⚠️ Maybe |

#### **DAG.tsx** (Legacy DAG visualization)

| Feature | Value | Apply? |
|---------|-------|--------|
| **Tasks limited to 7 per group** | Shows first 6 + ellipsis + last task | ⚠️ We handle differently |
| **Animated edges for running** | Edge pulses when target is running | ✅ Already have |
| **Click task node → select** | Updates URL with task selection | ✅ Yes |
| **Smart bezier edges** | Uses @tisoap/react-flow-smart-edge | ⚠️ We use ELK |

#### **StatusBadge** (components/StatusBadge.tsx)

| Feature | Value | Apply? |
|---------|-------|--------|
| **Icon + text badge** | Visual + text in colored pill | ✅ Already have similar |
| **Compact mode** | Icon-only for dense views | ✅ Yes |
| **Color coding** | completed=green, error=red, pending=gray, running=blue | ✅ Already have |

---

### From `ResourceTable` (ui-next/resource-table.tsx)

| Feature | Value | Apply To Group Panel? |
|---------|-------|----------------------|
| **Sortable columns** | Click header → sort asc/desc/none | ✅ Yes - sort tasks by status, duration, name |
| **Virtualized rows** | Handle 1000+ items smoothly | ✅ Yes - already using in GroupNode |
| **Compact mode toggle** | 32px vs 48px row height | ✅ Yes - density preference |
| **Collapsible filters** | Auto-collapse when space is tight | ⚠️ Maybe - for task filtering |
| **Sticky header** | Header stays visible during scroll | ✅ Yes - essential |
| **CSS Grid columns** | Consistent alignment, flexible widths | ✅ Yes |
| **Keyboard navigation** | Tab through rows, Enter to select | ✅ Yes |
| **"X of Y" count** | Show filtered vs total | ✅ Yes - "3 of 50 failed" |

### From `TimelineListView` (dag-vertical/page.tsx)

| Feature | Value | Apply To Group Panel? |
|---------|-------|----------------------|
| **Multi-column layout** | Time \| Status \| Task \| Duration \| Node | ✅ Yes |
| **Inline status icon** | Visual scan without reading | ✅ Yes |
| **Group name as subtitle** | Context in flattened views | ⚠️ N/A (already in group) |
| **Click row → show details** | Familiar interaction | ✅ Yes |
| **Hover highlight** | Visual feedback | ✅ Yes |
| **Selected state** | Cyan border/background | ✅ Yes |

### Proposed Task Table Columns

Based on legacy patterns and `ListTaskEntry` API type:

| Column | Width | Sortable | Notes |
|--------|-------|----------|-------|
| Status | 24px | ✅ | Icon only, sort by category |
| Task Name | flex | ✅ | Primary identifier, truncate |
| Duration | 80px | ✅ | `tabular-nums` for alignment |
| Node | 120px | ✅ | Where it ran |
| Resources | 80px | ❌ | "4 GPU" or "8 CPU" |
| Actions | 60px | ❌ | Logs, Shell buttons |

### Alternative: Condensed Table (High Density)

For groups with 50+ tasks, prioritize scanability:

| Column | Width | Notes |
|--------|-------|-------|
| Status | 20px | Icon only |
| Task Name | flex | Truncated |
| Duration | 60px | Compact format (2h vs 2h 14m) |

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ⬇ Status  │ Task Name                          │ Duration │ Node          │
├──────────────────────────────────────────────────────────────────────────────┤
│  ❌        │ process-shards-17                   │    48s   │ gpu-node-12   │
│  ❌        │ process-shards-42                   │    52s   │ gpu-node-08   │
│  ❌        │ process-shards-08                   │    31s   │ gpu-node-15   │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │
│  ✅        │ process-shards-01                   │    49s   │ gpu-node-01   │
│  ✅        │ process-shards-02                   │    51s   │ gpu-node-02   │
│  ...       │ (45 more)                           │          │               │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

### 🌟 Key Features to Incorporate from Legacy UI

Based on the analysis, these are the **highest value** features from `external/ui`:

#### 1. **Prev/Next Task Navigation**
The legacy TaskDetails has `<<` / `>>` arrows to navigate through tasks without leaving the detail view. This is excellent for reviewing multiple failures quickly.

```
┌────────────────────────────────────────────────┐
│  [◀◀]     process-shards-17     [▶▶]         │
│  ─────────────────────────────────────────    │
```

#### 2. **Phase Duration Breakdown**
Legacy shows separate times for each phase:
- **Processing Time** - Time in PROCESSING state
- **Scheduling Time** - Time waiting for resources
- **Initializing Time** - Container startup time
- **Run Time** - Actual execution time

This helps diagnose *where* time is spent.

```
┌────────────────────────────────────────────────┐
│  TIMING BREAKDOWN                              │
│  Processing     2s                             │
│  Scheduling     15m 32s  ← bottleneck!         │
│  Initializing   45s                            │
│  Running        2m 14s                         │
│  ─────────────────────────────────────────     │
│  Total          18m 33s                        │
└────────────────────────────────────────────────┘
```

#### 3. **Inline Action Buttons in Table Rows**
Legacy TasksTable has a "Logs" button directly in the table row - no need to open task details first.

```
│ Task Name          │ Logs  │ Node   │ Status    │
├────────────────────┼───────┼────────┼───────────┤
│ process-shards-17  │ [📋]  │ gpu-12 │ ❌ Failed │
```

#### 4. **Exit Code with Documentation Link**
Exit codes are colored (0=green, non-zero=red) and link to docs explaining what each code means.

#### 5. **Expanded Action Set**
Legacy has more actions than our current DetailPanel:
- Task Logs ✅ (we have)
- **Task Error Logs** ← add this
- **Task Events** ← add this (pod events, useful for debugging)
- Dashboard link
- Shell (running only) ✅ (we have)
- **Port Forwarding** ← add this (running only)

#### 6. **Multi-Column Sorting**
Shift+click on column headers to sort by multiple columns. Users can sort by status first, then by duration.

---

## 🆕 50% Panel Width: More Room, Same Structure

With a wider panel (up to 50% of viewport), we get more room for content - **but the structure stays the same**.

### What Extra Width Enables

| Benefit | Without | With 50% Width |
|---------|---------|----------------|
| Task list | 3-4 visible rows | 6-8 visible rows |
| Logs preview | 15-20 lines | 30-40 lines |
| Task details | Scrolling required | More visible at once |
| Column density | Compact only | Can show more columns |

**Important:** The panel *layout* doesn't change - just the amount of content visible at once.

### Optional: User-Resizable Panel

Instead of auto-sizing based on content, let users control their panel width:

```
┌─────────────────────────────┬──│──────────────────────────────────────┐
│                             │◀▶│  Panel (user drags to resize)        │
│         DAG                 │──│                                      │
│                             │  │  (content adapts to available space) │
│                             │  │                                      │
└─────────────────────────────┴──┴──────────────────────────────────────┘
```

User preferences persist across sessions. Some users want maximum DAG space, others want larger panel.

---

### Layout Options (for reference - keeping for historical context)

*Note: The following options were considered but we're now recommending a single consistent layout. These remain here for reference.*

### Layout Option A: Master-Detail Split with Table (Recommended)

The panel uses a proper table for the task list (leveraging legacy patterns) with details on the right.

**Action:** User clicks multi-task group  
**Outcome:** Panel opens with split view - sortable table on left, details on right

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ process-shards                                                [Compact] [✕]   │
│  3 of 50 failed • 42m 46s total • Avg: 51s                                        │
├────────────────────────────────────────────┬───────────────────────────────────────┤
│  ┌────────────────────────────────────────┐│                                       │
│  │ [Failed ▾]  [All ▾]        3 of 50    ││  Select a task to view details        │
│  ├─────┬──────────────────────┬─────┬────┤│                                       │
│  │ St⬇│ Task Name            │ Dur │Node││           ┌─────────────┐              │
│  ├─────┼──────────────────────┼─────┼────┤│           │   📋        │              │
│  │ ❌  │ process-shards-17    │ 48s │ 12 ││           │  Click a    │              │
│  │ ❌  │ process-shards-42    │ 52s │ 08 ││           │  task row   │              │
│  │ ❌  │ process-shards-08    │ 31s │ 15 ││           └─────────────┘              │
│  ├─────┴──────────────────────┴─────┴────┤│                                       │
│  │ ✅  │ process-shards-01    │ 49s │ 01 ││                                       │
│  │ ✅  │ process-shards-02    │ 51s │ 02 ││                                       │
│  │ ✅  │ ...47 more           │     │    ││                                       │
│  └────────────────────────────────────────┘│                                       │
│                                            │                                       │
│  [🔄 Retry 3 Failed]  [📋 All Logs]       │                                       │
└────────────────────────────────────────────┴───────────────────────────────────────┘
```

**After clicking a task row (with legacy UI features integrated):**

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ process-shards                                                [Compact] [✕]   │
│  3 of 50 failed • 42m 46s total • Avg: 51s                                        │
├────────────────────────────────────────────┬───────────────────────────────────────┤
│  ┌────────────────────────────────────────┐│  [◀◀]  process-shards-17  [▶▶]       │
│  │ [Failed ▾]  [All ▾]        3 of 50    ││  ❌ Failed • OOM Error                │
│  ├─────┬──────────────────────┬─────┬────┤│  ─────────────────────────────────    │
│  │ St⬇│ Task Name        │ Dur │📋 │Node││                                       │
│  ├─────┼──────────────────┼─────┼───┼────┤│  TIMING BREAKDOWN                     │
│  │ ❌▶ │ process-shards-17│ 48s │ ↗ │ 12 ││  Processing      2s                   │
│  │ ❌  │ process-shards-42│ 52s │ ↗ │ 08 ││  Scheduling      12s                  │
│  │ ❌  │ process-shards-08│ 31s │ ↗ │ 15 ││  Initializing    8s                   │
│  ├─────┴──────────────────┴─────┴───┴────┤│  Running         26s                  │
│  │ ✅  │ ...47 completed  │     │   │    ││  ─────────────────────────            │
│  └────────────────────────────────────────┘│  Total           48s                  │
│                                            │                                       │
│                                            │  DETAILS                              │
│                                            │  Node     gpu-node-12                 │
│                                            │  Pod      shards-17-abc123            │
│                                            │  Exit     137 (OOMKilled)            │
│                                            │                                       │
│                                            │  FAILURE REASON                       │
│                                            │  ┌───────────────────────────────┐    │
│                                            │  │ Container killed: OOMKilled  │    │
│  [🔄 Retry 3 Failed]  [📋 All Logs]       │  │ Memory limit exceeded (8Gi)  │    │
│                                            │  └───────────────────────────────┘    │
│                                            │                                       │
│                                            │  [📋 Logs] [🐛 Errors] [📅 Events]   │
│                                            │  [🖥️ Shell] [🔗 Port Fwd]            │
└────────────────────────────────────────────┴───────────────────────────────────────┘
```

**Table Features (from legacy patterns):**
- ✅ **Sortable columns** - Click header to sort (St↓ = sorted by status)
- ✅ **Multi-column sorting** - Shift+click for secondary sort (from legacy)
- ✅ **Filter dropdown** - Show only failed, running, etc.
- ✅ **Compact mode** - Toggle for high-density view
- ✅ **Sticky header** - Visible during scroll
- ✅ **"X of Y" count** - Show filtered subset
- ✅ **Virtualized** - Handle 200+ tasks smoothly
- ✅ **Selected row indicator** - `▶` shows current selection
- ✅ **Keyboard navigation** - ↑/↓ to move, Enter to select
- ✅ **Inline logs link** - 📋 button in row (from legacy TasksTable)

**Task Detail Features (from legacy TaskDetails):**
- ✅ **Prev/Next navigation** - `◀◀` / `▶▶` to move through tasks
- ✅ **Phase timing breakdown** - Processing, Scheduling, Initializing, Running
- ✅ **Exit code with docs link** - Color-coded, links to exit code docs
- ✅ **Full failure message** - Show complete failure_message
- ✅ **Expanded actions** - Logs, Error Logs, Events, Shell, Port Fwd

**Benefits:**
- ✅ No navigation - context always visible
- ✅ Rapid task comparison (↑/↓ or ◀◀/▶▶ through list)
- ✅ Group summary stays persistent
- ✅ Group + task actions both accessible
- ✅ Familiar table UX from legacy patterns
- ✅ Phase timing helps diagnose where time is spent

---

### Layout Option B: Inline Logs Preview

With more width, we can show log snippets directly in the panel without a modal.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ❌ process-shards-17                                              ✕         │
│  Failed • OOM Error                                                          │
├───────────────────────────────────────────────────────────────────────────────┤
│  DETAILS                          │  LOGS (last 50 lines)           [↗ Open] │
│  ──────                           │  ───────────────────────────────────────  │
│  Duration     48s                 │  [2024-01-15 14:16:18] Loading model...  │
│  Node         gpu-node-12         │  [2024-01-15 14:16:19] Allocated 7.2GB   │
│  Pod          shards-17-abc123    │  [2024-01-15 14:16:19] Processing batch  │
│  Started      2:15:32 PM          │  [2024-01-15 14:16:20] WARNING: Memory   │
│  Failed       2:16:20 PM          │      pressure detected (7.9GB/8GB)       │
│                                   │  [2024-01-15 14:16:20] FATAL: OOMKilled  │
│  ERROR                            │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  ┌─────────────────────────────┐  │                                          │
│  │ Container killed: OOMKilled│  │  🔍 Search logs...                       │
│  │ Exit code: 137             │  │  [Filter: ERROR ▾] [Wrap ☑]              │
│  └─────────────────────────────┘  │                                          │
│                                   │                                          │
│  [🔄 Retry] [🚫 Cancel]          │  [⬇ Download Full Log]                   │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

### Layout Option C: Side-by-Side Task Comparison

Compare two tasks from the same group (useful for debugging "why did this one fail?")

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ process-shards • Compare Mode                                       ✕    │
│  Comparing: process-shards-17 vs process-shards-01                           │
├───────────────────────────────────┬───────────────────────────────────────────┤
│  ❌ process-shards-17             │  ✅ process-shards-01                     │
│  Failed • OOM Error               │  Completed                                │
│  ─────────────────────────────    │  ─────────────────────────────────────    │
│                                   │                                           │
│  Duration     48s                 │  Duration     49s                         │
│  Node         gpu-node-12         │  Node         gpu-node-08        ← diff   │
│  Memory       8Gi (limit)         │  Memory       16Gi (limit)       ← diff   │
│  Peak Mem     8.2Gi ⚠️            │  Peak Mem     7.1Gi ✓                     │
│  Started      2:15:32 PM          │  Started      2:04:32 PM                  │
│                                   │                                           │
│  EXIT CODE                        │  EXIT CODE                                │
│  ┌─────────────────────────────┐  │  ┌─────────────────────────────────────┐ │
│  │ 137 (OOMKilled)             │  │  │ 0 (Success)                        │ │
│  └─────────────────────────────┘  │  └─────────────────────────────────────┘ │
│                                   │                                           │
│  [📋 Logs]  [🔄 Retry]           │  [📋 Logs]  [🔄 Re-run]                   │
└───────────────────────────────────┴───────────────────────────────────────────┘
```

**Entry point:** "Compare with..." action on any task

---

### Layout Option D: Timeline/Gantt View

Visualize task execution timeline within a group (great for parallelism analysis)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ✅ process-shards                                                      ✕    │
│  50 tasks • 42m total                                          [List] [Gantt]│
├───────────────────────────────────────────────────────────────────────────────┤
│  TIMELINE                                   2:04 PM          2:25 PM   2:47 PM│
│  ───────────────────────────────────────────│─────────────────│────────│──────│
│                                                                               │
│  process-shards-01  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│  process-shards-02  ░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│  process-shards-03  ░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│  process-shards-04  ░░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│  process-shards-05  ░░░░████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░            │
│  ...                                                                          │
│  process-shards-17  ░░░░░░░░░░░░░████████⬛░░░░░░░░░░░░░░░░░░░░░░  ← FAILED  │
│  ...                                                                          │
│  process-shards-50  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░████████████         │
│                                                                               │
│  LEGEND: ████ Running  ████ Completed  ⬛ Failed  ░░░░ Queued                 │
│                                                                               │
│  Max parallelism: 8 tasks │ Avg duration: 51s │ Total: 42m 46s               │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

### Layout Option E: Resizable Split with Collapsible Sections

User can customize their view by resizing the split and collapsing sections.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│  ⚠️ process-shards                                                      ✕    │
├────────────────────────────────────│──────────────────────────────────────────┤
│                                   ◀│▶   (draggable divider)                   │
│  ▼ STATUS BREAKDOWN                │  ❌ process-shards-17                    │
│    47 completed • 3 failed         │  ──────────────────────────────────────  │
│    █████████████████░░░            │                                          │
│                                    │  ▼ DETAILS                               │
│  ▼ FAILURE SUMMARY                 │    Duration: 48s                         │
│    ❌ OOM Error (2)                │    Node: gpu-node-12                     │
│    ❌ Timeout (1)                  │    Pod: shards-17-abc123                 │
│                                    │                                          │
│  ▶ TIMING (collapsed)              │  ▼ ERROR                                 │
│                                    │    OOMKilled - Memory limit 8Gi          │
│  ▼ TASKS                           │                                          │
│    [Filter] [Sort]                 │  ▼ LOGS (inline preview)                 │
│    ❌ process-shards-17 ◀          │    [last 20 lines shown]                 │
│    ❌ process-shards-42            │    ...                                   │
│    ❌ process-shards-08            │                                          │
│    ✅ process-shards-01            │  ▶ RESOURCE METRICS (collapsed)          │
│    ...                             │                                          │
│                                    │  ACTIONS                                 │
│  GROUP ACTIONS                     │  [📋 Full Logs] [🖥️ Shell] [🔄 Retry]   │
│  [🔄 Retry Failed] [🚫 Cancel]    │                                          │
└────────────────────────────────────┴──────────────────────────────────────────┘
```

---

### Updated Decision 2: Panel Navigation Model (with 50% width)

| Option | Pros | Cons | Best For |
|--------|------|------|----------|
| **A: Replace content (breadcrumb)** | Simple | Loses context | Single-task selection |
| **B: Master-Detail Split** ⭐ | Both visible, no navigation | Complex layout | Multi-task groups |
| **C: Tabs within panel** | Organized sections | Hidden content | Many detail categories |
| **D: Inline everything** | All visible | Information overload | Power users |

**New Recommendation:** 
- **Single-task nodes → Simple full-width detail panel** (current behavior, works great)
- **Multi-task groups → Master-Detail Split (Option B)** - leverages the 50% width perfectly

---

### Responsive Considerations

The panel adapts **gracefully** without changing structure:

| Viewport Width | Panel Behavior | What Changes |
|----------------|----------------|--------------|
| > 1400px | Side panel (user-set width) | More content visible |
| 1000-1400px | Side panel (narrower default) | Less content visible, may scroll more |
| < 1000px | Overlay/modal | Panel covers DAG temporarily |

**Critically:** The internal structure of the panel is **identical** in all cases. Only the container changes.

---

## Design Decision Points

### Decision 1: How to trigger Group Details vs Expand/Collapse?

| Option | Pros | Cons |
|--------|------|------|
| **A: Click header = Group Details, chevron = expand** | Clear separation | Requires click precision |
| **B: Single click = Group Details, double-click = expand** | Discoverable | Slower for power users |
| **C: Click = expand, right-click = Group Details** | Familiar pattern | Discoverability issue |
| **D: Click = expand, dedicated "info" button in node** | Explicit | Visual clutter |

**Recommendation:** Option A with visual affordances (cursor changes, hover states)

### Decision 2: Panel Layout Model

~~Previously considered multiple layouts based on context.~~

**Revised Decision:** Single consistent layout (see [Design Principle](#️-design-principle-consistency-over-cleverness))

| Element | Behavior |
|---------|----------|
| Panel structure | Always the same (header → task list → task details → tabs → actions) |
| Task list | Visible if group has 2+ tasks, hidden if single task |
| Task details | Always present, same layout regardless of context |
| Width | User-resizable with sensible defaults |

**Why:** Consistency builds muscle memory. Users should recognize the panel instantly.

### Decision 3: Tool Integration Model

How should Logs, Events, Dashboard, and Shell be presented?

| Option | Pros | Cons |
|--------|------|------|
| **A: Tabs in detail pane** | Context preserved, quick switch | Limited space for logs |
| **B: Slide-out drawer (full height)** | More room | Covers task list |
| **C: External links only** | Full-featured, simple | Loses workflow context |
| **D: Hybrid (preview + open full)** | Best of both worlds | More complex to build |

**Recommendation:** **Option D (Hybrid)** - Show inline preview with "Open Full" escape hatch:
- **Details tab** - Always visible, default
- **Logs tab** - Embedded viewer (last 100 lines), with search/filter, "Open Full" button
- **Events tab** - Pod events timeline
- **Dashboard tab** - Key metrics summary, "Open in Grafana" button
- **Shell** - Modal/drawer for interactive terminal
- **Port Forward** - Modal for configuration

### Decision 4: What Actions to Surface at Group Level?

| Action | Always | Sometimes | Never |
|--------|--------|-----------|-------|
| Retry failed tasks | ✓ (if failures) | | |
| Cancel group | ✓ (if running/pending) | | |
| View aggregated logs | | ✓ (if supported) | |
| Export task list | | ✓ | |
| Open shell (random task) | | ✓ (if running) | |
| Re-run group | | ✓ (if completed) | |

---

## Open Questions

1. **Progressive disclosure:** Should Group Details start minimal and expand on demand?

2. **Live updates:** How to show real-time progress without jarring updates?

3. **Keyboard navigation:** How to navigate panel content with keyboard?

4. **Mobile/touch:** Different interaction model needed?

5. **Persistence:** Should selected panel survive page refresh? URL state?

6. **Multi-selection:** Future - select multiple groups for bulk operations?

---

---

## Component Reuse Opportunities

We can leverage existing patterns rather than building from scratch:

### From `ui-next` (new UI)

| Need | Existing Component/Pattern | Location |
|------|---------------------------|----------|
| Virtualized table | `useVirtualizerCompat` + CSS Grid | `resource-table.tsx` |
| Sortable headers | `TableHeaderRow` pattern | `resource-table.tsx` |
| Collapsible filters | Auto-collapse logic | `resource-table.tsx` |
| Compact mode toggle | `compactMode` state | `resource-table.tsx` |
| Status icons | `getStatusIcon()` | `reactflow-dag/utils/status.tsx` |
| Status styles | `STATUS_STYLES` | `reactflow-dag/constants.ts` |
| Duration formatting | `formatDuration()` | `workflow-types.ts` |
| Detail panel layout | `DetailPanel` | `reactflow-dag/components/` |
| Keyboard navigation | Focus management | `resource-table.tsx` |

### From `ui` (legacy UI) - Patterns to Port

| Need | Legacy Pattern | Location | Port Priority |
|------|---------------|----------|---------------|
| Full-featured table | TanStack Table + TableBase | `ui/components/TableBase.tsx` | ⚠️ Consider |
| Multi-column sort | `useTableSortLoader` | `ui/hooks/useTableSortLoader.ts` | ✅ Port |
| Prev/Next navigation | `onNext`/`onPrevious` props | `ui/workflows/TaskDetails.tsx` | ✅ Port |
| Phase timing display | Duration breakdown logic | `ui/workflows/TaskDetails.tsx` | ✅ Port |
| Task actions set | TaskActions component | `ui/workflows/TaskActions.tsx` | ✅ Port |
| Exit code styling | Color-coded Tag + docs link | `ui/workflows/TaskDetails.tsx` | ✅ Port |
| Status badge compact | `compact` prop on StatusBadge | `ui/components/StatusBadge.tsx` | ✅ Port |
| Column visibility | Show/hide columns modal | `ui/components/TableBase.tsx` | ⚠️ Maybe |
| URL state sync | `useTableStateUrlUpdater` | `ui/hooks/useTableStateUrlUpdater.ts` | ⚠️ Maybe |

### Proposed New Components

```
components/
├── GroupMasterDetailPanel.tsx    # Main 50% panel container
├── TaskTable.tsx                 # Reusable task table (from ResourceTable patterns)
├── TaskTableHeader.tsx           # Sortable column headers
├── TaskTableRow.tsx              # Virtualized row component
├── TaskDetailPane.tsx            # Right-side task details
├── GroupSummaryHeader.tsx        # Top summary with aggregate stats
└── GroupActions.tsx              # Retry, Cancel, Logs buttons
```

---

## Next Steps

1. [ ] Review and iterate on user journeys
2. [x] ~~Decide on panel navigation~~ → **Master-Detail Split** with 50% width
3. [x] ~~Review legacy patterns~~ → Incorporate table patterns from `ResourceTable`
4. [ ] Decide: How to trigger Group Details vs Expand (Decision 1)
5. [ ] Decide: Which group-level actions to surface (Decision 3)
6. [ ] Design responsive behavior for narrower viewports
7. [ ] Prototype `GroupMasterDetailPanel` component with:
   - Reuse `useVirtualizerCompat` for task table
   - Reuse sortable header pattern from `ResourceTable`
   - Compact mode toggle
   - Filter by status dropdown
   - Keyboard navigation (↑/↓/Enter)
8. [ ] Update `useDAGState` with:
   - `selectedGroup` (without requiring `selectedTask`)
   - `selectedTaskInGroup` (for right pane)
   - `taskSortState` and `taskFilterState`
9. [ ] Integrate with real workflow API data (`ListTaskEntry` type)
