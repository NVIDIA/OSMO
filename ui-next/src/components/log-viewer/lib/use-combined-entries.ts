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

import { useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter/types";
import { filterEntries, type FilterParams } from "@/lib/api/log-adapter/adapters/compute";
import { debugWarn } from "./debug";

/**
 * Combines query entries with live streaming entries.
 * Uses O(n+k) deduplication to handle query refetches during streaming.
 */
export function useCombinedEntries(
  queryEntries: LogEntry[],
  liveEntries: LogEntry[],
  filterParams?: FilterParams,
): LogEntry[] {
  const combined = useMemo(() => {
    if (liveEntries.length === 0) return queryEntries;

    if (queryEntries.length === 0) {
      return filterParams ? filterEntries(liveEntries, filterParams) : liveEntries;
    }

    // Build Set of query entry IDs for O(1) deduplication lookup
    const queryIds = new Set<string>();
    for (const e of queryEntries) {
      queryIds.add(e.id ?? e.timestamp.getTime().toString());
    }

    // Filter live entries not already in query results
    let newLiveEntries: LogEntry[] = [];
    for (const entry of liveEntries) {
      const entryId = entry.id ?? entry.timestamp.getTime().toString();
      if (!queryIds.has(entryId)) {
        newLiveEntries.push(entry);
      }
    }

    if (filterParams && newLiveEntries.length > 0) {
      newLiveEntries = filterEntries(newLiveEntries, filterParams);
    }

    if (newLiveEntries.length === 0) return queryEntries;

    return [...queryEntries, ...newLiveEntries];
  }, [queryEntries, liveEntries, filterParams]);

  // DEBUG: Check ordering (tree-shaken in production)
  if (combined.length > 1) {
    let outOfOrder = 0;
    for (let i = 1; i < Math.min(combined.length, 10); i++) {
      if (combined[i].timestamp < combined[i - 1].timestamp) outOfOrder++;
    }
    if (outOfOrder > 0) {
      debugWarn(
        `[useCombinedEntries] ${outOfOrder} out-of-order entries in first 10. ` +
          `Query: ${queryEntries.length}, Live: ${liveEntries.length}`,
      );
    }
  }

  return combined;
}
