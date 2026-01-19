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
 * useLogFacets Hook
 *
 * Provides facet data for the log viewer Fields pane.
 * Shows distinct values and counts for filterable fields.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { LogQuery, FieldFacet, LogLevel } from "../types";
import { FACETABLE_FIELDS } from "../constants";
import { useLogAdapter } from "./use-log-adapter";

// =============================================================================
// Types
// =============================================================================

/**
 * Parameters for the useLogFacets hook.
 */
export interface UseLogFacetsParams {
  /** Workflow ID to fetch facets for */
  workflowId: string;
  /** Fields to compute facets for (default: all facetable fields) */
  fields?: string[];
  /** Filter by task name */
  taskName?: string;
  /** Filter by log levels */
  levels?: LogLevel[];
  /** Start of time range */
  start?: Date;
  /** End of time range */
  end?: Date;
  /** Whether to enable the query */
  enabled?: boolean;
}

/**
 * Return value from useLogFacets.
 */
export interface UseLogFacetsReturn {
  /** Facet data for each requested field */
  facets: FieldFacet[];
  /** Get facet by field name */
  getFacet: (field: string) => FieldFacet | undefined;
  /** Whether the query is loading */
  isLoading: boolean;
  /** Error if the query failed */
  error: Error | null;
  /** Refresh the facets */
  refetch: () => void;
}

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for fetching facet data for log filtering.
 *
 * Facets provide:
 * - List of distinct values for each field
 * - Count of entries for each value
 * - Sorted by count descending for relevance
 *
 * @param params - Query parameters
 * @returns Facet data and loading state
 */
export function useLogFacets(params: UseLogFacetsParams): UseLogFacetsReturn {
  const adapter = useLogAdapter();
  const fields = params.fields ?? FACETABLE_FIELDS;

  // Build stable query key
  const queryKey = useMemo(
    () => [
      "logs",
      "facets",
      params.workflowId,
      {
        fields: fields.sort().join(","),
        taskName: params.taskName,
        levels: params.levels?.sort().join(","),
        start: params.start?.toISOString(),
        end: params.end?.toISOString(),
      },
    ],
    [params.workflowId, fields, params.taskName, params.levels, params.start, params.end],
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
    queryFn: async () => adapter.facets(logQuery, fields),
    enabled: params.enabled !== false && !!params.workflowId,
    staleTime: 30_000, // 30 seconds
  });

  // Memoized helper to get facet by field name
  const getFacet = useMemo(() => {
    const facetMap = new Map(query.data?.map((f) => [f.field, f]) ?? []);
    return (field: string) => facetMap.get(field);
  }, [query.data]);

  return {
    facets: query.data ?? [],
    getFacet,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
