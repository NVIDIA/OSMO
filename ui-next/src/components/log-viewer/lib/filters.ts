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
 * Log Viewer Filter Utilities
 *
 * Pure functions for filtering log entries based on search chips.
 * Separated from components for testability.
 */

import type { LogEntry } from "@/lib/api/log-adapter";
import type { SearchChip } from "@/components/filter-bar";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter matching function signature.
 */
export type FilterMatcher = (entry: LogEntry, value: string) => boolean;

/**
 * Registry of field matchers for filtering.
 */
export type FilterMatcherRegistry = Record<string, FilterMatcher>;

// =============================================================================
// Default Matchers
// =============================================================================

/**
 * Default matchers for log entry fields.
 * Extensible - consumers can add custom matchers.
 */
export const DEFAULT_MATCHERS: FilterMatcherRegistry = {
  level: (entry, value) => entry.labels.level === value,
  task: (entry, value) => entry.labels.task === value,
  source: (entry, value) => entry.labels.source === value,
  text: (entry, value) => entry.message.toLowerCase().includes(value.toLowerCase()),
};

// =============================================================================
// Filter Functions
// =============================================================================

/**
 * Check if an entry matches a single filter.
 *
 * @param entry - The log entry to check
 * @param field - The field to match against
 * @param value - The value to match
 * @param matchers - Registry of field matchers (defaults to DEFAULT_MATCHERS)
 * @returns True if the entry matches the filter
 */
export function matchesFilter(
  entry: LogEntry,
  field: string,
  value: string,
  matchers: FilterMatcherRegistry = DEFAULT_MATCHERS,
): boolean {
  const matcher = matchers[field];
  if (!matcher) return false;
  return matcher(entry, value);
}

/**
 * Apply filter chips to entries.
 *
 * Logic:
 * - Groups chips by field
 * - Within a field: OR logic (matches any value)
 * - Across fields: AND logic (must match all fields)
 *
 * @param entries - Log entries to filter
 * @param chips - Filter chips to apply
 * @param matchers - Registry of field matchers (defaults to DEFAULT_MATCHERS)
 * @returns Filtered entries
 */
export function applyFilters(
  entries: LogEntry[],
  chips: SearchChip[],
  matchers: FilterMatcherRegistry = DEFAULT_MATCHERS,
): LogEntry[] {
  if (chips.length === 0) return entries;

  // Group chips by field for OR within field, AND across fields
  const filtersByField = new Map<string, string[]>();
  for (const chip of chips) {
    const existing = filtersByField.get(chip.field) ?? [];
    existing.push(chip.value);
    filtersByField.set(chip.field, existing);
  }

  const result: LogEntry[] = [];
  for (const entry of entries) {
    let matches = true;

    for (const [field, values] of filtersByField) {
      let fieldMatches = false;

      for (const value of values) {
        if (matchesFilter(entry, field, value, matchers)) {
          fieldMatches = true;
          break; // OR within field
        }
      }

      if (!fieldMatches) {
        matches = false;
        break; // AND across fields
      }
    }

    if (matches) {
      result.push(entry);
    }
  }

  return result;
}

/**
 * Build an active filters map from chips.
 * Used for highlighting active filters in the UI.
 *
 * @param chips - Current filter chips
 * @returns Map of field -> Set of active values
 */
export function buildActiveFiltersMap(chips: SearchChip[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const chip of chips) {
    const existing = map.get(chip.field) ?? new Set();
    existing.add(chip.value);
    map.set(chip.field, existing);
  }
  return map;
}
