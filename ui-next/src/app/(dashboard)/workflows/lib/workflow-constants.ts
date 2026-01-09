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
 * Workflow Status Constants
 *
 * Single source of truth for workflow status styling and categorization.
 * Aligned with the DAG visualizer constants for consistency.
 */

import type { WorkflowStatus } from "@/lib/api/generated";

// =============================================================================
// Status Categories
// =============================================================================

export type StatusCategory = "waiting" | "running" | "completed" | "failed" | "unknown";

/**
 * Map workflow status to display category.
 * Categories are used for styling and grouping.
 */
export const STATUS_CATEGORY_MAP: Record<WorkflowStatus, StatusCategory> = {
  // Waiting states
  PENDING: "waiting",
  WAITING: "waiting",
  // Running states
  RUNNING: "running",
  // Completed states
  COMPLETED: "completed",
  // Failed states
  FAILED: "failed",
  FAILED_SUBMISSION: "failed",
  FAILED_SERVER_ERROR: "failed",
  FAILED_EXEC_TIMEOUT: "failed",
  FAILED_QUEUE_TIMEOUT: "failed",
  FAILED_CANCELED: "failed",
  FAILED_BACKEND_ERROR: "failed",
  FAILED_IMAGE_PULL: "failed",
  FAILED_EVICTED: "failed",
  FAILED_START_ERROR: "failed",
  FAILED_START_TIMEOUT: "failed",
  FAILED_PREEMPTED: "failed",
};

/**
 * Human-readable labels for workflow statuses (lowercase, actual status names).
 */
export const STATUS_LABELS: Record<WorkflowStatus, string> = {
  PENDING: "Pending",
  WAITING: "Waiting",
  RUNNING: "Running",
  COMPLETED: "Completed",
  FAILED: "Failed",
  FAILED_SUBMISSION: "Failed: Submission",
  FAILED_SERVER_ERROR: "Failed: Server Error",
  FAILED_EXEC_TIMEOUT: "Failed: Exec Timeout",
  FAILED_QUEUE_TIMEOUT: "Failed: Queue Timeout",
  FAILED_CANCELED: "Failed: Canceled",
  FAILED_BACKEND_ERROR: "Failed: Backend Error",
  FAILED_IMAGE_PULL: "Failed: Image Pull",
  FAILED_EVICTED: "Failed: Evicted",
  FAILED_START_ERROR: "Failed: Start Error",
  FAILED_START_TIMEOUT: "Failed: Start Timeout",
  FAILED_PREEMPTED: "Failed: Preempted",
};

/**
 * Get status display info (category and label).
 * Falls back to "Unknown" category for unrecognized statuses.
 */
export function getStatusDisplay(status: WorkflowStatus): { category: StatusCategory; label: string } {
  return {
    category: STATUS_CATEGORY_MAP[status] ?? "unknown",
    label: STATUS_LABELS[status] ?? status,
  };
}

// =============================================================================
// Status Styling
// =============================================================================

/**
 * Status category styling for badges and UI elements.
 * Uses Tailwind classes for light/dark mode support.
 */
export const STATUS_STYLES: Record<
  StatusCategory,
  {
    bg: string;
    text: string;
    icon: string;
    dot: string;
    border: string;
  }
> = {
  waiting: {
    bg: "bg-gray-100 dark:bg-zinc-800/60",
    text: "text-gray-600 dark:text-zinc-400",
    icon: "text-gray-500 dark:text-zinc-500",
    dot: "bg-gray-400 dark:bg-zinc-500",
    border: "border-gray-300 dark:border-zinc-600",
  },
  running: {
    bg: "bg-blue-50 dark:bg-blue-950/60",
    text: "text-blue-700 dark:text-blue-400",
    icon: "text-blue-500 dark:text-blue-400",
    dot: "bg-blue-500",
    border: "border-blue-400 dark:border-blue-500",
  },
  completed: {
    bg: "bg-emerald-50 dark:bg-emerald-950/60",
    text: "text-emerald-700 dark:text-emerald-400",
    icon: "text-emerald-500 dark:text-emerald-400",
    dot: "bg-emerald-500",
    border: "border-emerald-400 dark:border-emerald-600",
  },
  failed: {
    bg: "bg-red-50 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    icon: "text-red-500 dark:text-red-400",
    dot: "bg-red-500",
    border: "border-red-400 dark:border-red-500",
  },
  unknown: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    text: "text-amber-700 dark:text-amber-400",
    icon: "text-amber-500 dark:text-amber-400",
    dot: "bg-amber-500",
    border: "border-amber-400 dark:border-amber-500",
  },
};

// =============================================================================
// Priority Styling
// =============================================================================

export type Priority = "HIGH" | "NORMAL" | "LOW";

const VALID_PRIORITIES: ReadonlySet<string> = new Set(["HIGH", "NORMAL", "LOW"]);

/** Type guard for Priority */
function isPriority(value: string): value is Priority {
  return VALID_PRIORITIES.has(value);
}

export const PRIORITY_STYLES: Record<
  Priority,
  {
    bg: string;
    text: string;
    label: string;
  }
> = {
  HIGH: {
    bg: "bg-red-100 dark:bg-red-950/60",
    text: "text-red-700 dark:text-red-400",
    label: "High",
  },
  NORMAL: {
    bg: "bg-zinc-100 dark:bg-zinc-800/60",
    text: "text-zinc-600 dark:text-zinc-400",
    label: "Normal",
  },
  LOW: {
    bg: "bg-zinc-100 dark:bg-zinc-800/60",
    text: "text-zinc-500 dark:text-zinc-500",
    label: "Low",
  },
};

export function getPriorityDisplay(priority: string): { label: string; bg: string; text: string } {
  const normalized = priority.toUpperCase();
  if (isPriority(normalized)) {
    return PRIORITY_STYLES[normalized];
  }
  return PRIORITY_STYLES.NORMAL;
}
