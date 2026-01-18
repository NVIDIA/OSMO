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

// Pure status functions. Metadata generated from backend via `pnpm generate-api`.

import { TaskGroupStatus } from "@/lib/api/generated";
import {
  TASK_STATUS_METADATA,
  type StatusCategory,
  getTaskStatusCategory,
  isTaskFailed,
  isTaskOngoing,
  isTaskTerminal,
  isTaskInQueue,
} from "@/lib/api/status-metadata.generated";

export type { StatusCategory };
export { TASK_STATUS_METADATA, getTaskStatusCategory, isTaskFailed, isTaskOngoing, isTaskTerminal, isTaskInQueue };

// Derived lookups computed once at module load
export const STATUS_CATEGORY_MAP: Record<string, StatusCategory> = {};
for (const [status, meta] of Object.entries(TASK_STATUS_METADATA)) {
  STATUS_CATEGORY_MAP[status] = meta.category;
}

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

export const STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Completed",
  RESCHEDULED: "Rescheduled",
  RUNNING: "Running",
  INITIALIZING: "Initializing",
  FAILED: "Failed",
  FAILED_CANCELED: "Failed: Canceled",
  FAILED_SERVER_ERROR: "Failed: Server Error",
  FAILED_BACKEND_ERROR: "Failed: Backend Error",
  FAILED_EXEC_TIMEOUT: "Failed: Exec Timeout",
  FAILED_QUEUE_TIMEOUT: "Failed: Queue Timeout",
  FAILED_IMAGE_PULL: "Failed: Image Pull",
  FAILED_UPSTREAM: "Failed: Upstream",
  FAILED_EVICTED: "Failed: Evicted",
  FAILED_START_ERROR: "Failed: Start Error",
  FAILED_START_TIMEOUT: "Failed: Start Timeout",
  FAILED_PREEMPTED: "Failed: Preempted",
  WAITING: "Waiting",
  SCHEDULING: "Scheduling",
  SUBMITTING: "Submitting",
  PROCESSING: "Processing",
} as const;

export type StateCategory = "completed" | "running" | "failed" | "pending";

function buildStateCategories(): Record<StateCategory, Set<string>> {
  const categories: Record<StateCategory, Set<string>> = {
    completed: new Set(),
    running: new Set(),
    failed: new Set(),
    pending: new Set(),
  };

  for (const [status, meta] of Object.entries(TASK_STATUS_METADATA)) {
    switch (meta.category) {
      case "completed":
        categories.completed.add(status);
        break;
      case "running":
        categories.running.add(status);
        break;
      case "failed":
        categories.failed.add(status);
        break;
      case "waiting":
      case "pending":
        // Both "waiting" and "pending" StatusCategory map to "pending" StateCategory
        categories.pending.add(status);
        break;
    }
  }

  return categories;
}

export const STATE_CATEGORIES: Record<StateCategory, Set<string>> = buildStateCategories();

export const STATE_CATEGORY_NAMES: StateCategory[] = ["completed", "running", "failed", "pending"];

export function getStatusCategory(status: string): StatusCategory {
  return STATUS_CATEGORY_MAP[status] ?? "failed";
}

export function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// `color` and `strokeColor` are hex values needed for ReactFlow edges/minimap
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
  pending: {
    bg: "bg-amber-50 dark:bg-amber-950/60",
    border: "border-amber-400 dark:border-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    dot: "bg-amber-500",
    // Raw colors for ReactFlow (edges, minimap)
    color: "#f59e0b",
    strokeColor: "#d97706",
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

export function getStatusStyle(status: string) {
  const category = getStatusCategory(status);
  return STATUS_STYLES[category];
}

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
    const status = task.status as TaskGroupStatus;

    // Increment subStats counter
    subStats.set(status, (subStats.get(status) ?? 0) + 1);

    // Use generated metadata for categorization
    const meta = TASK_STATUS_METADATA[status];
    if (meta) {
      switch (meta.category) {
        case "completed":
          completed++;
          break;
        case "running":
          running++;
          hasRunning = true;
          break;
        case "failed":
          failed++;
          break;
      }
    }

    // Parse timestamps
    const startTime = task.start_time;
    const endTime = task.end_time;

    if (startTime) {
      const t = Date.parse(startTime);
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

export function computeGroupDuration(stats: TaskStats, now?: number): number | null {
  if (stats.earliestStart === null) return null;
  const endTime = stats.hasRunning ? (now ?? Date.now()) : stats.latestEnd;
  if (endTime === null) return null;
  return Math.max(0, Math.floor((endTime - stats.earliestStart) / 1000));
}
