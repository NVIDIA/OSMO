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
 * Status Utilities
 *
 * Comprehensive status helpers for task/group status categorization, icons, and styling.
 * Single source of truth for all status-related functionality across the DAG.
 */

"use client";

import { memo } from "react";
import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Check, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  STATUS_STYLES,
  STATUS_CATEGORY_MAP,
  STATUS_SORT_ORDER,
  STATUS_LABELS,
  type StatusCategory,
} from "../constants";
import { TaskGroupStatus } from "@/lib/api/generated";

// =============================================================================
// Re-exports from constants for convenience
// =============================================================================

export { STATUS_STYLES, STATUS_CATEGORY_MAP, STATUS_SORT_ORDER, STATUS_LABELS };
export type { StatusCategory };

// =============================================================================
// State Categories (groupings of statuses for filtering)
// =============================================================================

export type StateCategory = "completed" | "running" | "failed" | "pending";

export const STATE_CATEGORIES: Record<StateCategory, Set<string>> = {
  completed: new Set([TaskGroupStatus.COMPLETED, TaskGroupStatus.RESCHEDULED]),
  running: new Set([TaskGroupStatus.RUNNING, TaskGroupStatus.INITIALIZING]),
  failed: new Set([
    TaskGroupStatus.FAILED,
    TaskGroupStatus.FAILED_CANCELED,
    TaskGroupStatus.FAILED_SERVER_ERROR,
    TaskGroupStatus.FAILED_BACKEND_ERROR,
    TaskGroupStatus.FAILED_EXEC_TIMEOUT,
    TaskGroupStatus.FAILED_QUEUE_TIMEOUT,
    TaskGroupStatus.FAILED_IMAGE_PULL,
    TaskGroupStatus.FAILED_UPSTREAM,
    TaskGroupStatus.FAILED_EVICTED,
    TaskGroupStatus.FAILED_START_ERROR,
    TaskGroupStatus.FAILED_START_TIMEOUT,
    TaskGroupStatus.FAILED_PREEMPTED,
  ]),
  pending: new Set([
    TaskGroupStatus.WAITING,
    TaskGroupStatus.SCHEDULING,
    TaskGroupStatus.SUBMITTING,
    TaskGroupStatus.PROCESSING,
  ]),
};

export const STATE_CATEGORY_NAMES: StateCategory[] = ["completed", "running", "failed", "pending"];

// =============================================================================
// Status Helper Functions
// =============================================================================

/**
 * Get the status category for a given status string.
 * Uses pre-computed lookup map for O(1) performance.
 */
export function getStatusCategory(status: string): StatusCategory {
  return STATUS_CATEGORY_MAP[status] ?? "failed";
}

/**
 * Check if a status represents a failure state.
 */
export function isFailedStatus(status: string): boolean {
  return typeof status === "string" && status.startsWith("FAILED");
}

/**
 * Get the sort order for a status (lower = appears first).
 */
export function getStatusOrder(status: string): number {
  return STATUS_SORT_ORDER[status] ?? 99;
}

/**
 * Check if a status matches a state category.
 */
export function statusMatchesState(status: string, state: string): boolean {
  const category = STATE_CATEGORIES[state.toLowerCase() as StateCategory];
  return category?.has(status) ?? false;
}

/**
 * Get human-readable label for a status.
 */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Get styling for a status category.
 */
export function getStatusStyle(status: string) {
  const category = getStatusCategory(status);
  return STATUS_STYLES[category];
}

/**
 * Get edge color for a status category.
 */
export function getEdgeColor(category: StatusCategory): string {
  return STATUS_STYLES[category].color;
}

// =============================================================================
// Status Display Configuration
// =============================================================================

/**
 * Status display configuration for DAG nodes and tasks.
 * Maps category to Icon component, label, and styling.
 */
export const StatusDisplay: Record<
  StatusCategory,
  {
    Icon: LucideIcon;
    label: string;
    iconClass: string;
    animate?: string;
  }
> = {
  waiting: {
    Icon: Clock,
    label: "Waiting",
    iconClass: "text-gray-400 dark:text-zinc-400",
  },
  running: {
    Icon: Loader2,
    label: "Running",
    iconClass: "text-blue-400",
    animate: "animate-spin motion-reduce:animate-none",
  },
  completed: {
    Icon: CheckCircle,
    label: "Completed",
    iconClass: "text-emerald-400",
  },
  failed: {
    Icon: XCircle,
    label: "Failed",
    iconClass: "text-red-400",
  },
} as const;

// =============================================================================
// Status Icon Components
// =============================================================================

interface StatusIconProps {
  status: string;
  size?: string;
  className?: string;
}

/**
 * Memoized status icon component using Lucide icons.
 * Prevents icon re-creation on every parent render.
 */
const StatusIconLucide = memo(function StatusIconLucide({ status, size = "h-4 w-4", className }: StatusIconProps) {
  const category = getStatusCategory(status);
  const { Icon, iconClass, animate } = StatusDisplay[category];

  return (
    <Icon
      className={cn(size, iconClass, animate, className)}
      aria-hidden="true"
    />
  );
});

