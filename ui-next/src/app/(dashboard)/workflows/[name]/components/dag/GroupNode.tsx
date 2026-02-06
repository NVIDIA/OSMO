// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * GroupNode Component
 *
 * Collapsible node component for DAG visualization.
 *
 * Features:
 * - Single-task nodes show task name directly (flattened)
 * - Multi-task nodes show group name with expand/collapse
 * - Status-specific hint text
 * - Virtualized task list for large groups
 * - WCAG 2.1 AA accessibility
 *
 * Navigation:
 * - Single-task node click → Opens DetailPanel
 * - Multi-task node click → Opens GroupPanel (with group task list)
 * - Task click in expanded list → Opens DetailPanel
 *
 * Performance:
 * - Memoized with React.memo to prevent unnecessary re-renders
 * - Uses static style objects to avoid allocation per render
 * - Virtualized task lists for large groups (TanStack Virtual)
 * - Data attributes for per-row handlers (avoids closure per row)
 * - Smart scroll handling with cached dimensions (ResizeObserver)
 * - Context-based callbacks to decouple from prop changes
 */

"use client";

import { useRef, useCallback, useMemo, useEffect, memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn, naturalCompare } from "@/lib/utils";
import { useTick } from "@/hooks/use-tick";
import { useVirtualizerCompat } from "@/hooks/use-virtualizer-compat";
import type { TaskQueryResponse, GroupWithLayout } from "../../lib/workflow-types";
import { TaskGroupStatus, isTaskFailed } from "../../lib/workflow-types";
import type { GroupNodeData } from "../../lib/dag-layout";
import { useDAGContext } from "./dag-context";
import { getStatusIcon, getStatusCategory, getStatusLabel } from "../../lib/status";
import { calculateDuration, formatDuration } from "../../lib/workflow-types";
import { HANDLE_OFFSET } from "@/components/dag/constants";
import { TASK_ROW_HEIGHT, NODE_HEADER_HEIGHT } from "../../lib/dag-layout";

// ============================================================================
// Static Style Objects (Avoid Object Allocation in Render)
// ============================================================================

/** Pre-computed handle position styles to avoid object allocation per render */
const HANDLE_STYLES = {
  targetVertical: { top: -HANDLE_OFFSET } as const,
  targetHorizontal: { left: -HANDLE_OFFSET } as const,
  sourceVertical: { bottom: -HANDLE_OFFSET } as const,
  sourceHorizontal: { right: -HANDLE_OFFSET } as const,
} as const;

/** Pre-computed header height style */
const HEADER_STYLE = { height: NODE_HEADER_HEIGHT } as const;

// ============================================================================
// Smart Scroll Handler (Optimized)
// ============================================================================

/**
 * Hook to handle wheel events with optimized boundary detection.
 *
 * Performance optimizations:
 * - Uses bitwise operations for boundary checks where possible
 * - Caches scroll dimensions to avoid layout thrashing
 * - Uses local variables to minimize property access
 *
 * Behavior:
 * - Horizontal scroll (deltaX) → always pass through for panning
 * - Vertical scroll (deltaY) → capture for list scrolling, pass through at boundaries
 */
function useSmartScroll(ref: React.RefObject<HTMLDivElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive) return;

    const element = ref.current;
    if (!element) return;

    // Cache scroll dimensions (updated on resize via ResizeObserver)
    let cachedScrollHeight = element.scrollHeight;
    let cachedClientHeight = element.clientHeight;

    // Update cache when element resizes
    const resizeObserver = new ResizeObserver(() => {
      cachedScrollHeight = element.scrollHeight;
      cachedClientHeight = element.clientHeight;
    });
    resizeObserver.observe(element);

    const handleWheel = (e: WheelEvent) => {
      // Fast path: horizontal scroll → let it pan (use local vars)
      const deltaX = e.deltaX;
      const deltaY = e.deltaY;

      // Bitwise abs comparison (avoids Math.abs call)
      // |deltaX| > |deltaY| → horizontal dominant
      if (deltaX * deltaX > deltaY * deltaY) {
        return;
      }

      // Use cached dimensions (avoids layout read)
      const scrollTop = element.scrollTop;
      const maxScroll = cachedScrollHeight - cachedClientHeight;

      // Boundary checks with early returns
      // At top and scrolling up → let it pan
      if (scrollTop <= 0 && deltaY < 0) {
        return;
      }
      // At bottom and scrolling down → let it pan (use >= instead of > for tolerance)
      if (scrollTop >= maxScroll - 1 && deltaY > 0) {
        return;
      }

      // Vertical scroll in the middle → capture for list scrolling
      e.stopPropagation();
    };

    // Note: Cannot use passive: true here because we call stopPropagation
    element.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      element.removeEventListener("wheel", handleWheel);
      resizeObserver.disconnect();
    };
  }, [ref, isActive]);
}

// ============================================================================
// Status Hint Text
// ============================================================================

/**
 * Get status-specific hint text for display in the node.
 * @param now - Synchronized tick timestamp for live duration calculation
 */
