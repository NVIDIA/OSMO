//SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.

//Licensed under the Apache License, Version 2.0 (the "License");
//you may not use this file except in compliance with the License.
//You may obtain a copy of the License at

//http://www.apache.org/licenses/LICENSE-2.0

//Unless required by applicable law or agreed to in writing, software
//distributed under the License is distributed on an "AS IS" BASIS,
//WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//See the License for the specific language governing permissions and
//limitations under the License.

//SPDX-License-Identifier: Apache-2.0

/**
 * Event Viewer FilterBar field definitions.
 *
 * Defines searchable fields for event filtering in the workflow event viewer.
 * Uses client-side filtering with hierarchical logic (task-level and event-level filters).
 */

import { cn } from "@/lib/utils";
import type { SearchField, SearchPreset, SearchChip } from "@/components/filter-bar/lib/types";
import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import type { EventSeverity } from "@/lib/api/adapter/events/events-types";

// =============================================================================
// Search Field Definitions
// =============================================================================

/**
 * Lifecycle stage field - task-level filter.
 * Filters tasks currently at the selected lifecycle stage.
 * No prefix - accessed via preset buttons, not typed search.
 */
export const LIFECYCLE_FIELD: SearchField<TaskGroup> = {
  id: "lifecycle",
  label: "Lifecycle",
  prefix: "",
  hint: "Filter tasks currently at lifecycle stage",
  exhaustive: true,
  requiresValidValue: true,
  getValues: () => ["Pending", "Init", "Running", "Failed", "Done"],
  match: (task, value) => {
    // Use cached derived state (SSOT: computed once from events)
    return task.derived.lifecycle === value;
  },
};

/**
 * Event severity field - event-level filter.
 * Filters events within tasks. Uses hierarchical matching:
 * - "info" -> all events (info, warn, error)
 * - "warn" -> warn OR error events
 * - "error" -> only error events
 * No prefix - accessed via preset buttons, not typed search.
 */
export const SEVERITY_FIELD: SearchField<TaskGroup> = {
  id: "severity",
  label: "Severity",
  prefix: "",
  hint: "Filter events by severity level",
  exhaustive: true,
  requiresValidValue: true,
  getValues: () => ["info", "warn", "error"],
  match: (task, value) => {
    // Check if task has ANY events matching the severity filter
    return task.events.some((event) => {
      if (value === "error") return event.severity === "error";
      if (value === "warn") return event.severity === "error" || event.severity === "warn";
      return true; // "info" matches all events
    });
  },
};

/**
 * Task name filter - matches task names with autocomplete.
 * Provides suggestions from actual task names in the data.
 * Accepts free-form text for substring matching.
 */
export const TASK_FIELD: SearchField<TaskGroup> = {
  id: "task",
  label: "Task Name",
  prefix: "task:",
  hint: "Filter by task name",
  exhaustive: false, // Allow free-form text input (not restricted to autocomplete suggestions)
  getValues: (items) => {
    // Extract unique task names from the data for autocomplete
    const uniqueNames = new Set(items.map((task) => task.name));
    return Array.from(uniqueNames).sort();
  },
  match: (task, value) => {
    // Match against task name (case-insensitive substring match)
    return task.name.toLowerCase().includes(value.toLowerCase());
  },
};

/**
 * Free-text search field - matches task names, event reasons, and messages.
 * No prefix - all unmatched input goes here.
 */
export const FREE_TEXT_FIELD: SearchField<TaskGroup> = {
  id: "_freetext",
  label: "Task/Event Text",
  prefix: "",
  hint: "Search task names, event reasons, and messages",
  getValues: () => [], // No autocomplete for free text
  match: (task, value) => {
    const term = value.toLowerCase();
    // Match task name
    if (task.name.toLowerCase().includes(term)) return true;
    // Match event reasons or messages
    return task.events.some((e) => e.reason.toLowerCase().includes(term) || e.message.toLowerCase().includes(term));
  },
};

/**
 * All event search fields in display order.
 */
export const EVENT_SEARCH_FIELDS: readonly SearchField<TaskGroup>[] = Object.freeze([
  LIFECYCLE_FIELD,
  SEVERITY_FIELD,
  TASK_FIELD,
  FREE_TEXT_FIELD,
]);

// =============================================================================
// Presets
// =============================================================================

/**
 * Preset button colors for lifecycle stages.
 */
const LIFECYCLE_PRESET_COLORS: Record<string, { dot: string; bg: string; text: string }> = {
  Pending: {
    dot: "bg-purple-500",
    bg: "bg-purple-100 dark:bg-purple-900/50",
    text: "text-purple-700 dark:text-purple-300",
  },
  Init: {
    dot: "bg-indigo-500",
    bg: "bg-indigo-100 dark:bg-indigo-900/50",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  Running: {
    dot: "bg-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/50",
    text: "text-blue-700 dark:text-blue-300",
  },
  Failed: {
    dot: "bg-red-500",
    bg: "bg-red-100 dark:bg-red-900/50",
    text: "text-red-700 dark:text-red-300",
  },
  Done: {
    dot: "bg-emerald-500",
    bg: "bg-emerald-100 dark:bg-emerald-900/50",
    text: "text-emerald-700 dark:text-emerald-300",
  },
};

/**
 * Preset button colors for severity levels.
 */
const SEVERITY_PRESET_COLORS: Record<EventSeverity, { dot: string; bg: string; text: string }> = {
  error: {
    dot: "bg-red-500",
    bg: "bg-red-100 dark:bg-red-900/50",
    text: "text-red-700 dark:text-red-300",
  },
  warn: {
    dot: "bg-yellow-500",
    bg: "bg-yellow-100 dark:bg-yellow-900/50",
    text: "text-yellow-700 dark:text-yellow-300",
  },
  info: {
    dot: "bg-blue-500",
    bg: "bg-blue-100 dark:bg-blue-900/50",
    text: "text-blue-700 dark:text-blue-300",
  },
};

/**
 * Lifecycle stage presets for quick filtering.
 */
export const EVENT_PRESETS: { label: string; items: SearchPreset[] }[] = [
  {
    label: "Lifecycle",
    items: (["Pending", "Init", "Running", "Failed", "Done"] as const).map((stage) => {
      const colors = LIFECYCLE_PRESET_COLORS[stage];
      return {
        id: `lifecycle-${stage.toLowerCase()}`,
        chips: [
          {
            field: "lifecycle",
            value: stage,
            label: stage,
          },
        ],
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
            <span>{stage}</span>
            {active && <span className="ml-0.5">✓</span>}
          </span>
        ),
      };
    }),
  },
  {
    label: "Severity",
    items: (["info", "warn", "error"] as const).map((severity) => {
      const colors = SEVERITY_PRESET_COLORS[severity];
      const label = severity.charAt(0).toUpperCase() + severity.slice(1);
      return {
        id: `severity-${severity}`,
        chips: [
          {
            field: "severity",
            value: severity,
            label,
          },
        ],
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

// =============================================================================
// Re-export types for convenience
// =============================================================================

export type { SearchChip };
