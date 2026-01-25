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
 * useLogData Hook
 *
 * Unified TanStack Query hook for fetching all log data in a single call.
 * Returns entries, histogram, and facets together for efficient caching.
 *
 * This is the primary hook for log data access. It replaces the pattern
 * of calling useLogQuery, useLogHistogram, and useLogFacets separately.
 *
 * Benefits:
 * - Single network request for all data
 * - SSR compatible via HydrationBoundary
 * - Efficient React Query caching
 * - Simpler component code
 */

"use client";

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import type { LogEntry, LogDataResult, HistogramResult, FieldFacet } from "../types";
import { PlainTextAdapter } from "../adapters/plain-text-adapter";
import { FACETABLE_FIELDS, LOG_QUERY_DEFAULTS } from "../constants";
import { createLogDataQueryKey, type LogDataQueryKeyParams } from "../query-keys";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the useLogData hook.
 * Extends the query key params with hook-specific options.
 */
export interface UseLogDataParams extends LogDataQueryKeyParams {
  /** Whether to enable the query (default: true) */
  enabled?: boolean;
  /** Stale time in milliseconds (default: 30000) */
  staleTime?: number;
  /**
   * Keep previous data visible while refetching (default: true).
   * Prevents flash/flicker when filters change.
   */
  keepPrevious?: boolean;
}

/**
 * Return value from useLogData.
 */
export interface UseLogDataReturn {
  /** Full query result (undefined while loading) */
  data: LogDataResult | undefined;
  /** Filtered log entries (empty array while loading) */
  entries: LogEntry[];
  /** Histogram data (empty buckets while loading) */
  histogram: HistogramResult;
  /** Facet data (empty array while loading) */
  facets: FieldFacet[];
  /** Statistics (zero counts while loading) */
  stats: { totalCount: number; filteredCount: number };
  /** Whether the query is loading */
  isLoading: boolean;
  /** Whether this is the initial load (no data yet) */
  isPending: boolean;
  /** Whether we're refetching in the background */
  isFetching: boolean;
  /** Whether current data is from placeholder (previous query) */
  isPlaceholderData: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Refetch the data */
  refetch: () => void;
}

// Re-export query key factory from shared module
export { createLogDataQueryKey } from "../query-keys";

// =============================================================================
// Default Values
// =============================================================================

const EMPTY_HISTOGRAM: HistogramResult = { buckets: [], intervalMs: 60_000 };
const EMPTY_FACETS: FieldFacet[] = [];
const EMPTY_STATS = { totalCount: 0, filteredCount: 0 };

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Unified hook for fetching all log data.
 *
 * @param params - Query parameters
 * @returns Log data with loading/error states
 *
 * @example
 * ```tsx
 * const { entries, histogram, facets, isLoading, error } = useLogData({
 *   workflowId: "my-workflow",
 *   levels: ["error", "warn"],
 *   search: "timeout",
 * });
 *
 * if (isLoading) return <Skeleton />;
 * if (error) return <Error error={error} />;
 *
 * return (
 *   <LogViewer
 *     entries={entries}
 *     histogram={histogram}
 *     facets={facets}
 *   />
 * );
 * ```
 */
export function useLogData(params: UseLogDataParams): UseLogDataReturn {
  // Build stable query key
  // Caller should memoize params object to prevent unnecessary regeneration
  const queryKey = useMemo(() => createLogDataQueryKey(params), [params]);

  // Create adapter with dev params if provided
  const adapter = useMemo(
    () =>
      new PlainTextAdapter({
        baseUrl: "",
        devParams: params.devParams,
      }),
    [params.devParams],
  );

  // Execute query
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      adapter.queryAll(
        {
          workflowId: params.workflowId,
          groupId: params.groupId,
          taskId: params.taskId,
          levels: params.levels,
          tasks: params.tasks,
          retries: params.retries,
          sources: params.sources,
          search: params.search,
          searchRegex: params.searchRegex,
          start: params.start,
          end: params.end,
          histogramBuckets: params.histogramBuckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS,
          facetFields: params.facetFields ?? FACETABLE_FIELDS,
        },
        signal,
      ),
    staleTime: params.staleTime ?? 30_000,
    enabled: params.enabled ?? true,
    // keepPrevious: Show skeleton during refetch for data correctness
    // Can be disabled per-call via params.keepPrevious if needed
    placeholderData: params.keepPrevious ? keepPreviousData : undefined,
  });

  return {
    data: query.data,
    entries: query.data?.entries ?? [],
    histogram: query.data?.histogram ?? EMPTY_HISTOGRAM,
    facets: query.data?.facets ?? EMPTY_FACETS,
    stats: query.data?.stats ?? EMPTY_STATS,
    isLoading: query.isLoading,
    isPending: query.isPending,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    error: query.error,
    refetch: query.refetch,
  };
}
