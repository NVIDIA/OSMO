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
 * Workflow DAG Constants
 *
 * Workflow-specific constants for the DAG visualization.
 * Generic DAG constants are available from @/components/dag.
 */

// ============================================================================
// Workflow-Specific Dimensions
// ============================================================================

/** Task row height in pixels */
export const TASK_ROW_HEIGHT = 28;

/** Table row height in pixels (for GroupPanel) */
export const TABLE_ROW_HEIGHT = 40;

/** Padding for task list container (pixels) */
export const TASK_LIST_PADDING = 16;

/** Header height for expanded nodes (pixels) */
export const NODE_HEADER_HEIGHT = 68;

/** Action bar height (Show/Hide tasks bar) in pixels */
export const NODE_ACTION_BAR_HEIGHT = 28;

/** Node border width for dimension calculations */
export const NODE_BORDER_WIDTH = 3; // 1.5px border * 2 sides

// ============================================================================
// Auto-collapse Thresholds
// ============================================================================

/** Collapse groups with this many or more tasks */
export const AUTO_COLLAPSE_TASK_THRESHOLD = 20;

/** Collapse all groups if there are this many or more groups */
export const AUTO_COLLAPSE_GROUP_THRESHOLD = 10;

// ============================================================================
// Status Category Types
// ============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed";

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

// ============================================================================
// Status Styling
// ============================================================================

/**
 * Status category styling for nodes and UI elements.
 */
export const STATUS_STYLES = {
  waiting: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    border: "border-gray-300 dark:border-zinc-600",
    text: "text-gray-500 dark:text-zinc-400",
    dot: "bg-gray-400 dark:bg-zinc-500",
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

// ============================================================================
// Virtualization
// ============================================================================

/** Number of items to render outside the visible area */
export const VIRTUAL_OVERSCAN = 5;
