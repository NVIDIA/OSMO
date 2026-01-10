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
 * Task/Group Status Utilities
 *
 * Single source of truth for TaskGroupStatus (task and group statuses within a workflow).
 * Used by the workflow detail view (`/workflows/[name]`).
 *
 * Note: Workflow-level status utilities (WorkflowStatus for the workflows list) are in
 * `../../../lib/workflow-constants.ts`. These are separate because:
 * 1. They operate on different API types (TaskGroupStatus vs WorkflowStatus)
 * 2. They have different status values and mappings
 * 3. Workflow detail needs extra fields (color, strokeColor) for ReactFlow rendering
 */

"use client";

import { memo } from "react";
import { Clock, Loader2, CheckCircle, XCircle, AlertCircle, Check, Circle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskGroupStatus } from "@/lib/api/generated";
import type { GroupNodeData } from "./dag-layout";

// =============================================================================
// Status Category Types
// =============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed";

// =============================================================================
// Bitwise Status Flags (for O(1) category checks)
// =============================================================================

/**
 * Status category bitmasks for fast category checking.
 * Using powers of 2 allows bitwise AND for instant category membership tests.
 *
 * Performance: Bitwise operations are ~10x faster than string comparisons
 * because they operate on CPU registers without memory allocation.
 */
const STATUS_FLAG_WAITING = 0b0001;
const STATUS_FLAG_RUNNING = 0b0010;
const STATUS_FLAG_COMPLETED = 0b0100;
const STATUS_FLAG_FAILED = 0b1000;

/**
 * Pre-computed status bitmask lookup.
 * Maps status string to its category bitmask for O(1) bitwise checks.
 */
const STATUS_BITMASK: Record<string, number> = {
  // Waiting states
  SUBMITTING: STATUS_FLAG_WAITING,
  WAITING: STATUS_FLAG_WAITING,
  PROCESSING: STATUS_FLAG_WAITING,
  SCHEDULING: STATUS_FLAG_WAITING,
  // Running states
  INITIALIZING: STATUS_FLAG_RUNNING,
  RUNNING: STATUS_FLAG_RUNNING,
  // Completed states
  COMPLETED: STATUS_FLAG_COMPLETED,
  RESCHEDULED: STATUS_FLAG_COMPLETED,
  // Failed states - use bitwise OR for failed (most common check)
  FAILED: STATUS_FLAG_FAILED,
  FAILED_CANCELED: STATUS_FLAG_FAILED,
  FAILED_SERVER_ERROR: STATUS_FLAG_FAILED,
  FAILED_BACKEND_ERROR: STATUS_FLAG_FAILED,
  FAILED_EXEC_TIMEOUT: STATUS_FLAG_FAILED,
  FAILED_QUEUE_TIMEOUT: STATUS_FLAG_FAILED,
  FAILED_IMAGE_PULL: STATUS_FLAG_FAILED,
  FAILED_UPSTREAM: STATUS_FLAG_FAILED,
  FAILED_EVICTED: STATUS_FLAG_FAILED,
  FAILED_START_ERROR: STATUS_FLAG_FAILED,
  FAILED_START_TIMEOUT: STATUS_FLAG_FAILED,
  FAILED_PREEMPTED: STATUS_FLAG_FAILED,
};

/** Fast bitwise check if status is failed */
export const isFailedFast = (status: string): boolean => ((STATUS_BITMASK[status] ?? 0) & STATUS_FLAG_FAILED) !== 0;

/** Fast bitwise check if status is running */
export const isRunningFast = (status: string): boolean => ((STATUS_BITMASK[status] ?? 0) & STATUS_FLAG_RUNNING) !== 0;

/** Fast bitwise check if status is completed */
export const isCompletedFast = (status: string): boolean =>
  ((STATUS_BITMASK[status] ?? 0) & STATUS_FLAG_COMPLETED) !== 0;

/** Fast bitwise check if status is waiting */
export const isWaitingFast = (status: string): boolean => ((STATUS_BITMASK[status] ?? 0) & STATUS_FLAG_WAITING) !== 0;

