// Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * GroupNode Component
 *
 * Collapsible node component for DAG visualization.
 * Features:
 * - Single-task nodes show task name directly (flattened)
 * - Multi-task nodes show group name with expand/collapse
 * - Status-specific hint text
 * - Virtualized task list for large groups
 * - WCAG 2.1 AA accessibility
 */

"use client";

import { useRef, useCallback, useMemo, useEffect } from "react";
import { Handle, Position } from "@xyflow/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskQueryResponse, GroupWithLayout } from "../../workflow-types";
import { TaskGroupStatus, isFailedStatus } from "../../workflow-types";
import type { GroupNodeData } from "../types";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../utils/status";
import { calculateDuration, formatDuration } from "../../workflow-types";
import {
  TASK_ROW_HEIGHT,
  NODE_HEADER_HEIGHT,
} from "../constants";

// ============================================================================
// Smart Scroll Handler
// ============================================================================

/**
 * Hook to handle wheel events:
 * - Horizontal scroll (deltaX) → always pass through for panning
 * - Vertical scroll (deltaY) → capture for list scrolling, pass through at boundaries
 */
function useSmartScroll(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleWheel = (e: WheelEvent) => {
      // Horizontal scroll → let it pan
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return;
      }

      const { scrollTop, scrollHeight, clientHeight } = element;
      const atTop = scrollTop <= 0;
      const atBottom = scrollTop + clientHeight >= scrollHeight - 1;

      // At boundaries → let it pan
      if ((atTop && e.deltaY < 0) || (atBottom && e.deltaY > 0)) {
        return;
      }

      // Vertical scroll in the middle → capture for list scrolling
      e.stopPropagation();
    };

    element.addEventListener("wheel", handleWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleWheel);
  }, [ref]);
}

// ============================================================================
// Status Hint Text
// ============================================================================

/**
 * Get status-specific hint text for display in the node.
 * Different logic for single-task vs multi-task groups.
 */
function getStatusHint(
  group: GroupWithLayout,
  task: TaskQueryResponse | undefined,
  isSingleTask: boolean
): string {
  const tasks = group.tasks || [];
  const taskCount = tasks.length;

  // Count failures for multi-task groups
  const failedTasks = tasks.filter((t) => isFailedStatus(t.status));
  const failedCount = failedTasks.length;

  // For multi-task with failures, always show failure count
  if (!isSingleTask && failedCount > 0) {
    if (failedCount === taskCount) {
      // All failed - show the common failure type if available
      const firstFailed = failedTasks[0];
      const failureHint = getFailureHint(firstFailed);
      return `Failed · ${failureHint}`;
    }
    return `${failedCount} of ${taskCount} failed`;
  }

  // Use task status for single-task, group status for multi-task
  const status = isSingleTask && task ? task.status : group.status;

  switch (status) {
    // Waiting states
    case TaskGroupStatus.WAITING: {
      const blocking = group.remaining_upstream_groups;
      if (blocking?.length === 1) {
        return `Waiting for: ${blocking[0]}`;
      }
      if (blocking && blocking.length > 1) {
        return `Waiting for ${blocking.length} tasks`;
      }
      return isSingleTask ? "Queued..." : `${taskCount} tasks queued`;
    }

    case TaskGroupStatus.SUBMITTING:
      return isSingleTask ? "Submitting..." : `Submitting ${taskCount} tasks...`;

    case TaskGroupStatus.SCHEDULING:
      return isSingleTask ? "In queue..." : `Scheduling ${taskCount} tasks...`;

    case TaskGroupStatus.PROCESSING:
      return isSingleTask ? "Processing..." : `Processing ${taskCount} tasks...`;

    // Active states
    case TaskGroupStatus.INITIALIZING:
      return isSingleTask ? "Starting up..." : `Starting ${taskCount} tasks...`;

    case TaskGroupStatus.RUNNING: {
      const startTime = isSingleTask ? task?.start_time : group.start_time;
      const elapsed = calculateDuration(startTime, null);
      return `Running · ${formatDuration(elapsed)}`;
    }

    // Terminal states
    case TaskGroupStatus.COMPLETED: {
      const startTime = isSingleTask ? task?.start_time : group.start_time;
      const endTime = isSingleTask ? task?.end_time : group.end_time;
      const duration = calculateDuration(startTime, endTime);
      return formatDuration(duration);
    }

    case TaskGroupStatus.RESCHEDULED: {
      const retryId = task?.retry_id || 0;
      return retryId > 0 ? `Retrying... (attempt ${retryId + 1})` : "Retrying...";
    }

    // Failure states - use failure_message when available, fallback to status-specific text
    case TaskGroupStatus.FAILED:
      return task?.failure_message?.slice(0, 25) || "Failed";

    case TaskGroupStatus.FAILED_CANCELED:
      return "Cancelled";

    case TaskGroupStatus.FAILED_SERVER_ERROR:
      return task?.failure_message?.slice(0, 25) || "Server error";

    case TaskGroupStatus.FAILED_BACKEND_ERROR:
      return task?.failure_message?.slice(0, 25) || "Backend error";

    case TaskGroupStatus.FAILED_EXEC_TIMEOUT:
      return "Execution timeout";

    case TaskGroupStatus.FAILED_QUEUE_TIMEOUT:
      return "Queue timeout";

    case TaskGroupStatus.FAILED_IMAGE_PULL:
      return "Image pull failed";

    case TaskGroupStatus.FAILED_UPSTREAM:
      return "Upstream failed";

    case TaskGroupStatus.FAILED_EVICTED:
      return "Evicted";

    case TaskGroupStatus.FAILED_START_ERROR:
      return task?.failure_message?.slice(0, 25) || "Start error";

    case TaskGroupStatus.FAILED_START_TIMEOUT:
      return "Start timeout";

    case TaskGroupStatus.FAILED_PREEMPTED:
      return "Preempted";

    default:
      return "";
  }
}

