// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

"use client";

import { useState, useMemo, useCallback, memo, useRef, useEffect } from "react";
import { faker } from "@faker-js/faker";
import {
  X,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  Search,
  Check,
  AlertCircle,
  Clock,
  Loader2,
  Circle,
  ExternalLink,
  Terminal,
  ScrollText,
  PanelLeftClose,
  PanelLeft,
  Columns2,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useVirtualizerCompat } from "@/lib/hooks";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";

// =============================================================================
// Types
// =============================================================================

type TaskStatus =
  | "COMPLETED"
  | "RUNNING"
  | "WAITING"
  | "FAILED"
  | "FAILED_TIMEOUT"
  | "FAILED_PREEMPTED"
  | "FAILED_CANCELED"
  | "INITIALIZING"
  | "SCHEDULING";

interface MockTask {
  name: string;
  status: TaskStatus;
  duration: number | null; // seconds
  startTime: Date | null;
  endTime: Date | null;
  nodeName: string | null;
  podIp: string | null;
  failureMessage?: string;
  exitCode?: number;
}

interface MockGroup {
  name: string;
  tasks: MockTask[];
}

type SortColumn = "status" | "name" | "duration" | "node";
type SortDirection = "asc" | "desc";

interface SortState {
  column: SortColumn | null;
  direction: SortDirection;
}

// =============================================================================
// Mock Data Generation
// =============================================================================

function generateMockGroup(taskCount: number, scenarioName: string): MockGroup {
  faker.seed(42);

  const nodes = [
    "dgx-a100-001",
    "dgx-a100-002",
    "dgx-a100-003",
    "dgx-h100-001",
    "dgx-h100-002",
    "gpu-l40s-101",
    "gpu-l40s-102",
    "gpu-l40s-103",
  ];

  const tasks: MockTask[] = [];
  const baseTime = new Date();
  baseTime.setHours(baseTime.getHours() - 2);

  for (let i = 0; i < taskCount; i++) {
    // Determine status based on position and scenario
    let status: TaskStatus;
    if (i < taskCount * 0.7) {
      status = "COMPLETED";
    } else if (i < taskCount * 0.85) {
      status = "RUNNING";
    } else if (i < taskCount * 0.92) {
      status = faker.helpers.arrayElement(["FAILED", "FAILED_TIMEOUT", "FAILED_PREEMPTED"]);
    } else {
      status = faker.helpers.arrayElement(["WAITING", "SCHEDULING", "INITIALIZING"]);
    }

    const startTime =
      status !== "WAITING" && status !== "SCHEDULING"
        ? new Date(baseTime.getTime() + i * 60000 + faker.number.int({ min: 0, max: 30000 }))
        : null;

    const duration =
      status === "COMPLETED" || status === "FAILED" || status === "FAILED_TIMEOUT"
        ? faker.number.int({ min: 30, max: 600 })
        : status === "RUNNING"
          ? Math.floor((Date.now() - (startTime?.getTime() ?? Date.now())) / 1000)
          : null;

    const endTime = status === "COMPLETED" || status.startsWith("FAILED") ? new Date() : null;

    tasks.push({
      name: `${scenarioName}-shard-${i.toString().padStart(3, "0")}`,
      status,
      duration,
      startTime,
      endTime,
      nodeName: status !== "WAITING" && status !== "SCHEDULING" ? faker.helpers.arrayElement(nodes) : null,
      podIp:
        status !== "WAITING" && status !== "SCHEDULING" ? `10.0.${faker.number.int({ min: 1, max: 10 })}.${faker.number.int({ min: 1, max: 254 })}` : null,
      failureMessage: status.startsWith("FAILED")
        ? faker.helpers.arrayElement([
            "OutOfMemoryError: CUDA out of memory",
            "Connection timeout after 30s",
            "Process killed by signal 9",
            "RuntimeError: NCCL error",
          ])
        : undefined,
      exitCode: status === "COMPLETED" ? 0 : status.startsWith("FAILED") ? 1 : undefined,
    });
  }

  // Shuffle to make it more realistic
  return {
    name: scenarioName,
    tasks: faker.helpers.shuffle(tasks),
  };
}

