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
 * Data hook for datasets page.
 *
 * Architecture:
 * - Uses `usePaginatedData` with `fetchPaginatedDatasets` for server-side
 *   pagination, filtering, and sorting (mirrors workflows pattern).
 * - All filtering (name, bucket, user, type) and sorting (updated_at) are server-side.
 * - DataTable uses virtual scrolling + infinite scroll for display.
 */

"use client";

import { useMemo } from "react";
import type { SearchChip } from "@/stores/types";
import type { PaginationParams, PaginatedResponse } from "@/lib/api/pagination/types";
import { usePaginatedData } from "@/lib/api/pagination/use-paginated-data";
import {
  fetchPaginatedDatasets,
  buildDatasetsQueryKey,
  hasActiveFilters as hasActiveDatasetsFilters,
  type Dataset,
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
  /** Sort direction for updated_at ordering */
  sortDirection?: "ASC" | "DESC";
}

interface UseDatasetsDataReturn {
  /** Paginated datasets for display */
  datasets: Dataset[];
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total datasets before filtering */
  total: number;
  /** Total datasets after filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
  /** Whether more pages are available */
  hasMore: boolean;
  /** Function to load next page */
  fetchNextPage: () => void;
  /** Loading state for next page fetch */
  isFetchingNextPage: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useDatasetsData({
  searchChips,
  showAllUsers: showAllUsersProp = false,
  sortDirection = "DESC",
}: UseDatasetsDataParams): UseDatasetsDataReturn {
  const hasUserChips = useMemo(() => searchChips.some((chip) => chip.field === "user"), [searchChips]);
  const showAllUsers = hasUserChips ? false : showAllUsersProp;

  const queryKey = useMemo(
    () => buildDatasetsQueryKey(searchChips, showAllUsers, sortDirection),
    [searchChips, showAllUsers, sortDirection],
  );

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
    params: { searchChips, showAllUsers, sortDirection },
    config: {
      pageSize: 50,
      staleTime: QUERY_STALE_TIME.STANDARD,
    },
  });

  return {
    datasets,
    hasActiveFilters: hasActiveDatasetsFilters(searchChips),
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
