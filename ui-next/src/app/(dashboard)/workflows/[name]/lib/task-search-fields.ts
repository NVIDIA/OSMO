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
 * Task Search Fields Configuration
 *
 * Defines search fields for task filtering using the canonical SmartSearch component.
 * Includes:
 * - Field definitions with match functions
 * - Presets for quick status filtering
 * - Duration and time parsing utilities
 */

import type { SearchField, SearchPreset, SearchChip } from "@/components/smart-search";
import { STATE_CATEGORIES, STATE_CATEGORY_NAMES, type StateCategory } from "./status";
import type { TaskWithDuration } from "./workflow-types";

// ============================================================================
// Lazy-loaded chrono-node with idle prefetch
// ============================================================================

/**
 * chrono-node is lazy-loaded to reduce initial bundle size (~40KB).
 * It's prefetched during browser idle time, so it's ready when needed.
 */
let chronoModule: typeof import("chrono-node") | null = null;
let chronoLoadPromise: Promise<typeof import("chrono-node")> | null = null;

// Prefetch during browser idle time (non-blocking)
if (typeof window !== "undefined" && "requestIdleCallback" in window) {
  requestIdleCallback(
    () => {
      chronoLoadPromise = import("chrono-node").then((m) => {
        chronoModule = m;
        return m;
      });
    },
    { timeout: 5000 }, // Load within 5 seconds even if not idle
  );
} else if (typeof window !== "undefined") {
  // Fallback for browsers without requestIdleCallback (Safari)
  setTimeout(() => {
    chronoLoadPromise = import("chrono-node").then((m) => {
      chronoModule = m;
      return m;
    });
  }, 2000);
}

/**
 * Get chrono module, loading it if not already loaded.
 * Returns null if not yet loaded (sync access).
 */
function getChronoSync(): typeof import("chrono-node") | null {
  return chronoModule;
}

/**
 * Ensure chrono is loaded (for prefetch on focus).
 */
export function ensureChronoLoaded(): void {
  if (!chronoModule && !chronoLoadPromise) {
    chronoLoadPromise = import("chrono-node").then((m) => {
      chronoModule = m;
      return m;
    });
  }
}

// ============================================================================
// Duration Parsing Utilities
// ============================================================================

/**
 * Parse duration string like "1m", "30s", "2h", "1h30m" into milliseconds.
 */
function parseDurationString(str: string): number | null {
  const normalized = str.toLowerCase().trim();
  if (!normalized) return null;

  let totalMs = 0;
  let remaining = normalized;

  const regex = /^(\d+(?:\.\d+)?)\s*(h|m|s|ms)/;
  let hasMatch = false;

  while (remaining.length > 0) {
    const match = regex.exec(remaining);
    if (match) {
      hasMatch = true;
      const num = parseFloat(match[1]);
      const unit = match[2];
      switch (unit) {
        case "h":
          totalMs += num * 60 * 60 * 1000;
          break;
        case "m":
          totalMs += num * 60 * 1000;
          break;
        case "s":
          totalMs += num * 1000;
          break;
        case "ms":
          totalMs += num;
          break;
      }
      remaining = remaining.slice(match[0].length).trim();
    } else {
      break;
    }
  }

  if (hasMatch && remaining.length === 0) return totalMs;
  if (!hasMatch && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return parseFloat(normalized) * 1000;
  }
  return null;
}

/**
 * Compare a value using operator prefix (>, >=, <, <=, =).
 */
function compareWithOperator(taskValue: number, filterValue: string, parser: (s: string) => number | null): boolean {
  const trimmed = filterValue.trim();
  let operator = ">=";
  let valueStr = trimmed;

  if (trimmed.startsWith(">=")) {
    operator = ">=";
    valueStr = trimmed.slice(2);
  } else if (trimmed.startsWith("<=")) {
    operator = "<=";
    valueStr = trimmed.slice(2);
  } else if (trimmed.startsWith(">")) {
    operator = ">";
    valueStr = trimmed.slice(1);
  } else if (trimmed.startsWith("<")) {
    operator = "<";
    valueStr = trimmed.slice(1);
  } else if (trimmed.startsWith("=")) {
    operator = "=";
    valueStr = trimmed.slice(1);
  }

  const compareValue = parser(valueStr.trim());
  if (compareValue === null) return false;

  switch (operator) {
    case ">":
      return taskValue > compareValue;
    case ">=":
      return taskValue >= compareValue;
    case "<":
      return taskValue < compareValue;
    case "<=":
      return taskValue <= compareValue;
    case "=":
      return taskValue === compareValue;
    default:
      return false;
  }
}

