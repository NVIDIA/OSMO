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
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Search,
  Filter,
  RefreshCw,
  Plus,
  ChevronRight,
  ChevronDown,
  Terminal,
  FileText,
  XCircle,
  CheckCircle,
  Clock,
  Loader2,
  AlertCircle,
  Play,
  MoreHorizontal,
  ExternalLink,
} from "lucide-react";

// ============================================================================
// MOCK DATA - Represents ideal backend data structure
// ============================================================================

type WorkflowStatus =
  | "PENDING"
  | "WAITING"
  | "PROCESSING"
  | "SCHEDULING"
  | "INITIALIZING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "FAILED_IMAGE_PULL"
  | "FAILED_EXEC_TIMEOUT"
  | "FAILED_QUEUE_TIMEOUT"
  | "FAILED_EVICTED"
  | "FAILED_PREEMPTED"
  | "FAILED_UPSTREAM"
  | "FAILED_CANCELED";

type Priority = "LOW" | "NORMAL" | "HIGH";

interface Task {
  name: string;
  status: WorkflowStatus;
  startTime: Date | null;
  endTime: Date | null;
  duration: number | null;
  resources: {
    cpu: number;
    memory: string;
    gpu: number;
    storage: string;
  };
  node: string | null;
  dependsOn: string[];
}

interface WorkflowGroup {
  name: string;
  status: WorkflowStatus;
  tasks: Task[];
  upstreamGroups: string[];
  downstreamGroups: string[];
}

interface Workflow {
  id: string;
  name: string;
  uuid: string;
  status: WorkflowStatus;
  priority: Priority;
  pool: string;
  user: string;
  submitTime: Date;
  startTime: Date | null;
  endTime: Date | null;
  queuedTime: number;
  duration: number | null;
  groups: WorkflowGroup[];
  tags: string[];
  failureMessage?: string;
}

