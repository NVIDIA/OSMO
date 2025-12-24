# OSMO Workflows Page Design

> **Status**: Design Phase
> **Last Updated**: December 2025
> **Author**: Design collaboration document

---

## Executive Summary

The Workflows page is the **most complex and important** part of the OSMO dashboard. It serves as:

1. **Command Center** - Primary view for users to monitor all workflow activity
2. **Investigation Tool** - Entry point for debugging failed/stuck workflows
3. **Lifecycle Tracker** - Understanding what happened, what's happening, what will happen

This document defines the information architecture, interaction patterns, and visual design for the redesigned Workflows experience.

---

## Table of Contents

1. [User Needs & Pain Points](#user-needs--pain-points)
2. [Information Architecture](#information-architecture)
3. [Progressive Disclosure Model](#progressive-disclosure-model)
4. [Workflow List Design](#workflow-list-design)
5. [Workflow Detail Design](#workflow-detail-design)
6. [DAG Visualization](#dag-visualization)
7. [Task Interaction Model](#task-interaction-model)
8. [Lifecycle & Status Communication](#lifecycle--status-communication)
9. [Interactive Features](#interactive-features)
10. [Cross-Cutting Concerns](#cross-cutting-concerns)
11. [Reference Implementations](#reference-implementations)
12. [Implementation Plan](#implementation-plan)

---

## User Needs & Pain Points

### Primary User Questions (in order of frequency)

| Question | When Asked | Current Pain Point |
|----------|-----------|-------------------|
| **Why did my workflow fail?** | After failure notification | Buried error logs, unclear failure type |
| **Why isn't my workflow running?** | Waiting in queue | No queue position, no ETA, no resource visibility |
| **What's the current state?** | During execution | Status updates don't explain what's happening |
| **What will happen next?** | Planning/waiting | No visibility into future state transitions |
| **How long will it take?** | After submission | No estimates, no historical comparison |

### User Personas & Their Needs

| Persona | Primary Task | Key Need |
|---------|-------------|----------|
| **ML Engineer** | Train models, iterate | Fast failure diagnosis, restart workflow |
| **Researcher** | Run experiments | Compare runs, track progress across many workflows |
| **Team Lead** | Monitor team activity | Overview of all team workflows, identify bottlenecks |
| **On-Call** | Troubleshoot issues | Quickly identify failing workflows, find root cause |

### Success Metrics

- **Time to diagnosis**: How quickly can users understand why something failed?
- **Time to action**: How quickly can users take corrective action?
- **Cognitive load**: How many clicks/views to answer primary questions?

---

## Information Architecture

### Entity Hierarchy

```
User
 └── submits → Workflow
                 ├── status (WAITING → RUNNING → COMPLETED/FAILED)
                 ├── priority (LOW, NORMAL, HIGH)
                 ├── pool (where it runs)
                 ├── timing (submit, start, end, queued, duration)
                 └── contains → Group(s)
                                  ├── status
                                  ├── dependencies (upstream/downstream)
                                  └── contains → Task(s)
                                                   ├── status
                                                   ├── timing (granular lifecycle)
                                                   ├── resources (CPU, GPU, memory)
                                                   ├── node (where it runs)
                                                   ├── logs (stdout, stderr)
                                                   ├── events (k8s events)
                                                   └── actions (shell, port-forward)
```

### Information Layers

| Layer | Contents | When Visible |
|-------|----------|--------------|
| **L0: List** | Workflow ID, status, user, pool, submit time | Always (workflows index) |
| **L1: Summary** | Status breakdown, progress, quick actions | Hover/select workflow |
| **L2: Detail** | All workflow metadata, task list/DAG | Drill into workflow |
| **L3: Task** | Task details, lifecycle, logs, actions | Select task |
| **L4: Interaction** | Shell, logs stream, port-forward | Launch action |

---

## Progressive Disclosure Model

### Design Principle: **Answer first, explain second**

Each level of the UI should immediately answer the user's most likely question at that level, then provide paths to deeper investigation.

### Level 0: Workflow List

**Question answered**: "What's the status of my workflows?"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WORKFLOWS                                                    [+ Submit]    │
├─────────────────────────────────────────────────────────────────────────────┤
│  [Search: workflow name]     [Pool ▼] [Status ▼] [User ▼] [Date ▼]         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  train-mnist-a1b2c3                                                  │   │
│  │  ● RUNNING  •  gpu-pool  •  2h 15m  •  you  •  3 tasks              │   │
│  │  ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2/3 tasks complete    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  eval-model-x9y8z7                                                   │   │
│  │  ● WAITING  •  gpu-pool  •  queued 45m  •  you  •  1 task           │   │
│  │  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ Position #3 in queue  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  data-prep-failed-q2w3e4                                             │   │
│  │  ✕ FAILED_IMAGE_PULL  •  cpu-pool  •  5m ago  •  you  •  1 task     │   │
│  │  ─────────────────────────────────────────────── Image not found    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions**:
- **Inline progress**: Show task completion directly in list row
- **Queue position**: Show position for waiting workflows
- **Failure hint**: Show failure reason snippet for failed workflows
- **Relative time**: Use "5m ago", "2h 15m" instead of timestamps
- **Smart defaults**: Filter to user's workflows, recent first

### Level 1: Workflow Summary (Hover/Quick View)

**Question answered**: "What's happening right now?"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          train-mnist-a1b2c3                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Status         ● RUNNING (Task 2/3 executing)                              │
│  Pool           gpu-pool (3 GPUs available)                                 │
│  Submitted      2h 15m ago by you                                           │
│  Started        2h 10m ago (queued 5m)                                      │
│                                                                             │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │  TIMELINE                                                              │ │
│  │  ═══════════╦══════════════════════════════╦══════════════════════     │ │
│  │  submit    start                          now                    est.  │ │
│  │             ├── preprocess ✓ (5m)                                      │ │
│  │             ├── train ● (2h running)                                   │ │
│  │             └── evaluate ○ (waiting)                                   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐               │
│  │  ◉ Detail  │ │  ▣ Logs    │ │  ⌧ Cancel  │ │  ↗ Open    │               │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key design decisions**:
- **Visual timeline**: Show progress as a timeline, not just percentages
- **Current action**: Describe what's happening ("Task 2/3 executing")
- **Resource context**: Show pool availability
- **Quick actions**: Most common actions immediately accessible

### Level 2: Workflow Detail Page

**Question answered**: "What's the complete picture?"

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← Workflows / train-mnist-a1b2c3                           [↻ Refresh]     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        WORKFLOW OVERVIEW                            │   │
│  │                                                                     │   │
│  │   Status    ● RUNNING         Priority    NORMAL                    │   │
│  │   Pool      gpu-pool          Backend     aws-east-1                │   │
│  │   Submitted Dec 23, 2:15 PM   Started     Dec 23, 2:20 PM           │   │
│  │   Queued    5m                Duration    2h 10m (running)          │   │
│  │   User      fernandol         Tags        experiment, v2            │   │
│  │                                                                     │   │
│  │   [View Spec]  [View Logs]  [Grafana]  [K8s Dashboard]  [Cancel]    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  VIEW:  [List]  [DAG]  [Timeline]                                   │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐│   │
│  │  │                      DAG VISUALIZATION                          ││   │
│  │  │                                                                 ││   │
│  │  │      ┌──────────┐       ┌──────────┐       ┌──────────┐         ││   │
│  │  │      │preprocess│ ────▶ │  train   │ ────▶ │ evaluate │         ││   │
│  │  │      │    ✓     │       │    ●     │       │    ○     │         ││   │
│  │  │      │   5m     │       │ 2h 10m   │       │ waiting  │         ││   │
│  │  │      └──────────┘       └──────────┘       └──────────┘         ││   │
│  │  │                                                                 ││   │
│  │  └─────────────────────────────────────────────────────────────────┘│   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐│   │
│  │  │  TASK LIST                              [Filter ▼] [Search]     ││   │
│  │  │                                                                 ││   │
│  │  │  ┌───────────────────────────────────────────────────────────┐ ││   │
│  │  │  │ ✓ preprocess   •  5m   •  node-01  •  1 CPU, 8Gi, 0 GPU   │ ││   │
│  │  │  └───────────────────────────────────────────────────────────┘ ││   │
│  │  │  ┌───────────────────────────────────────────────────────────┐ ││   │
│  │  │  │ ● train        •  2h 10m  •  node-02  •  4 CPU, 32Gi, 1 GPU│◀││   │
│  │  │  └───────────────────────────────────────────────────────────┘ ││   │
│  │  │  ┌───────────────────────────────────────────────────────────┐ ││   │
│  │  │  │ ○ evaluate     •  waiting on: train                       │ ││   │
│  │  │  └───────────────────────────────────────────────────────────┘ ││   │
│  │  │                                                                 ││   │
│  │  └─────────────────────────────────────────────────────────────────┘│   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      TASK: train (selected)                         │   │
│  │                                                                     │   │
│  │  Status      ● RUNNING            Started    Dec 23, 2:25 PM        │   │
│  │  Node        gpu-node-02          Duration   2h 05m                 │   │
│  │  Resources   4 CPU, 32Gi, 1 GPU   Exit Code  -                      │   │
│  │                                                                     │   │
│  │  LIFECYCLE                                                          │   │
│  │  ───────────────────────────────────────────────────────────────    │   │
│  │  Processing   → Scheduling   → Initializing   → Running             │   │
│  │     1m             2m             2m            2h 05m              │   │
│  │                                                                     │   │
│  │  [View Logs]  [Open Shell]  [Port Forward]  [View Events]           │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Workflow List Design

### Filtering System

| Filter | Type | Options | Purpose |
|--------|------|---------|---------|
| **User** | Multi-select | All users, just me | Scope to own workflows |
| **Pool** | Multi-select | Available pools | Filter by compute pool |
| **Status** | Multi-select | Status groups | Find running/failed/etc |
| **Priority** | Multi-select | LOW, NORMAL, HIGH | Filter by priority |
| **Date Range** | Date picker | Last 24h, 7d, 30d, custom | Time-bound queries |
| **Search** | Text input | Workflow name | Find specific workflow |

### Status Groups for Filtering

| UI Group | Backend Statuses | Color |
|----------|------------------|-------|
| **Queued** | PENDING, WAITING, PROCESSING, SCHEDULING | 🟡 Amber |
| **Running** | INITIALIZING, RUNNING | 🟢 Green |
| **Completed** | COMPLETED | ⬜ Gray |
| **Failed** | FAILED_* (all failure types) | 🔴 Red |

### Row Design Variants

**Minimal Row (Dense Mode)**:
```
train-mnist-a1b2c3  ● RUNNING  gpu-pool  2h 15m  fernandol
```

**Standard Row (Default)**:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  train-mnist-a1b2c3                                           ● RUNNING     │
│  gpu-pool  •  fernandol  •  2h 15m running  •  3 tasks                      │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2/3 complete       │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Expanded Row (on hover/select)**:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  train-mnist-a1b2c3                                           ● RUNNING     │
│  gpu-pool  •  fernandol  •  2h 15m running  •  3 tasks                      │
│  ████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 2/3 complete       │
│  ─────────────────────────────────────────────────────────────────────────  │
│  ✓ preprocess (5m)  →  ● train (2h 10m)  →  ○ evaluate (pending)            │
│                                                                             │
│  [Open]  [Logs]  [Cancel]                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Real-time Updates

- **Auto-refresh**: Configurable interval (default: 30s)
- **Optimistic updates**: Immediate feedback on actions
- **Status badge pulse**: Animate running workflows subtly
- **Connection indicator**: Show when real-time is connected

---

## DAG Visualization

### Research: Existing Implementations

| Tool | Library | Strengths | Weaknesses |
|------|---------|-----------|------------|
| **Airflow** | D3 + custom | Clear dependencies, zoom levels | Dated UI, heavy |
| **Argo Workflows** | React Flow | Modern, interactive | Can get cluttered |
| **GitHub Actions** | Custom SVG | Clean, simple | Only linear flows |
| **Prefect** | React Flow | Beautiful, collapsible | Complex setup |
| **Dagster** | Custom + cytoscape | Detailed metadata | Busy visuals |

### Recommended Approach: **React Flow with Custom Nodes**

**Why React Flow**:
- Already in legacy codebase (knowledge exists)
- Highly customizable
- Good performance with virtualization
- Active maintenance

### Node Types

**Group Node** (contains multiple tasks):
```
┌───────────────────────────────────────┐
│  GROUP: training                      │
│  ───────────────────────────────────  │
│  ● train-shard-1                      │
│  ● train-shard-2                      │
│  ● train-shard-3                      │
│  ... +12 more                         │
│  ───────────────────────────────────  │
│  13/15 running                        │
└───────────────────────────────────────┘
```

**Single Task Node**:
```
┌───────────────────────┐
│  preprocess           │
│  ✓ 5m                 │
│  node-01              │
└───────────────────────┘
```

**Running Task Node** (expanded):
```
┌───────────────────────────────────────┐
│  train                         ● ● ●  │
│  ───────────────────────────────────  │
│  ● RUNNING  •  2h 10m                 │
│  gpu-node-02  •  1 GPU                │
│  ───────────────────────────────────  │
│  [Logs]  [Shell]                      │
└───────────────────────────────────────┘
```

**Failed Task Node**:
```
┌───────────────────────────────────────┐
│  deploy                         ✕     │
│  ───────────────────────────────────  │
│  ✕ FAILED_IMAGE_PULL                  │
│  "Image not found: nvcr.io/..."       │
│  ───────────────────────────────────  │
│  [View Error]  [Retry]                │
└───────────────────────────────────────┘
```

### Layout Algorithms

| Algorithm | Best For | Use When |
|-----------|----------|----------|
| **Dagre (hierarchical)** | Standard DAGs | <50 nodes, clear hierarchy |
| **ELK** | Complex DAGs | Many nodes, complex dependencies |
| **Force-directed** | Exploring relationships | Unknown structure |

**Recommended**: Start with Dagre, allow user to switch layouts.

### Interactivity

| Action | Trigger | Result |
|--------|---------|--------|
| **Select node** | Click | Show task details in panel |
| **Pan** | Drag background | Move viewport |
| **Zoom** | Scroll wheel | Zoom in/out |
| **Fit view** | Button / keyboard | Fit all nodes in viewport |
| **Expand group** | Click expand | Show individual tasks |
| **Quick action** | Right-click / hover button | Logs, shell, etc. |

### Edge Styling

| State | Style |
|-------|-------|
| **Pending** | Dashed, gray |
| **Active** | Solid, animated pulse, blue |
| **Complete** | Solid, green |
| **Failed** | Solid, red |

---

## Task Interaction Model

### Task Detail Panel

The task detail panel is a slide-out that shows comprehensive task information without leaving the context of the workflow view.

**Panel Sections**:

1. **Identity**: Name, retry ID, group
2. **Status**: Current status with description
3. **Lifecycle Timeline**: Visual timeline of state transitions
4. **Resources**: CPU, GPU, memory, storage requested
5. **Placement**: Node, pod name, pod IP
6. **Timing**: Detailed timing breakdown
7. **Actions**: Context-appropriate actions

### Lifecycle Timeline Visualization

```
LIFECYCLE TIMELINE
─────────────────────────────────────────────────────────────────────────────

  Processing     Scheduling     Initializing      Running         End
      │              │               │               │             │
      ▼              ▼               ▼               ▼             ▼
  ════════════╦═══════════════╦══════════════╦═══════════════════════════
  │    1m    ││      2m      ││     2m      ││        2h 05m         │
  ════════════╩═══════════════╩══════════════╩═══════════════════════════
                                              └──▶ currently here

  • Processing: Workflow engine evaluating task
  • Scheduling: Finding node with available resources  
  • Initializing: Pulling image, mounting volumes
  • Running: Task code executing
```

### Task Actions

| Action | Available When | Opens |
|--------|---------------|-------|
| **View Logs** | Always (after start) | Log viewer modal |
| **View Error Logs** | After failure | Error log viewer |
| **View Events** | Always | K8s events viewer |
| **Open Shell** | RUNNING | Terminal modal |
| **Port Forward** | RUNNING | Port forward setup |
| **View on Dashboard** | Has dashboard URL | External link |
| **View on Grafana** | Has Grafana URL | External link |

---

## Lifecycle & Status Communication

### Status Descriptions

Each status should have a clear, actionable description:

| Status | Category | Description | User Action |
|--------|----------|-------------|-------------|
| **PENDING** | Queued | Workflow received, waiting to be processed | Wait |
| **WAITING** | Queued | In queue, waiting for resources | Check pool availability |
| **PROCESSING** | Queued | Scheduler evaluating task requirements | Wait |
| **SCHEDULING** | Queued | Finding a node with sufficient resources | Wait or check pool |
| **INITIALIZING** | Starting | Pulling image and setting up pod | Wait |
| **RUNNING** | Running | Task is executing | Monitor, interact |
| **COMPLETED** | Done | Task finished successfully | View outputs |
| **FAILED** | Failed | Task failed (generic) | Check logs |
| **FAILED_IMAGE_PULL** | Failed | Could not pull container image | Fix image name or creds |
| **FAILED_EXEC_TIMEOUT** | Failed | Task exceeded execution timeout | Increase timeout or optimize |
| **FAILED_QUEUE_TIMEOUT** | Failed | Waited too long in queue | Try different pool/priority |
| **FAILED_EVICTED** | Failed | Evicted due to resource pressure | Retry or use different pool |
| **FAILED_PREEMPTED** | Failed | Preempted by higher priority | Submit with higher priority |
| **FAILED_UPSTREAM** | Failed | A dependency failed | Fix upstream task |
| **FAILED_CANCELED** | Failed | Cancelled by user | Intentional, resubmit if needed |

### "Why isn't it running?" Explainer

For queued workflows, provide context:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WHY IS THIS WAITING?                                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Your workflow needs: 4 GPUs                                                │
│                                                                             │
│  Pool status (gpu-pool):                                                    │
│  • 8 GPUs total capacity                                                    │
│  • 6 GPUs currently in use                                                  │
│  • 2 GPUs available                                                         │
│                                                                             │
│  Position in queue: #3                                                      │
│                                                                             │
│  Options:                                                                   │
│  • Wait for resources to free up (estimated: ~30min based on running jobs) │
│  • Try a different pool with more capacity                                  │
│  • Submit with HIGH priority (if urgent)                                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### "Why did it fail?" Explainer

For failed workflows, provide diagnosis:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  WHY DID THIS FAIL?                                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✕ FAILED_IMAGE_PULL                                                        │
│                                                                             │
│  The container image could not be pulled:                                   │
│  Image: nvcr.io/nvidia/pytorch:24.03-py3-custom                            │
│                                                                             │
│  Error: unauthorized: authentication required                               │
│                                                                             │
│  Likely causes:                                                             │
│  • Image name is incorrect                                                  │
│  • Missing registry credentials for nvcr.io                                 │
│  • Image does not exist or was deleted                                      │
│                                                                             │
│  How to fix:                                                                │
│  1. Verify the image exists: `docker pull nvcr.io/nvidia/...`               │
│  2. Check your registry credentials: Profile → Credentials                  │
│  3. If using NGC, ensure you have a valid API key                           │
│                                                                             │
│  [Add NGC Credential]  [View Full Error]  [Restart Workflow]                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Interactive Features

### Log Viewer

**Requirements**:
- Stream logs in real-time for running tasks
- Support for large log files (virtualized)
- Search within logs
- Download logs
- ANSI color support
- Timestamp toggle
- Task filter (for workflow-level logs)

**UI Design**:
```
┌─────────────────────────────────────────────────────────────────────────────┐
│  LOGS: train-mnist-a1b2c3                                      [✕ Close]    │
├─────────────────────────────────────────────────────────────────────────────┤
│  Task: [All Tasks ▼]     Lines: [Last 1000 ▼]     [⟳ Auto-scroll]          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ [Search logs...]                           [Download] [Timestamps]    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  2024-12-23 14:25:01 [preprocess] Starting data preprocessing...            │
│  2024-12-23 14:25:03 [preprocess] Loading dataset from s3://bucket/data     │
│  2024-12-23 14:25:15 [preprocess] Preprocessing complete. 10000 samples.    │
│  2024-12-23 14:25:16 [train] Starting training run...                       │
│  2024-12-23 14:25:18 [train] Epoch 1/10                                     │
│  2024-12-23 14:26:42 [train] Epoch 1 complete. Loss: 0.543                  │
│  2024-12-23 14:27:03 [train] Epoch 2/10                                     │
│  ...                                                                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Shell Terminal

**Requirements**:
- WebSocket-based PTY connection
- Full terminal emulation (xterm.js)
- Copy/paste support
- Search within terminal
- Multiple shell instances

### Port Forwarding

**Requirements**:
- Set up tunnel to task port
- Show accessible URL
- Multiple ports supported
- Connection status indicator

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  PORT FORWARD: train task                                      [✕ Close]    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Local Port    Remote Port    Status                                        │
│  ──────────    ───────────    ──────                                        │
│  8888          8888           ● Connected                                   │
│  6006          6006           ● Connected                                   │
│                                                                             │
│  Access your services:                                                      │
│  • Jupyter: http://localhost:8888                                           │
│  • TensorBoard: http://localhost:6006                                       │
│                                                                             │
│  [+ Add Port]                                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Cross-Cutting Concerns

### Workflow-Level Log View

Show interleaved logs from all tasks with task prefix:

```
[preprocess] Starting preprocessing...
[preprocess] Complete.
[train] Starting training...
[evaluate] Waiting for train to complete...
[train] Epoch 1 complete.
```

### Aggregated Status View

For workflows with many tasks, show summary:

```
TASK STATUS SUMMARY
───────────────────────────────────────────────────────────────────────────────
  ████████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

  ✓ 45 completed    ● 10 running    ○ 25 waiting    ✕ 2 failed
```

### Keyboard Navigation

| Key | Action |
|-----|--------|
| `j` / `k` or `↓` / `↑` | Navigate workflows/tasks |
| `Enter` | Open selected |
| `Escape` | Close panel/modal |
| `?` | Show keyboard shortcuts |
| `g` / `l` | Switch to Graph/List view |
| `r` | Refresh |
| `/` | Focus search |

### URL State

All view state should be reflected in URL for shareability:

```
/workflows/train-mnist-a1b2c3?view=dag&task=train&panel=logs
```

---

## Reference Implementations

### For DAG Visualization

1. **Argo Workflows** - https://argoproj.github.io/argo-workflows/
   - React Flow based, good interactivity
   - Study their node/edge styling

2. **Prefect UI** - https://www.prefect.io/
   - Beautiful task state visualization
   - Excellent timeline view

3. **Dagster** - https://dagster.io/
   - Rich metadata display on nodes
   - Good for complex DAGs

4. **GitHub Actions** - https://github.com/features/actions
   - Clean, simple for linear flows
   - Good status communication

### For Log Viewers

1. **Vercel Logs** - https://vercel.com/
   - Clean, performant log streaming
   - Good search experience

2. **Grafana Loki** - https://grafana.com/oss/loki/
   - Query-based log exploration
   - Label-based filtering

---

## Implementation Plan

### Phase 1: Workflow List (Week 1-2)

| Task | Priority |
|------|----------|
| Workflow list page with filtering | P0 |
| Status badges with proper colors | P0 |
| Row expansion with task preview | P1 |
| Auto-refresh | P1 |
| Keyboard navigation | P2 |

### Phase 2: Workflow Detail - Basic (Week 3-4)

| Task | Priority |
|------|----------|
| Workflow detail page layout | P0 |
| Task list view | P0 |
| Task detail panel | P0 |
| Basic DAG view (React Flow) | P1 |
| Lifecycle timeline | P1 |

### Phase 3: Interactive Features (Week 5-6)

| Task | Priority |
|------|----------|
| Log viewer modal | P0 |
| Shell terminal | P1 |
| Port forwarding UI | P2 |
| Workflow-level logs | P1 |

### Phase 4: Polish (Week 7-8)

| Task | Priority |
|------|----------|
| "Why waiting?" explainer | P1 |
| "Why failed?" explainer | P1 |
| DAG layout algorithms | P2 |
| URL state sync | P1 |
| Real-time updates (WebSocket) | P2 |

---

## Open Questions

1. **DAG vs List default**: Which view should be default for workflow detail?
   - Proposal: List for >10 tasks, DAG for ≤10 tasks

2. **Terminal library**: Continue with xterm.js or evaluate alternatives?
   - Proposal: Keep xterm.js, it's proven

3. **Real-time updates**: Polling vs WebSocket?
   - Proposal: Start with polling (30s), add WebSocket later

4. **Log storage**: Stream from backend or cache locally?
   - Proposal: Stream with local virtualization

---

## Related Documents

- [Information Architecture](./INFORMATION_ARCHITECTURE.md)
- [Redesign Plan](./REDESIGN_PLAN.md)
- [Patterns & Conventions](./docs/PATTERNS.md)

---

## Changelog

| Date | Change |
|------|--------|
| Dec 2025 | Initial design document created |