/**
 * Get a short hint for failure type (used in multi-task group summaries).
 */
function getFailureHint(task: TaskQueryResponse): string {
  switch (task.status) {
    case TaskGroupStatus.FAILED_CANCELED:
      return "Cancelled";
    case TaskGroupStatus.FAILED_SERVER_ERROR:
      return "Server error";
    case TaskGroupStatus.FAILED_BACKEND_ERROR:
      return "Backend error";
    case TaskGroupStatus.FAILED_EXEC_TIMEOUT:
      return "Timeout";
    case TaskGroupStatus.FAILED_QUEUE_TIMEOUT:
      return "Queue timeout";
    case TaskGroupStatus.FAILED_IMAGE_PULL:
      return "Image pull";
    case TaskGroupStatus.FAILED_UPSTREAM:
      return "Upstream failed";
    case TaskGroupStatus.FAILED_EVICTED:
      return "Evicted";
    case TaskGroupStatus.FAILED_START_ERROR:
      return "Start error";
    case TaskGroupStatus.FAILED_START_TIMEOUT:
      return "Start timeout";
    case TaskGroupStatus.FAILED_PREEMPTED:
      return "Preempted";
    default:
      return task.failure_message?.slice(0, 15) || "Failed";
  }
}

interface GroupNodeProps {
  data: GroupNodeData;
}