/**
 * Pre-computed status category lookup for O(1) access.
 */
export const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {
  // Waiting states
  SUBMITTING: "waiting",
  WAITING: "waiting",
  PROCESSING: "waiting",
  SCHEDULING: "waiting",
  // Running states
  INITIALIZING: "running",
  RUNNING: "running",
  // Completed states
  COMPLETED: "completed",
  RESCHEDULED: "completed",
  // Failed states
  FAILED: "failed",
  FAILED_CANCELED: "failed",
  FAILED_SERVER_ERROR: "failed",
  FAILED_BACKEND_ERROR: "failed",
  FAILED_EXEC_TIMEOUT: "failed",
  FAILED_QUEUE_TIMEOUT: "failed",
  FAILED_IMAGE_PULL: "failed",
  FAILED_UPSTREAM: "failed",
  FAILED_EVICTED: "failed",
  FAILED_START_ERROR: "failed",
  FAILED_START_TIMEOUT: "failed",
  FAILED_PREEMPTED: "failed",
} as const;

/**
 * Pre-computed sort order for status (failures first, completed last).
 */
export const STATUS_SORT_ORDER: Record<string, number> = {
  FAILED: 0,
  FAILED_CANCELED: 1,
  FAILED_SERVER_ERROR: 2,
  FAILED_BACKEND_ERROR: 3,
  FAILED_EXEC_TIMEOUT: 4,
  FAILED_QUEUE_TIMEOUT: 5,
  FAILED_IMAGE_PULL: 6,
  FAILED_UPSTREAM: 7,
  FAILED_EVICTED: 8,
  FAILED_START_ERROR: 9,
  FAILED_START_TIMEOUT: 10,
  FAILED_PREEMPTED: 11,
  RUNNING: 12,
  INITIALIZING: 13,
  PROCESSING: 14,
  SCHEDULING: 15,
  SUBMITTING: 16,
  WAITING: 17,
  RESCHEDULED: 18,
  COMPLETED: 19,
} as const;

/**
 * Human-readable labels for statuses.
 */
export const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  RESCHEDULED: "Rescheduled",
  RUNNING: "Running",
  INITIALIZING: "Initializing",
  FAILED: "Failed",
  FAILED_CANCELED: "Canceled",
  FAILED_SERVER_ERROR: "Server Error",
  FAILED_BACKEND_ERROR: "Backend Error",
  FAILED_EXEC_TIMEOUT: "Exec Timeout",
  FAILED_QUEUE_TIMEOUT: "Queue Timeout",
  FAILED_IMAGE_PULL: "Image Pull",
  FAILED_UPSTREAM: "Upstream",
  FAILED_EVICTED: "Evicted",
  FAILED_START_ERROR: "Start Error",
  FAILED_START_TIMEOUT: "Start Timeout",
  FAILED_PREEMPTED: "Preempted",
  WAITING: "Waiting",
  SCHEDULING: "Scheduling",
  SUBMITTING: "Submitting",
  PROCESSING: "Processing",
} as const;

// =============================================================================
// Status Styling (Tailwind classes)
// =============================================================================

/**
 * Status category styling using Tailwind classes.
 * The `color` and `strokeColor` are hex values needed for ReactFlow edges/minimap.
 */
export const STATUS_STYLES = {
  waiting: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    border: "border-gray-300 dark:border-zinc-600",
    text: "text-gray-500 dark:text-zinc-400",
    dot: "bg-gray-400 dark:bg-zinc-500",
    // Raw colors for ReactFlow (edges, minimap)
    color: "#71717a",
    strokeColor: "#52525b",
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    border: "border-blue-400 dark:border-blue-500",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
    color: "#3b82f6",
    strokeColor: "#1d4ed8",
  },
  completed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    border: "border-emerald-400 dark:border-emerald-600",
    text: "text-emerald-600 dark:text-emerald-400",
    dot: "bg-emerald-500",
    color: "#10b981",
    strokeColor: "#047857",
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-950/60",
    border: "border-red-400 dark:border-red-500",
    text: "text-red-600 dark:text-red-400",
    dot: "bg-red-500",
    color: "#ef4444",
    strokeColor: "#b91c1c",
  },
} as const;

