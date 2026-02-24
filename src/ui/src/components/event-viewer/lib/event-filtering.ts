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
 * Event Viewer Hierarchical Filtering Logic
 *
 * Implements client-side filtering for hierarchical event data (tasks containing events).
 * Supports two filtering levels:
 * - Task-level filters (lifecycle, task name, free-text) → Hide entire tasks
 * - Event-level filters (severity) → Filter events within tasks, keep tasks visible
 */

import type { TaskGroup } from "@/lib/api/adapter/events/events-grouping";
import type { SearchChip } from "@/components/filter-bar/lib/types";
import type { K8sEvent } from "@/lib/api/adapter/events/events-types";

/**
 * Extended TaskGroup with filtering metadata for UI rendering.
 * IMPORTANT: task.events always contains the full unfiltered events array (SSOT).
 * When event-level filters are active, _filteredEvents contains the filtered subset.
 */
export interface FilteredTaskGroup extends TaskGroup {
  /** Filtered events subset (only present when event-level filters active) */
  _filteredEvents?: K8sEvent[];
  /** Total number of events before filtering (optional) */
  _allEventsCount?: number;
  /** Number of events after filtering (optional) */
  _filteredEventsCount?: number;
  /** Whether event-level filters are active (for dimming empty tasks, optional) */
  _hasEventFilters?: boolean;
}

/**
 * Apply search chips to task groups with hierarchical filtering logic.
 *
 * Filtering Strategy:
 * 1. Task-level filters (lifecycle, task name, free-text) → Hide entire tasks
 * 2. Event-level filters (severity) → Filter events within tasks
 * 3. Tasks with no matching events are kept visible but marked (for dimmed rendering)
 *
 * @param tasks - Raw task groups from events API
 * @param chips - Active search chips from FilterBar
 * @returns Filtered task groups with metadata for rendering
 */
export function filterTaskGroups(tasks: TaskGroup[], chips: SearchChip[]): FilteredTaskGroup[] {
  // Separate chips by filter type
  const lifecycleChips = chips.filter((c) => c.field === "lifecycle");
  const severityChips = chips.filter((c) => c.field === "severity");
  const taskChips = chips.filter((c) => c.field === "task");
  const freeTextChips = chips.filter((c) => c.field === "_freetext" || c.field === "");

  const hasEventFilters = severityChips.length > 0;

  const filtered = tasks
    // Task-level filtering: hide entire tasks
    .filter((task) => {
      // Filter by lifecycle stage (tasks currently at this stage)
      if (lifecycleChips.length > 0) {
        // Use cached derived state (SSOT: computed once from events)
        const matchesLifecycle = lifecycleChips.some((c) => task.derived.lifecycle === c.value);
        if (!matchesLifecycle) return false;
      }

      // Filter by task name
      if (taskChips.length > 0) {
        const matchesTask = taskChips.some((c) => task.name.toLowerCase().includes(c.value.toLowerCase()));
        if (!matchesTask) return false;
      }

      // Filter by free text (task name or event content)
      if (freeTextChips.length > 0) {
        const matchesText = freeTextChips.some((c) => {
          const term = c.value.toLowerCase();
          // Match task name
          if (task.name.toLowerCase().includes(term)) return true;
          // Match event reasons or messages
          return task.events.some(
            (e) => e.reason.toLowerCase().includes(term) || e.message.toLowerCase().includes(term),
          );
        });
        if (!matchesText) return false;
      }

      return true;
    });

  // Fast path: no event-level filters, preserve object identity for memo optimization
  if (!hasEventFilters) {
    return filtered;
  }

  // Event-level filtering: add filtered events subset, preserve original events array
  return filtered.map((task) => {
    const filteredEvents = task.events.filter((event) => {
      return severityChips.some((c) => {
        if (c.value === "error") return event.severity === "error";
        if (c.value === "warn") return event.severity === "error" || event.severity === "warn";
        return true; // "info" matches all events
      });
    });

    return {
      ...task,
      // IMPORTANT: Keep task.events as the full unfiltered array (SSOT for derived state)
      _filteredEvents: filteredEvents,
      _allEventsCount: task.events.length,
      _filteredEventsCount: filteredEvents.length,
      _hasEventFilters: true,
    };
  });
}
