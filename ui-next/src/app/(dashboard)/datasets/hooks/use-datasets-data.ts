// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Data hook for datasets page with server-side filtering and infinite scroll.
 *
 * Architecture:
 * - Uses usePaginatedData for offset-based pagination with infinite scroll
 * - Passes FilterBar chips directly to backend API for server-side filtering
 * - Returns paginated data for UI
 *
 * Server-side filtering:
 * - All filters (name, bucket, user) are passed to the backend
 * - Backend handles filtering and pagination
 * - No client-side filtering needed
 */

"use client";

import { useMemo } from "react";
import type { SearchChip } from "@/stores/types";
import type { PaginationParams, PaginatedResponse } from "@/lib/api/pagination/types";
import { usePaginatedData } from "@/lib/api/pagination/use-paginated-data";
import type { Dataset } from "@/lib/api/adapter/datasets";
import {
  fetchPaginatedDatasets,
  buildDatasetsQueryKey,
  hasActiveFilters,
  type DatasetFilterParams,
} from "@/lib/api/adapter/datasets";
import { QUERY_STALE_TIME } from "@/lib/config";

// =============================================================================
// Types
// =============================================================================

interface UseDatasetsDataParams {
  /** Search chips from FilterBar */
  searchChips: SearchChip[];
  /** Show all users' datasets (default: false = current user only) */
  showAllUsers?: boolean;
  /** Number of datasets per page (default: 50) */
  pageSize?: number;
}

interface UseDatasetsDataReturn {
  /** Datasets from the current query */
  datasets: Dataset[];
  /** All loaded datasets (for suggestions in FilterBar) */
  allDatasets: Dataset[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total datasets before filtering (if available from server) */
  total: number;
  /** Total datasets after filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Whether there are more datasets available */
  hasMore: boolean;
  /** Function to load next page */
  fetchNextPage: () => void;
  /** Whether currently loading more data */
  isFetchingNextPage: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useDatasetsData({
  searchChips,
  showAllUsers = false,
  pageSize = 50,
}: UseDatasetsDataParams): UseDatasetsDataReturn {
  // Build stable query key - changes when filters or showAllUsers change, which resets pagination
  const queryKey = useMemo(() => buildDatasetsQueryKey(searchChips, showAllUsers), [searchChips, showAllUsers]);

  // Use paginated data hook for infinite scroll
  const {
    items: datasets,
    filteredCount,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = usePaginatedData<Dataset, DatasetFilterParams>({
    queryKey,
    queryFn: async (params: PaginationParams & DatasetFilterParams): Promise<PaginatedResponse<Dataset>> => {
      return fetchPaginatedDatasets(params);
    },
    params: { searchChips, showAllUsers },
    config: {
      pageSize,
      // Datasets are relatively static - use STATIC stale time (5 minutes)
      staleTime: QUERY_STALE_TIME.STATIC,
    },
  });

  return {
    datasets,
    // For FilterBar suggestions, we use the currently loaded datasets
    // This provides a reasonable suggestion pool without fetching all data
    allDatasets: datasets,
    hasActiveFilters: hasActiveFilters(searchChips),
    total: totalCount ?? datasets.length,
    filteredTotal: filteredCount ?? datasets.length,
    isLoading,
    error,
    refetch,
    hasMore: hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  };
}
