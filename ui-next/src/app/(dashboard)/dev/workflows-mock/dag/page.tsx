// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useMemo, useCallback } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ChevronLeft,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Grid3X3,
  List,
  GitBranch,
  Terminal,
  FileText,
  XCircle,
  CheckCircle,
  Clock,
  Loader2,
  AlertCircle,
  ArrowRight,
  MoreHorizontal,
  ExternalLink,
  Play,
  Eye,
} from "lucide-react";

// ============================================================================
// MOCK DATA - Complex DAG workflow
// ============================================================================

type TaskStatus =
  | "WAITING"
  | "PROCESSING"
  | "SCHEDULING"
  | "INITIALIZING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "FAILED_UPSTREAM";

interface DagTask {
  id: string;
  name: string;
  groupName: string;
  status: TaskStatus;
  duration: number | null;
  resources: {
    cpu: number;
    memory: string;
    gpu: number;
  };
  node: string | null;
  retryId: number;
}

interface DagGroup {
  id: string;
  name: string;
  status: TaskStatus;
  tasks: DagTask[];
  upstreamGroups: string[];
  downstreamGroups: string[];
  x: number;
  y: number;
}

// Complex DAG workflow example
const mockGroups: DagGroup[] = [
  {
    id: "data-download",
    name: "data-download",
    status: "COMPLETED",
    upstreamGroups: [],
    downstreamGroups: ["preprocess"],
    x: 0,
    y: 1,
    tasks: [
      {
        id: "data-download-0",
        name: "download-dataset",
        groupName: "data-download",
        status: "COMPLETED",
        duration: 180,
        resources: { cpu: 2, memory: "8Gi", gpu: 0 },
        node: "cpu-node-01",
        retryId: 0,
      },
    ],
  },
  {
    id: "preprocess",
    name: "preprocess",
    status: "COMPLETED",
    upstreamGroups: ["data-download"],
    downstreamGroups: ["train-shard"],
    x: 1,
    y: 1,
    tasks: [
      {
        id: "preprocess-0",
        name: "preprocess-data",
        groupName: "preprocess",
        status: "COMPLETED",
        duration: 600,
        resources: { cpu: 4, memory: "16Gi", gpu: 0 },
        node: "cpu-node-02",
        retryId: 0,
      },
    ],
  },
  {
    id: "train-shard",
    name: "train-shard",
    status: "RUNNING",
    upstreamGroups: ["preprocess"],
    downstreamGroups: ["aggregate"],
    x: 2,
    y: 1,
    tasks: [
      {
        id: "train-shard-0",
        name: "train-shard-0",
        groupName: "train-shard",
        status: "COMPLETED",
        duration: 3600,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: "gpu-node-01",
        retryId: 0,
      },
      {
        id: "train-shard-1",
        name: "train-shard-1",
        groupName: "train-shard",
        status: "COMPLETED",
        duration: 3500,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: "gpu-node-02",
        retryId: 0,
      },
      {
        id: "train-shard-2",
        name: "train-shard-2",
        groupName: "train-shard",
        status: "RUNNING",
        duration: 2400,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: "gpu-node-03",
        retryId: 0,
      },
      {
        id: "train-shard-3",
        name: "train-shard-3",
        groupName: "train-shard",
        status: "RUNNING",
        duration: 2200,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: "gpu-node-04",
        retryId: 0,
      },
    ],
  },
  {
    id: "aggregate",
    name: "aggregate",
    status: "WAITING",
    upstreamGroups: ["train-shard"],
    downstreamGroups: ["evaluate", "export"],
    x: 3,
    y: 1,
    tasks: [
      {
        id: "aggregate-0",
        name: "aggregate-models",
        groupName: "aggregate",
        status: "WAITING",
        duration: null,
        resources: { cpu: 4, memory: "64Gi", gpu: 1 },
        node: null,
        retryId: 0,
      },
    ],
  },
  {
    id: "evaluate",
    name: "evaluate",
    status: "WAITING",
    upstreamGroups: ["aggregate"],
    downstreamGroups: ["deploy"],
    x: 4,
    y: 0,
    tasks: [
      {
        id: "evaluate-0",
        name: "run-eval",
        groupName: "evaluate",
        status: "WAITING",
        duration: null,
        resources: { cpu: 4, memory: "32Gi", gpu: 1 },
        node: null,
        retryId: 0,
      },
    ],
  },
  {
    id: "export",
    name: "export",
    status: "WAITING",
    upstreamGroups: ["aggregate"],
    downstreamGroups: ["deploy"],
    x: 4,
    y: 2,
    tasks: [
      {
        id: "export-0",
        name: "export-model",
        groupName: "export",
        status: "WAITING",
        duration: null,
        resources: { cpu: 2, memory: "16Gi", gpu: 0 },
        node: null,
        retryId: 0,
      },
    ],
  },
  {
    id: "deploy",
    name: "deploy",
    status: "WAITING",
    upstreamGroups: ["evaluate", "export"],
    downstreamGroups: [],
    x: 5,
    y: 1,
    tasks: [
      {
        id: "deploy-0",
        name: "deploy-model",
        groupName: "deploy",
        status: "WAITING",
        duration: null,
        resources: { cpu: 2, memory: "8Gi", gpu: 0 },
        node: null,
        retryId: 0,
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

function getStatusCategory(status: TaskStatus): "waiting" | "running" | "completed" | "failed" {
  if (["WAITING", "PROCESSING", "SCHEDULING"].includes(status)) return "waiting";
  if (["INITIALIZING", "RUNNING"].includes(status)) return "running";
  if (status === "COMPLETED") return "completed";
  return "failed";
}

function getStatusColor(status: TaskStatus): string {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return "border-zinc-600 bg-zinc-800";
    case "running":
      return "border-green-500 bg-green-500/20";
    case "completed":
      return "border-zinc-500 bg-zinc-700";
    case "failed":
      return "border-red-500 bg-red-500/20";
  }
}

function getStatusTextColor(status: TaskStatus): string {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return "text-zinc-400";
    case "running":
      return "text-green-400";
    case "completed":
      return "text-zinc-300";
    case "failed":
      return "text-red-400";
  }
}

function getStatusIcon(status: TaskStatus) {
  const category = getStatusCategory(status);
  switch (category) {
    case "waiting":
      return <Clock className="h-3.5 w-3.5" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5" />;
  }
}

// ============================================================================
// DAG NODE COMPONENTS
// ============================================================================

function DagNode({ group, isSelected, onClick }: { group: DagGroup; isSelected: boolean; onClick: () => void }) {
  const completedCount = group.tasks.filter((t) => t.status === "COMPLETED").length;
  const runningCount = group.tasks.filter((t) => ["RUNNING", "INITIALIZING"].includes(t.status)).length;
  const totalCount = group.tasks.length;
  const hasMultipleTasks = totalCount > 1;

  return (
    <div
      className={cn(
        "relative p-3 rounded-lg border-2 min-w-[160px] cursor-pointer transition-all",
        getStatusColor(group.status),
        isSelected && "ring-2 ring-indigo-500 ring-offset-2 ring-offset-zinc-900",
      )}
      onClick={onClick}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <span className={cn("", getStatusTextColor(group.status))}>{getStatusIcon(group.status)}</span>
        <span className="font-medium text-sm truncate">{group.name}</span>
      </div>

      {/* Task count / progress */}
      {hasMultipleTasks ? (
        <div className="space-y-1.5">
          <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div
                className="bg-green-500 transition-all"
                style={{ width: `${(completedCount / totalCount) * 100}%` }}
              />
              <div
                className="bg-green-500/50 animate-pulse"
                style={{ width: `${(runningCount / totalCount) * 100}%` }}
              />
            </div>
          </div>
          <div className="text-xs text-zinc-400">
            {completedCount}/{totalCount} tasks
          </div>
        </div>
      ) : (
        <div className="text-xs text-zinc-400">{group.tasks[0]?.node || "Not scheduled"}</div>
      )}

      {/* Duration if running/completed */}
      {(getStatusCategory(group.status) === "running" || getStatusCategory(group.status) === "completed") && (
        <div className="text-xs text-zinc-500 mt-1">
          {formatDuration(group.tasks.reduce((max, t) => Math.max(max, t.duration || 0), 0))}
        </div>
      )}
    </div>
  );
}

function DagEdge({
  fromX,
  fromY,
  toX,
  toY,
  isActive,
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  isActive: boolean;
}) {
  // Simple bezier curve
  const nodeWidth = 180;
  const nodeHeight = 100;
  const xSpacing = 220;
  const ySpacing = 130;
  const startX = fromX * xSpacing + nodeWidth;
  const startY = fromY * ySpacing + nodeHeight / 2;
  const endX = toX * xSpacing;
  const endY = toY * ySpacing + nodeHeight / 2;
  const controlPointOffset = (endX - startX) / 2;

  const path = `M ${startX} ${startY} C ${startX + controlPointOffset} ${startY}, ${endX - controlPointOffset} ${endY}, ${endX} ${endY}`;

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={isActive ? "#22c55e" : "#52525b"}
        strokeWidth={2}
        strokeDasharray={isActive ? "none" : "4 4"}
        className={isActive ? "animate-pulse" : ""}
      />
      {/* Arrow head */}
      <polygon
        points={`${endX},${endY} ${endX - 8},${endY - 4} ${endX - 8},${endY + 4}`}
        fill={isActive ? "#22c55e" : "#52525b"}
      />
    </g>
  );
}

// ============================================================================
// TASK DETAIL PANEL
// ============================================================================

function TaskDetailPanel({ group, onClose }: { group: DagGroup; onClose: () => void }) {
  const [selectedTask, setSelectedTask] = useState<DagTask | null>(group.tasks[0] || null);

  return (
    <div className="w-80 border-l border-zinc-800 bg-zinc-900 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 bg-zinc-900 border-b border-zinc-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Group: {group.name}</h3>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 transition-colors"
          >
            <XCircle className="h-4 w-4 text-zinc-400" />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className={getStatusTextColor(group.status)}>{getStatusIcon(group.status)}</span>
          <span className={cn("text-sm", getStatusTextColor(group.status))}>{group.status}</span>
        </div>
      </div>

      {/* Task list for groups with multiple tasks */}
      {group.tasks.length > 1 && (
        <div className="p-4 border-b border-zinc-800">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            Tasks ({group.tasks.length})
          </h4>
          <div className="space-y-1">
            {group.tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedTask(task)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left transition-colors",
                  selectedTask?.id === task.id ? "bg-indigo-500/20 text-indigo-300" : "hover:bg-zinc-800 text-zinc-300",
                )}
              >
                <span className={getStatusTextColor(task.status)}>{getStatusIcon(task.status)}</span>
                <span className="truncate">{task.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Selected task details */}
      {selectedTask && (
        <div className="p-4 space-y-4">
          <div>
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Task Details</h4>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-zinc-400">Name</dt>
                <dd className="text-zinc-200 font-mono">{selectedTask.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Status</dt>
                <dd className={getStatusTextColor(selectedTask.status)}>{selectedTask.status}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Duration</dt>
                <dd className="text-zinc-200">{formatDuration(selectedTask.duration)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-400">Node</dt>
                <dd className="text-zinc-200">{selectedTask.node || "Not assigned"}</dd>
              </div>
            </dl>
          </div>

          <div>
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Resources</h4>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2 rounded bg-zinc-800 text-center">
                <div className="text-lg font-semibold">{selectedTask.resources.cpu}</div>
                <div className="text-xs text-zinc-400">CPU</div>
              </div>
              <div className="p-2 rounded bg-zinc-800 text-center">
                <div className="text-lg font-semibold">{selectedTask.resources.gpu}</div>
                <div className="text-xs text-zinc-400">GPU</div>
              </div>
              <div className="p-2 rounded bg-zinc-800 text-center">
                <div className="text-sm font-semibold">{selectedTask.resources.memory}</div>
                <div className="text-xs text-zinc-400">Memory</div>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div>
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Actions</h4>
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
              >
                <FileText className="h-4 w-4 mr-2" />
                View Logs
              </Button>
              {["RUNNING", "INITIALIZING"].includes(selectedTask.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                >
                  <Terminal className="h-4 w-4 mr-2" />
                  Open Shell
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-start"
              >
                <Eye className="h-4 w-4 mr-2" />
                View Events
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// LIFECYCLE TIMELINE
// ============================================================================

function LifecycleTimeline() {
  const stages = [
    { name: "Submit", time: "2h 15m ago", status: "completed" as const },
    { name: "Queue", time: "5m", status: "completed" as const },
    { name: "Running", time: "2h 10m", status: "current" as const },
    { name: "Complete", time: "~30m est.", status: "pending" as const },
  ];

  return (
    <div className="px-6 py-4 border-b border-zinc-800">
      <div className="flex items-center justify-between">
        {stages.map((stage, i) => (
          <div
            key={stage.name}
            className="flex items-center"
          >
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  "w-3 h-3 rounded-full",
                  stage.status === "completed" && "bg-green-500",
                  stage.status === "current" && "bg-green-500 animate-pulse",
                  stage.status === "pending" && "bg-zinc-600",
                )}
              />
              <span className="text-xs text-zinc-400 mt-1">{stage.name}</span>
              <span className={cn("text-xs", stage.status === "pending" ? "text-zinc-500" : "text-zinc-300")}>
                {stage.time}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className={cn("w-24 h-0.5 mx-2", stage.status === "completed" ? "bg-green-500" : "bg-zinc-700")} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function DagMockPage() {
  const [selectedGroup, setSelectedGroup] = useState<DagGroup | null>(null);
  const [zoom, setZoom] = useState(1);
  const [viewMode, setViewMode] = useState<"dag" | "list" | "timeline">("dag");

  const nodeWidth = 180;
  const nodeHeight = 100;
  const xSpacing = 220;
  const ySpacing = 130;

  // Calculate SVG dimensions
  const maxX = Math.max(...mockGroups.map((g) => g.x));
  const maxY = Math.max(...mockGroups.map((g) => g.y));
  const svgWidth = (maxX + 1) * xSpacing + 40;
  const svgHeight = (maxY + 1) * ySpacing + 40;

  // Build edges
  const edges = useMemo(() => {
    const result: Array<{
      fromX: number;
      fromY: number;
      toX: number;
      toY: number;
      isActive: boolean;
    }> = [];
    mockGroups.forEach((group) => {
      group.downstreamGroups.forEach((downstreamId) => {
        const downstream = mockGroups.find((g) => g.id === downstreamId);
        if (downstream) {
          const isActive =
            getStatusCategory(group.status) === "running" || getStatusCategory(group.status) === "completed";
          result.push({
            fromX: group.x,
            fromY: group.y,
            toX: downstream.x,
            toY: downstream.y,
            isActive,
          });
        }
      });
    });
    return result;
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Workflows
          </Button>
          <div>
            <h1 className="text-lg font-semibold">train-distributed-a1b2c3</h1>
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <span className="text-green-400 flex items-center gap-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                RUNNING
              </span>
              <span>•</span>
              <span>gpu-pool-us-east</span>
              <span>•</span>
              <span>fernandol</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
          >
            <FileText className="h-4 w-4 mr-2" />
            All Logs
          </Button>
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
            className="text-red-400 hover:text-red-300"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Cancel
          </Button>
        </div>
      </div>

      {/* Lifecycle Timeline */}
      <LifecycleTimeline />

      {/* View Toggle */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800">
        <Tabs
          value={viewMode}
          onValueChange={(v) => setViewMode(v as typeof viewMode)}
        >
          <TabsList className="bg-zinc-800">
            <TabsTrigger
              value="dag"
              className="data-[state=active]:bg-zinc-700"
            >
              <GitBranch className="h-4 w-4 mr-1" />
              DAG
            </TabsTrigger>
            <TabsTrigger
              value="list"
              className="data-[state=active]:bg-zinc-700"
            >
              <List className="h-4 w-4 mr-1" />
              List
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="data-[state=active]:bg-zinc-700"
            >
              <Clock className="h-4 w-4 mr-1" />
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
            <span className="text-sm text-zinc-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setZoom((z) => Math.min(2, z + 0.1))}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* DAG View */}
        {viewMode === "dag" && (
          <div className="flex-1 overflow-auto bg-zinc-950 p-6">
            <div
              style={{
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                width: svgWidth,
                minHeight: svgHeight,
              }}
            >
              {/* SVG for edges */}
              <svg
                className="absolute top-0 left-0 pointer-events-none"
                width={svgWidth}
                height={svgHeight}
              >
                {edges.map((edge, i) => (
                  <DagEdge
                    key={i}
                    {...edge}
                  />
                ))}
              </svg>

              {/* Nodes */}
              <div
                className="relative"
                style={{ width: svgWidth, height: svgHeight }}
              >
                {mockGroups.map((group) => (
                  <div
                    key={group.id}
                    className="absolute"
                    style={{
                      left: group.x * xSpacing + 20,
                      top: group.y * ySpacing + 20,
                    }}
                  >
                    <DagNode
                      group={group}
                      isSelected={selectedGroup?.id === group.id}
                      onClick={() => setSelectedGroup(group)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* List View Placeholder */}
        {viewMode === "list" && (
          <div className="flex-1 p-6">
            <div className="space-y-2">
              {mockGroups.flatMap((g) =>
                g.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-4 p-3 rounded-lg bg-zinc-900 border border-zinc-800"
                  >
                    <span className={getStatusTextColor(task.status)}>{getStatusIcon(task.status)}</span>
                    <span className="font-mono text-sm flex-1">{task.name}</span>
                    <span className="text-sm text-zinc-400">{formatDuration(task.duration)}</span>
                    <span className="text-sm text-zinc-500">{task.node || "-"}</span>
                    <span className="text-xs text-zinc-500">
                      {task.resources.gpu > 0 ? `${task.resources.gpu} GPU` : `${task.resources.cpu} CPU`}
                    </span>
                  </div>
                )),
              )}
            </div>
          </div>
        )}

        {/* Timeline View Placeholder */}
        {viewMode === "timeline" && (
          <div className="flex-1 p-6 flex items-center justify-center text-zinc-500">
            <p>Timeline view coming soon...</p>
          </div>
        )}

        {/* Detail Panel */}
        {selectedGroup && (
          <TaskDetailPanel
            group={selectedGroup}
            onClose={() => setSelectedGroup(null)}
          />
        )}
      </div>

      {/* Design Notes */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50">
        <details>
          <summary className="text-sm font-medium text-zinc-400 cursor-pointer">
            🎨 Design Notes (click to expand)
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-zinc-500">
            <li>
              ✅ <strong>Custom DAG rendering</strong>: Using CSS positioning + SVG edges (lightweight, no React Flow
              dependency)
            </li>
            <li>
              ✅ <strong>Node states</strong>: Visual distinction between waiting, running, completed, failed
            </li>
            <li>
              ✅ <strong>Group nodes</strong>: Support for multi-task groups with progress
            </li>
            <li>
              ✅ <strong>Detail panel</strong>: Click to see task details without leaving context
            </li>
            <li>
              ✅ <strong>View modes</strong>: DAG, List, Timeline tabs
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Use React Flow for production (better interaction, pan/zoom)
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Auto-layout with Dagre/ELK
            </li>
            <li>
              ⏳ <strong>TODO</strong>: Animated edges for active flows
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
