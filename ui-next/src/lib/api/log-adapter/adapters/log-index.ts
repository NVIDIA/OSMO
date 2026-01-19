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
 * Log Index for Fast Filtering
 *
 * In-memory index enabling O(1) label filtering and pre-computed facets.
 * Histogram buckets are computed incrementally as logs stream in.
 *
 * Design principles:
 * - Indexes are Sets of entry indices for O(1) lookup
 * - Counts are pre-computed and updated incrementally
 * - Histogram buckets are created on-demand during streaming
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
 * Filter options for querying the index.
 */
export interface LogIndexFilterOptions {
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Filter by task names */
  tasks?: string[];
  /** Filter by source types (user vs system) */
  sources?: LogSourceType[];
  /** Text search (regex-escaped substring match) */
  search?: string;
  /** Use regex for search */
  searchRegex?: boolean;
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
}

// =============================================================================
// Log Index Class
// =============================================================================

/**
 * In-memory index for fast log filtering and aggregation.
 *
 * Maintains:
 * - Inverted indexes by level, task, and IO type for O(1) filtering
 * - Pre-computed facet counts updated incrementally
 * - Time-bucketed histogram data for visualization
 */
export class LogIndex {
  // Primary storage
  private entries: LogEntry[] = [];

  // Inverted indexes: label value -> Set of entry indices
  private byLevel = new Map<LogLevel, Set<number>>();
  private byTask = new Map<string, Set<number>>();
  private bySource = new Map<LogSourceType, Set<number>>();
  private byRetry = new Map<string, Set<number>>();

  // Pre-computed facet counts
  private levelCounts = new Map<LogLevel, number>();
  private taskCounts = new Map<string, number>();
  private sourceCounts = new Map<LogSourceType, number>();
  private retryCounts = new Map<string, number>();

  // Histogram: bucket timestamp -> level counts
  private buckets = new Map<number, Map<LogLevel, number>>();
  private bucketMs: number;

  // Time range tracking
  private minTimestamp: Date | null = null;
  private maxTimestamp: Date | null = null;

  /**
   * Creates a new LogIndex.
   *
   * @param bucketMs - Histogram bucket size in milliseconds (default: 60000 = 1 minute)
   */
  constructor(bucketMs = 60_000) {
    this.bucketMs = bucketMs;
  }

  // ===========================================================================
  // Entry Management
  // ===========================================================================

  /**
   * Adds entries to the index.
   * Updates all indexes and counts incrementally.
   *
   * @param newEntries - Entries to add
   */
  addEntries(newEntries: LogEntry[]): void {
    const base = this.entries.length;

    for (let i = 0; i < newEntries.length; i++) {
      const entry = newEntries[i];
      const idx = base + i;
      this.entries.push(entry);

      // Update time range
      this.updateTimeRange(entry.timestamp);

      // Index by level
      const level = entry.labels.level ?? "info";
      this.addToIndex(this.byLevel, level, idx);
      this.incrementCount(this.levelCounts, level);

      // Index by task
      if (entry.labels.task) {
        this.addToIndex(this.byTask, entry.labels.task, idx);
        this.incrementCount(this.taskCounts, entry.labels.task);
      }

      // Index by source (user vs system)
      if (entry.labels.source) {
        this.addToIndex(this.bySource, entry.labels.source, idx);
        this.incrementCount(this.sourceCounts, entry.labels.source);
      }

      // Index by retry
      if (entry.labels.retry) {
        this.addToIndex(this.byRetry, entry.labels.retry, idx);
        this.incrementCount(this.retryCounts, entry.labels.retry);
      }

      // Update histogram bucket
      this.updateHistogramBucket(entry.timestamp, level);
    }
  }

  /**
   * Gets all entries in the index.
   */
  getAllEntries(): LogEntry[] {
    return this.entries;
  }

  /**
   * Gets the total number of entries.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clears all entries and indexes.
   */
  clear(): void {
    this.entries = [];
    this.byLevel.clear();
    this.byTask.clear();
    this.bySource.clear();
    this.byRetry.clear();
    this.levelCounts.clear();
    this.taskCounts.clear();
    this.sourceCounts.clear();
    this.retryCounts.clear();
    this.buckets.clear();
    this.minTimestamp = null;
    this.maxTimestamp = null;
  }

  // ===========================================================================
  // Filtering
  // ===========================================================================

  /**
   * Filters entries based on provided options.
   * Uses inverted indexes for O(1) label filtering.
   *
   * @param opts - Filter options
   * @returns Filtered entries in timestamp order
   */
  filter(opts: LogIndexFilterOptions = {}): LogEntry[] {
    let indices: Set<number> | null = null;

    // Filter by levels (OR within levels)
    if (opts.levels?.length) {
      const levelSets = opts.levels.map((l) => this.byLevel.get(l));
      indices = this.union(levelSets);
    }

    // Filter by tasks (OR within tasks, AND with levels)
    if (opts.tasks?.length) {
      const taskSets = opts.tasks.map((t) => this.byTask.get(t));
      const taskIndices = this.union(taskSets);
      indices = indices ? this.intersect(indices, taskIndices) : taskIndices;
    }

    // Filter by source types (OR within sources, AND with previous)
    if (opts.sources?.length) {
      const sourceSets = opts.sources.map((s) => this.bySource.get(s));
      const sourceIndices = this.union(sourceSets);
      indices = indices ? this.intersect(indices, sourceIndices) : sourceIndices;
    }

    // Get candidate entries from indices or all entries
    let candidates: LogEntry[];
    if (indices) {
      const sortedIndices = [...indices].sort((a, b) => a - b);
      candidates = sortedIndices.map((i) => this.entries[i]);
    } else {
      candidates = this.entries;
    }

    // Filter by time range
    if (opts.start || opts.end) {
      candidates = candidates.filter((e) => {
        if (opts.start && e.timestamp < opts.start) return false;
        if (opts.end && e.timestamp > opts.end) return false;
        return true;
      });
    }

    // Filter by text search
    if (opts.search) {
      const pattern = opts.searchRegex ? opts.search : this.escapeRegex(opts.search);
      const regex = new RegExp(pattern, "i");
      candidates = candidates.filter((e) => regex.test(e.message));
    }

    return candidates;
  }