// Generate mock workflows
const mockWorkflows: Workflow[] = [
  {
    id: "train-mnist-a1b2c3d4",
    name: "train-mnist",
    uuid: "a1b2c3d4e5f6",
    status: "RUNNING",
    priority: "NORMAL",
    pool: "gpu-pool-us-east",
    user: "fernandol",
    submitTime: new Date(Date.now() - 2 * 60 * 60 * 1000),
    startTime: new Date(Date.now() - 1.9 * 60 * 60 * 1000),
    endTime: null,
    queuedTime: 6 * 60,
    duration: 1.9 * 60 * 60,
    tags: ["experiment", "mnist", "v2"],
    groups: [
      {
        name: "preprocess",
        status: "COMPLETED",
        upstreamGroups: [],
        downstreamGroups: ["train"],
        tasks: [
          {
            name: "preprocess",
            status: "COMPLETED",
            startTime: new Date(Date.now() - 1.9 * 60 * 60 * 1000),
            endTime: new Date(Date.now() - 1.8 * 60 * 60 * 1000),
            duration: 6 * 60,
            resources: { cpu: 2, memory: "8Gi", gpu: 0, storage: "10Gi" },
            node: "cpu-node-01",
            dependsOn: [],
          },
        ],
      },
      {
        name: "train",
        status: "RUNNING",
        upstreamGroups: ["preprocess"],
        downstreamGroups: ["evaluate"],
        tasks: [
          {
            name: "train",
            status: "RUNNING",
            startTime: new Date(Date.now() - 1.8 * 60 * 60 * 1000),
            endTime: null,
            duration: 1.8 * 60 * 60,
            resources: { cpu: 4, memory: "32Gi", gpu: 1, storage: "50Gi" },
            node: "gpu-node-02",
            dependsOn: ["preprocess"],
          },
        ],
      },
      {
        name: "evaluate",
        status: "WAITING",
        upstreamGroups: ["train"],
        downstreamGroups: [],
        tasks: [
          {
            name: "evaluate",
            status: "WAITING",
            startTime: null,
            endTime: null,
            duration: null,
            resources: { cpu: 2, memory: "16Gi", gpu: 1, storage: "10Gi" },
            node: null,
            dependsOn: ["train"],
          },
        ],
      },
    ],
  },
  {
    id: "eval-model-x9y8z7w6",
    name: "eval-model",
    uuid: "x9y8z7w6v5u4",
    status: "WAITING",
    priority: "NORMAL",
    pool: "gpu-pool-us-east",
    user: "fernandol",
    submitTime: new Date(Date.now() - 45 * 60 * 1000),
    startTime: null,
    endTime: null,
    queuedTime: 45 * 60,
    duration: null,
    tags: ["evaluation"],
    groups: [
      {
        name: "eval",
        status: "WAITING",
        upstreamGroups: [],
        downstreamGroups: [],
        tasks: [
          {
            name: "eval",
            status: "WAITING",
            startTime: null,
            endTime: null,
            duration: null,
            resources: { cpu: 4, memory: "32Gi", gpu: 2, storage: "20Gi" },
            node: null,
            dependsOn: [],
          },
        ],
      },
    ],
  },
  {
    id: "data-prep-failed-q2w3e4r5",
    name: "data-prep-failed",
    uuid: "q2w3e4r5t6y7",
    status: "FAILED_IMAGE_PULL",
    priority: "NORMAL",
    pool: "cpu-pool",
    user: "fernandol",
    submitTime: new Date(Date.now() - 15 * 60 * 1000),
    startTime: new Date(Date.now() - 14 * 60 * 1000),
    endTime: new Date(Date.now() - 5 * 60 * 1000),
    queuedTime: 60,
    duration: 9 * 60,
    tags: [],
    failureMessage: "Failed to pull image: nvcr.io/nvidia/pytorch:24.03-custom - unauthorized",
    groups: [
      {
        name: "prep",
        status: "FAILED_IMAGE_PULL",
        upstreamGroups: [],
        downstreamGroups: [],
        tasks: [
          {
            name: "prep",
            status: "FAILED_IMAGE_PULL",
            startTime: new Date(Date.now() - 14 * 60 * 1000),
            endTime: new Date(Date.now() - 5 * 60 * 1000),
            duration: 9 * 60,
            resources: { cpu: 2, memory: "8Gi", gpu: 0, storage: "10Gi" },
            node: "cpu-node-03",
            dependsOn: [],
          },
        ],
      },
    ],
  },
  {
    id: "inference-batch-m1n2o3p4",
    name: "inference-batch",
    uuid: "m1n2o3p4q5r6",
    status: "COMPLETED",
    priority: "HIGH",
    pool: "gpu-pool-us-west",
    user: "alice",
    submitTime: new Date(Date.now() - 4 * 60 * 60 * 1000),
    startTime: new Date(Date.now() - 3.9 * 60 * 60 * 1000),
    endTime: new Date(Date.now() - 60 * 60 * 1000),
    queuedTime: 6 * 60,
    duration: 2.9 * 60 * 60,
    tags: ["production", "inference"],
    groups: [
      {
        name: "inference",
        status: "COMPLETED",
        upstreamGroups: [],
        downstreamGroups: [],
        tasks: Array.from({ length: 8 }, (_, i) => ({
          name: `inference-shard-${i + 1}`,
          status: "COMPLETED" as WorkflowStatus,
          startTime: new Date(Date.now() - 3.9 * 60 * 60 * 1000),
          endTime: new Date(Date.now() - 60 * 60 * 1000),
          duration: 2.9 * 60 * 60,
          resources: { cpu: 4, memory: "32Gi", gpu: 1, storage: "20Gi" },
          node: `gpu-node-${(i % 4) + 1}`,
          dependsOn: [],
        })),
      },
    ],
  },
  {
    id: "sdg-pipeline-s1t2u3v4",
    name: "sdg-pipeline",
    uuid: "s1t2u3v4w5x6",
    status: "INITIALIZING",
    priority: "LOW",
    pool: "gpu-pool-us-east",
    user: "bob",
    submitTime: new Date(Date.now() - 10 * 60 * 1000),
    startTime: new Date(Date.now() - 5 * 60 * 1000),
    endTime: null,
    queuedTime: 5 * 60,
    duration: 5 * 60,
    tags: ["sdg", "isaac-sim"],
    groups: [
      {
        name: "generate",
        status: "INITIALIZING",
        upstreamGroups: [],
        downstreamGroups: ["postprocess"],
        tasks: [
          {
            name: "generate",
            status: "INITIALIZING",
            startTime: new Date(Date.now() - 5 * 60 * 1000),
            endTime: null,
            duration: 5 * 60,
            resources: { cpu: 8, memory: "64Gi", gpu: 1, storage: "100Gi" },
            node: "gpu-node-05",
            dependsOn: [],
          },
        ],
      },
      {
        name: "postprocess",
        status: "WAITING",
        upstreamGroups: ["generate"],
        downstreamGroups: [],
        tasks: [
          {
            name: "postprocess",
            status: "WAITING",
            startTime: null,
            endTime: null,
            duration: null,
            resources: { cpu: 4, memory: "16Gi", gpu: 0, storage: "50Gi" },
            node: null,
            dependsOn: ["generate"],
          },
        ],
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

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function getStatusCategory(status: WorkflowStatus): "queued" | "running" | "completed" | "failed" {
  if (["PENDING", "WAITING", "PROCESSING", "SCHEDULING"].includes(status)) return "queued";
  if (["INITIALIZING", "RUNNING"].includes(status)) return "running";
  if (status === "COMPLETED") return "completed";
  return "failed";
}

function getStatusColor(status: WorkflowStatus): string {
  const category = getStatusCategory(status);
  switch (category) {
    case "queued":
      return "text-amber-500 bg-amber-500/10";
    case "running":
      return "text-green-500 bg-green-500/10";
    case "completed":
      return "text-zinc-400 bg-zinc-500/10";
    case "failed":
      return "text-red-500 bg-red-500/10";
  }
}

function getStatusIcon(status: WorkflowStatus) {
  const category = getStatusCategory(status);
  switch (category) {
    case "queued":
      return <Clock className="h-3.5 w-3.5" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
    case "completed":
      return <CheckCircle className="h-3.5 w-3.5" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5" />;
  }
}

function getStatusLabel(status: WorkflowStatus): string {
  switch (status) {
    case "PENDING":
      return "Pending";
    case "WAITING":
      return "Queued";
    case "PROCESSING":
      return "Processing";
    case "SCHEDULING":
      return "Scheduling";
    case "INITIALIZING":
      return "Starting";
    case "RUNNING":
      return "Running";
    case "COMPLETED":
      return "Completed";
    case "FAILED":
      return "Failed";
    case "FAILED_IMAGE_PULL":
      return "Image Pull Failed";
    case "FAILED_EXEC_TIMEOUT":
      return "Timeout";
    case "FAILED_QUEUE_TIMEOUT":
      return "Queue Timeout";
    case "FAILED_EVICTED":
      return "Evicted";
    case "FAILED_PREEMPTED":
      return "Preempted";
    case "FAILED_UPSTREAM":
      return "Upstream Failed";
    case "FAILED_CANCELED":
      return "Cancelled";
    default:
      return status;
  }
}

function getPriorityColor(priority: Priority): string {
  switch (priority) {
    case "HIGH":
      return "text-red-400 bg-red-500/10 border-red-500/20";
    case "NORMAL":
      return "text-zinc-400 bg-zinc-500/10 border-zinc-500/20";
    case "LOW":
      return "text-blue-400 bg-blue-500/10 border-blue-500/20";
  }
}

// ============================================================================
// COMPONENTS
// ============================================================================

function StatusBadge({ status }: { status: WorkflowStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        getStatusColor(status),
      )}
    >
      {getStatusIcon(status)}
      {getStatusLabel(status)}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border",
        getPriorityColor(priority),
      )}
    >
      {priority}
    </span>
  );
}

