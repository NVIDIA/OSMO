// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useEffect, useRef, useMemo, useCallback, useSyncExternalStore } from "react";
import { DataSet } from "vis-data";
import { Timeline, TimelineOptions } from "vis-timeline/standalone";
import { cn } from "@/lib/utils";
import { Button } from "@/components/shadcn/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/shadcn/tabs";
import {
  ChevronLeft,
  RefreshCw,
  XCircle,
  CheckCircle,
  Clock,
  Loader2,
  FileText,
  Terminal,
  Maximize2,
  Minimize2,
} from "lucide-react";
import { usePage } from "@/components/shell";

// Import vis-timeline CSS
import "vis-timeline/styles/vis-timeline-graph2d.css";

import {
  EXAMPLE_WORKFLOWS,
  getStatusCategory,
  type MockGroupNode,
  type MockTaskNode,
  type WorkflowPattern,
  TaskGroupStatus,
} from "../mock-workflow";

// ============================================================================
// Status Styling
// ============================================================================

const statusColors = {
  waiting: { bg: "#3f3f46", border: "#52525b", text: "#a1a1aa" },
  running: { bg: "#065f46", border: "#10b981", text: "#6ee7b7" },
  completed: { bg: "#27272a", border: "#52525b", text: "#71717a" },
  failed: { bg: "#7f1d1d", border: "#ef4444", text: "#fca5a5" },
};