// ============================================================================
// Time Parsing Utilities
// ============================================================================

// LRU cache for chrono parsing
const chronoCache = new Map<string, Date | null>();
const CHRONO_CACHE_MAX = 100;

/**
 * Parse natural language date string using chrono-node.
 * Uses LRU cache for performance.
 * Returns null if chrono isn't loaded yet (shouldn't happen with prefetch).
 */
function parseDateTime(input: string): Date | null {
  if (!input?.trim()) return null;
  const key = input.trim().toLowerCase();
  if (chronoCache.has(key)) return chronoCache.get(key)!;

  // Get chrono module (may be null if not yet loaded)
  const chrono = getChronoSync();
  if (!chrono) return null; // Chrono not loaded yet - graceful degradation

  const result = chrono.parseDate(input);
  if (chronoCache.size >= CHRONO_CACHE_MAX) {
    const firstKey = chronoCache.keys().next().value;
    if (firstKey) chronoCache.delete(firstKey);
  }
  chronoCache.set(key, result);
  return result;
}

function matchTimeFilter(taskTime: number, filterValue: string): boolean {
  let operator = ">=";
  let isoStr = filterValue;

  if (filterValue.startsWith(">=")) {
    operator = ">=";
    isoStr = filterValue.slice(2);
  } else if (filterValue.startsWith("<=")) {
    operator = "<=";
    isoStr = filterValue.slice(2);
  } else if (filterValue.startsWith(">")) {
    operator = ">";
    isoStr = filterValue.slice(1);
  } else if (filterValue.startsWith("<")) {
    operator = "<";
    isoStr = filterValue.slice(1);
  } else if (filterValue.startsWith("=")) {
    operator = "=";
    isoStr = filterValue.slice(1);
  }

  const isoDate = new Date(isoStr);
  if (!isNaN(isoDate.getTime())) {
    const compareTime = isoDate.getTime();
    switch (operator) {
      case ">":
        return taskTime > compareTime;
      case ">=":
        return taskTime >= compareTime;
      case "<":
        return taskTime < compareTime;
      case "<=":
        return taskTime <= compareTime;
      case "=":
        return new Date(taskTime).toDateString() === isoDate.toDateString();
      default:
        return taskTime >= compareTime;
    }
  }

  const parsed = parseDateTime(isoStr);
  if (parsed) {
    const compareTime = parsed.getTime();
    switch (operator) {
      case ">":
        return taskTime > compareTime;
      case ">=":
        return taskTime >= compareTime;
      case "<":
        return taskTime < compareTime;
      case "<=":
        return taskTime <= compareTime;
      case "=":
        return new Date(taskTime).toDateString() === parsed.toDateString();
      default:
        return taskTime >= compareTime;
    }
  }

  return false;
}

function statusMatchesState(status: string, state: string): boolean {
  const category = STATE_CATEGORIES[state.toLowerCase() as StateCategory];
  return category?.has(status) ?? false;
}

// ============================================================================
// Field Definitions
// ============================================================================

/**
 * Search field definitions for task filtering.
 * Compatible with the canonical SmartSearch component.
 */
