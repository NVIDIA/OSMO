// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  GitBranch,
  List,
  Clock,
  Loader2,
  CheckCircle,
  XCircle,
  AlertTriangle,
  FileText,
  Terminal,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
} from "lucide-react";

// ============================================================================
// TYPES & MOCK DATA
// ============================================================================

type TaskStatus = "WAITING" | "SCHEDULING" | "INITIALIZING" | "RUNNING" | "COMPLETED" | "FAILED" | "FAILED_UPSTREAM";

interface DagTask {
  id: string;
  name: string;
  groupId: string;
  status: TaskStatus;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  resources: {
    cpu: number;
    memory: string;
    gpu: number;
  };
  node: string | null;
}

interface DagGroup {
  id: string;
  name: string;
  status: TaskStatus;
  tasks: DagTask[];
  upstreamGroups: string[];
  downstreamGroups: string[];
  // Vertical positioning: level = row (0 = top), lane = column for parallel groups
  level: number;
  lane: number;
}

// Complex DAG with vertical layout (level = row from top)
const mockGroups: DagGroup[] = [
  {
    id: "fetch-data",
    name: "fetch-data",
    status: "COMPLETED",
    upstreamGroups: [],
    downstreamGroups: ["validate", "preprocess-a", "preprocess-b"],
    level: 0,
    lane: 1,
    tasks: [
      {
        id: "fetch-data-0",
        name: "fetch-dataset",
        groupId: "fetch-data",
        status: "COMPLETED",
        startTime: new Date(Date.now() - 3600000),
        endTime: new Date(Date.now() - 3540000),
        duration: 60,
        resources: { cpu: 2, memory: "8Gi", gpu: 0 },
        node: "cpu-node-01",
      },
    ],
  },
  {
    id: "validate",
    name: "validate",
    status: "COMPLETED",
    upstreamGroups: ["fetch-data"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 0,
    tasks: [
      {
        id: "validate-0",
        name: "validate-schema",
        groupId: "validate",
        status: "COMPLETED",
        startTime: new Date(Date.now() - 3540000),
        endTime: new Date(Date.now() - 3480000),
        duration: 60,
        resources: { cpu: 1, memory: "4Gi", gpu: 0 },
        node: "cpu-node-02",
      },
    ],
  },
  {
    id: "preprocess-a",
    name: "preprocess-a",
    status: "COMPLETED",
    upstreamGroups: ["fetch-data"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 1,
    tasks: [
      {
        id: "preprocess-a-0",
        name: "preprocess-images",
        groupId: "preprocess-a",
        status: "COMPLETED",
        startTime: new Date(Date.now() - 3540000),
        endTime: new Date(Date.now() - 3300000),
        duration: 240,
        resources: { cpu: 4, memory: "16Gi", gpu: 0 },
        node: "cpu-node-03",
      },
    ],
  },
  {
    id: "preprocess-b",
    name: "preprocess-b",
    status: "COMPLETED",
    upstreamGroups: ["fetch-data"],
    downstreamGroups: ["train"],
    level: 1,
    lane: 2,
    tasks: [
      {
        id: "preprocess-b-0",
        name: "preprocess-labels",
        groupId: "preprocess-b",
        status: "COMPLETED",
        startTime: new Date(Date.now() - 3540000),
        endTime: new Date(Date.now() - 3420000),
        duration: 120,
        resources: { cpu: 2, memory: "8Gi", gpu: 0 },
        node: "cpu-node-04",
      },
    ],
  },
  {
    id: "train",
    name: "train",
    status: "RUNNING",
    upstreamGroups: ["validate", "preprocess-a", "preprocess-b"],
    downstreamGroups: ["evaluate"],
    level: 2,
    lane: 1,
    tasks: [
      {
        id: "train-0",
        name: "train-shard-0",
        groupId: "train",
        status: "COMPLETED",
        startTime: new Date(Date.now() - 3300000),
        endTime: new Date(Date.now() - 1800000),
        duration: 1500,
        resources: { cpu: 8, memory: "64Gi", gpu: 2 },
        node: "gpu-node-01",
      },
      {
        id: "train-1",
        name: "train-shard-1",
        groupId: "train",
        status: "RUNNING",
        startTime: new Date(Date.now() - 3300000),
        endTime: null,
        duration: 3300,
        resources: { cpu: 8, memory: "64Gi", gpu: 2 },
        node: "gpu-node-02",
      },
      {
        id: "train-2",
        name: "train-shard-2",
        groupId: "train",
        status: "RUNNING",
        startTime: new Date(Date.now() - 3300000),
        endTime: null,
        duration: 3300,
        resources: { cpu: 8, memory: "64Gi", gpu: 2 },
        node: "gpu-node-03",
      },
    ],
  },
  {
    id: "evaluate",
    name: "evaluate",
    status: "WAITING",
    upstreamGroups: ["train"],
    downstreamGroups: ["deploy"],
    level: 3,
    lane: 1,
    tasks: [
      {
        id: "evaluate-0",
        name: "run-benchmarks",
        groupId: "evaluate",
        status: "WAITING",
        startTime: null,
        endTime: null,
        duration: null,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: null,
      },
    ],
  },
  {
    id: "deploy",
    name: "deploy",
    status: "WAITING",
    upstreamGroups: ["evaluate"],
    downstreamGroups: [],
    level: 4,
    lane: 1,
    tasks: [
      {
        id: "deploy-0",
        name: "deploy-model",
        groupId: "deploy",
        status: "WAITING",
        startTime: null,
        endTime: null,
        duration: null,
        resources: { cpu: 2, memory: "8Gi", gpu: 0 },
        node: null,
      },
    ],
  },
];

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

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

function getStatusCategory(status: TaskStatus): "waiting" | "running" | "completed" | "failed" {
  if (["WAITING", "SCHEDULING"].includes(status)) return "waiting";
  if (["INITIALIZING", "RUNNING"].includes(status)) return "running";
  if (status === "COMPLETED") return "completed";
  return "failed";
}

const statusStyles = {
  waiting: {
    bg: "bg-zinc-800/80",
    border: "border-zinc-600",
    text: "text-zinc-400",
    dot: "bg-zinc-500",
    glow: "",
  },
  running: {
    bg: "bg-emerald-950/60",
    border: "border-emerald-500/70",
    text: "text-emerald-400",
    dot: "bg-emerald-500",
    glow: "shadow-[0_0_20px_rgba(16,185,129,0.15)]",
  },
  completed: {
    bg: "bg-zinc-900/60",
    border: "border-zinc-700",
    text: "text-zinc-500",
    dot: "bg-zinc-600",
    glow: "",
  },
  failed: {
    bg: "bg-red-950/40",
    border: "border-red-500/50",
    text: "text-red-400",
    dot: "bg-red-500",
    glow: "shadow-[0_0_20px_rgba(239,68,68,0.15)]",
  },
};

function getStatusIcon(status: TaskStatus, size = "h-4 w-4") {
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

// ============================================================================
// VERTICAL DAG NODE COMPONENT
// ============================================================================

function VerticalDagNode({
  group,
  isSelected,
  onClick,
}: {
  group: DagGroup;
  isSelected: boolean;
  onClick: () => void;
}) {
  const category = getStatusCategory(group.status);
  const style = statusStyles[category];
  const completedCount = group.tasks.filter((t) => t.status === "COMPLETED").length;
  const totalCount = group.tasks.length;

  return (
    <div
      className={cn(
        "relative px-4 py-3 rounded-xl border-2 min-w-[140px] max-w-[180px]",
        "cursor-pointer transition-all duration-200",
        style.bg,
        style.border,
        style.glow,
        isSelected && "ring-2 ring-cyan-500 ring-offset-2 ring-offset-zinc-950",
      )}
      onClick={onClick}
    >
      {/* Status indicator dot */}
      <div
        className={cn(
          "absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full",
          style.dot,
          category === "running" && "animate-pulse",
        )}
      />

      {/* Content */}
      <div className="flex items-center gap-2 mb-1">
        {getStatusIcon(group.status, "h-3.5 w-3.5")}
        <span className="font-semibold text-sm text-zinc-100 truncate">{group.name}</span>
      </div>

      {/* Task progress or single task info */}
      {totalCount > 1 ? (
        <div className="space-y-1">
          <div className="w-full h-1 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className={cn("h-full transition-all", category === "running" ? "bg-emerald-500" : "bg-zinc-500")}
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
          <div className={cn("text-xs", style.text)}>
            {completedCount}/{totalCount} tasks
          </div>
        </div>
      ) : (
        <div className={cn("text-xs", style.text)}>{group.tasks[0]?.node || "Pending"}</div>
      )}
    </div>
  );
}

// ============================================================================
// SVG EDGE FOR VERTICAL DAG
// ============================================================================

function VerticalDagEdge({
  fromLevel,
  fromLane,
  toLane,
  toLevel,
  isActive,
  nodeWidth,
  nodeHeight,
  xSpacing,
  ySpacing,
  lanesAtLevel,
}: {
  fromLevel: number;
  fromLane: number;
  toLane: number;
  toLevel: number;
  isActive: boolean;
  nodeWidth: number;
  nodeHeight: number;
  xSpacing: number;
  ySpacing: number;
  lanesAtLevel: Map<number, number>;
}) {
  // Calculate center offset for lanes at each level
  const fromLaneCount = lanesAtLevel.get(fromLevel) || 1;
  const toLaneCount = lanesAtLevel.get(toLevel) || 1;
  const fromOffset = ((fromLaneCount - 1) / 2) * xSpacing;
  const toOffset = ((toLaneCount - 1) / 2) * xSpacing;

  const startX = fromLane * xSpacing - fromOffset + nodeWidth / 2;
  const startY = fromLevel * ySpacing + nodeHeight;
  const endX = toLane * xSpacing - toOffset + nodeWidth / 2;
  const endY = toLevel * ySpacing;

  const controlPointOffset = (endY - startY) / 2;

  const path = `M ${startX} ${startY} C ${startX} ${startY + controlPointOffset}, ${endX} ${endY - controlPointOffset}, ${endX} ${endY}`;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={isActive ? "#10b981" : "#3f3f46"}
        strokeWidth={2}
        strokeDasharray={isActive ? "none" : "6 4"}
        className={isActive ? "" : "opacity-60"}
      />
      {/* Arrow head pointing down */}
      <polygon
        points={`${endX},${endY} ${endX - 5},${endY - 8} ${endX + 5},${endY - 8}`}
        fill={isActive ? "#10b981" : "#3f3f46"}
        className={isActive ? "" : "opacity-60"}
      />
    </g>
  );
}

// ============================================================================
// TIMELINE LIST VIEW COMPONENT
// ============================================================================

function TimelineListView({
  groups,
  onSelectGroup,
  selectedGroupId,
}: {
  groups: DagGroup[];
  onSelectGroup: (group: DagGroup) => void;
  selectedGroupId: string | null;
}) {
  // Flatten and sort all tasks by start time
  const allTasks = useMemo(() => {
    return groups
      .flatMap((g) => g.tasks.map((t) => ({ ...t, group: g })))
      .sort((a, b) => {
        if (!a.startTime && !b.startTime) return 0;
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        return a.startTime.getTime() - b.startTime.getTime();
      });
  }, [groups]);

  // Get the earliest start time for the timeline
  const timelineStart = useMemo(() => {
    const firstStart = allTasks.find((t) => t.startTime)?.startTime;
    return firstStart || new Date();
  }, [allTasks]);

  return (
    <div className="space-y-1">
      {/* Timeline header */}
      <div className="flex items-center gap-4 px-4 py-2 text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
        <div className="w-24">Time</div>
        <div className="w-6" /> {/* Status icon */}
        <div className="flex-1">Task</div>
        <div className="w-24 text-right">Duration</div>
        <div className="w-32">Node</div>
      </div>

      {/* Timeline entries */}
      <div className="relative">
        {/* Vertical timeline line */}
        <div className="absolute left-[52px] top-0 bottom-0 w-0.5 bg-gradient-to-b from-zinc-700 via-zinc-700 to-transparent" />

        {allTasks.map((task, idx) => {
          const category = getStatusCategory(task.status);
          const style = statusStyles[category];
          const isGroupSelected = selectedGroupId === task.groupId;

          return (
            <div
              key={task.id}
              className={cn(
                "relative flex items-center gap-4 px-4 py-3 transition-all cursor-pointer",
                "hover:bg-zinc-800/50",
                isGroupSelected && "bg-cyan-950/30 border-l-2 border-cyan-500",
              )}
              onClick={() => onSelectGroup(task.group)}
            >
              {/* Time column with dot on timeline */}
              <div className="w-24 text-sm text-zinc-400 font-mono">{formatTime(task.startTime)}</div>

              {/* Timeline dot */}
              <div
                className={cn(
                  "absolute left-[50px] w-3 h-3 rounded-full border-2 border-zinc-900",
                  style.dot,
                  category === "running" && "animate-pulse",
                )}
              />

              {/* Status icon */}
              <div className="w-6">{getStatusIcon(task.status, "h-4 w-4")}</div>

              {/* Task name and group */}
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-zinc-100 truncate">{task.name}</div>
                <div className="text-xs text-zinc-500">{task.group.name}</div>
              </div>

              {/* Duration */}
              <div className="w-24 text-right text-sm text-zinc-400 font-mono">{formatDuration(task.duration)}</div>

              {/* Node */}
              <div className="w-32 text-sm text-zinc-500 truncate">{task.node || "-"}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// DETAIL PANEL
// ============================================================================

function DetailPanel({ group, onClose }: { group: DagGroup; onClose: () => void }) {
  const [expandedTask, setExpandedTask] = useState<string | null>(group.tasks[0]?.id || null);
  const category = getStatusCategory(group.status);
  const style = statusStyles[category];

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900/95 backdrop-blur overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {getStatusIcon(group.status)}
            <h3 className="font-semibold text-zinc-100">{group.name}</h3>
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
          {group.status} • {group.tasks.length} task{group.tasks.length > 1 ? "s" : ""}
        </div>
      </div>

      {/* Tasks */}
      <div className="p-4 space-y-2">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Tasks</h4>
        {group.tasks.map((task) => {
          const taskCategory = getStatusCategory(task.status);
          const taskStyle = statusStyles[taskCategory];
          const isExpanded = expandedTask === task.id;

          return (
            <div
              key={task.id}
              className={cn("rounded-lg border transition-all", taskStyle.bg, taskStyle.border)}
            >
              <button
                className="w-full flex items-center gap-2 p-3 text-left"
                onClick={() => setExpandedTask(isExpanded ? null : task.id)}
              >
                {getStatusIcon(task.status, "h-3.5 w-3.5")}
                <span className="flex-1 text-sm font-medium text-zinc-100 truncate">{task.name}</span>
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-zinc-400" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-zinc-400" />
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t border-zinc-800/50 pt-3">
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <dt className="text-zinc-500">Start</dt>
                      <dd className="text-zinc-300 font-mono">{formatTime(task.startTime)}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Duration</dt>
                      <dd className="text-zinc-300 font-mono">{formatDuration(task.duration)}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Node</dt>
                      <dd className="text-zinc-300">{task.node || "-"}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Resources</dt>
                      <dd className="text-zinc-300">
                        {task.resources.gpu > 0 ? `${task.resources.gpu} GPU` : `${task.resources.cpu} CPU`}
                      </dd>
                    </div>
                  </dl>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 h-7 text-xs"
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Logs
                    </Button>
                    {taskCategory === "running" && (
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
              )}
            </div>
          );
        })}
      </div>

      {/* Dependencies */}
      <div className="p-4 border-t border-zinc-800">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Dependencies</h4>
        <div className="space-y-2">
          {group.upstreamGroups.length > 0 && (
            <div className="text-xs">
              <span className="text-zinc-500">Depends on: </span>
              <span className="text-zinc-300">{group.upstreamGroups.join(", ")}</span>
            </div>
          )}
          {group.downstreamGroups.length > 0 && (
            <div className="text-xs">
              <span className="text-zinc-500">Blocking: </span>
              <span className="text-zinc-300">{group.downstreamGroups.join(", ")}</span>
            </div>
          )}
          {group.upstreamGroups.length === 0 && group.downstreamGroups.length === 0 && (
            <div className="text-xs text-zinc-500">No dependencies</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function DagVerticalPage() {
  const [selectedGroup, setSelectedGroup] = useState<DagGroup | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<"dag" | "timeline">("dag");

  // Layout constants
  const nodeWidth = 160;
  const nodeHeight = 80;
  const xSpacing = 200;
  const ySpacing = 140;
  const padding = 60;

  // Calculate lanes at each level for centering
  const lanesAtLevel = useMemo(() => {
    const map = new Map<number, number>();
    mockGroups.forEach((g) => {
      map.set(g.level, Math.max(map.get(g.level) || 0, g.lane + 1));
    });
    return map;
  }, []);

  // Calculate canvas dimensions
  const maxLevel = Math.max(...mockGroups.map((g) => g.level));
  const maxLaneCount = Math.max(...Array.from(lanesAtLevel.values()));
  const canvasWidth = maxLaneCount * xSpacing + padding * 2;
  const canvasHeight = (maxLevel + 1) * ySpacing + padding * 2;

  // Build edges
  const edges = useMemo(() => {
    const result: Array<{
      fromLevel: number;
      fromLane: number;
      toLane: number;
      toLevel: number;
      isActive: boolean;
    }> = [];

    mockGroups.forEach((group) => {
      group.downstreamGroups.forEach((downstreamId) => {
        const downstream = mockGroups.find((g) => g.id === downstreamId);
        if (downstream) {
          const category = getStatusCategory(group.status);
          const isActive = category === "running" || category === "completed";
          result.push({
            fromLevel: group.level,
            fromLane: group.lane,
            toLane: downstream.lane,
            toLevel: downstream.level,
            isActive,
          });
        }
      });
    });
    return result;
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
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Workflows
          </Button>
          <div className="h-6 w-px bg-zinc-700" />
          <div>
            <h1 className="text-lg font-semibold text-zinc-100">train-distributed-xyz789</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-emerald-400 flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                RUNNING
              </span>
              <span>•</span>
              <span>gpu-pool-us-east</span>
              <span>•</span>
              <span className="font-mono">1h 15m</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      {/* View Toggle & Controls */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as typeof viewMode)}
        >
          <TabsList className="bg-zinc-800/50">
            <TabsTrigger
              value="dag"
              className="data-[state=active]:bg-zinc-700 data-[state=active]:text-cyan-400"
            >
              <GitBranch className="h-4 w-4 mr-1.5" />
              DAG
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="data-[state=active]:bg-zinc-700 data-[state=active]:text-cyan-400"
            >
              <List className="h-4 w-4 mr-1.5" />
              Timeline
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {viewMode === "dag" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.1))}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm text-zinc-400 w-12 text-center font-mono">{Math.round(zoom * 100)}%</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* DAG View */}
        {viewMode === "dag" && (
          <div className="flex-1 overflow-auto">
            <div
              className="relative mx-auto"
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
                width: canvasWidth,
                minHeight: canvasHeight,
                padding: padding,
              }}
            >
              {/* SVG for edges */}
              <svg
                className="absolute top-0 left-0 pointer-events-none"
                width={canvasWidth}
                height={canvasHeight}
                style={{ left: 0, top: 0 }}
              >
                <g transform={`translate(${padding}, ${padding})`}>
                  {edges.map((edge, i) => (
                    <VerticalDagEdge
                      key={i}
                      {...edge}
                      nodeWidth={nodeWidth}
                      nodeHeight={nodeHeight}
                      xSpacing={xSpacing}
                      ySpacing={ySpacing}
                      lanesAtLevel={lanesAtLevel}
                    />
                  ))}
                </g>
              </svg>

              {/* Nodes */}
              <div
                className="relative"
                style={{ width: canvasWidth - padding * 2, height: canvasHeight - padding * 2 }}
              >
                {mockGroups.map((group) => {
                  const laneCount = lanesAtLevel.get(group.level) || 1;
                  const offset = ((laneCount - 1) / 2) * xSpacing;
                  const x = group.lane * xSpacing - offset + (nodeWidth / 2 - nodeWidth / 2);
                  const centerX = (canvasWidth - padding * 2) / 2;

                  return (
                    <div
                      key={group.id}
                      className="absolute"
                      style={{
                        left: centerX + x - nodeWidth / 2,
                        top: group.level * ySpacing,
                      }}
                    >
                      <VerticalDagNode
                        group={group}
                        isSelected={selectedGroup?.id === group.id}
                        onClick={() => setSelectedGroup(group)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Timeline View */}
        {viewMode === "timeline" && (
          <div className="flex-1 overflow-auto bg-zinc-900/30">
            <TimelineListView
              groups={mockGroups}
              onSelectGroup={setSelectedGroup}
              selectedGroupId={selectedGroup?.id || null}
            />
          </div>
        )}

        {/* Detail Panel */}
        {selectedGroup && (
          <DetailPanel
            group={selectedGroup}
            onClose={() => setSelectedGroup(null)}
          />
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
              ✅ <strong>Vertical DAG layout</strong>: Top-to-bottom flow, natural reading order
            </li>
            <li>
              ✅ <strong>Centered lanes</strong>: Parallel tasks centered at each level
            </li>
            <li>
              ✅ <strong>Timeline view</strong>: Chronological task list with time markers
            </li>
            <li>
              ✅ <strong>Status theming</strong>: Distinct colors/glows for each state
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Gantt-style timeline with time scale
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Collapsible groups in DAG
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Auto-layout with dagre algorithm
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Animated flow lines for active edges
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
