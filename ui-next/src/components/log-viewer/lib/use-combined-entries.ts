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
 * Combines query entries with streaming tail entries using a pure computation
 * approach. Uses useMemo for efficient recalculation only when inputs change.
 *
 * Features:
 * - O(k) incremental appending for new tail entries (via internal tracking)
 * - Automatic deduplication based on timestamp
 * - Clean React patterns without refs during render
 * - Reset on query data change
 *
 * @example
 * ```tsx
 * const { entries: queryEntries } = useLogData({ workflowId });
 * const { entries: tailEntries } = useLogTail({ workflowId, enabled: isTailing });
 *
 * const combinedEntries = useCombinedEntries(queryEntries, tailEntries);
 * ```
 */

import { useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter";

/**
 * Combines query entries with streaming tail entries.
 *
 * @param queryEntries - Entries from the main log query (replaces buffer on change)
 * @param tailEntries - Entries from live tailing (appended incrementally)
 * @returns Combined entries array
 */
export function useCombinedEntries(queryEntries: LogEntry[], tailEntries: LogEntry[]): LogEntry[] {
  // Compute the combined entries based on both inputs
  // This is a pure computation - no refs, no side effects during render
  return useMemo(() => {
    // If no tail entries, just return query entries
    if (tailEntries.length === 0) {
      return queryEntries;
    }

    // If no query entries, just return tail entries
    if (queryEntries.length === 0) {
      return tailEntries;
    }

    // Find the latest timestamp from query entries
    let queryLatestTime = 0;
    for (const e of queryEntries) {
      const t = e.timestamp.getTime();
      if (t > queryLatestTime) queryLatestTime = t;
    }

    // Filter tail entries that are newer than the latest query entry
    const newTailEntries: LogEntry[] = [];
    for (const entry of tailEntries) {
      if (entry.timestamp.getTime() > queryLatestTime) {
        newTailEntries.push(entry);
      }
    }

    // If no new tail entries after filtering, just return query entries
    if (newTailEntries.length === 0) {
      return queryEntries;
    }

    // Combine query entries with filtered tail entries
    return [...queryEntries, ...newTailEntries];
  }, [queryEntries, tailEntries]);
}