export const TASK_SEARCH_FIELDS: readonly SearchField<TaskWithDuration>[] = [
  {
    id: "name",
    label: "Name",
    prefix: "",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.name))].slice(0, 10),
    match: (task, value) => task.name.toLowerCase().includes(value.toLowerCase()),
  },
  {
    id: "state",
    label: "State",
    prefix: "state:",
    getValues: () => STATE_CATEGORY_NAMES,
    match: (task, value) => statusMatchesState(task.status, value),
    exhaustive: true,
    hint: "state category",
  },
  {
    id: "status",
    label: "Status",
    prefix: "status:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.status))],
    match: (task, value) => task.status.toLowerCase() === value.toLowerCase(),
    hint: "specific status",
  },
  {
    id: "node",
    label: "Node",
    prefix: "node:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.node_name).filter(Boolean) as string[])],
    match: (task, value) => task.node_name?.toLowerCase().includes(value.toLowerCase()) ?? false,
    hint: "node name",
  },
  {
    id: "ip",
    label: "IP",
    prefix: "ip:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.pod_ip).filter(Boolean) as string[])],
    match: (task, value) => task.pod_ip?.includes(value) ?? false,
    hint: "pod IP address",
  },
  {
    id: "exit",
    label: "Exit Code",
    prefix: "exit:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.exit_code?.toString()).filter(Boolean) as string[])],
    match: (task, value) => task.exit_code?.toString() === value,
    hint: "exit code",
  },
  {
    id: "retry",
    label: "Retry",
    prefix: "retry:",
    getValues: (tasks) => [...new Set(tasks.map((t) => t.retry_id.toString()))],
    match: (task, value) => task.retry_id.toString() === value,
    hint: "retry attempt ID",
  },
  {
    id: "duration",
    label: "Duration",
    prefix: "duration:",
    getValues: () => [],
    match: (task, value) => {
      const durationMs = (task.duration ?? 0) * 1000;
      return compareWithOperator(durationMs, value, parseDurationString);
    },
    freeFormHint: "5m (≥5m), <1h, =30s",
    hint: "5m (≥5m), <1h, =30s",
  },
  {
    id: "started",
    label: "Started",
    prefix: "started:",
    getValues: () => ["last 10m", "last 1h", "last 24h", "last 7d", "today", "yesterday"],
    match: (task, value) => {
      if (!task.start_time) return false;
      return matchTimeFilter(new Date(task.start_time).getTime(), value);
    },
    freeFormHint: "last 2h, >yesterday, <Dec 25 9am",
    hint: "last 2h, >yesterday, <Dec 25 9am",
  },
  {
    id: "ended",
    label: "Ended",
    prefix: "ended:",
    getValues: () => ["last 10m", "last 1h", "last 24h", "last 7d", "today", "yesterday"],
    match: (task, value) => {
      if (!task.end_time) return false;
      return matchTimeFilter(new Date(task.end_time).getTime(), value);
    },
    freeFormHint: "last 2h, >yesterday, <Dec 25 9am",
    hint: "last 2h, >yesterday, <Dec 25 9am",
  },
];

// ============================================================================
// Presets
// ============================================================================

/**
 * State preset button colors.
 */
const STATE_PRESET_COLORS: Record<StateCategory, { dot: string; bg: string; text: string }> = {
  completed: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-100 dark:bg-emerald-900/50",
    text: "text-emerald-700 dark:text-emerald-300",
  },
  running: {
    dot: "bg-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/50",
    text: "text-blue-700 dark:text-blue-300",
  },
  failed: {
    dot: "bg-red-500",
    bg: "bg-red-100 dark:bg-red-900/50",
    text: "text-red-700 dark:text-red-300",
  },
  pending: {
    dot: "bg-gray-400 dark:bg-zinc-400",
    bg: "bg-gray-100 dark:bg-zinc-700",
    text: "text-gray-700 dark:text-zinc-300",
  },
};

/**
 * Create preset buttons for quick state filtering.
 */
export function createTaskPresets(
  tasks: TaskWithDuration[],
): { label: string; items: SearchPreset<TaskWithDuration>[] }[] {
  const presets: SearchPreset<TaskWithDuration>[] = STATE_CATEGORY_NAMES.map((state) => {
    const colors = STATE_PRESET_COLORS[state];

    return {
      id: `state-${state}`,
      label: state.charAt(0).toUpperCase() + state.slice(1),
      count: (data: TaskWithDuration[]) => data.filter((t) => STATE_CATEGORIES[state].has(t.status)).length,
      chip: {
        field: "state",
        value: state,
        label: state,
      },
      dotColor: colors.dot,
      badgeColors: {
        bg: colors.bg,
        text: colors.text,
      },
    };
  });

  // Only include presets with matching tasks
  const activePresets = presets.filter((p) => p.count(tasks) > 0);

  return activePresets.length > 0 ? [{ label: "State", items: activePresets }] : [];
}

// ============================================================================
// Re-export SearchChip type for convenience
// ============================================================================

export type { SearchChip };
