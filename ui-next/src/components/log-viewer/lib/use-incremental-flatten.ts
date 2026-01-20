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

import { useRef, useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter";

// =============================================================================
// Types
// =============================================================================

/**
 * A flattened virtual list item - either a date separator or a log entry.
 * Using a discriminated union for type-safe rendering.
 */
export type VirtualItem =
  | { type: "separator"; dateKey: string; date: Date; index: number }
  | { type: "entry"; entry: LogEntry };

/** Information about a date separator for sticky header tracking */
export interface SeparatorInfo {
  index: number;
  dateKey: string;
  date: Date;
}

/** Result of flattening entries */
export interface FlattenResult {
  items: VirtualItem[];
  separators: SeparatorInfo[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get a date key string for grouping (YYYY-MM-DD format).
 * Exported for testing.
 */
export function getDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// =============================================================================
// Cache Structure
// =============================================================================

interface FlattenCache {
  /** Flattened items array - mutated in place for appends */
  items: VirtualItem[];
  /** Separator metadata array - mutated in place for appends */
  separators: SeparatorInfo[];
  /** Last date key processed (for detecting day boundaries) */
  lastDateKey: string | null;
  /** Number of entries processed so far */
  processedCount: number;
  /** First entry ID (for detecting array replacement) */
  firstEntryId: string | null;
  /** Version counter to force React updates */
  version: number;
}

/**
 * Create an empty cache.
 */
function createEmptyCache(): FlattenCache {
  return {
    items: [],
    separators: [],
    lastDateKey: null,
    processedCount: 0,
    firstEntryId: null,
    version: 0,
  };
}

// =============================================================================
// Incremental Flatten Hook
// =============================================================================

/**
 * Hook that incrementally flattens log entries with date separators.
 *
 * For streaming scenarios, this provides O(k) performance where k = new entries,
 * instead of O(n) full recomputation on every update.
 *
 * The hook detects three scenarios:
 * 1. **Append** (streaming): entries.length > cache.processedCount and first entry matches
 *    → Only processes new entries (constant time per new entry)
 * 2. **Reset**: entries.length < cache.processedCount or first entry changed
 *    → Full recomputation
 * 3. **No change**: entries.length === cache.processedCount
 *    → Returns cached result
 *
 * @param entries - Log entries array (may be mutated in place for streaming)
 * @returns Flattened items and separator metadata
 */
export function useIncrementalFlatten(entries: LogEntry[]): FlattenResult {
  const cacheRef = useRef<FlattenCache>(createEmptyCache());

  // Use entries.length as primary dependency for detecting changes
  // This works correctly even when the array is mutated in place
  return useMemo(() => {
    const cache = cacheRef.current;
    const entriesLength = entries.length;

    // Empty entries - reset cache and return empty result
    if (entriesLength === 0) {
      if (cache.processedCount !== 0) {
        cacheRef.current = createEmptyCache();
      }
      return { items: [], separators: [] };
    }

    const firstEntry = entries[0];
    const isFirstEntryMatch = cache.firstEntryId === firstEntry.id;

    // Detect scenario
    const isAppend = entriesLength > cache.processedCount && cache.processedCount > 0 && isFirstEntryMatch;

    const isNoChange = entriesLength === cache.processedCount && isFirstEntryMatch;

    // No change - return cached result with same reference
    if (isNoChange) {
      return { items: cache.items, separators: cache.separators };
    }

    // Full recomputation needed (reset or first load)
    if (!isAppend) {
      const result = fullFlatten(entries);
      cacheRef.current = {
        items: result.items,
        separators: result.separators,
        lastDateKey: entriesLength > 0 ? getDateKey(entries[entriesLength - 1].timestamp) : null,
        processedCount: entriesLength,
        firstEntryId: firstEntry.id,
        version: cache.version + 1,
      };
      return result;
    }

    // Incremental append - O(k) where k = new entries
    appendNewEntries(cache, entries);
    cache.processedCount = entriesLength;
    cache.version++;

    // Return same arrays (mutated in place) - React sees new result object
    return { items: cache.items, separators: cache.separators };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entries.length triggers update
  }, [entries.length, entries[0]?.id]);
}

/**
 * Full flattening - O(n) for all entries.
 * Used for initial load or when entries are replaced.
 * Exported for testing.
 */
export function fullFlatten(entries: LogEntry[]): FlattenResult {
  if (entries.length === 0) {
    return { items: [], separators: [] };
  }

  const items: VirtualItem[] = [];
  const separators: SeparatorInfo[] = [];
  let currentDateKey: string | null = null;

  for (const entry of entries) {
    const dateKey = getDateKey(entry.timestamp);

    // Insert date separator when date changes
    if (dateKey !== currentDateKey) {
      const separatorIndex = items.length;
      const separator: SeparatorInfo = { index: separatorIndex, dateKey, date: entry.timestamp };
      separators.push(separator);
      items.push({ type: "separator", dateKey, date: entry.timestamp, index: separatorIndex });
      currentDateKey = dateKey;
    }

    items.push({ type: "entry", entry });
  }

  return { items, separators };
}

/**
 * Append only new entries to the cache - O(k) for k new entries.
 * Mutates cache.items and cache.separators in place for maximum performance.
 */
function appendNewEntries(cache: FlattenCache, entries: LogEntry[]): void {
  const startIndex = cache.processedCount;
  let currentDateKey = cache.lastDateKey;

  for (let i = startIndex; i < entries.length; i++) {
    const entry = entries[i];
    const dateKey = getDateKey(entry.timestamp);

    // Insert date separator when date changes
    if (dateKey !== currentDateKey) {
      const separatorIndex = cache.items.length;
      const separator: SeparatorInfo = { index: separatorIndex, dateKey, date: entry.timestamp };
      cache.separators.push(separator);
      cache.items.push({ type: "separator", dateKey, date: entry.timestamp, index: separatorIndex });
      currentDateKey = dateKey;
    }

    cache.items.push({ type: "entry", entry });
  }

  cache.lastDateKey = currentDateKey;
}
