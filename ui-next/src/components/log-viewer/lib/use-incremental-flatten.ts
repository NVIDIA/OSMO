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

import { useState, useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter/types";

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

/** Internal result of flattening (without reset tracking) */
interface FlattenResultInternal {
  items: VirtualItem[];
  separators: SeparatorInfo[];
}

/** Result of flattening entries from the hook */
export interface FlattenResult {
  items: VirtualItem[];
  separators: SeparatorInfo[];
  /**
   * Increments when items array is fully replaced (filter/reset).
   * Does NOT increment for streaming appends.
   * Use this to invalidate virtualizer measurements cache.
   */
  resetCount: number;
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
// Incremental Flatten Hook
// =============================================================================

/** State for tracking previous entries and cached flatten result */
interface PrevEntriesState {
  firstEntryId: string | undefined;
  length: number;
  resetCount: number;
  lastFlattenedResult: FlattenResultInternal;
  lastDateKey: string | null;
}

/**
 * Hook that flattens log entries with date separators.
 *
 * Optimized for streaming: detects appends and only processes new entries (O(k))
 * instead of re-flattening the entire array (O(n)).
 *
 * The hook detects reset scenarios (when the first entry changes) and
 * increments resetCount accordingly. This helps consumers know when
 * to invalidate caches like virtualizer measurements.
 *
 * @param entries - Log entries array
 * @returns Flattened items and separator metadata
 */
export function useIncrementalFlatten(entries: LogEntry[]): FlattenResult {
  // Track previous entries state and cached flattened result
  const [prevState, setPrevState] = useState<PrevEntriesState>({
    firstEntryId: undefined,
    length: 0,
    resetCount: 0,
    lastFlattenedResult: { items: [], separators: [] },
    lastDateKey: null,
  });

  // Extract current state
  const entriesLength = entries.length;
  const firstEntryId = entries[0]?.id;

  // Detect if this is a reset (first entry changed) vs append or no-change
  // Use the "updating state during render" pattern recommended by React
  let resetCount = prevState.resetCount;
  let newState = prevState;

  const isAppend = entriesLength > prevState.length && firstEntryId === prevState.firstEntryId && prevState.length > 0;
  const isReset =
    (firstEntryId !== prevState.firstEntryId && prevState.length > 0 && entriesLength > 0) ||
    (entriesLength === 0 && prevState.length > 0);

  if (isReset) {
    resetCount = prevState.resetCount + 1;
  }

  // Compute the flattened result
  let flattenedResult: FlattenResultInternal;

  // No-change path: same entries, reuse cached result (O(1))
  // This prevents creating new object references that would trigger
  // an infinite render-phase setState loop (fullFlatten always returns new arrays).
  const isNoChange =
    entriesLength === prevState.length && firstEntryId === prevState.firstEntryId && prevState.length > 0;

  if (isNoChange) {
    flattenedResult = prevState.lastFlattenedResult;
  } else if (isAppend) {
    // Append path: only flatten new entries (O(k) where k = new entries)
    const newEntries = entries.slice(prevState.length);
    flattenedResult = appendFlatten(prevState.lastFlattenedResult, newEntries, prevState.lastDateKey);
  } else {
    // Reset path or initial: full flatten (O(n))
    flattenedResult = fullFlatten(entries);
  }

  // Extract last date key for next append
  const lastDateKey =
    flattenedResult.separators.length > 0
      ? flattenedResult.separators[flattenedResult.separators.length - 1].dateKey
      : null;

  // Update state if anything changed
  if (
    firstEntryId !== prevState.firstEntryId ||
    entriesLength !== prevState.length ||
    resetCount !== prevState.resetCount ||
    flattenedResult !== prevState.lastFlattenedResult
  ) {
    newState = {
      firstEntryId,
      length: entriesLength,
      resetCount,
      lastFlattenedResult: flattenedResult,
      lastDateKey,
    };
    setPrevState(newState);
  }

  // Return memoized result
  return useMemo(
    () => ({
      items: flattenedResult.items,
      separators: flattenedResult.separators,
      resetCount,
    }),
    [flattenedResult, resetCount],
  );
}

/**
 * Full flattening - O(n) for all entries.
 * Used for initial load or when entries are replaced.
 * Exported for testing.
 */
export function fullFlatten(entries: LogEntry[]): FlattenResultInternal {
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
 * Append flattening - O(k) for new entries only.
 * Extends previous flattened result with new entries.
 * Exported for testing.
 */
export function appendFlatten(
  prevResult: FlattenResultInternal,
  newEntries: LogEntry[],
  prevLastDateKey: string | null,
): FlattenResultInternal {
  if (newEntries.length === 0) {
    return prevResult;
  }

  // Clone previous result (copy arrays by reference is ok, we'll create new arrays)
  const items = [...prevResult.items];
  const separators = [...prevResult.separators];
  let currentDateKey = prevLastDateKey;

  for (const entry of newEntries) {
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
