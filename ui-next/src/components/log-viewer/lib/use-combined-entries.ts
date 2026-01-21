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
 * Combines query entries with streaming tail entries using a ref-based buffer
 * for stable array identity. This avoids creating new arrays on every tail
 * update, improving performance during live streaming.
 *
 * Features:
 * - O(k) incremental appending for new tail entries
 * - Automatic deduplication based on timestamp
 * - Stable array identity during streaming
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

import { useRef, useState, useEffect, useMemo } from "react";
import type { LogEntry } from "@/lib/api/log-adapter";

/**
 * Combines query entries with streaming tail entries.
 *
 * @param queryEntries - Entries from the main log query (replaces buffer on change)
 * @param tailEntries - Entries from live tailing (appended incrementally)
 * @returns Combined entries array with stable identity during streaming
 */
export function useCombinedEntries(queryEntries: LogEntry[], tailEntries: LogEntry[]): LogEntry[] {
  // Cache the latest timestamp from query entries (computed once per query change)
  const queryLatestTime = useMemo(() => {
    if (queryEntries.length === 0) return 0;
    let maxTime = 0;
    for (const e of queryEntries) {
      const t = e.timestamp.getTime();
      if (t > maxTime) maxTime = t;
    }
    return maxTime;
  }, [queryEntries]);

  // Ref-based buffer maintains stable array identity during streaming
  const combinedEntriesRef = useRef<LogEntry[]>([]);
  const lastQueryEntriesRef = useRef<LogEntry[]>([]);
  const processedTailCountRef = useRef(0);

  // Version counter to trigger re-renders when buffer changes
  const [bufferVersion, setBufferVersion] = useState(0);

  // Update combined entries buffer when query or tail entries change
  useEffect(() => {
    // If query entries changed (different reference = new data load), reset buffer
    if (queryEntries !== lastQueryEntriesRef.current) {
      const newBuffer: LogEntry[] = [];
      for (const e of queryEntries) newBuffer.push(e);
      combinedEntriesRef.current = newBuffer;
      lastQueryEntriesRef.current = queryEntries;
      processedTailCountRef.current = 0;
      setBufferVersion((v) => v + 1);
      return;
    }

    // Append only new tail entries (incremental update)
    const newTailCount = tailEntries.length - processedTailCountRef.current;
    if (newTailCount > 0) {
      let appended = false;
      for (let i = processedTailCountRef.current; i < tailEntries.length; i++) {
        const entry = tailEntries[i];
        if (entry.timestamp.getTime() > queryLatestTime) {
          combinedEntriesRef.current.push(entry);
          appended = true;
        }
      }
      processedTailCountRef.current = tailEntries.length;

      if (appended) {
        setBufferVersion((v) => v + 1);
      }
    }
  }, [queryEntries, tailEntries, queryLatestTime]);

  // Use buffer version in dependency to ensure consumers re-render
  // bufferVersion is explicitly referenced to satisfy exhaustive-deps rule
  // and to trigger recomputation when the buffer changes
  return useMemo(() => {
    void bufferVersion;
    return combinedEntriesRef.current;
  }, [bufferVersion]);
}
