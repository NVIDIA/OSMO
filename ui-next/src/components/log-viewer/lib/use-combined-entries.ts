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

"use client";

/**
 * useCombinedEntries Hook
 *
 * Combines query entries with live streaming entries using a pure computation
 * approach. Uses useMemo for efficient recalculation only when inputs change.
 *
 * Features:
 * - O(n+k) deduplication using entry ID Set for exact matching
 * - Handles query refetches during streaming without duplicates
 * - Clean React patterns without refs during render
 * - Reset on query data change
 *
 * @example
 * ```tsx
 * const { entries: queryEntries } = useLogData({ workflowId });
 * const { entries: liveEntries } = useLogTail({ workflowId, enabled: isLiveMode });
 *
 * const combinedEntries = useCombinedEntries(queryEntries, liveEntries);
 * ```
 */

import { useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter";
import { filterEntries, type FilterParams } from "@/lib/api/log-adapter/adapters/compute";
import { debugWarn } from "./debug";

/**
 * Combines query entries with live streaming entries.
 *
 * @param queryEntries - Entries from the main log query (replaces buffer on change)
 * @param liveEntries - Entries from live streaming (appended incrementally when isLiveMode is active)
 * @param filterParams - Optional filter parameters to apply to live entries
 * @returns Combined entries array
 */
export function useCombinedEntries(
  queryEntries: LogEntry[],
  liveEntries: LogEntry[],
  filterParams?: FilterParams,
): LogEntry[] {
  // Compute the combined entries based on both inputs
  // This is a pure computation - no refs, no side effects during render
  const combined = useMemo(() => {
    // If no live entries, just return query entries
    if (liveEntries.length === 0) {
      return queryEntries;
    }

    // If no query entries, filter and return live entries
    if (queryEntries.length === 0) {
      return filterParams ? filterEntries(liveEntries, filterParams) : liveEntries;
    }

    // Build a Set of query entry IDs for O(1) lookup during deduplication
    // Use entry ID if available, otherwise fall back to timestamp string
    // This handles cases where query refetches during streaming would cause duplicates
    const queryIds = new Set<string>();
    for (const e of queryEntries) {
      const entryId = e.id ?? e.timestamp.getTime().toString();
      queryIds.add(entryId);
    }

    // Filter live entries that aren't already in query results
    let newLiveEntries: LogEntry[] = [];
    for (const entry of liveEntries) {
      const entryId = entry.id ?? entry.timestamp.getTime().toString();
      if (!queryIds.has(entryId)) {
        newLiveEntries.push(entry);
      }
    }

    // Apply filters to new live entries if provided
    if (filterParams && newLiveEntries.length > 0) {
      newLiveEntries = filterEntries(newLiveEntries, filterParams);
    }

    // If no new live entries after filtering, just return query entries
    if (newLiveEntries.length === 0) {
      return queryEntries;
    }

    // Combine query entries with filtered live entries
    return [...queryEntries, ...newLiveEntries];
  }, [queryEntries, liveEntries, filterParams]);

  // DEBUG: Check ordering of combined entries (tree-shaken in production)
  if (combined.length > 1) {
    let outOfOrder = 0;
    for (let i = 1; i < Math.min(combined.length, 10); i++) {
      if (combined[i].timestamp < combined[i - 1].timestamp) {
        outOfOrder++;
      }
    }
    if (outOfOrder > 0) {
      debugWarn(
        `[useCombinedEntries] Combined entries have ${outOfOrder} out-of-order in first 10. ` +
          `Query: ${queryEntries.length}, Live: ${liveEntries.length}. ` +
          `First 3 dates: ${combined
            .slice(0, 3)
            .map((e) => e.timestamp.toISOString().split("T")[0])
            .join(", ")}`,
      );
    }
  }

  return combined;
}
