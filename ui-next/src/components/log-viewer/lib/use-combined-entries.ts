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
 * - O(k) incremental appending for new live entries (via internal tracking)
 * - Automatic deduplication based on timestamp
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

/**
 * Combines query entries with live streaming entries.
 *
 * @param queryEntries - Entries from the main log query (replaces buffer on change)
 * @param liveEntries - Entries from live streaming (appended incrementally when isLiveMode is active)
 * @returns Combined entries array
 */
export function useCombinedEntries(queryEntries: LogEntry[], liveEntries: LogEntry[]): LogEntry[] {
  // Compute the combined entries based on both inputs
  // This is a pure computation - no refs, no side effects during render
  return useMemo(() => {
    // If no live entries, just return query entries
    if (liveEntries.length === 0) {
      return queryEntries;
    }

    // If no query entries, just return live entries
    if (queryEntries.length === 0) {
      return liveEntries;
    }

    // Find the latest timestamp from query entries
    let queryLatestTime = 0;
    for (const e of queryEntries) {
      const t = e.timestamp.getTime();
      if (t > queryLatestTime) queryLatestTime = t;
    }

    // Filter live entries that are newer than the latest query entry
    const newLiveEntries: LogEntry[] = [];
    for (const entry of liveEntries) {
      if (entry.timestamp.getTime() > queryLatestTime) {
        newLiveEntries.push(entry);
      }
    }

    // If no new live entries after filtering, just return query entries
    if (newLiveEntries.length === 0) {
      return queryEntries;
    }

    // Combine query entries with filtered live entries
    return [...queryEntries, ...newLiveEntries];
  }, [queryEntries, liveEntries]);
}