// =============================================================================
// Status Utilities
// =============================================================================

function isFailedStatus(status: TaskStatus): boolean {
  return status.startsWith("FAILED");
}

function getStatusCategory(status: TaskStatus): "completed" | "running" | "failed" | "pending" {
  if (status === "COMPLETED") return "completed";
  if (status === "RUNNING" || status === "INITIALIZING") return "running";
  if (isFailedStatus(status)) return "failed";
  return "pending";
}

function getStatusOrder(status: TaskStatus): number {
  const order: Record<TaskStatus, number> = {
    FAILED: 0,
    FAILED_TIMEOUT: 1,
    FAILED_PREEMPTED: 2,
    FAILED_CANCELED: 3,
    RUNNING: 4,
    INITIALIZING: 5,
    SCHEDULING: 6,
    WAITING: 7,
    COMPLETED: 8,
  };
  return order[status] ?? 99;
}

interface GroupStatus {
  status: "completed" | "running" | "failed" | "pending";
  label: string;
}

function computeGroupStatus(tasks: MockTask[]): GroupStatus {
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === "COMPLETED").length;
  const running = tasks.filter((t) => t.status === "RUNNING" || t.status === "INITIALIZING").length;
  const failed = tasks.filter((t) => isFailedStatus(t.status)).length;

  if (completed === total) {
    return { status: "completed", label: "Completed" };
  }
  if (failed > 0) {
    return { status: "failed", label: running > 0 ? "Running with failures" : "Failed" };
  }
  if (running > 0) {
    return { status: "running", label: "Running" };
  }
  return { status: "pending", label: "Pending" };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

// =============================================================================
// Status Icon Component
// =============================================================================

function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  const category = getStatusCategory(status);

  switch (category) {
    case "completed":
      return <Check className={cn("h-3.5 w-3.5 text-emerald-500", className)} />;
    case "running":
      return <Loader2 className={cn("h-3.5 w-3.5 animate-spin text-blue-500", className)} />;
    case "failed":
      return <AlertCircle className={cn("h-3.5 w-3.5 text-red-500", className)} />;
    case "pending":
      return <Clock className={cn("h-3.5 w-3.5 text-zinc-400", className)} />;
    default:
      return <Circle className={cn("h-3.5 w-3.5 text-zinc-400", className)} />;
  }
}

// =============================================================================
// Progress Bar Component (with clickable filter labels)
// =============================================================================

type StatusFilter = "completed" | "running" | "failed" | "pending" | null;

