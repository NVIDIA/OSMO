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
  entries: LogEntry[];
  resetKey: string;
  resetCount: number;
  lastFlattenedResult: FlattenResultInternal;
  lastDateKey: string | null;
}

export type EntriesChangeType = "unchanged" | "append" | "replace";

/**
 * Classify an entry update without scanning the full prefix on streaming appends.
 * The previous tail must remain at the same prefix boundary; expanding a filtered
 * subsequence therefore becomes a replacement instead of a false append.
 *
 * While resetKey is unchanged, entries must be immutable and order-preserving;
 * producers may only append entries and/or evict a prefix. Any other replacement
 * must change resetKey.
 */
export function classifyEntriesChange(
  previousEntries: LogEntry[],
  entries: LogEntry[],
  previousResetKey: string,
  resetKey: string,
): EntriesChangeType {
  if (resetKey !== previousResetKey) {
    return "replace";
  }

  if (entries === previousEntries) {
    return "unchanged";
  }

  if (entries.length === previousEntries.length) {
    if (entries.length === 0) return "unchanged";

    // The log stream is immutable: existing entry objects are preserved for
    // appends/caps, while reconnect replacements create new boundary objects.
    // Query replacements are distinguished by resetKey. Checking boundaries
    // keeps filtered no-match stream updates O(1) instead of rescanning up to
    // 100K entries on every RAF batch.
    if (entries[0] === previousEntries[0] && entries[entries.length - 1] === previousEntries[entries.length - 1]) {
      return "unchanged";
    }
  }

  if (
    previousEntries.length > 0 &&
    entries.length > previousEntries.length &&
    entries[0] === previousEntries[0] &&
    entries[previousEntries.length - 1] === previousEntries[previousEntries.length - 1]
  ) {
    return "append";
  }

  return "replace";
}

/**
 * Hook that flattens log entries with date separators.
 *
 * Optimized for streaming: detects appends and only processes new entries (O(k))
 * instead of re-flattening the entire array (O(n)).
 *
 * The hook detects reset scenarios from the query generation or replaced
 * entries and increments resetCount accordingly. This helps consumers know
 * when to invalidate caches like virtualizer measurements.
 *
 * @param entries - Log entries array
 * @param resetKey - Stable identity for the filters and time range producing entries
 * @returns Flattened items and separator metadata
 */
export function useIncrementalFlatten(entries: LogEntry[], resetKey: string): FlattenResult {
  // Track previous entries state and cached flattened result
  const [prevState, setPrevState] = useState<PrevEntriesState>({
    entries: [],
    resetKey: "",
    resetCount: 0,
    lastFlattenedResult: { items: [], separators: [] },
    lastDateKey: null,
  });

  // Extract current state
  // Detect if this is a reset (filter/replacement) vs append or no-change.
  // Use the "updating state during render" pattern recommended by React
  let resetCount = prevState.resetCount;
  let newState = prevState;

  // No-change path: same entries, reuse cached result (O(1))
  // This prevents creating new object references that would trigger
  // an infinite render-phase setState loop (fullFlatten always returns new arrays).
  // CRITICAL: Must handle the empty-to-empty case (both length 0). Without this,
  // fullFlatten([]) creates a new object every render, the reference check on line 154
  // always triggers setPrevState, and React hits "Too many re-renders."
  const changeType = classifyEntriesChange(prevState.entries, entries, prevState.resetKey, resetKey);
  const isNoChange = changeType === "unchanged";
  const isAppend = changeType === "append";
  // A reset is anything that's not an append or no-change (filter applied, entries replaced, etc.).
  // The old condition only checked firstEntryId changes, missing the case where a filter keeps
  // the same first entry but reduces the count — leaving measurementsCache stale and causing
  // incorrect separator positions (hidden separators creating visual gaps).
  const isReset = changeType === "replace" && prevState.entries.length > 0;

  if (isReset) {
    resetCount = prevState.resetCount + 1;
  }

  // Compute the flattened result
  let flattenedResult: FlattenResultInternal;

  if (isNoChange) {
    flattenedResult = prevState.lastFlattenedResult;
  } else if (isAppend) {
    // Append path: only flatten new entries (O(k) where k = new entries)
    const newEntries = entries.slice(prevState.entries.length);
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
  if (!isNoChange) {
    newState = {
      entries,
      resetKey,
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
