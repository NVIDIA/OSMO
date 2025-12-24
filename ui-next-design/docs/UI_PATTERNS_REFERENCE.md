# UI Patterns Reference for Dashboard & Platform Design

> **Purpose**: Offline reference for UI design patterns, inspiration, and best practices
> **Focus**: Developer tools, workflow orchestration, observability dashboards
> **Last Updated**: December 2025

---

## Table of Contents

1. [Status Communication Patterns](#status-communication-patterns)
2. [List & Table Patterns](#list--table-patterns)
3. [DAG & Graph Visualization](#dag--graph-visualization)
4. [Progressive Disclosure](#progressive-disclosure)
5. [Information Density](#information-density)
6. [Time & Duration Display](#time--duration-display)
7. [Error & Failure States](#error--failure-states)
8. [Action Patterns](#action-patterns)
9. [Filter & Search Patterns](#filter--search-patterns)
10. [Real-time Updates](#real-time-updates)
11. [Color Systems](#color-systems)
12. [Typography for Dashboards](#typography-for-dashboards)
13. [Inspiration Gallery](#inspiration-gallery)

---

## Status Communication Patterns

### Pattern 1: Status Badge
Simple, compact status indicator.

```
┌─────────────────┐
│ ● Running       │  ← Icon + Label, colored
└─────────────────┘
```

**When to use**: Lists, tables, compact views
**Variations**: 
- Dot only (very compact): `●`
- Icon + text: `⏳ Pending`
- Pill badge: `[Running]`

### Pattern 2: Status with Detail
Badge + supporting information.

```
┌───────────────────────────────────┐
│ ● Running                         │
│ Started 2h ago • 45% complete     │
└───────────────────────────────────┘
```

**When to use**: List rows with space, cards

### Pattern 3: Status Explainer
Full context for complex states.

```
┌───────────────────────────────────────────────────────────────┐
│ ⏳ QUEUED                                                      │
│ ──────────────────────────────────────────────────────────────│
│ Position #3 in queue                                          │
│ Waiting for: 4 GPUs in gpu-pool-us-east                       │
│ Est. wait: ~30 minutes                                        │
│                                                               │
│ [Try different pool]  [Increase priority]                     │
└───────────────────────────────────────────────────────────────┘
```

**When to use**: Detail pages, modals, expanded rows

### Status Categories (Standard)

| Category | Colors | Icons | States |
|----------|--------|-------|--------|
| **Pending/Queued** | Amber/Yellow | Clock, Hourglass | Waiting, Scheduled |
| **Running/Active** | Green, Blue | Spinner, Play | Running, Processing |
| **Success/Done** | Green (muted), Gray | Checkmark | Completed |
| **Failed/Error** | Red | X, Alert | Failed, Error |
| **Warning** | Orange | Warning triangle | Degraded, Retry |
| **Cancelled** | Gray | Slash, Stop | Cancelled, Skipped |

---

## List & Table Patterns

### Pattern 1: Simple List Row
```
┌─────────────────────────────────────────────────────────────────┐
│ train-mnist-a1b2c3   ● Running   gpu-pool   2h 15m   fernandol │
└─────────────────────────────────────────────────────────────────┘
```
**Density**: High
**Best for**: Power users, many items

### Pattern 2: Card Row (Default)
```
┌─────────────────────────────────────────────────────────────────────┐
│  train-mnist-a1b2c3                                    ● Running    │
│  gpu-pool  •  fernandol  •  2h 15m  •  3 tasks                     │
│  ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2/3 complete     │
└─────────────────────────────────────────────────────────────────────┘
```
**Density**: Medium
**Best for**: Default view, scanning

### Pattern 3: Expandable Row
```
┌─────────────────────────────────────────────────────────────────────┐
│ ▼ train-mnist-a1b2c3                                   ● Running    │
│   gpu-pool  •  fernandol  •  2h 15m  •  3 tasks                    │
├─────────────────────────────────────────────────────────────────────┤
│   ✓ preprocess (5m)  →  ● train (2h)  →  ○ evaluate (pending)      │
│                                                                     │
│   [Open]  [Logs]  [Cancel]                                         │
└─────────────────────────────────────────────────────────────────────┘
```
**Density**: Low (expanded)
**Best for**: Quick actions without navigation

### Pattern 4: Master-Detail Split
```
┌──────────────────────────────┬──────────────────────────────────────┐
│ List (scrollable)            │ Detail Panel                         │
│                              │                                      │
│ ▶ workflow-1                 │ workflow-2                           │
│ ▶ workflow-2  ← selected     │ ─────────────────────────────────── │
│ ▶ workflow-3                 │ Status: Running                      │
│ ▶ workflow-4                 │ Pool: gpu-pool                       │
│                              │ Duration: 2h 15m                     │
│                              │                                      │
│                              │ [View Full Details]                  │
└──────────────────────────────┴──────────────────────────────────────┘
```
**Best for**: Exploration, comparing items

---

## DAG & Graph Visualization

### Node Design Patterns

**Minimal Node**:
```
┌──────────────┐
│  task-name   │
│     ✓        │
└──────────────┘
```

**Standard Node**:
```
┌────────────────────┐
│ task-name          │
│ ● Running  •  15m  │
│ gpu-node-02        │
└────────────────────┘
```

**Expanded Node** (with actions):
```
┌─────────────────────────────┐
│ task-name            ● ● ●  │
│ ────────────────────────────│
│ ● RUNNING  •  15m           │
│ gpu-node-02  •  1 GPU       │
│ ────────────────────────────│
│ [Logs]  [Shell]  [Stop]     │
└─────────────────────────────┘
```

**Group Node** (multiple tasks):
```
┌─────────────────────────────┐
│ GROUP: training             │
│ ────────────────────────────│
│ ● train-0  ● train-1        │
│ ● train-2  ○ train-3        │
│ ...+12 more                 │
│ ────────────────────────────│
│ █████████░░ 10/15 running   │
└─────────────────────────────┘
```

### Edge Styles

| State | Style | Animation |
|-------|-------|-----------|
| Pending | Dashed, gray | None |
| Active | Solid, colored | Pulse or flow |
| Complete | Solid, muted | None |
| Failed | Solid, red | None |

### Layout Algorithms

| Algorithm | Best For | Trade-offs |
|-----------|----------|------------|
| **Dagre** | Hierarchical DAGs | Clean, predictable; limited flexibility |
| **ELK** | Complex graphs | More control; heavier setup |
| **Force** | Unknown structure | Organic; can be messy |
| **Grid** | Parallel tasks | Compact; loses dependency clarity |

---

## Progressive Disclosure

### 3-Level Model

```
L1: Overview (list)     → Shows: ID, status, timing, owner
                              ↓ click
L2: Summary (expanded)  → Shows: + progress, tasks, quick actions
                              ↓ click "Open"
L3: Detail (page)       → Shows: + full metadata, DAG, logs, shell
```

### Hover vs Click

| Interaction | Use For |
|-------------|---------|
| **Hover** | Tooltips, previews (no state change) |
| **Click** | Selection, expansion (state change) |
| **Double-click** | Open/navigate (avoid if possible) |
| **Right-click** | Context menu (power users) |

### Information Hierarchy

1. **Primary** (always visible): ID, status
2. **Secondary** (visible on focus): timing, progress, owner
3. **Tertiary** (on demand): resources, node, metadata
4. **Deep** (separate view): logs, events, full history

---

## Information Density

### Density Modes

**Compact** (power users):
```
train-mnist ● 2h gpu-pool fernandol 3/3 ✓
eval-model  ○ 45m queue  fernandol 0/1
```

**Default** (most users):
```
┌────────────────────────────────────────┐
│ train-mnist          ● Running         │
│ gpu-pool • 2h • 3/3 tasks complete    │
└────────────────────────────────────────┘
```

**Comfortable** (occasional users):
```
┌─────────────────────────────────────────────────────┐
│ train-mnist-a1b2c3d4                                │
│                                                     │
│ Status:    ● Running (since 2h ago)                 │
│ Pool:      gpu-pool-us-east                         │
│ Progress:  ████████░░ 3/3 tasks complete           │
│                                                     │
│ [View Details]  [View Logs]                         │
└─────────────────────────────────────────────────────┘
```

### When to Offer Density Toggle
- ✅ Tables with many rows (>20)
- ✅ Dashboards with repeat patterns
- ❌ Forms and input screens
- ❌ Onboarding/first-run experiences

---

## Time & Duration Display

### Relative vs Absolute

| Context | Use |
|---------|-----|
| Recent (<24h) | Relative: "5m ago", "2h ago" |
| Older (>24h) | Absolute: "Dec 23, 2:15 PM" |
| Durations | Duration: "2h 15m" |
| Queued time | Queue-specific: "queued 45m" |

### Duration Formatting

```javascript
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
```

### Relative Time Formatting

```javascript
function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
```

---

## Error & Failure States

### Error Message Hierarchy

1. **What happened** (status): "Image Pull Failed"
2. **Specific error** (message): "unauthorized: authentication required"
3. **Likely causes** (diagnosis): "Missing registry credentials"
4. **How to fix** (action): "Add NGC credential"

### Error Display Patterns

**Inline (minimal)**:
```
✕ FAILED_IMAGE_PULL: Image not found
```

**Card (standard)**:
```
┌─────────────────────────────────────────────────────┐
│ ✕ Image Pull Failed                                 │
│ ─────────────────────────────────────────────────── │
│ Could not pull: nvcr.io/nvidia/pytorch:24.03       │
│ Error: unauthorized                                 │
│                                                     │
│ [View Full Error]  [Retry]                          │
└─────────────────────────────────────────────────────┘
```

**Explainer (detailed)**:
```
┌─────────────────────────────────────────────────────────────────┐
│ ✕ IMAGE PULL FAILED                                             │
│ ─────────────────────────────────────────────────────────────── │
│                                                                 │
│ WHAT HAPPENED                                                   │
│ The container image could not be pulled from the registry.      │
│                                                                 │
│ ERROR DETAILS                                                   │
│ Image: nvcr.io/nvidia/pytorch:24.03-custom                     │
│ Error: unauthorized: authentication required                    │
│                                                                 │
│ LIKELY CAUSES                                                   │
│ 1. Missing registry credentials for nvcr.io                     │
│ 2. Image tag does not exist                                     │
│ 3. Expired API key                                              │
│                                                                 │
│ HOW TO FIX                                                      │
│ [Add NGC Credential]  [Verify Image Exists]  [Restart]          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Action Patterns

### Action Placement

| Location | Actions | Visibility |
|----------|---------|------------|
| **Row inline** | Most common (Open, Logs) | Always |
| **Row hover** | Secondary (Cancel, Copy ID) | On hover |
| **Overflow menu** | Rare (Delete, Clone) | Behind ⋮ |
| **Detail page** | All actions | Prominent |

### Action Button Hierarchy

```
Primary:   [████ Open ████]     ← Filled, brand color
Secondary: [──── Logs ────]     ← Outlined
Tertiary:  [    Cancel    ]     ← Text only, muted
Danger:    [──── Delete ──]     ← Outlined, red
```

### Destructive Actions

Always require confirmation:
```
┌───────────────────────────────────────────────────┐
│ Cancel workflow?                                  │
│                                                   │
│ This will stop all running tasks. This action    │
│ cannot be undone.                                 │
│                                                   │
│            [Keep Running]   [Cancel Workflow]     │
└───────────────────────────────────────────────────┘
```

---

## Filter & Search Patterns

### Filter Bar Layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ [🔍 Search workflows...]  [Status ▼] [Pool ▼] [User ▼] [Date ▼]    │
└─────────────────────────────────────────────────────────────────────┘
```

### Active Filters Display

**Pills (recommended)**:
```
Showing: [Status: Running ×] [Pool: gpu-pool ×] [Clear all]
```

**Inline**:
```
Filtered to: Running workflows in gpu-pool (5 results)
```

### Quick Filters (clickable stats)

```
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ ⏳ 12    │ │ ● 8     │ │ ✓ 45    │ │ ✕ 3     │
│ Queued   │ │ Running  │ │ Complete │ │ Failed   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘
```

---

## Real-time Updates

### Update Indicators

| Pattern | Use |
|---------|-----|
| **Pulse animation** | Status badges for running items |
| **Last updated** | "Updated 5s ago" in header |
| **Live indicator** | Green dot: "● Live" |
| **Toast notification** | New failures, completions |

### Polling vs WebSocket

| Approach | Pros | Cons |
|----------|------|------|
| **Polling (30s)** | Simple, resilient | Delay, traffic |
| **WebSocket** | Instant, efficient | Complexity, reconnection |
| **Hybrid** | Best of both | Most complex |

**Recommendation**: Start with polling, add WebSocket for active workflows.

---

## Color Systems

### Status Colors (Dark Theme)

```css
:root {
  /* Queued/Pending */
  --status-queued-bg: rgb(251 191 36 / 0.1);    /* amber-400/10 */
  --status-queued-text: rgb(251 191 36);         /* amber-400 */
  --status-queued-border: rgb(251 191 36 / 0.3);
  
  /* Running */
  --status-running-bg: rgb(34 197 94 / 0.1);     /* green-500/10 */
  --status-running-text: rgb(34 197 94);         /* green-500 */
  --status-running-border: rgb(34 197 94 / 0.3);
  
  /* Completed */
  --status-completed-bg: rgb(113 113 122 / 0.1); /* zinc-500/10 */
  --status-completed-text: rgb(161 161 170);     /* zinc-400 */
  --status-completed-border: rgb(113 113 122 / 0.2);
  
  /* Failed */
  --status-failed-bg: rgb(239 68 68 / 0.1);      /* red-500/10 */
  --status-failed-text: rgb(248 113 113);        /* red-400 */
  --status-failed-border: rgb(239 68 68 / 0.3);
}
```

### Priority Colors

```css
:root {
  --priority-high: rgb(248 113 113);    /* red-400 */
  --priority-normal: rgb(161 161 170);  /* zinc-400 */
  --priority-low: rgb(96 165 250);      /* blue-400 */
}
```

---

## Typography for Dashboards

### Recommended Fonts

| Use Case | Font | Why |
|----------|------|-----|
| **UI Text** | Inter, SF Pro | Clean, good at small sizes |
| **Code/IDs** | JetBrains Mono, Fira Code | Monospace, distinguishable chars |
| **Numbers** | Tabular figures | Columns align properly |

### Size Scale

```css
--text-xs: 0.75rem;   /* 12px - metadata, timestamps */
--text-sm: 0.875rem;  /* 14px - secondary info */
--text-base: 1rem;    /* 16px - primary content */
--text-lg: 1.125rem;  /* 18px - section headers */
--text-xl: 1.25rem;   /* 20px - page titles */
```

### Weight Usage

- **Regular (400)**: Body text, descriptions
- **Medium (500)**: Labels, buttons, emphasis
- **Semibold (600)**: Headings, important values
- **Bold (700)**: Rarely (page titles only)

---

## Inspiration Gallery

### Workflow/Pipeline UIs

1. **GitHub Actions**
   - Clean linear visualization
   - Excellent status communication
   - Simple, focused

2. **Argo Workflows**
   - React Flow DAG
   - Rich node metadata
   - Good for complex DAGs

3. **Prefect**
   - Beautiful timeline view
   - Collapsible task groups
   - Smooth animations

4. **Dagster**
   - Asset-centric view
   - Rich metadata panels
   - Good observability

5. **Airflow**
   - Proven patterns
   - Grid and graph views
   - Task instance focus

### Observability Dashboards

1. **Grafana**
   - Flexible panels
   - Time-series focus
   - Query-driven

2. **Datadog**
   - Service maps
   - Trace visualization
   - Alert integration

3. **Vercel**
   - Clean log streaming
   - Deploy previews
   - Minimal, effective

### Developer Platforms

1. **Railway**
   - Simple deployment view
   - Clear resource display
   - Modern aesthetic

2. **Render**
   - Service dashboard
   - Log tailing
   - Deploy history

3. **Fly.io**
   - Machine focus
   - Geographic visualization
   - Terminal-inspired

---

## Quick Reference: Tailwind Classes

### Status Badge Classes
```jsx
// Queued
"bg-amber-500/10 text-amber-400 border-amber-500/30"

// Running
"bg-green-500/10 text-green-400 border-green-500/30"

// Completed
"bg-zinc-500/10 text-zinc-400 border-zinc-500/30"

// Failed
"bg-red-500/10 text-red-400 border-red-500/30"
```

### Card/Row Classes
```jsx
// Default row
"bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-zinc-700"

// Selected row
"bg-zinc-900 border border-zinc-600 rounded-lg p-4"

// Expanded row
"bg-zinc-900 border border-zinc-700 rounded-lg divide-y divide-zinc-800"
```

### Button Classes
```jsx
// Primary
"bg-[var(--nvidia-green)] text-black hover:bg-[var(--nvidia-green-light)]"

// Secondary
"bg-transparent border border-zinc-700 text-zinc-300 hover:bg-zinc-800"

// Danger
"bg-transparent border border-red-500/30 text-red-400 hover:bg-red-500/10"
```

---

## Changelog

| Date | Change |
|------|--------|
| Dec 2025 | Initial reference document |