function ProgressBar({
  tasks,
  activeFilter,
  onFilterChange,
}: {
  tasks: MockTask[];
  activeFilter: StatusFilter;
  onFilterChange: (filter: StatusFilter) => void;
}) {
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "COMPLETED").length;
    const running = tasks.filter((t) => t.status === "RUNNING" || t.status === "INITIALIZING").length;
    const failed = tasks.filter((t) => isFailedStatus(t.status)).length;
    const pending = total - completed - running - failed;

    return { total, completed, running, failed, pending };
  }, [tasks]);

  const pcts = {
    completed: (stats.completed / stats.total) * 100,
    running: (stats.running / stats.total) * 100,
    failed: (stats.failed / stats.total) * 100,
  };

  const handleClick = (filter: StatusFilter) => {
    // Toggle off if clicking the same filter
    onFilterChange(activeFilter === filter ? null : filter);
  };

  // When a filter is active, mute the non-selected segments
  const isFiltered = activeFilter !== null;

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={cn(
            "transition-all duration-300",
            isFiltered && activeFilter !== "completed"
              ? "bg-emerald-500/25"
              : "bg-emerald-500",
          )}
          style={{ width: `${pcts.completed}%` }}
        />
        <div
          className={cn(
            "transition-all duration-300",
            isFiltered && activeFilter !== "running"
              ? "bg-blue-500/25"
              : "bg-blue-500",
          )}
          style={{ width: `${pcts.running}%` }}
        />
        <div
          className={cn(
            "transition-all duration-300",
            isFiltered && activeFilter !== "failed"
              ? "bg-red-500/25"
              : "bg-red-500",
          )}
          style={{ width: `${pcts.failed}%` }}
        />
        {/* Pending segment (shown muted when other filter active) */}
        <div
          className={cn(
            "transition-all duration-300",
            isFiltered && activeFilter !== "pending"
              ? "bg-zinc-300/25 dark:bg-zinc-600/25"
              : "bg-zinc-300 dark:bg-zinc-600",
          )}
          style={{ width: `${(stats.pending / stats.total) * 100}%` }}
        />
      </div>

      {/* Clickable filter labels */}
      <div className="flex flex-wrap gap-3 text-xs">
        {stats.completed > 0 && (
          <button
            onClick={() => handleClick("completed")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200",
              activeFilter === "completed"
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                : isFiltered
                  ? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full transition-opacity duration-200", isFiltered && activeFilter !== "completed" ? "bg-emerald-500/40" : "bg-emerald-500")} />
            <span>{stats.completed} completed</span>
          </button>
        )}
        {stats.running > 0 && (
          <button
            onClick={() => handleClick("running")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200",
              activeFilter === "running"
                ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                : isFiltered
                  ? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full transition-opacity duration-200", isFiltered && activeFilter !== "running" ? "bg-blue-500/40" : "bg-blue-500")} />
            <span>{stats.running} running</span>
          </button>
        )}
        {stats.failed > 0 && (
          <button
            onClick={() => handleClick("failed")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200",
              activeFilter === "failed"
                ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                : isFiltered
                  ? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full transition-opacity duration-200", isFiltered && activeFilter !== "failed" ? "bg-red-500/40" : "bg-red-500")} />
            <span>{stats.failed} failed</span>
          </button>
        )}
        {stats.pending > 0 && (
          <button
            onClick={() => handleClick("pending")}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200",
              activeFilter === "pending"
                ? "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                : isFiltered
                  ? "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800",
            )}
          >
            <span className={cn("h-2 w-2 rounded-full transition-opacity duration-200", isFiltered && activeFilter !== "pending" ? "bg-zinc-300/40 dark:bg-zinc-600/40" : "bg-zinc-300 dark:bg-zinc-600")} />
            <span>{stats.pending} pending</span>
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Task Table Header
// =============================================================================

const TaskTableHeader = memo(function TaskTableHeader({
  sort,
  onSort,
}: {
  sort: SortState;
  onSort: (column: SortColumn) => void;
}) {
  const columns: { key: SortColumn; label: string; align: "left" | "right" }[] = [
    { key: "status", label: "St", align: "left" },
    { key: "name", label: "Name", align: "left" },
    { key: "duration", label: "Duration", align: "right" },
    { key: "node", label: "Node", align: "left" },
  ];

  return (
    <div
      className="grid gap-2 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs font-medium uppercase tracking-wider text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
      style={{ gridTemplateColumns: "32px 1fr 80px 1fr" }}
    >
      {columns.map((col) => (
        <button
          key={col.key}
          onClick={() => onSort(col.key)}
          className={cn(
            "flex items-center gap-1 transition-colors hover:text-zinc-900 dark:hover:text-white",
            col.align === "right" && "justify-end",
          )}
        >
          {col.label}
          {sort.column === col.key ? (
            sort.direction === "asc" ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )
          ) : (
            <ChevronsUpDown className="h-3 w-3 opacity-30" />
          )}
        </button>
      ))}
    </div>
  );
});

// =============================================================================
// Task Row
// =============================================================================

const TaskRow = memo(function TaskRow({
  task,
  isSelected,
  onSelect,
}: {
  task: MockTask;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        "grid cursor-pointer items-center gap-2 border-b border-zinc-100 px-3 py-2 text-sm transition-colors dark:border-zinc-800",
        isSelected ? "bg-blue-50 dark:bg-blue-900/20" : "hover:bg-zinc-50 dark:hover:bg-zinc-900",
      )}
      style={{ gridTemplateColumns: "32px 1fr 80px 1fr" }}
    >
      <div className="flex items-center">
        <StatusIcon status={task.status} />
      </div>
      <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">{task.name}</div>
      <div className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">{formatDuration(task.duration)}</div>
      <div className="truncate text-zinc-500 dark:text-zinc-400">{task.nodeName ?? "—"}</div>
    </div>
  );
});

