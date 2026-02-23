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
 * Utility for converting filter chips to LogQuery parameters.
 *
 * This enables O(1) filtering via LogIndex at the adapter level,
 * rather than O(n) client-side filtering after fetching all entries.
 */

import type { SearchChip } from "@/components/filter-bar/lib/types";
import type { LogSourceType } from "@/lib/api/log-adapter/types";
import { LOG_SOURCE_TYPES } from "@/lib/api/log-adapter/constants";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter parameters extracted from SearchChips.
 * Maps to UseLogQueryParams filter fields.
 */
export interface LogQueryFilters {
  /** Filter by task names (multiple allowed, OR'd together) */
  tasks?: string[];
  /** Filter by source types (multiple allowed, OR'd together) */
  sources?: LogSourceType[];
  /** Text search queries (multiple allowed, OR'd together - any must match) */
  search?: string[];
  /** Filter by retry attempts (multiple allowed, OR'd together) */
  retries?: string[];
}

// =============================================================================
// Pre-computed Sets for O(1) validation
// =============================================================================

const VALID_SOURCES = new Set<string>(LOG_SOURCE_TYPES);

// =============================================================================
// Main Function
// =============================================================================

/**
 * Converts SearchChip[] to LogQuery filter parameters.
 *
 * Chip field mapping:
 * - `task` → `tasks[]` (multiple allowed, OR'd together)
 * - `retry` → `retries[]` (multiple allowed, OR'd together)
 * - `source` → `sources[]` (multiple allowed, validated against LOG_SOURCE_TYPES)
 * - `text` → `search[]` (multiple allowed, OR'd together)
 *
 * Same-field chips are OR'd (collected into arrays).
 * Different-field chips are AND'd (separate filter params).
 *
 * @param chips - Filter chips from the log viewer UI
 * @returns Filter parameters for useLogQuery
 *
 * @example
 * ```ts
 * const chips = [
 *   { field: "task", value: "train", label: "Task: train" },
 *   { field: "task", value: "eval", label: "Task: eval" },
 *   { field: "source", value: "user", label: "Source: user" },
 * ];
 * const filters = chipsToLogQuery(chips);
 * // { tasks: ["train", "eval"], sources: ["user"] }
 * ```
 */
export function chipsToLogQuery(chips: SearchChip[]): LogQueryFilters {
  if (chips.length === 0) {
    return {};
  }

  const tasks: string[] = [];
  const sources: LogSourceType[] = [];
  const retries: string[] = [];
  const searches: string[] = [];

  for (const chip of chips) {
    switch (chip.field) {
      case "task":
        tasks.push(chip.value);
        break;

      case "source":
        if (VALID_SOURCES.has(chip.value)) {
          sources.push(chip.value as LogSourceType);
        }
        break;

      case "retry":
        retries.push(chip.value);
        break;

      case "text":
        searches.push(chip.value);
        break;
    }
  }

  const filters: LogQueryFilters = {};

  if (tasks.length > 0) {
    filters.tasks = tasks;
  }
  if (sources.length > 0) {
    filters.sources = sources;
  }
  if (searches.length > 0) {
    filters.search = searches;
  }
  if (retries.length > 0) {
    filters.retries = retries;
  }

  return filters;
}

/**
 * Checks if any filter chips are active.
 *
 * @param chips - Filter chips to check
 * @returns True if there are any chips that would affect filtering
 */
export function hasActiveFilters(chips: SearchChip[]): boolean {
  return chips.length > 0;
}