export function GroupNode({ data }: GroupNodeProps) {
  const {
    group,
    isSelected,
    isExpanded,
    layoutDirection,
    onSelectTask,
    onToggleExpand,
    nodeWidth,
    nodeHeight,
  } = data;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Smart scroll handling - only capture wheel when content is scrollable
  useSmartScroll(scrollContainerRef);

  const tasks = group.tasks || [];
  const totalCount = tasks.length;
  const isSingleTask = totalCount === 1;
  const hasManyTasks = totalCount > 1;

  // For single-task nodes, use the task's status; for multi-task, use group status
  const primaryTask = tasks[0];
  const displayStatus = isSingleTask && primaryTask ? primaryTask.status : group.status;
  const category = getStatusCategory(displayStatus);
  const style = getStatusStyle(displayStatus);

  // Virtualization for large task lists
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TASK_ROW_HEIGHT,
    overscan: 5,
  });

  // Get hint text based on status
  const hintText = useMemo(
    () => getStatusHint(group, primaryTask, isSingleTask),
    [group, primaryTask, isSingleTask]
  );

  // Display name: task name for single-task, group name for multi-task
  const displayName = isSingleTask && primaryTask ? primaryTask.name : group.name;

  // Handle positions based on layout direction
  const isVertical = layoutDirection === "TB";
  const targetPosition = isVertical ? Position.Top : Position.Left;
  const sourcePosition = isVertical ? Position.Bottom : Position.Right;

  // Event handlers
  const handleNodeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (hasManyTasks) {
        onToggleExpand(group.name);
      } else if (tasks[0]) {
        onSelectTask(tasks[0], group);
      }
    },
    [hasManyTasks, group, tasks, onToggleExpand, onSelectTask]
  );

  const handleExpandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(group.name);
    },
    [group.name, onToggleExpand]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (hasManyTasks) {
          onToggleExpand(group.name);
        } else if (tasks[0]) {
          onSelectTask(tasks[0], group);
        }
      }
    },
    [hasManyTasks, group, tasks, onToggleExpand, onSelectTask]
  );

  const handleTaskClick = useCallback(
    (e: React.MouseEvent, task: TaskQueryResponse) => {
      e.stopPropagation();
      onSelectTask(task, group);
    },
    [group, onSelectTask]
  );

  const handleTaskKeyDown = useCallback(
    (e: React.KeyboardEvent, task: TaskQueryResponse) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectTask(task, group);
      }
    },
    [group, onSelectTask]
  );

  // Accessibility labels
  const ariaLabel = isSingleTask
    ? `${displayName}, ${getStatusLabel(displayStatus)}`
    : `${displayName}, ${getStatusLabel(displayStatus)}, ${totalCount} tasks`;
  const expandLabel = isExpanded ? "Collapse task list" : "Expand task list";

  return (
    <div
      className={cn(
        "rounded-lg border-2 backdrop-blur-sm transition-all duration-200 flex flex-col",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950",
        style.bg,
        style.border,
        isSelected && "ring-2 ring-cyan-500 ring-offset-2 ring-offset-zinc-950",
        category === "running" && "shadow-[0_0_20px_rgba(59,130,246,0.3)]",
        category === "failed" && "shadow-[0_0_20px_rgba(239,68,68,0.3)]"
      )}
      style={{ width: nodeWidth, height: nodeHeight }}
      role="treeitem"
      aria-label={ariaLabel}
      aria-expanded={hasManyTasks ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Handles */}
      <Handle
        type="target"
        position={targetPosition}
        id="target"
        className="!bg-zinc-600 !border-zinc-500 !w-3 !h-3"
        style={isVertical ? { left: "50%" } : { top: "50%" }}
        aria-hidden="true"
      />
      <Handle
        type="source"
        position={sourcePosition}
        id="source"
        className="!bg-zinc-600 !border-zinc-500 !w-3 !h-3"
        style={isVertical ? { left: "50%" } : { top: "50%" }}
        aria-hidden="true"
      />

      {/* Header */}
      <div
        className={cn(
          "px-3 cursor-pointer select-none flex-shrink-0 flex flex-col justify-center",
          !isExpanded && "h-full"
        )}
        style={{ height: isExpanded ? NODE_HEADER_HEIGHT : undefined }}
        onClick={handleNodeClick}
      >
        <div className="flex items-center gap-2">
          {hasManyTasks && (
            <button
              onClick={handleExpandClick}
              className="p-0.5 rounded hover:bg-zinc-700/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
              aria-label={expandLabel}
              aria-expanded={isExpanded}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden="true" />
              )}
            </button>
          )}
          {getStatusIcon(displayStatus, "h-4 w-4")}
          <span className="font-medium text-sm text-zinc-100 truncate flex-1">
            {displayName}
          </span>
        </div>

        {/* Always show hint below name */}
        <div className={cn("text-xs mt-1 truncate", style.text, hasManyTasks && "ml-7")}>
          {hintText}
        </div>
      </div>

      {/* Virtualized task list */}
      {isExpanded && hasManyTasks && (
        <div
          ref={scrollContainerRef}
          className="border-t border-zinc-700/50 px-2 py-2 flex-1 min-h-0 overflow-y-auto"
          role="list"
          aria-label={`Tasks in ${group.name}`}
        >
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const task = tasks[virtualRow.index];
              const taskStyle = getStatusStyle(task.status);
              const taskDuration = calculateDuration(task.start_time, task.end_time);

              return (
                <button
                  key={`${task.name}-${task.retry_id}`}
                  className={cn(
                    "absolute left-0 w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-left",
                    "hover:bg-zinc-700/50 transition-colors cursor-pointer",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-inset"
                  )}
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  onClick={(e) => handleTaskClick(e, task)}
                  onKeyDown={(e) => handleTaskKeyDown(e, task)}
                  role="listitem"
                  aria-label={`${task.name}, ${getStatusLabel(task.status)}`}
                >
                  {getStatusIcon(task.status, "h-3 w-3")}
                  <span className="flex-1 truncate text-zinc-300">{task.name}</span>
                  <span className={cn("tabular-nums", taskStyle.text)}>
                    {formatDuration(taskDuration)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// Export node types map for ReactFlow
export const nodeTypes = {
  collapsibleGroup: GroupNode,
};