// =============================================================================
// Virtualized Task List
// =============================================================================

function VirtualizedTaskList({
  tasks,
  selectedTask,
  onSelectTask,
}: {
  tasks: MockTask[];
  selectedTask: MockTask | null;
  onSelectTask: (task: MockTask) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rowHeight = 40;

  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 5,
  });

  if (tasks.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        No tasks match your filters
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      style={{ contain: "strict" }}
    >
      <div
        style={{
          height: virtualizer.getTotalSize(),
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const task = tasks[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: virtualRow.size,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <TaskRow
                task={task}
                isSelected={selectedTask?.name === task.name}
                onSelect={() => onSelectTask(task)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// Task Detail Mini Panel
// =============================================================================

function TaskDetailMini({ task, onClose }: { task: MockTask; onClose: () => void }) {
  const category = getStatusCategory(task.status);

  return (
    <div className="border-t border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h4 className="font-medium text-zinc-900 dark:text-white">{task.name}</h4>
          <div className="mt-1 flex items-center gap-2">
            <StatusIcon status={task.status} />
            <span
              className={cn(
                "text-sm",
                category === "completed" && "text-emerald-600 dark:text-emerald-400",
                category === "running" && "text-blue-600 dark:text-blue-400",
                category === "failed" && "text-red-600 dark:text-red-400",
                category === "pending" && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {task.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 hover:bg-zinc-200 dark:hover:bg-zinc-700"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Duration</dt>
          <dd className="font-medium text-zinc-900 dark:text-white">{formatDuration(task.duration)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Node</dt>
          <dd className="font-medium text-zinc-900 dark:text-white">{task.nodeName ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Pod IP</dt>
          <dd className="font-mono text-zinc-900 dark:text-white">{task.podIp ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">Exit Code</dt>
          <dd className="font-mono text-zinc-900 dark:text-white">{task.exitCode ?? "—"}</dd>
        </div>
      </dl>

      {task.failureMessage && (
        <div className="mt-3 rounded-md bg-red-50 p-2 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {task.failureMessage}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-4 flex gap-2">
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
          <ScrollText className="h-3.5 w-3.5" />
          Logs
        </button>
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          <Terminal className="h-3.5 w-3.5" />
          Shell
        </button>
        <button className="flex items-center gap-1.5 rounded-md bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700">
          <ExternalLink className="h-3.5 w-3.5" />
          Dashboard
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Group Panel Component
// =============================================================================

function GroupPanel({ group, onClose }: { group: MockGroup; onClose: () => void }) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState>({ column: "status", direction: "asc" });
  const [selectedTask, setSelectedTask] = useState<MockTask | null>(null);

  // Filter and sort tasks
  const filteredTasks = useMemo(() => {
    let result = [...group.tasks];

    // Apply status filter
    if (statusFilter !== null) {
      result = result.filter((task) => {
        const category = getStatusCategory(task.status);
        return category === statusFilter;
      });
    }

    // Apply search
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (task) =>
          task.name.toLowerCase().includes(query) ||
          task.nodeName?.toLowerCase().includes(query) ||
          task.podIp?.includes(query),
      );
    }

    // Apply sort
    if (sort.column) {
      result.sort((a, b) => {
        let cmp = 0;
        switch (sort.column) {
          case "status":
            cmp = getStatusOrder(a.status) - getStatusOrder(b.status);
            break;
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "duration":
            cmp = (a.duration ?? 0) - (b.duration ?? 0);
            break;
          case "node":
            cmp = (a.nodeName ?? "").localeCompare(b.nodeName ?? "");
            break;
        }
        return sort.direction === "asc" ? cmp : -cmp;
      });
    }

    return result;
  }, [group.tasks, statusFilter, searchQuery, sort]);

  // Sort handler
  const handleSort = useCallback((column: SortColumn) => {
    setSort((prev) => {
      if (prev.column === column) {
        if (prev.direction === "asc") return { column, direction: "desc" };
        return { column: null, direction: "asc" };
      }
      return { column, direction: "asc" };
    });
  }, []);

  // Compute group status for header
  const groupStatus = useMemo(() => computeGroupStatus(group.tasks), [group.tasks]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white shadow-[-4px_0_16px_-4px_rgba(0,0,0,0.1)] dark:bg-zinc-950 dark:shadow-[-4px_0_16px_-4px_rgba(0,0,0,0.4)]">
      {/* Compact Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2.5 dark:border-zinc-800">
        <div className="min-w-0 flex-1">
          {/* Line 1: Group name · Task count */}
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-semibold text-zinc-900 dark:text-white">{group.name}</h2>
            <span className="text-zinc-300 dark:text-zinc-600">·</span>
            <span className="shrink-0 text-sm text-zinc-500 dark:text-zinc-400">{group.tasks.length} tasks</span>
          </div>
          {/* Line 2: Status icon · Status label */}
          <div className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                "flex items-center gap-1.5",
                groupStatus.status === "completed" && "text-emerald-600 dark:text-emerald-400",
                groupStatus.status === "running" && "text-blue-600 dark:text-blue-400",
                groupStatus.status === "failed" && "text-red-600 dark:text-red-400",
                groupStatus.status === "pending" && "text-zinc-500 dark:text-zinc-400",
              )}
            >
              {groupStatus.status === "completed" && <Check className="h-3 w-3" />}
              {groupStatus.status === "running" && <Loader2 className="h-3 w-3 animate-spin" />}
              {groupStatus.status === "failed" && <AlertCircle className="h-3 w-3" />}
              {groupStatus.status === "pending" && <Clock className="h-3 w-3" />}
              <span className="font-medium">{groupStatus.label}</span>
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="ml-2 shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Progress bar with clickable filter labels */}
      <div className="border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <ProgressBar
          tasks={group.tasks}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
        />
      </div>

      {/* Search */}
      <div className="space-y-2 border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <Input
            placeholder="Search by name, node, or IP..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-8 pl-9 text-sm"
          />
        </div>
        {(statusFilter !== null || searchQuery) && (
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              Showing {filteredTasks.length} of {group.tasks.length} tasks
            </span>
            <button
              onClick={() => {
                setStatusFilter(null);
                setSearchQuery("");
              }}
              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Table header */}
      <TaskTableHeader
        sort={sort}
        onSort={handleSort}
      />

      {/* Virtualized task list */}
      <VirtualizedTaskList
        tasks={filteredTasks}
        selectedTask={selectedTask}
        onSelectTask={setSelectedTask}
      />

      {/* Selected task detail */}
      {selectedTask && (
        <TaskDetailMini
          task={selectedTask}
          onClose={() => setSelectedTask(null)}
        />
      )}
    </div>
  );
}

// =============================================================================
// Scenario Selector
// =============================================================================

const SCENARIOS = [
  { key: "small", label: "Small Group (8 tasks)", count: 8 },
  { key: "medium", label: "Medium Group (50 tasks)", count: 50 },
  { key: "large", label: "Large Group (200 tasks)", count: 200 },
  { key: "massive", label: "Massive Group (500 tasks)", count: 500 },
  { key: "extreme", label: "Extreme Group (1000 tasks)", count: 1000 },
] as const;

// Panel width presets (percentage of container)
const WIDTH_PRESETS = [
  { key: "narrow", pct: 33, icon: PanelLeftClose, label: "Narrow (33%)" },
  { key: "medium", pct: 50, icon: Columns2, label: "Medium (50%)" },
  { key: "wide", pct: 75, icon: PanelLeft, label: "Wide (75%)" },
] as const;

// =============================================================================
// Resizable Panel Hook
// =============================================================================

function useResizablePanel(initialPct: number = 50, minPct: number = 25, maxPct: number = 80) {
  const [panelPct, setPanelPct] = useState(initialPct);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = 100 - (x / rect.width) * 100;
      setPanelPct(Math.min(maxPct, Math.max(minPct, pct)));
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, minPct, maxPct]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (e.key === "[") {
        setPanelPct((p) => Math.max(minPct, p - 10));
      } else if (e.key === "]") {
        setPanelPct((p) => Math.min(maxPct, p + 10));
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [minPct, maxPct]);

  return { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef };
}

// =============================================================================
// Main Page
// =============================================================================

export default function GroupPanelDevPage() {
  const [scenario, setScenario] = useState<(typeof SCENARIOS)[number]["key"]>("medium");
  const { panelPct, setPanelPct, isDragging, handleMouseDown, containerRef } = useResizablePanel(50);

  const group = useMemo(() => {
    const config = SCENARIOS.find((s) => s.key === scenario)!;
    return generateMockGroup(config.count, `distributed-training-${config.key}`);
  }, [scenario]);

  return (
    <div className="flex h-full flex-col">
      {/* Compact header with scenario selector and width presets */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Tasks:</span>
            <div className="flex gap-1">
              {SCENARIOS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setScenario(s.key)}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors",
                    scenario === s.key
                      ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
                  )}
                >
                  {s.count}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Width presets */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {Math.round(panelPct)}%
          </span>
          <div className="flex gap-0.5">
            {WIDTH_PRESETS.map((preset) => {
              const Icon = preset.icon;
              const isActive = Math.abs(panelPct - preset.pct) < 5;
              return (
                <Tooltip key={preset.key}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => setPanelPct(preset.pct)}
                      className={cn(
                        "rounded p-1.5 transition-colors",
                        isActive
                          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                          : "text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{preset.label}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <span className="ml-1 text-[10px] text-zinc-400 dark:text-zinc-600">[ ]</span>
        </div>
      </div>

      {/* Main content - DAG with panel overlay */}
      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden"
        style={{ cursor: isDragging ? "col-resize" : undefined }}
      >
        {/* DAG takes full space (panel overlays this) */}
        <div className="absolute inset-0 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex h-full items-center justify-center text-zinc-400 dark:text-zinc-600">
            <div className="text-center">
              <div className="text-2xl">🗺️</div>
              <div className="mt-1 text-xs">DAG Visualization</div>
              <div className="mt-2 text-[10px] text-zinc-300 dark:text-zinc-700">
                (Full width - panel overlays from right)
              </div>
            </div>
          </div>
        </div>

        {/* Panel overlay - slides in from right, casts shadow over DAG */}
        <div
          className="absolute inset-y-0 right-0 shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.15)] dark:shadow-[-8px_0_24px_-8px_rgba(0,0,0,0.5)]"
          style={{ width: `${panelPct}%`, minWidth: "300px" }}
        >
          {/* Drag handle - positioned at the left edge of panel */}
          <div
            onMouseDown={handleMouseDown}
            className="group absolute inset-y-0 left-0 z-20 w-3 -translate-x-1/2 cursor-col-resize"
          >
            {/* Edge highlight line - right at panel edge */}
            <div
              className={cn(
                "absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 transition-all duration-150",
                isDragging
                  ? "bg-blue-400/70"
                  : "bg-transparent group-hover:bg-zinc-300/80 dark:group-hover:bg-zinc-600/50",
              )}
            />
            {/* Grip indicator - appears on hover, centered on edge */}
            <div
              className={cn(
                "pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 transition-all duration-150",
                isDragging
                  ? "scale-100 opacity-100"
                  : "scale-90 opacity-0 group-hover:scale-100 group-hover:opacity-100",
              )}
            >
              <div
                className={cn(
                  "flex h-8 w-4 items-center justify-center rounded-full shadow-md",
                  isDragging
                    ? "bg-blue-500 text-white"
                    : "bg-white text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500",
                )}
              >
                <GripVertical className="h-3.5 w-3.5" />
              </div>
            </div>
          </div>
          
          {/* Panel content - fills the overlay */}
          <div className="h-full overflow-hidden">
            <GroupPanel
              group={group}
              onClose={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
