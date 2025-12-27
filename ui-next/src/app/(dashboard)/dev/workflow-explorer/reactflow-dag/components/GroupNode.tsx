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
 * - Expand/collapse for multi-task groups
 * - Virtualized task list for large groups
 * - WCAG 2.1 AA accessibility
 * - Status-based styling
 */

"use client";

import { useRef, useCallback } from "react";
import { Handle, Position } from "@xyflow/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskQueryResponse } from "../../workflow-types";
import { TaskGroupStatus } from "../../workflow-types";
import type { GroupNodeData } from "../types";
import { getStatusIcon, getStatusCategory, getStatusStyle, getStatusLabel } from "../utils/status";
import { calculateDuration, formatDuration } from "../../workflow-types";
import {
  TASK_ROW_HEIGHT,
  NODE_HEADER_HEIGHT,
} from "../constants";

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

  const category = getStatusCategory(group.status);
  const style = getStatusStyle(group.status);

  const tasks = group.tasks || [];
  const totalCount = tasks.length;
  const hasManyTasks = totalCount > 1;

  // Virtualization for large task lists
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => TASK_ROW_HEIGHT,
    overscan: 5,
  });

  // Get representative info for collapsed view
  const runningTask = tasks.find((t) => getStatusCategory(t.status) === "running");
  const completedTask = tasks.find((t) => t.status === TaskGroupStatus.COMPLETED);
  const representativeTask = runningTask || completedTask || tasks[0];

  // Calculate total duration from start/end times
  const totalDuration = tasks.reduce((sum, t) => {
    const duration = calculateDuration(t.start_time, t.end_time);
    return sum + (duration || 0);
  }, 0);

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

  // Secondary info line content
  const getSecondaryInfo = () => {
    if (category === "waiting") {
      return "Waiting...";
    }
    if (category === "running") {
      const nodeName = representativeTask?.node_name;
      return nodeName ? `Running on ${nodeName}` : "Running...";
    }
    if (category === "failed") {
      return "Failed";
    }
    const nodeName = representativeTask?.node_name;
    const duration = totalDuration > 0 ? formatDuration(totalDuration) : null;
    if (nodeName && duration) {
      return `${nodeName} · ${duration}`;
    }
    return nodeName || duration || "Completed";
  };

  // Accessibility labels
  const ariaLabel = `${group.name}, ${getStatusLabel(group.status)}, ${totalCount} task${totalCount !== 1 ? "s" : ""}`;
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
          "px-3 py-2.5 cursor-pointer select-none flex-shrink-0",
          !isExpanded && "flex flex-col justify-center h-full"
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
          {getStatusIcon(group.status, "h-4 w-4")}
          <span className="font-medium text-sm text-zinc-100 truncate flex-1">
            {group.name}
          </span>
        </div>

        {!isExpanded && (
          <div className={cn("text-xs mt-1 truncate", style.text, hasManyTasks && "ml-7")}>
            {getSecondaryInfo()}
          </div>
        )}
      </div>

      {/* Virtualized task list */}
      {isExpanded && hasManyTasks && (
        <div
          ref={scrollContainerRef}
          className="nowheel border-t border-zinc-700/50 px-2 py-2 flex-1 min-h-0 overflow-y-auto"
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