function getStatusIcon(status: TaskGroupStatus, size = "h-4 w-4") {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return <Clock className={cn(size, "text-zinc-400")} />;
    case "running":
      return <Loader2 className={cn(size, "text-emerald-400 animate-spin")} />;
    case "completed":
      return <CheckCircle className={cn(size, "text-zinc-500")} />;
    case "failed":
      return <XCircle className={cn(size, "text-red-400")} />;
  }
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "-";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.round((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTime(date: Date | null): string {
  if (!date) return "-";
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ============================================================================
// Timeline Data Conversion with Nested Groups
// ============================================================================

interface TimelineItem {
  id: string;
  content: string;
  start: Date;
  end: Date;
  group: string;
  className: string;
  title?: string;
  style?: string;
}

interface TimelineGroup {
  id: string;
  content: string;
  className?: string;
  style?: string;
  nestedGroups?: string[];
  showNested?: boolean;
  treeLevel?: number;
}

function convertToTimelineData(
  workflow: ReturnType<typeof EXAMPLE_WORKFLOWS.complex>,
  showNestedTasks: boolean,
): {
  items: TimelineItem[];
  groups: TimelineGroup[];
} {
  const items: TimelineItem[] = [];
  const groups: TimelineGroup[] = [];

  workflow.groups.forEach((group) => {
    const category = getStatusCategory(group.status);
    const colors = statusColors[category];
    const completedCount = group.tasks.filter((t) => t.status === TaskGroupStatus.COMPLETED).length;
    const hasManyTasks = group.tasks.length > 1;

    if (showNestedTasks && hasManyTasks) {
      // Create parent group with nested task groups - show ALL tasks
      const taskGroupIds = group.tasks.map((t) => `task-${t.id}`);

      groups.push({
        id: group.id,
        content: `<div class="flex items-center gap-2">
          <span class="font-medium">${group.name}</span>
          <span class="text-xs opacity-60">${completedCount}/${group.tasks.length}</span>
        </div>`,
        style: `color: ${colors.text}; background: ${colors.bg}40;`,
        nestedGroups: taskGroupIds,
        showNested: true, // Always expanded by default, users can collapse if needed
        treeLevel: 1,
      });

      // Create nested groups for each task
      group.tasks.forEach((task) => {
        const taskCategory = getStatusCategory(task.status);
        const taskColors = statusColors[taskCategory];

        groups.push({
          id: `task-${task.id}`,
          content: `<span class="text-xs">${task.name}</span>`,
          style: `color: ${taskColors.text}; background: ${taskColors.bg}20; padding-left: 20px;`,
          treeLevel: 2,
        });

        // Add item for this task
        if (task.startTime) {
          items.push({
            id: task.id,
            content: formatDuration(task.duration),
            start: task.startTime,
            end: task.endTime || new Date(),
            group: `task-${task.id}`,
            className: `task-${taskCategory}`,
            title: `${task.name}\nStatus: ${task.status}\nDuration: ${formatDuration(task.duration)}\nNode: ${task.node || "N/A"}`,
            style: `background: ${taskColors.bg}; border-color: ${taskColors.border}; color: ${taskColors.text};`,
          });
        }
      });
    } else {
      // Flat group - all tasks on one row
      groups.push({
        id: group.id,
        content: `<div class="flex items-center gap-2">
          <span class="font-medium">${group.name}</span>
          ${hasManyTasks ? `<span class="text-xs opacity-60">(${group.tasks.length})</span>` : ""}
        </div>`,
        style: `color: ${colors.text}; background: ${colors.bg}40;`,
      });

      // Create items for each task
      group.tasks.forEach((task) => {
        const taskCategory = getStatusCategory(task.status);
        const taskColors = statusColors[taskCategory];

        if (task.startTime) {
          items.push({
            id: task.id,
            content: hasManyTasks ? "" : task.name,
            start: task.startTime,
            end: task.endTime || new Date(),
            group: group.id,
            className: `task-${taskCategory}`,
            title: `${task.name}\nStatus: ${task.status}\nDuration: ${formatDuration(task.duration)}\nNode: ${task.node || "N/A"}`,
            style: `background: ${taskColors.bg}; border-color: ${taskColors.border}; color: ${taskColors.text};`,
          });
        }
      });
    }
  });

  return { items, groups };
}

// ============================================================================
// Detail Panel
// ============================================================================

function DetailPanel({
  task,
  group,
  onClose,
}: {
  task: MockTaskNode | null;
  group: MockGroupNode | null;
  onClose: () => void;
}) {
  if (!task || !group) return null;

  const category = getStatusCategory(task.status);
  const style = {
    waiting: { text: "text-zinc-400", bg: "bg-zinc-800" },
    running: { text: "text-emerald-400", bg: "bg-emerald-950/50" },
    completed: { text: "text-zinc-500", bg: "bg-zinc-800" },
    failed: { text: "text-red-400", bg: "bg-red-950/50" },
  }[category];

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900/95 backdrop-blur overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-4 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(task.status)}
            <h3 className="font-semibold text-zinc-100">{task.name}</h3>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onClose}
          >
            <XCircle className="h-4 w-4 text-zinc-400" />
          </Button>
        </div>
        <div className={cn("text-xs mt-1", style.text)}>
          {task.status} • Group: {group.name}
        </div>
      </div>

      {/* Task details */}
      <div className="p-4 space-y-4">
        <div>
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Timing</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Start</dt>
              <dd className="text-zinc-200 font-mono text-xs">{formatTime(task.startTime)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">End</dt>
              <dd className="text-zinc-200 font-mono text-xs">{formatTime(task.endTime)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-zinc-400">Duration</dt>
              <dd className="text-zinc-200">{formatDuration(task.duration)}</dd>
            </div>
          </dl>
        </div>

        <div>
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Resources</h4>
          <div className="grid grid-cols-3 gap-2">
            <div className="p-2 rounded bg-zinc-800 text-center">
              <div className="text-lg font-semibold">{task.cpu}</div>
              <div className="text-xs text-zinc-400">CPU</div>
            </div>
            <div className="p-2 rounded bg-zinc-800 text-center">
              <div className="text-lg font-semibold">{task.gpu}</div>
              <div className="text-xs text-zinc-400">GPU</div>
            </div>
            <div className="p-2 rounded bg-zinc-800 text-center">
              <div className="text-sm font-semibold">{task.memory}Gi</div>
              <div className="text-xs text-zinc-400">Memory</div>
            </div>
          </div>
        </div>

        <div>
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Placement</h4>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-zinc-400">Node</dt>
              <dd className="text-zinc-200 font-mono text-xs">{task.node || "-"}</dd>
            </div>
          </dl>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
          >
            <FileText className="h-3 w-3 mr-1" />
            Logs
          </Button>
          {category === "running" && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-7 text-xs"
            >
              <Terminal className="h-3 w-3 mr-1" />
              Shell
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Page
// ============================================================================

export default function VisTimelinePage() {
  usePage({
    title: "vis-timeline Gantt",
    breadcrumbs: [
      { label: "Dev", href: "/dev" },
      { label: "Workflow Explorer", href: "/dev/workflow-explorer" },
    ],
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<Timeline | null>(null);

  const [workflowPattern, setWorkflowPattern] = useState<WorkflowPattern>("complex");
  const [selectedTask, setSelectedTask] = useState<MockTaskNode | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<MockGroupNode | null>(null);
  const [showNestedTasks, setShowNestedTasks] = useState(true); // Default to nested view

  // Generate workflow
  const workflow = useMemo(() => EXAMPLE_WORKFLOWS[workflowPattern](), [workflowPattern]);

  // Convert to timeline data
  const { items, groups } = useMemo(
    () => convertToTimelineData(workflow, showNestedTasks),
    [workflow, showNestedTasks],
  );

  // Track if component is mounted using useSyncExternalStore for React Compiler compatibility
  // This avoids setState in effect - returns false on server, true on client
  const isMounted = useSyncExternalStore(
    () => () => {}, // no-op subscribe - value never changes after hydration
    () => true,     // client snapshot - always mounted on client
    () => false     // server snapshot - not mounted during SSR
  );

  // Calculate time bounds from items
  const timeBounds = useMemo(() => {
    if (items.length === 0) {
      const now = new Date();
      return { min: new Date(now.getTime() - 3600000), max: now };
    }

    let minTime = Infinity;
    let maxTime = -Infinity;

    items.forEach((item) => {
      minTime = Math.min(minTime, item.start.getTime());
      maxTime = Math.max(maxTime, item.end.getTime());
    });

    // Add 5% padding on each side
    const range = maxTime - minTime;
    const padding = range * 0.05;

    return {
      min: new Date(minTime - padding),
      max: new Date(maxTime + padding),
    };
  }, [items]);

  // Extract time values for stable dependency array (avoids complex expressions in deps)
  const timeBoundsMinTime = timeBounds.min.getTime();
  const timeBoundsMaxTime = timeBounds.max.getTime();

  // Initialize timeline
  useEffect(() => {
    if (!isMounted || !containerRef.current) return;

    // Create datasets
    const itemsDataSet = new DataSet(items);
    const groupsDataSet = new DataSet(groups);

    // Timeline options - scroll to pan, no zoom, bounded to task times
    const options: TimelineOptions = {
      stack: !showNestedTasks, // Stack items when not in nested mode
      stackSubgroups: true,
      showCurrentTime: true,
      // Disable zoom - scroll just pans
      zoomable: false,
      zoomKey: "ctrlKey",
      moveable: true,
      verticalScroll: true,
      horizontalScroll: true,
      orientation: { axis: "both", item: "bottom" },
      margin: { item: { horizontal: 0, vertical: 5 } },
      tooltip: {
        followMouse: true,
        overflowMethod: "cap",
      },
      groupOrder: (a, b) => {
        // Order by tree level first, then by id
        const levelA = a.treeLevel || 0;
        const levelB = b.treeLevel || 0;
        if (levelA !== levelB) return levelA - levelB;
        return a.id.localeCompare(b.id);
      },
      height: "100%",
      minHeight: 400,
      // Limit panning to task time bounds
      min: timeBounds.min,
      max: timeBounds.max,
      // Set initial window to show all tasks at reasonable size
      start: timeBounds.min,
      end: timeBounds.max,
    };

    // Create timeline
    const timeline = new Timeline(containerRef.current, itemsDataSet, groupsDataSet, options);
    timelineRef.current = timeline;

    // Handle selection
    timeline.on("select", (properties) => {
      const selectedId = properties.items[0];
      if (selectedId) {
        // Find the task
        for (const group of workflow.groups) {
          const task = group.tasks.find((t) => t.id === selectedId);
          if (task) {
            setSelectedTask(task);
            setSelectedGroup(group);
            break;
          }
        }
      } else {
        setSelectedTask(null);
        setSelectedGroup(null);
      }
    });

    return () => {
      timeline.destroy();
      timelineRef.current = null;
    };
  }, [isMounted, items, groups, workflow.groups, showNestedTasks, timeBounds, timeBoundsMinTime, timeBoundsMaxTime]);

  // Fit timeline to show all items
  const handleFit = useCallback(() => {
    if (timelineRef.current && items.length > 0) {
      try {
        timelineRef.current.fit();
      } catch {
        // Ignore fit errors
      }
    }
  }, [items.length]);

  // Pattern change
  const onPatternChange = useCallback((pattern: WorkflowPattern) => {
    setWorkflowPattern(pattern);
    setSelectedTask(null);
    setSelectedGroup(null);
  }, []);

  // Toggle nested view
  const toggleNestedView = useCallback(() => {
    setShowNestedTasks((prev) => !prev);
  }, []);

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80 backdrop-blur">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className="text-zinc-400 hover:text-zinc-100"
            asChild
          >
            <a href="/dev/workflow-explorer">
              <ChevronLeft className="h-4 w-4 mr-1" />
              Back
            </a>
          </Button>
          <div className="h-6 w-px bg-zinc-700" />
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">vis-timeline Gantt View</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-emerald-400 flex items-center gap-1">
                {getStatusIcon(workflow.status, "h-3.5 w-3.5")}
                {workflow.status}
              </span>
              <span>•</span>
              <span>{workflow.groups.length} groups</span>
              <span>•</span>
              <span>{workflow.totalTasks} tasks</span>
              <span>•</span>
              <span className="font-mono">{formatDuration(workflow.duration)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showNestedTasks ? "default" : "outline"}
            size="sm"
            onClick={toggleNestedView}
          >
            {showNestedTasks ? (
              <>
                <Minimize2 className="h-4 w-4 mr-2" />
                Flat View
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4 mr-2" />
                Nested View
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Tabs
            value={workflowPattern}
            onValueChange={(v) => onPatternChange(v as WorkflowPattern)}
          >
            <TabsList className="bg-zinc-800/50">
              <TabsTrigger
                value="linear"
                className="data-[state=active]:bg-zinc-700"
              >
                Linear
              </TabsTrigger>
              <TabsTrigger
                value="diamond"
                className="data-[state=active]:bg-zinc-700"
              >
                Diamond
              </TabsTrigger>
              <TabsTrigger
                value="parallel"
                className="data-[state=active]:bg-zinc-700"
              >
                Parallel
              </TabsTrigger>
              <TabsTrigger
                value="complex"
                className="data-[state=active]:bg-zinc-700"
              >
                Complex
              </TabsTrigger>
              <TabsTrigger
                value="massiveParallel"
                className="data-[state=active]:bg-zinc-700"
              >
                200 Tasks
              </TabsTrigger>
              <TabsTrigger
                value="manyGroups"
                className="data-[state=active]:bg-zinc-700"
              >
                100 Groups
              </TabsTrigger>
              <TabsTrigger
                value="multiRoot"
                className="data-[state=active]:bg-zinc-700"
              >
                Multi-Root
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleFit}
          >
            <Maximize2 className="h-4 w-4 mr-2" />
            Fit All
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative overflow-hidden">
        {/* Timeline Container */}
        <div className="h-full w-full overflow-hidden">
          <div
            ref={containerRef}
            className="h-full w-full vis-timeline-container"
          />
        </div>

        {/* Detail Panel - Overlay */}
        {selectedTask && (
          <div className="absolute top-0 right-0 h-full z-10">
            <DetailPanel
              task={selectedTask}
              group={selectedGroup}
              onClose={() => {
                setSelectedTask(null);
                setSelectedGroup(null);
                if (timelineRef.current) {
                  timelineRef.current.setSelection([]);
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Design Notes */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <details>
          <summary className="text-sm font-medium text-zinc-400 cursor-pointer hover:text-zinc-300">
            🎨 Design Notes (click to expand)
          </summary>
          <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-500">
            <li>
              ✅ <strong>Nested groups</strong>: Toggle between flat and nested task view
            </li>
            <li>
              ✅ <strong>Scale test</strong>: 200 tasks, 100 groups patterns available
            </li>
            <li>
              ✅ <strong>Tree levels</strong>: Groups at level 1, tasks at level 2
            </li>
            <li>
              ✅ <strong>Stacking</strong>: Stacked in flat mode, rows in nested mode
            </li>
            <li>
              ✅ <strong>Performance</strong>: Limits to 50 nested task rows per group
            </li>
            <li>
              ⚠️ <strong>Note</strong>: vis-timeline nestedGroups requires specific data format
            </li>
          </ul>
        </details>
      </div>

      {/* Custom styles for vis-timeline dark theme */}
      <style
        jsx
        global
      >{`
        .vis-timeline-container {
          background: #09090b;
        }

        .vis-timeline {
          border: none;
          background: #09090b;
        }

        .vis-panel.vis-center,
        .vis-panel.vis-left,
        .vis-panel.vis-right {
          background: #09090b;
        }

        .vis-labelset .vis-label {
          background: #18181b;
          border-bottom: 1px solid #27272a;
          color: #a1a1aa;
        }

        .vis-labelset .vis-label .vis-inner {
          padding: 8px 12px;
        }

        .vis-foreground .vis-group {
          border-bottom: 1px solid #27272a;
        }

        .vis-time-axis .vis-text {
          color: #71717a;
          font-size: 11px;
        }

        .vis-time-axis .vis-grid.vis-minor {
          border-color: #27272a;
        }

        .vis-time-axis .vis-grid.vis-major {
          border-color: #3f3f46;
        }

        .vis-item {
          border-width: 2px;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 500;
        }

        .vis-item.vis-selected {
          box-shadow: 0 0 0 2px #06b6d4;
        }

        .vis-current-time {
          background-color: #ef4444;
          width: 2px;
        }

        .vis-custom-time {
          background-color: #3b82f6;
          width: 2px;
        }

        .vis-tooltip {
          background: #18181b;
          border: 1px solid #3f3f46;
          color: #e4e4e7;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 12px;
          white-space: pre-line;
        }

        /* Nested group styles */
        .vis-nesting-group {
          background: #1f1f23 !important;
        }

        .vis-nested-group {
          background: #18181b !important;
        }

        .vis-group-level-1 {
          font-weight: 600;
        }

        .vis-group-level-2 {
          font-size: 11px;
          opacity: 0.9;
        }
      `}</style>
    </div>
  );
}
