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

/** State for tracking previous entries to detect resets vs appends */
interface PrevEntriesState {
  firstEntryId: string | undefined;
  length: number;
  resetCount: number;
}

/**
 * Hook that flattens log entries with date separators.
 *
 * The hook detects reset scenarios (when the first entry changes) and
 * increments resetCount accordingly. This helps consumers know when
 * to invalidate caches like virtualizer measurements.
 *
 * @param entries - Log entries array
 * @returns Flattened items and separator metadata
 */
export function useIncrementalFlatten(entries: LogEntry[]): FlattenResult {
  // Track previous entries state to detect resets
  const [prevState, setPrevState] = useState<PrevEntriesState>({
    firstEntryId: undefined,
    length: 0,
    resetCount: 0,
  });

  // Extract current state
  const entriesLength = entries.length;
  const firstEntryId = entries[0]?.id;

  // Detect if this is a reset (first entry changed) vs append or no-change
  // Use the "updating state during render" pattern recommended by React
  let resetCount = prevState.resetCount;
  if (firstEntryId !== prevState.firstEntryId && prevState.length > 0 && entriesLength > 0) {
    // First entry changed and we had previous entries - this is a reset
    resetCount = prevState.resetCount + 1;
  } else if (entriesLength === 0 && prevState.length > 0) {
    // Entries cleared - this is also a reset
    resetCount = prevState.resetCount + 1;
  }

  // Update tracked state if anything changed
  if (
    firstEntryId !== prevState.firstEntryId ||
    entriesLength !== prevState.length ||
    resetCount !== prevState.resetCount
  ) {
    setPrevState({
      firstEntryId,
      length: entriesLength,
      resetCount,
    });
  }

  // Compute the flattened result - pure computation based on entries
  const flattenedResult = useMemo(() => {
    return fullFlatten(entries);
  }, [entries]);

  // Combine with resetCount
  return useMemo(() => {
    return {
      items: flattenedResult.items,
      separators: flattenedResult.separators,
      resetCount,
    };
  }, [flattenedResult, resetCount]);
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