// =============================================================================
// State Categories (for filtering)
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

/** Get the status category for a given status string. */
export function getStatusCategory(status: string): StatusCategory {
  return STATUS_CATEGORY_MAP[status] ?? "failed";
}

/**
 * Check if a status represents a failure state.
 * Uses bitwise lookup for O(1) performance instead of string.startsWith().
 */
export function isFailedStatus(status: string): boolean {
  return isFailedFast(status);
}

/** Get human-readable label for a status. */
export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Get styling for a status. */
export function getStatusStyle(status: string) {
  const category = getStatusCategory(status);
  return STATUS_STYLES[category];
}

// =============================================================================
// Status Icon Components (Optimized with Pre-rendering)
// =============================================================================

/** Icon configuration per category */
const ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  running: { Icon: Loader2, className: "text-blue-400 animate-spin motion-reduce:animate-none" },
  completed: { Icon: CheckCircle, className: "text-emerald-400" },
  failed: { Icon: XCircle, className: "text-red-400" },
};

/** Compact icon configuration for tables */
const COMPACT_ICON_CONFIG: Record<StatusCategory, { Icon: LucideIcon; className: string }> = {
  waiting: { Icon: Clock, className: "text-gray-400 dark:text-zinc-400" },
  running: { Icon: Loader2, className: "text-blue-500 animate-spin motion-reduce:animate-none" },
  completed: { Icon: Check, className: "text-emerald-500" },
  failed: { Icon: AlertCircle, className: "text-red-500" },
};

// =============================================================================
// Pre-rendered Icon Cache
//
// Instead of creating new React elements on every render, we pre-render
// icons for common sizes and cache them. This eliminates:
// - Object allocation for props
// - React.createElement calls
// - Reconciliation work for identical elements
// =============================================================================

/** Cache key format: "category:size" */
type IconCacheKey = `${StatusCategory}:${string}`;

/** Pre-rendered icon element cache (module-level singleton) */
const iconCache = new Map<IconCacheKey, React.ReactNode>();
const compactIconCache = new Map<IconCacheKey, React.ReactNode>();

/** Generate and cache a status icon */
function getCachedIcon(category: StatusCategory, size: string): React.ReactNode {
  const key: IconCacheKey = `${category}:${size}`;
  let cached = iconCache.get(key);
  if (!cached) {
    const { Icon, className: iconClass } = ICON_CONFIG[category];
    cached = (
      <Icon
        className={cn(size, iconClass)}
        aria-hidden="true"
      />
    );
    iconCache.set(key, cached);
  }
  return cached;
}

/** Generate and cache a compact status icon */
function getCachedCompactIcon(category: StatusCategory, size: string): React.ReactNode {
  const key: IconCacheKey = `${category}:${size}`;
  let cached = compactIconCache.get(key);
  if (!cached) {
    const config = COMPACT_ICON_CONFIG[category];
    const { Icon, className: iconClass } = config;
    cached = (
      <Icon
        className={cn(size, iconClass)}
        aria-hidden="true"
      />
    );
    compactIconCache.set(key, cached);
  }
  return cached;
}

interface StatusIconProps {
  status: string;
  size?: string;
  className?: string;
}

const StatusIconLucide = memo(function StatusIconLucide({ status, size = "size-4", className }: StatusIconProps) {
  const category = getStatusCategory(status);

  // Fast path: use cached icon if no custom className
  if (!className) {
    return getCachedIcon(category, size);
  }

  // Slow path: create new element with custom className
  const { Icon, className: iconClass } = ICON_CONFIG[category];
  return (
    <Icon
      className={cn(size, iconClass, className)}
      aria-hidden="true"
    />
  );
});