  // ===========================================================================
  // Facets
  // ===========================================================================

  /**
   * Gets facet data for specified fields.
   * Returns pre-computed counts without recalculation.
   *
   * @param fields - Field names to get facets for
   * @returns Array of FieldFacet objects
   */
  getFacets(fields: string[]): FieldFacet[] {
    const facets: FieldFacet[] = [];

    for (const field of fields) {
      const facet = this.getFacetForField(field);
      if (facet) {
        facets.push(facet);
      }
    }

    return facets;
  }

  /**
   * Gets facet data for a single field.
   */
  private getFacetForField(field: string): FieldFacet | null {
    let counts: Map<string, number>;

    switch (field) {
      case "level":
        counts = this.levelCounts as Map<string, number>;
        break;
      case "task":
        counts = this.taskCounts;
        break;
      case "source":
        counts = this.sourceCounts as Map<string, number>;
        break;
      case "retry":
        counts = this.retryCounts;
        break;
      default:
        return null;
    }

    const values: FacetValue[] = [];
    for (const [value, count] of counts) {
      values.push({ value, count });
    }

    // Sort by count descending, then by value
    values.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.value.localeCompare(b.value);
    });

    return { field, values };
  }

  /**
   * Gets raw facet counts for quick access.
   */
  getRawFacets(): {
    levels: Map<LogLevel, number>;
    tasks: Map<string, number>;
    sources: Map<LogSourceType, number>;
    retries: Map<string, number>;
  } {
    return {
      levels: this.levelCounts,
      tasks: this.taskCounts,
      sources: this.sourceCounts,
      retries: this.retryCounts,
    };
  }

  // ===========================================================================
  // Histogram
  // ===========================================================================

  /**
   * Gets histogram data for timeline visualization.
   *
   * @param _numBuckets - Target number of buckets (reserved for future use)
   * @returns Histogram result with buckets and interval
   */
  getHistogram(_numBuckets = 50): HistogramResult {
    if (this.buckets.size === 0 || !this.minTimestamp || !this.maxTimestamp) {
      return { buckets: [], intervalMs: this.bucketMs };
    }

    // Convert internal buckets to histogram format
    const result: HistogramBucket[] = [];

    const sortedBucketKeys = [...this.buckets.keys()].sort((a, b) => a - b);

    for (const bucketKey of sortedBucketKeys) {
      const levelCounts = this.buckets.get(bucketKey)!;
      const counts: Partial<Record<LogLevel, number>> = {};
      let total = 0;

      for (const level of LOG_LEVELS) {
        const count = levelCounts.get(level) ?? 0;
        if (count > 0) {
          counts[level] = count;
          total += count;
        }
      }

      result.push({
        timestamp: new Date(bucketKey * this.bucketMs),
        counts,
        total,
      });
    }

    return {
      buckets: result,
      intervalMs: this.bucketMs,
    };
  }

  /**
   * Gets the time range of indexed entries.
   */
  getTimeRange(): { start: Date | null; end: Date | null } {
    return {
      start: this.minTimestamp,
      end: this.maxTimestamp,
    };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Adds an entry index to an inverted index.
   */
  private addToIndex<K>(map: Map<K, Set<number>>, key: K, index: number): void {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    set.add(index);
  }

  /**
   * Increments a count in a count map.
   */
  private incrementCount<K>(map: Map<K, number>, key: K): void {
    map.set(key, (map.get(key) ?? 0) + 1);
  }

  /**
   * Updates the histogram bucket for an entry.
   */
  private updateHistogramBucket(timestamp: Date, level: LogLevel): void {
    const bucketKey = Math.floor(timestamp.getTime() / this.bucketMs);

    let bucket = this.buckets.get(bucketKey);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(bucketKey, bucket);
    }

    bucket.set(level, (bucket.get(level) ?? 0) + 1);
  }

  /**
   * Updates the tracked time range.
   */
  private updateTimeRange(timestamp: Date): void {
    if (!this.minTimestamp || timestamp < this.minTimestamp) {
      this.minTimestamp = timestamp;
    }
    if (!this.maxTimestamp || timestamp > this.maxTimestamp) {
      this.maxTimestamp = timestamp;
    }
  }

  /**
   * Unions multiple sets of indices.
   */
  private union(sets: (Set<number> | undefined)[]): Set<number> {
    const result = new Set<number>();
    for (const set of sets) {
      if (set) {
        for (const value of set) {
          result.add(value);
        }
      }
    }
    return result;
  }

  /**
   * Intersects two sets of indices.
   */
  private intersect(a: Set<number>, b: Set<number>): Set<number> {
    const result = new Set<number>();
    // Iterate over smaller set for efficiency
    const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
    for (const value of smaller) {
      if (larger.has(value)) {
        result.add(value);
      }
    }
    return result;
  }

  /**
   * Escapes special regex characters for literal matching.
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
}
