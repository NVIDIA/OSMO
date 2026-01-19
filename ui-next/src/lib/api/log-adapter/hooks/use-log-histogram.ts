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
 * useLogHistogram Hook
 *
 * Provides histogram data for log timeline visualization.
 * Computed client-side from the log index.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { LogQuery, HistogramBucket, LogLevel } from "../types";
import { LOG_QUERY_DEFAULTS } from "../constants";
import { useLogAdapter } from "./use-log-adapter";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the useLogHistogram hook.
 */
export interface UseLogHistogramParams {
  /** Workflow ID to fetch histogram for */
  workflowId: string;
  /** Filter by task name */
  taskName?: string;
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
  /** Number of histogram buckets */
  buckets?: number;
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Return value from useLogHistogram.
 */
export interface UseLogHistogramReturn {
  /** Histogram buckets */
  buckets: HistogramBucket[];
  /** Bucket interval in milliseconds */
  intervalMs: number;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Refresh the histogram */
  refetch: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for fetching histogram data for log timeline visualization.
 *
 * The histogram shows log density over time, with counts per log level
 * for stacked visualization.
 *
 * @param params - Query parameters
 * @returns Histogram data and loading state
 */
export function useLogHistogram(params: UseLogHistogramParams): UseLogHistogramReturn {
  const adapter = useLogAdapter();
  const numBuckets = params.buckets ?? LOG_QUERY_DEFAULTS.HISTOGRAM_BUCKETS;

  // Build stable query key
  const queryKey = useMemo(
    () => [
      "logs",
      "histogram",
      params.workflowId,
      {
        taskName: params.taskName,
        levels: params.levels?.sort().join(","),
        start: params.start?.toISOString(),
        end: params.end?.toISOString(),
        buckets: numBuckets,
      },
    ],
    [params.workflowId, params.taskName, params.levels, params.start, params.end, numBuckets],
  );

  // Build query params
  const logQuery: Omit<LogQuery, "cursor" | "limit"> = useMemo(
    () => ({
      workflowId: params.workflowId,
      taskName: params.taskName,
      levels: params.levels,
      start: params.start,
      end: params.end,
    }),
    [params],
  );

  const query = useQuery({
    queryKey,
    queryFn: async () => adapter.histogram(logQuery, numBuckets),
    enabled: params.enabled !== false && !!params.workflowId,
    staleTime: 30_000, // 30 seconds
  });

  return {
    buckets: query.data?.buckets ?? [],
    intervalMs: query.data?.intervalMs ?? 60_000,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