/**
 * Compact status icon component for table rows.
 * Uses simpler icons optimized for smaller sizes.
 */
const StatusIconCompact = memo(function StatusIconCompact({
  status,
  size = "h-3.5 w-3.5",
  className,
}: StatusIconProps) {
  const category = getStatusCategory(status);

  switch (category) {
    case "completed":
      return (
        <Check
          className={cn(size, "text-emerald-500", className)}
          aria-hidden="true"
        />
      );
    case "running":
      return (
        <Loader2
          className={cn(size, "animate-spin text-blue-500 motion-reduce:animate-none", className)}
          aria-hidden="true"
        />
      );
    case "failed":
      return (
        <AlertCircle
          className={cn(size, "text-red-500", className)}
          aria-hidden="true"
        />
      );
    case "waiting":
      return (
        <Clock
          className={cn(size, "text-gray-400 dark:text-zinc-400", className)}
          aria-hidden="true"
        />
      );
    default:
      return (
        <Circle
          className={cn(size, "text-gray-400 dark:text-zinc-400", className)}
          aria-hidden="true"
        />
      );
  }
});

/**
 * Get the appropriate status icon for a given status.
 *
 * @param status - The status string from the backend
 * @param size - Tailwind size classes (default "h-4 w-4")
 * @returns JSX element for the status icon
 *
 * @example
 * ```tsx
 * {getStatusIcon(task.status, "h-3 w-3")}
 * ```
 */
export function getStatusIcon(status: string, size = "h-4 w-4") {
  return (
    <StatusIconLucide
      status={status}
      size={size}
    />
  );
}

/**
 * Get a compact status icon for table rows.
 */
export function getStatusIconCompact(status: string, size = "h-3.5 w-3.5") {
  return (
    <StatusIconCompact
      status={status}
      size={size}
    />
  );
}

// =============================================================================
// Stats Computation (single pass for all stats)
// =============================================================================

export interface TaskStats {
  total: number;
  completed: number;
  running: number;
  failed: number;
  pending: number;
  subStats: Map<string, number>;
  earliestStart: number | null;
  latestEnd: number | null;
  hasRunning: boolean;
}

/**
 * Compute all stats for a list of tasks in a single pass.
 * Highly optimized for performance with large task lists.
 */
export function computeTaskStats<T extends { status: string; start_time?: string | null; end_time?: string | null }>(
  tasks: T[],
): TaskStats {
  const subStats = new Map<string, number>();
  let completed = 0;
  let running = 0;
  let failed = 0;
  let earliestStart: number | null = null;
  let latestEnd: number | null = null;
  let hasRunning = false;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const status = task.status;

    subStats.set(status, (subStats.get(status) ?? 0) + 1);

    const cat = STATUS_CATEGORY_MAP[status];
    if (cat === "completed") completed++;
    else if (cat === "running") {
      running++;
      hasRunning = true;
    } else if (cat === "failed") failed++;

    if (task.start_time) {
      const t = new Date(task.start_time).getTime();
      if (earliestStart === null || t < earliestStart) earliestStart = t;
    }
    if (task.end_time) {
      const t = new Date(task.end_time).getTime();
      if (latestEnd === null || t > latestEnd) latestEnd = t;
    }
  }

  return {
    total: tasks.length,
    completed,
    running,
    failed,
    pending: tasks.length - completed - running - failed,
    subStats,
    earliestStart,
    latestEnd,
    hasRunning,
  };
}

export interface GroupStatus {
  status: "completed" | "running" | "failed" | "pending";
  label: string;
}

/**
 * Compute group status from task stats.
 */
export function computeGroupStatus(stats: TaskStats): GroupStatus {
  if (stats.completed === stats.total) {
    return { status: "completed", label: "Completed" };
  }
  if (stats.failed > 0) {
    return { status: "failed", label: stats.running > 0 ? "Running with failures" : "Failed" };
  }
  if (stats.running > 0) {
    return { status: "running", label: "Running" };
  }
  return { status: "pending", label: "Pending" };
}

/**
 * Compute group duration from task stats.
 */
export function computeGroupDuration(stats: TaskStats): number | null {
  if (stats.earliestStart === null) return null;
  const endTime = stats.hasRunning ? Date.now() : stats.latestEnd;
  if (endTime === null) return null;
  return Math.floor((endTime - stats.earliestStart) / 1000);
}

// =============================================================================
// MiniMap Color Helpers (pure functions for ReactFlow MiniMap)
// =============================================================================

// Import type for node data
import type { GroupNodeData } from "../types/dag-layout";

/**
 * Get node fill color for MiniMap based on status.
 * Pure function extracted outside component for performance.
 */
export function getMiniMapNodeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#52525b";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].color;
}

/**
 * Get node stroke color for MiniMap based on status.
 * Pure function extracted outside component for performance.
 */
export function getMiniMapStrokeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#3f3f46";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].strokeColor;
}