function getStatusHint(
  group: GroupWithLayout,
  task: TaskQueryResponse | undefined,
  isSingleTask: boolean,
  now: number,
): string {
  const tasks = group.tasks || [];
  const taskCount = tasks.length;

  // Count failures for multi-task groups
  const failedTasks = tasks.filter((t) => isTaskFailed(t.status));
  const failedCount = failedTasks.length;

  // For multi-task with failures, always show failure count
  if (!isSingleTask && failedCount > 0) {
    if (failedCount === taskCount) {
      const firstFailed = failedTasks[0];
      const failureHint = getFailureHint(firstFailed);
      return `Failed · ${failureHint}`;
    }
    return `${failedCount} of ${taskCount} failed`;
  }

  // Use task status for single-task, group status for multi-task
  const status = isSingleTask && task ? task.status : group.status;

  switch (status) {
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

    case TaskGroupStatus.INITIALIZING:
      return isSingleTask ? "Starting up..." : `Starting ${taskCount} tasks...`;

    case TaskGroupStatus.RUNNING: {
      const startTime = isSingleTask ? task?.start_time : group.start_time;
      const elapsed = calculateDuration(startTime, null, now);
      return `Running · ${formatDuration(elapsed)}`;
    }

    case TaskGroupStatus.COMPLETED: {
      const startTime = isSingleTask ? task?.start_time : group.start_time;
      const endTime = isSingleTask ? task?.end_time : group.end_time;
      const duration = calculateDuration(startTime, endTime, now);
      return formatDuration(duration);
    }

    case TaskGroupStatus.RESCHEDULED: {
      const retryId = task?.retry_id || 0;
      return retryId > 0 ? `Retrying... (attempt ${retryId + 1})` : "Retrying...";
    }

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

/**
 * Memoized GroupNode component.
 * Only re-renders when data props actually change.
 */
export const GroupNode = memo(function GroupNode({ data }: GroupNodeProps) {
  const { group, isExpanded, layoutDirection, nodeWidth, nodeHeight, hasIncomingEdges, hasOutgoingEdges } = data;

  // Get handlers and selection state from context (not props) to prevent re-renders
  const { selectedNodeId, onSelectGroup, onSelectTask, onToggleExpand } = useDAGContext();

  // Synchronized tick for live durations (all nodes update together)
  const now = useTick();

  // Determine if this node is selected (based on URL navigation state via context)
  const isSelected = group.name === selectedNodeId;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Memoize tasks array with natural sort order
  const tasks = useMemo(() => [...(group.tasks || [])].sort((a, b) => naturalCompare(a.name, b.name)), [group.tasks]);
  const totalCount = tasks.length;
  const isSingleTask = totalCount === 1;
  const hasManyTasks = totalCount > 1;

  // Smart scroll handling
  useSmartScroll(scrollContainerRef, isExpanded && hasManyTasks);

  // For single-task nodes, use the task's status
  const primaryTask = tasks[0];
  const displayStatus = isSingleTask && primaryTask ? primaryTask.status : group.status;
  const category = getStatusCategory(displayStatus);

  // Virtualization for large task lists
  const virtualizer = useVirtualizerCompat({
    count: tasks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TASK_ROW_HEIGHT,
    overscan: 5,
  });

  // Get hint text based on status (uses synchronized tick for running durations)
  const hintText = useMemo(
    () => getStatusHint(group, primaryTask, isSingleTask, now),
    [group, primaryTask, isSingleTask, now],
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
        // Multi-task group → Open GroupPanel
        onSelectGroup(group);
      } else if (tasks[0]) {
        // Single-task → Open DetailPanel
        onSelectTask(tasks[0], group);
      }
    },
    [hasManyTasks, group, tasks, onSelectGroup, onSelectTask],
  );

  const handleExpandClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(group.name);
    },
    [group.name, onToggleExpand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (hasManyTasks) {
          onSelectGroup(group);
        } else if (tasks[0]) {
          onSelectTask(tasks[0], group);
        }
      }
    },
    [hasManyTasks, group, tasks, onSelectGroup, onSelectTask],
  );

  // Optimized task handlers using data attributes to avoid per-row closures
  // The task index is stored in data-task-index and looked up from the tasks array
  const handleTaskClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      e.stopPropagation();
      const index = Number(e.currentTarget.dataset.taskIndex);
      const task = tasks[index];
      if (task) {
        onSelectTask(task, group);
      }
    },
    [tasks, group, onSelectTask],
  );

  const handleTaskKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const index = Number(e.currentTarget.dataset.taskIndex);
        const task = tasks[index];
        if (task) {
          onSelectTask(task, group);
        }
      }
    },
    [tasks, group, onSelectTask],
  );

  // Accessibility labels
  const ariaLabel = isSingleTask
    ? `${displayName}, ${getStatusLabel(displayStatus)}`
    : `${displayName}, ${getStatusLabel(displayStatus)}, ${totalCount} tasks`;

  return (
    <div
      className={cn(
        "dag-node relative flex flex-col rounded-lg border-[1.5px]",
        "focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white focus-visible:outline-none dark:focus-visible:ring-offset-zinc-950",
      )}
      style={{ width: nodeWidth, height: nodeHeight }}
      data-status={category}
      data-selected={isSelected}
      role="treeitem"
      aria-label={ariaLabel}
      aria-expanded={hasManyTasks ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {/* Task count badge for multi-task groups */}
      {hasManyTasks && (
        <span
          className="dag-count-badge"
          aria-label={`${totalCount} tasks`}
        >
          {totalCount}
        </span>
      )}

      {/* Handles - use static style objects to avoid allocation */}
      {hasIncomingEdges && (
        <Handle
          type="target"
          position={targetPosition}
          id="target"
          className="dag-handle"
          style={isVertical ? HANDLE_STYLES.targetVertical : HANDLE_STYLES.targetHorizontal}
          aria-hidden="true"
        />
      )}
      {hasOutgoingEdges && (
        <Handle
          type="source"
          position={sourcePosition}
          id="source"
          className="dag-handle"
          style={isVertical ? HANDLE_STYLES.sourceVertical : HANDLE_STYLES.sourceHorizontal}
          aria-hidden="true"
        />
      )}

      {/* Header */}
      <div
        className={cn(
          "flex shrink-0 cursor-pointer flex-col justify-center px-3 select-none",
          !isExpanded && !hasManyTasks && "flex-1 py-3",
          !isExpanded && hasManyTasks && "pt-3 pb-1.5",
          isExpanded && hasManyTasks && "dag-node-header-expanded py-3",
        )}
        style={isExpanded && hasManyTasks ? HEADER_STYLE : undefined}
        onClick={handleNodeClick}
      >
        <div className="flex items-center gap-2">
          {getStatusIcon(displayStatus, "size-4")}
          <span className="flex-1 truncate text-sm font-medium text-gray-900 dark:text-zinc-100">{displayName}</span>
        </div>

        {/* Hint below name */}
        <div className="dag-node-hint mt-1 truncate text-xs">{hintText}</div>
      </div>

      {/* Expand lip - shown when collapsed and has many tasks */}
      {!isExpanded && hasManyTasks && (
        <button
          onClick={handleExpandClick}
          className="mt-auto flex h-5 shrink-0 items-center justify-center rounded-b-[6.5px] text-gray-400 transition-colors hover:bg-gray-100/50 hover:text-gray-600 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset dark:text-zinc-500 dark:hover:bg-zinc-700/30 dark:hover:text-zinc-300"
          aria-label={`Expand to show ${tasks.length} tasks`}
          aria-expanded={false}
        >
          <ChevronDown
            className="size-3"
            aria-hidden="true"
          />
          <span className="sr-only">Show {tasks.length} tasks</span>
        </button>
      )}

      {/* Virtualized task list */}
      {isExpanded && hasManyTasks && (
        <div
          ref={scrollContainerRef}
          className="dag-scroll-container min-h-0 flex-1 overflow-y-auto border-t border-gray-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
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
              const taskCategory = getStatusCategory(task.status);
              const taskDuration = calculateDuration(task.start_time, task.end_time, now);

              return (
                <button
                  key={`${task.name}-${task.retry_id}`}
                  className="dag-task-row absolute left-0 flex w-full cursor-pointer items-center gap-2 border-b border-gray-100 px-3 py-1.5 text-left text-xs transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset dark:border-zinc-800 dark:hover:bg-zinc-800/50"
                  style={{
                    height: `${virtualRow.size}px`,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  data-status={taskCategory}
                  data-task-index={virtualRow.index}
                  onClick={handleTaskClick}
                  onKeyDown={handleTaskKeyDown}
                  role="listitem"
                  aria-label={`${task.name}, ${getStatusLabel(task.status)}`}
                >
                  {getStatusIcon(task.status, "size-3")}
                  <div className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate text-gray-700 dark:text-zinc-300">{task.name}</span>
                    {task.lead && (
                      <span className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-medium tracking-wide text-amber-700 uppercase ring-1 ring-amber-600/20 ring-inset dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/30">
                        Lead
                      </span>
                    )}
                  </div>
                  <span className="dag-task-duration tabular-nums">{formatDuration(taskDuration)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Collapse lip - shown when expanded and has many tasks */}
      {isExpanded && hasManyTasks && (
        <button
          onClick={handleExpandClick}
          className="dag-collapse-lip flex h-5 shrink-0 items-center justify-center rounded-b-[6.5px] text-gray-500 transition-colors hover:bg-gray-100/50 hover:text-gray-700 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none focus-visible:ring-inset dark:text-zinc-400 dark:hover:bg-zinc-700/30 dark:hover:text-zinc-200"
          aria-label="Collapse task list"
          aria-expanded={true}
        >
          <ChevronUp
            className="size-3"
            aria-hidden="true"
          />
          <span className="sr-only">Hide tasks</span>
        </button>
      )}
    </div>
  );
});

// Export node types map for ReactFlow
export const nodeTypes = {
  collapsibleGroup: GroupNode,
};
