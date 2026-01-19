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
 * useLogQuery Hook
 *
 * TanStack Query wrapper for fetching and filtering log entries.
 * Provides manual pagination with cursor-based navigation.
 */

"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useEffect, startTransition, useState } from "react";

import type { LogQuery, LogQueryResult, LogEntry, LogLevel, LogSourceType } from "../types";
import { LOG_QUERY_DEFAULTS } from "../constants";
import { useLogAdapter } from "./use-log-adapter";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the useLogQuery hook.
 */
export interface UseLogQueryParams {
  /** Workflow ID to fetch logs for */
  workflowId: string;
  /** Filter by task name */
  taskName?: string;
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Filter by source types (user vs system) */
  sources?: LogSourceType[];
  /** Text search query */
  search?: string;
  /** Search mode */
  searchMode?: "contains" | "regex";
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
  /** Number of entries per page */
  pageSize?: number;
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Return value from useLogQuery.
 */
export interface UseLogQueryReturn {
  /** Current page of log entries */
  entries: LogEntry[];
  /** Whether the query is loading */
  isLoading: boolean;
  /** Whether we're fetching a new page */
  isFetchingNextPage: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Whether there are more entries to fetch */
  hasMore: boolean;
  /** Total entries loaded so far */
  totalLoaded: number;
  /** Load the next page of entries */
  fetchNextPage: () => void;
  /** Refresh the query */
  refetch: () => void;
  /** Invalidate and refetch */
  invalidate: () => void;
}

// =============================================================================
// Query Key Factory
// =============================================================================

/**
 * Creates a stable query key for log queries.
 */
function createLogQueryKey(params: UseLogQueryParams): readonly unknown[] {
  return [
    "logs",
    params.workflowId,
    {
      taskName: params.taskName,
      levels: params.levels?.sort().join(","),
      sources: params.sources?.sort().join(","),
      search: params.search,
      searchMode: params.searchMode,
      start: params.start?.toISOString(),
      end: params.end?.toISOString(),
    },
  ] as const;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for fetching and filtering log entries.
 *
 * Features:
 * - Cursor-based pagination with manual "load more"
 * - Automatic cache invalidation
 * - Non-blocking updates via startTransition
 * - Stable query keys for React Query caching
 *
 * @param params - Query parameters
 * @returns Query state and control functions
 */
export function useLogQuery(params: UseLogQueryParams): UseLogQueryReturn {
  const adapter = useLogAdapter();
  const queryClient = useQueryClient();

  // Track accumulated entries and cursor
  const [allEntries, setAllEntries] = useState<LogEntry[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);

  const pageSize = params.pageSize ?? LOG_QUERY_DEFAULTS.PAGE_SIZE;
  const queryKey = useMemo(() => createLogQueryKey(params), [params]);

  // Build the query params
  const logQuery: LogQuery = useMemo(
    () => ({
      workflowId: params.workflowId,
      taskName: params.taskName,
      levels: params.levels,
      sources: params.sources,
      search: params.search,
      searchMode: params.searchMode,
      start: params.start,
      end: params.end,
      limit: pageSize,
      cursor,
      direction: "forward" as const,
    }),
    [params, pageSize, cursor],
  );

  // Main query
  const query = useQuery<LogQueryResult, Error>({
    queryKey: [...queryKey, cursor],
    queryFn: async () => adapter.query(logQuery),
    enabled: params.enabled !== false && !!params.workflowId,
    staleTime: 30_000, // 30 seconds
  });

  // Update accumulated entries when query succeeds
  useEffect(() => {
    if (query.data) {
      startTransition(() => {
        if (!cursor) {
          // First page - replace all entries
          setAllEntries(query.data.entries);
        } else {
          // Subsequent pages - append
          setAllEntries((prev) => [...prev, ...query.data.entries]);
        }
        setHasMore(query.data.hasMore);
      });
    }
  }, [query.data, cursor]);

  // Fetch next page
  const fetchNextPage = useCallback(() => {
    const nextCursor = query.data?.nextCursor;
    if (nextCursor && hasMore && !query.isFetching) {
      startTransition(() => {
        setCursor(nextCursor);
      });
    }
  }, [query.data, hasMore, query.isFetching]);

  // Refresh - reset to first page
  const refetch = useCallback(() => {
    startTransition(() => {
      setCursor(undefined);
      setAllEntries([]);
      setHasMore(true);
    });
    query.refetch();
  }, [query]);

  // Invalidate cache and refetch
  const invalidate = useCallback(() => {
    adapter.invalidateCache(params.workflowId);
    queryClient.invalidateQueries({ queryKey: ["logs", params.workflowId] });
    refetch();
  }, [adapter, params.workflowId, queryClient, refetch]);

  return {
    entries: allEntries,
    isLoading: query.isLoading && allEntries.length === 0,
    isFetchingNextPage: query.isFetching && allEntries.length > 0,
    error: query.error,
    hasMore,
    totalLoaded: allEntries.length,
    fetchNextPage,
    refetch,
    invalidate,
  };
}
