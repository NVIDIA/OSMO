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
 * Defines search fields for task filtering using the canonical FilterBar component.
 * Includes:
 * - Field definitions with match functions
 * - Presets for quick status filtering
 * - Duration and time parsing utilities
 */

import { cn } from "@/lib/utils";
import type { SearchField, SearchPreset, SearchChip } from "@/components/filter-bar";
import { STATE_CATEGORIES, STATE_CATEGORY_NAMES, STATUS_LABELS, type StateCategory } from "./status";
import { TaskGroupStatus } from "@/lib/api/generated";
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
// The dynamic import itself is async and won't block, but we want to
// schedule it at an optimal time to avoid competing with initial render
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
  // Safari fallback: Use RAF to wait for initial render to complete,
  // then use another RAF to ensure we're past the paint cycle
  // This avoids setTimeout long task violations while still deferring the load
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      chronoLoadPromise = import("chrono-node").then((m) => {
        chronoModule = m;
        return m;
      });
    });
  });
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

// ============================================================================
// Field Definitions
// ============================================================================

/**
 * Search field definitions for task filtering.
 * Compatible with the canonical FilterBar component.
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

// =============================================================================
// Status Presets - DERIVED FROM STATE_CATEGORIES
// =============================================================================

/**
 * Status presets derived from STATE_CATEGORIES.
 * Each preset maps a state category to its corresponding TaskGroupStatus values.
 * This enables presets to expand to individual status chips for server-side filtering.
 */
export const STATUS_PRESETS: Record<StateCategory, TaskGroupStatus[]> = {
  completed: [...STATE_CATEGORIES.completed] as TaskGroupStatus[],
  running: [...STATE_CATEGORIES.running] as TaskGroupStatus[],
  failed: [...STATE_CATEGORIES.failed] as TaskGroupStatus[],
  pending: [...STATE_CATEGORIES.pending] as TaskGroupStatus[],
};

/**
 * Create chips for a status preset.
 * Expands a state category to individual status chips.
 * Uses exact enum value as label for consistency with workflow chips.
 */
export function createPresetChips(stateCategory: StateCategory): SearchChip[] {
  const statuses = STATUS_PRESETS[stateCategory];
  return statuses.map((status) => ({
    field: "status",
    value: status,
    label: `Status: ${status}`,
  }));
}

/**
 * Check if a preset is fully satisfied by the current chips.
 * A preset is active only if ALL its statuses are present.
 */
export function isPresetActive(stateCategory: StateCategory, chips: SearchChip[]): boolean {
  const presetStatuses = STATUS_PRESETS[stateCategory];
  const statusChips = chips.filter((c) => c.field === "status");
  const statusValues = new Set(statusChips.map((c) => c.value));

  return presetStatuses.every((status) => statusValues.has(status));
}

/**
 * Toggle a preset on/off.
 * - If active (all statuses present): remove all preset statuses
 * - If inactive: add all preset statuses
 */
export function togglePreset(stateCategory: StateCategory, chips: SearchChip[]): SearchChip[] {
  const isActive = isPresetActive(stateCategory, chips);
  const presetStatusArray = STATUS_PRESETS[stateCategory];
  const presetStatusSet = new Set<string>(presetStatusArray);

  if (isActive) {
    // Remove all preset statuses
    return chips.filter((c) => !(c.field === "status" && presetStatusSet.has(c.value)));
  } else {
    // Add missing preset statuses
    const existingStatuses = new Set(chips.filter((c) => c.field === "status").map((c) => c.value));
    const newChips = [...chips];

    for (const status of presetStatusArray) {
      if (!existingStatuses.has(status)) {
        newChips.push({
          field: "status",
          value: status,
          label: `Status: ${STATUS_LABELS[status] ?? status}`,
        });
      }
    }

    return newChips;
  }
}

/**
 * Task state presets for quick filtering.
 * Each preset expands to individual status chips (e.g., "Failed" → FAILED, FAILED_CANCELED, etc.)
 *
 * Uses the `chips` property (not deprecated `chip`) to specify multiple status chips.
 * FilterBar will add/remove all chips together, and the preset is active only when all are present.
 */
export const TASK_PRESETS: { label: string; items: SearchPreset[] }[] = [
  {
    label: "State",
    items: STATE_CATEGORY_NAMES.map((state) => {
      const colors = STATE_PRESET_COLORS[state];
      const label = state.charAt(0).toUpperCase() + state.slice(1);

      return {
        id: `state-${state}`,
        chips: createPresetChips(state),
        render: ({ active, focused }) => (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              active
                ? cn(colors.bg, colors.text)
                : "bg-zinc-100 text-zinc-600 group-data-[selected=true]:bg-zinc-200 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:group-data-[selected=true]:bg-zinc-700 dark:hover:bg-zinc-700",
              focused && "ring-2 ring-blue-500/50",
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", colors.dot)} />
            <span>{label}</span>
            {active && <span className="ml-0.5">✓</span>}
          </span>
        ),
      };
    }),
  },
];

// ============================================================================
// Re-export types for convenience
// ============================================================================

export type { SearchChip };
export type { StateCategory };