const StatusIconCompact = memo(function StatusIconCompact({ status, size = "size-3.5", className }: StatusIconProps) {
  const category = getStatusCategory(status);
  const config = COMPACT_ICON_CONFIG[category];
  if (!config) {
    return (
      <Circle
        className={cn(size, "text-gray-400 dark:text-zinc-400", className)}
        aria-hidden="true"
      />
    );
  }

  // Fast path: use cached icon if no custom className
  if (!className) {
    return getCachedCompactIcon(category, size);
  }

  // Slow path: create new element with custom className
  const { Icon, className: iconClass } = config;
  return (
    <Icon
      className={cn(size, iconClass, className)}
      aria-hidden="true"
    />
  );
});

/**
 * Get the appropriate status icon for a given status.
 *
 * Performance: Uses pre-rendered icon cache for common sizes.
 * First call for a category+size combo creates the element,
 * subsequent calls return the cached React element directly.
 */
export function getStatusIcon(status: string, size = "size-4") {
  return (
    <StatusIconLucide
      status={status}
      size={size}
    />
  );
}

/**
 * Get a compact status icon for table rows.
 *
 * Performance: Uses pre-rendered icon cache for common sizes.
 */
export function getStatusIconCompact(status: string, size = "size-3.5") {
  return (
    <StatusIconCompact
      status={status}
      size={size}
    />
  );
}

// =============================================================================
// Stats Computation (Optimized)
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
 *
 * Optimizations:
 * - Uses bitwise status checks instead of string comparisons
 * - Minimizes Map operations with local counter variables
 * - Avoids repeated property access with local variables
 * - Pre-parses dates only once per task
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

  const len = tasks.length;
  for (let i = 0; i < len; i++) {
    const task = tasks[i];
    const status = task.status;

    // Increment subStats counter (single Map operation)
    subStats.set(status, (subStats.get(status) ?? 0) + 1);

    // Use bitwise checks for category (faster than string comparison)
    if (isCompletedFast(status)) {
      completed++;
    } else if (isRunningFast(status)) {
      running++;
      hasRunning = true;
    } else if (isFailedFast(status)) {
      failed++;
    }

    // Parse timestamps (cache parsed values)
    const startTime = task.start_time;
    const endTime = task.end_time;

    if (startTime) {
      const t = Date.parse(startTime); // Date.parse is faster than new Date().getTime()
      if (earliestStart === null || t < earliestStart) earliestStart = t;
    }
    if (endTime) {
      const t = Date.parse(endTime);
      if (latestEnd === null || t > latestEnd) latestEnd = t;
    }
  }

  return {
    total: len,
    completed,
    running,
    failed,
    pending: len - completed - running - failed,
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

/** Compute group status from task stats. */
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

/** Compute group duration from task stats. */
export function computeGroupDuration(stats: TaskStats): number | null {
  if (stats.earliestStart === null) return null;
  const endTime = stats.hasRunning ? Date.now() : stats.latestEnd;
  if (endTime === null) return null;
  return Math.floor((endTime - stats.earliestStart) / 1000);
}

// =============================================================================
// MiniMap Color Helpers (for ReactFlow)
// =============================================================================

/** Get node fill color for MiniMap based on status. */
export function getMiniMapNodeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#52525b";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].color;
}

/** Get node stroke color for MiniMap based on status. */
export function getMiniMapStrokeColor(node: { data: unknown }): string {
  const data = node.data as GroupNodeData;
  if (!data?.group) return "#3f3f46";
  const category = getStatusCategory(data.group.status);
  return STATUS_STYLES[category].strokeColor;
}

// =============================================================================
// Cold Start Optimization: Prewarm Icon Cache
// =============================================================================

/**
 * Prewarm the icon cache during browser idle time.
 * This ensures icons are ready before they're needed, eliminating
 * first-render allocation overhead.
 */
function prewarmIconCache(): void {
  const categories: StatusCategory[] = ["waiting", "running", "completed", "failed"];
  const sizes = ["size-3", "size-3.5", "size-4"];

  for (const category of categories) {
    for (const size of sizes) {
      getCachedIcon(category, size);
      getCachedCompactIcon(category, size);
    }
  }
}

// Schedule prewarm during idle time after module load
if (typeof window !== "undefined") {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(() => prewarmIconCache(), { timeout: 3000 });
  } else {
    // Fallback for Safari
    setTimeout(prewarmIconCache, 200);
  }
}
