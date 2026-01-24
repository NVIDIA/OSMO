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
 * Pure Compute Functions for Log Data
 *
 * Stateless functions for filtering entries and computing derived data
 * (histogram, facets). These replace the stateful LogIndex class.
 *
 * Benefits:
 * - SSR compatible (no internal state)
 * - Easier to test (pure functions)
 * - Simpler to understand
 *
 * Performance note: These use O(n) array operations. For typical log
 * volumes (<50k entries), this is fast enough (~5ms). For Loki integration,
 * these computations happen server-side anyway.
 */

import type {
  LogEntry,
  LogLevel,
  LogSourceType,
  HistogramBucket,
  HistogramResult,
  FieldFacet,
  FacetValue,
} from "../types";
import { LOG_LEVELS } from "../constants";

// =============================================================================
// Types
// =============================================================================

/**
 * Filter parameters for log entries.
 */
export interface FilterParams {
  /** Filter by log levels (OR - entry matches if level is in list) */
  levels?: LogLevel[];
  /** Filter by task names (OR - entry matches if task is in list) */
  tasks?: string[];
  /** Filter by retry attempts (OR - entry matches if retry is in list) */
  retries?: string[];
  /** Filter by source types (OR - entry matches if source is in list) */
  sources?: LogSourceType[];
  /** Text search (case-insensitive substring match) */
  search?: string;
  /** Use regex for search instead of substring */
  searchRegex?: boolean;
  /** Start of time range (inclusive) */
  start?: Date;
  /** End of time range (inclusive) */
  end?: Date;
}

// =============================================================================
// Filter Entries
// =============================================================================

/**
 * Filters log entries based on provided parameters.
 *
 * All filters are AND-ed together (entry must match all criteria).
 * Within multi-value filters (levels, tasks, sources), values are OR-ed.
 *
 * @param entries - Array of log entries to filter
 * @param params - Filter parameters
 * @returns Filtered entries in original order
 */
export function filterEntries(entries: LogEntry[], params: FilterParams): LogEntry[] {
  // Fast path: no filters
  if (
    !params.levels?.length &&
    !params.tasks?.length &&
    !params.retries?.length &&
    !params.sources?.length &&
    !params.search &&
    !params.start &&
    !params.end
  ) {
    return entries;
  }

  // Pre-compile regex if needed
  let searchRegex: RegExp | null = null;
  if (params.search) {
    const pattern = params.searchRegex ? params.search : escapeRegex(params.search);
    searchRegex = new RegExp(pattern, "i");
  }

  // Convert arrays to Sets for O(1) lookup
  const levelSet = params.levels?.length ? new Set(params.levels) : null;
  const taskSet = params.tasks?.length ? new Set(params.tasks) : null;
  const retrySet = params.retries?.length ? new Set(params.retries) : null;
  const sourceSet = params.sources?.length ? new Set(params.sources) : null;

  return entries.filter((entry) => {
    // Level filter
    if (levelSet) {
      const level = entry.labels.level ?? "info";
      if (!levelSet.has(level)) return false;
    }

    // Task filter
    if (taskSet) {
      if (!entry.labels.task || !taskSet.has(entry.labels.task)) return false;
    }

    // Retry filter
    if (retrySet) {
      if (!entry.labels.retry || !retrySet.has(entry.labels.retry)) return false;
    }

    // Source filter
    if (sourceSet) {
      if (!entry.labels.source || !sourceSet.has(entry.labels.source)) return false;
    }

    // Time range filter
    if (params.start && entry.timestamp < params.start) return false;
    if (params.end && entry.timestamp > params.end) return false;

    // Text search filter
    if (searchRegex && !searchRegex.test(entry.message)) return false;

    return true;
  });
}

// =============================================================================
// Compute Histogram
// =============================================================================

/**
 * Default bucket interval in milliseconds (1 minute).
 */
const DEFAULT_BUCKET_MS = 60_000;

/**
 * Computes histogram data for timeline visualization.
 *
 * Buckets entries by time and counts entries per log level within each bucket.
 *
 * @param entries - Array of log entries
 * @param numBuckets - Target number of buckets (default: 50)
 * @returns Histogram result with time-ordered buckets
 */
export function computeHistogram(entries: LogEntry[], numBuckets = 50): HistogramResult {
  if (entries.length === 0) {
    return { buckets: [], intervalMs: DEFAULT_BUCKET_MS };
  }

  // Find time range
  let minTime = entries[0].timestamp.getTime();
  let maxTime = minTime;

  for (const entry of entries) {
    const t = entry.timestamp.getTime();
    if (t < minTime) minTime = t;
    if (t > maxTime) maxTime = t;
  }

  // Calculate bucket interval
  const timeRange = maxTime - minTime;
  const intervalMs = timeRange > 0 ? Math.max(DEFAULT_BUCKET_MS, Math.ceil(timeRange / numBuckets)) : DEFAULT_BUCKET_MS;

  // Build bucket map: bucketKey -> level -> count
  const bucketMap = new Map<number, Map<LogLevel, number>>();

  for (const entry of entries) {
    const bucketKey = Math.floor(entry.timestamp.getTime() / intervalMs);
    const level = entry.labels.level ?? "info";

    let levelCounts = bucketMap.get(bucketKey);
    if (!levelCounts) {
      levelCounts = new Map();
      bucketMap.set(bucketKey, levelCounts);
    }

    levelCounts.set(level, (levelCounts.get(level) ?? 0) + 1);
  }

  // Generate all buckets in the time range (including empty ones)
  const minBucketKey = Math.floor(minTime / intervalMs);
  const maxBucketKey = Math.floor(maxTime / intervalMs);
  const buckets: HistogramBucket[] = [];

  for (let bucketKey = minBucketKey; bucketKey <= maxBucketKey; bucketKey++) {
    const levelCounts = bucketMap.get(bucketKey);
    const counts: Partial<Record<LogLevel, number>> = {};
    let total = 0;

    if (levelCounts) {
      for (const level of LOG_LEVELS) {
        const count = levelCounts.get(level) ?? 0;
        if (count > 0) {
          counts[level] = count;
          total += count;
        }
      }
    }

    buckets.push({
      timestamp: new Date(bucketKey * intervalMs),
      counts,
      total,
    });
  }

  return { buckets, intervalMs };
}

// =============================================================================
// Compute Facets
// =============================================================================

/**
 * Computes facet data for the Fields pane.
 *
 * Counts distinct values for each requested field.
 *
 * @param entries - Array of log entries
 * @param fields - Field names to compute facets for
 * @returns Array of field facets with value counts
 */
export function computeFacets(entries: LogEntry[], fields: string[]): FieldFacet[] {
  const facets: FieldFacet[] = [];

  for (const field of fields) {
    const counts = new Map<string, number>();

    for (const entry of entries) {
      let value: string | undefined;

      switch (field) {
        case "level":
          value = entry.labels.level ?? "info";
          break;
        case "task":
          value = entry.labels.task;
          break;
        case "source":
          value = entry.labels.source;
          break;
        case "retry":
          value = entry.labels.retry;
          break;
        case "io_type":
          value = entry.labels.io_type;
          break;
        default:
          value = entry.labels[field];
      }

      if (value) {
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    }

    // Convert to sorted array (descending by count, then alphabetical)
    const values: FacetValue[] = [];
    for (const [value, count] of counts) {
      values.push({ value, count });
    }

    values.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.value.localeCompare(b.value);
    });

    facets.push({ field, values });
  }

  return facets;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Escapes special regex characters for literal matching.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