function PoolBadge({ pool }: { pool: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
      {pool}
    </span>
  );
}

function ProgressBar({ completed, running, total }: { completed: number; running: number; total: number }) {
  const completedPct = (completed / total) * 100;
  const runningPct = (running / total) * 100;

  return (
    <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
      <div className="h-full flex">
        <div
          className="bg-green-500 transition-all"
          style={{ width: `${completedPct}%` }}
        />
        <div
          className="bg-green-500/50 animate-pulse transition-all"
          style={{ width: `${runningPct}%` }}
        />
      </div>
    </div>
  );
}

function WorkflowRow({
  workflow,
  isExpanded,
  onToggle,
  onSelect,
}: {
  workflow: Workflow;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
  const totalTasks = workflow.groups.reduce((acc, g) => acc + g.tasks.length, 0);
  const completedTasks = workflow.groups.reduce(
    (acc, g) => acc + g.tasks.filter((t) => t.status === "COMPLETED").length,
    0,
  );
  const runningTasks = workflow.groups.reduce(
    (acc, g) => acc + g.tasks.filter((t) => ["RUNNING", "INITIALIZING"].includes(t.status)).length,
    0,
  );

  const category = getStatusCategory(workflow.status);

  return (
    <div
      className={cn(
        "border rounded-lg transition-all duration-200",
        "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
        isExpanded && "border-zinc-600 bg-zinc-900",
      )}
    >
      {/* Main Row */}
      <div
        className="p-4 cursor-pointer"
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className="mt-0.5 p-0.5 rounded hover:bg-zinc-700/50 transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-zinc-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-400" />
              )}
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-mono text-sm font-medium text-zinc-100 truncate">{workflow.id}</h3>
                <StatusBadge status={workflow.status} />
                <PriorityBadge priority={workflow.priority} />
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-xs text-zinc-400 flex-wrap">
                <PoolBadge pool={workflow.pool} />
                <span>•</span>
                <span>{workflow.user}</span>
                <span>•</span>
                <span>
                  {category === "queued"
                    ? `queued ${formatDuration(workflow.queuedTime)}`
                    : category === "running"
                      ? `running ${formatDuration(workflow.duration)}`
                      : formatRelativeTime(workflow.submitTime)}
                </span>
                <span>•</span>
                <span>
                  {totalTasks} {totalTasks === 1 ? "task" : "tasks"}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
              }}
            >
              <FileText className="h-3.5 w-3.5 mr-1" />
              Logs
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Progress bar for running workflows */}
        {category === "running" && totalTasks > 1 && (
          <div className="mt-3 ml-7">
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <ProgressBar
                  completed={completedTasks}
                  running={runningTasks}
                  total={totalTasks}
                />
              </div>
              <span className="text-xs text-zinc-500">
                {completedTasks}/{totalTasks} complete
              </span>
            </div>
          </div>
        )}

        {/* Queue position for waiting workflows */}
        {category === "queued" && (
          <div className="mt-3 ml-7">
            <div className="flex items-center gap-2 text-xs text-amber-400">
              <Clock className="h-3.5 w-3.5" />
              <span>Position #3 in queue • Est. wait: ~30 min</span>
            </div>
          </div>
        )}

        {/* Failure message for failed workflows */}
        {category === "failed" && workflow.failureMessage && (
          <div className="mt-3 ml-7">
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-md p-2">
              <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span className="line-clamp-2">{workflow.failureMessage}</span>
            </div>
          </div>
        )}
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div className="border-t border-zinc-800 p-4 bg-zinc-950/50">
          <div className="ml-7">
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-3">Task Overview</h4>
            <div className="flex items-center gap-3 flex-wrap">
              {workflow.groups.map((group) => (
                <div
                  key={group.name}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm",
                    getStatusColor(group.status),
                    "border-current/20",
                  )}
                >
                  {getStatusIcon(group.status)}
                  <span>{group.name}</span>
                  {group.tasks.length > 1 && <span className="text-xs opacity-60">({group.tasks.length})</span>}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button
                size="sm"
                className="h-8"
              >
                <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                Open Detail
              </Button>
              {category === "running" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8"
                >
                  <Terminal className="h-3.5 w-3.5 mr-1.5" />
                  Shell
                </Button>
              )}
              {category !== "completed" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <XCircle className="h-3.5 w-3.5 mr-1.5" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// MAIN PAGE COMPONENT
// ============================================================================

export default function WorkflowsMockPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [userFilter, setUserFilter] = useState<string>("me");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedWorkflow, setSelectedWorkflow] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"standard" | "compact">("standard");

  const toggleExpanded = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const filteredWorkflows = useMemo(() => {
    return mockWorkflows.filter((w) => {
      // Search filter
      if (searchQuery && !w.id.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        const category = getStatusCategory(w.status);
        if (statusFilter !== category) return false;
      }

      // User filter
      if (userFilter === "me" && w.user !== "fernandol") {
        return false;
      }

      return true;
    });
  }, [searchQuery, statusFilter, userFilter]);

  // Calculate summary stats
  const stats = useMemo(() => {
    return {
      queued: filteredWorkflows.filter((w) => getStatusCategory(w.status) === "queued").length,
      running: filteredWorkflows.filter((w) => getStatusCategory(w.status) === "running").length,
      completed: filteredWorkflows.filter((w) => getStatusCategory(w.status) === "completed").length,
      failed: filteredWorkflows.filter((w) => getStatusCategory(w.status) === "failed").length,
    };
  }, [filteredWorkflows]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Workflows</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">View and manage your workflow submissions</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Submit Workflow
          </Button>
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-4">
        <button
          onClick={() => setStatusFilter("queued")}
          className={cn(
            "p-4 rounded-lg border transition-all text-left",
            statusFilter === "queued"
              ? "bg-amber-500/10 border-amber-500/30"
              : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
          )}
        >
          <div className="flex items-center gap-2 text-amber-400">
            <Clock className="h-4 w-4" />
            <span className="text-2xl font-bold">{stats.queued}</span>
          </div>
          <span className="text-xs text-zinc-400">Queued</span>
        </button>
        <button
          onClick={() => setStatusFilter("running")}
          className={cn(
            "p-4 rounded-lg border transition-all text-left",
            statusFilter === "running"
              ? "bg-green-500/10 border-green-500/30"
              : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
          )}
        >
          <div className="flex items-center gap-2 text-green-400">
            <Play className="h-4 w-4" />
            <span className="text-2xl font-bold">{stats.running}</span>
          </div>
          <span className="text-xs text-zinc-400">Running</span>
        </button>
        <button
          onClick={() => setStatusFilter("completed")}
          className={cn(
            "p-4 rounded-lg border transition-all text-left",
            statusFilter === "completed"
              ? "bg-zinc-500/10 border-zinc-500/30"
              : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
          )}
        >
          <div className="flex items-center gap-2 text-zinc-400">
            <CheckCircle className="h-4 w-4" />
            <span className="text-2xl font-bold">{stats.completed}</span>
          </div>
          <span className="text-xs text-zinc-400">Completed</span>
        </button>
        <button
          onClick={() => setStatusFilter("failed")}
          className={cn(
            "p-4 rounded-lg border transition-all text-left",
            statusFilter === "failed"
              ? "bg-red-500/10 border-red-500/30"
              : "bg-zinc-900/50 border-zinc-800 hover:border-zinc-700",
          )}
        >
          <div className="flex items-center gap-2 text-red-400">
            <XCircle className="h-4 w-4" />
            <span className="text-2xl font-bold">{stats.failed}</span>
          </div>
          <span className="text-xs text-zinc-400">Failed</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
          <Input
            placeholder="Search workflows..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-zinc-900/50 border-zinc-800"
          />
        </div>
        <Select
          value={userFilter}
          onValueChange={setUserFilter}
        >
          <SelectTrigger className="w-[140px] bg-zinc-900/50 border-zinc-800">
            <SelectValue placeholder="User" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="me">My workflows</SelectItem>
            <SelectItem value="all">All users</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={setStatusFilter}
        >
          <SelectTrigger className="w-[140px] bg-zinc-900/50 border-zinc-800">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
        >
          <Filter className="h-4 w-4 mr-2" />
          More Filters
        </Button>
      </div>

      {/* Workflow List */}
      <div className="space-y-3">
        {filteredWorkflows.length === 0 ? (
          <div className="text-center py-12 text-zinc-500">
            <p>No workflows found matching your filters.</p>
          </div>
        ) : (
          filteredWorkflows.map((workflow) => (
            <WorkflowRow
              key={workflow.id}
              workflow={workflow}
              isExpanded={expandedIds.has(workflow.id)}
              onToggle={() => toggleExpanded(workflow.id)}
              onSelect={() => setSelectedWorkflow(workflow.id)}
            />
          ))
        )}
      </div>

      {/* Design Notes */}
      <div className="mt-12 p-6 rounded-lg border border-dashed border-zinc-700 bg-zinc-900/30">
        <h3 className="text-lg font-semibold mb-4 text-zinc-300">🎨 Design Notes (for brainstorming)</h3>
        <ul className="space-y-2 text-sm text-zinc-400">
          <li>
            ✅ <strong>Status at a glance</strong>: Color-coded badges with icons
          </li>
          <li>
            ✅ <strong>Progress inline</strong>: Progress bar shows task completion for running workflows
          </li>
          <li>
            ✅ <strong>Queue visibility</strong>: Position and ETA for queued workflows
          </li>
          <li>
            ✅ <strong>Failure surfacing</strong>: Error message preview for failed workflows
          </li>
          <li>
            ✅ <strong>Expandable rows</strong>: Quick task overview without navigating away
          </li>
          <li>
            ✅ <strong>Stats dashboard</strong>: Clickable summary cards for quick filtering
          </li>
          <li>
            ⏳ <strong>TODO</strong>: Date range filter, pool filter, tag filter
          </li>
          <li>
            ⏳ <strong>TODO</strong>: Real-time updates (polling or WebSocket)
          </li>
          <li>
            ⏳ <strong>TODO</strong>: Keyboard navigation (j/k to move, Enter to open)
          </li>
        </ul>
      </div>
    </div>
  );
}
