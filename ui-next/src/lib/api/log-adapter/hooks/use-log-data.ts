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

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";

import type { LogEntry, LogDataResult, HistogramResult, FieldFacet } from "@/lib/api/log-adapter/types";
import { PlainTextAdapter } from "@/lib/api/log-adapter/adapters/plain-text-adapter";
import { FACETABLE_FIELDS, LOG_QUERY_DEFAULTS } from "@/lib/api/log-adapter/constants";
import { createLogDataQueryKey, type LogDataQueryKeyParams } from "@/lib/api/log-adapter/query-keys";

export interface UseLogDataParams extends LogDataQueryKeyParams {
  enabled?: boolean;
  staleTime?: number;
  keepPrevious?: boolean;
}

export interface UseLogDataReturn {
  data: LogDataResult | undefined;
  entries: LogEntry[];
  histogram: HistogramResult;
  facets: FieldFacet[];
  stats: { totalCount: number; filteredCount: number };
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isPlaceholderData: boolean;
  error: Error | null;
  refetch: () => void;
}

export { createLogDataQueryKey } from "@/lib/api/log-adapter/query-keys";

const EMPTY_HISTOGRAM: HistogramResult = { buckets: [], intervalMs: 60_000 };
const EMPTY_FACETS: FieldFacet[] = [];
const EMPTY_STATS = { totalCount: 0, filteredCount: 0 };

// Module-level singleton - adapter is stateless so no need to recreate per-hook
const adapter = new PlainTextAdapter({ baseUrl: "" });

/**
 * Unified hook for fetching log data (entries, histogram, facets).
 * SSR compatible via HydrationBoundary.
 */
export function useLogData(params: UseLogDataParams): UseLogDataReturn {
  const queryKey = useMemo(() => createLogDataQueryKey(params), [params]);

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
