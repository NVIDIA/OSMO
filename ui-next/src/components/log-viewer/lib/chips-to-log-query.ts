// Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
//
// NVIDIA CORPORATION and its licensors retain all intellectual property
// and proprietary rights in and to this software, related documentation
// and any modifications thereto. Any use, reproduction, disclosure or
// distribution of this software and related documentation without an express
// license agreement from NVIDIA CORPORATION is strictly prohibited.

/**
 * Utility for converting filter chips to LogQuery parameters.
 *
 * This enables O(1) filtering via LogIndex at the adapter level,
 * rather than O(n) client-side filtering after fetching all entries.
 */

import type { SearchChip } from "@/components/filter-bar";
import type { LogLevel, LogSourceType } from "@/lib/api/log-adapter";
import { LOG_LEVELS, LOG_SOURCE_TYPES } from "@/lib/api/log-adapter";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter parameters extracted from SearchChips.
 * Maps to UseLogQueryParams filter fields.
 */
export interface LogQueryFilters {
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Filter by task names (first task chip only - single task filter) */
  taskName?: string;
  /** Filter by source types (user vs system) */
  sources?: LogSourceType[];
  /** Text search query (first text chip only) */
  search?: string;
}

// =============================================================================
// Pre-computed Sets for O(1) validation
// =============================================================================

const VALID_LEVELS = new Set<string>(LOG_LEVELS);
const VALID_SOURCES = new Set<string>(LOG_SOURCE_TYPES);

// =============================================================================
// Main Function
// =============================================================================

/**
 * Converts SearchChip[] to LogQuery filter parameters.
 *
 * Chip field mapping:
 * - `level` → `levels[]` (multiple allowed, validated against LOG_LEVELS)
 * - `task` → `taskName` (first value only - useLogQuery supports single task)
 * - `source` → `sources[]` (multiple allowed, validated against LOG_SOURCE_TYPES)
 * - `text` → `search` (first value only)
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
 *   { field: "level", value: "error", label: "Level: error" },
 *   { field: "level", value: "warn", label: "Level: warn" },
 *   { field: "task", value: "train", label: "Task: train" },
 * ];
 * const filters = chipsToLogQuery(chips);
 * // { levels: ["error", "warn"], taskName: "train" }
 * ```
 */
export function chipsToLogQuery(chips: SearchChip[]): LogQueryFilters {
  if (chips.length === 0) {
    return {};
  }

  const levels: LogLevel[] = [];
  const sources: LogSourceType[] = [];
  let taskName: string | undefined;
  let search: string | undefined;

  for (const chip of chips) {
    switch (chip.field) {
      case "level":
        // Validate against known log levels
        if (VALID_LEVELS.has(chip.value)) {
          levels.push(chip.value as LogLevel);
        }
        break;

      case "task":
        // Take first task chip only (useLogQuery supports single taskName)
        if (taskName === undefined) {
          taskName = chip.value;
        }
        break;

      case "source":
        // Validate against known source types
        if (VALID_SOURCES.has(chip.value)) {
          sources.push(chip.value as LogSourceType);
        }
        break;

      case "text":
        // Take first text chip only
        if (search === undefined) {
          search = chip.value;
        }
        break;
    }
  }

  const filters: LogQueryFilters = {};

  if (levels.length > 0) {
    filters.levels = levels;
  }
  if (taskName !== undefined) {
    filters.taskName = taskName;
  }
  if (sources.length > 0) {
    filters.sources = sources;
  }
  if (search !== undefined) {
    filters.search = search;
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
