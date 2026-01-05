/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data hook for resources page with SmartSearch chip filtering.
 *
 * This hook fetches resources and applies client-side filtering
 * based on SmartSearch chips.
 */

"use client";

import { useMemo } from "react";
import { fetchResources, type Resource, type PaginatedResourcesResult } from "@/lib/api/adapter";
import { usePaginatedData } from "@/lib/api/pagination";
import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import { RESOURCE_SEARCH_FIELDS } from "../lib/resource-search-fields";

// =============================================================================
// Types
// =============================================================================

interface UseResourcesDataParams {
  searchChips: SearchChip[];
}

interface UseResourcesDataReturn {
  /** Filtered resources (after applying search chips) */
  resources: Resource[];
  /** All resources (unfiltered, for suggestions) */
  allResources: Resource[];
  filteredCount?: number;
  totalCount?: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useResourcesData({ searchChips }: UseResourcesDataParams): UseResourcesDataReturn {
  // Build query key - any change to chips triggers refetch
  const queryKey = useMemo(
    () => [
      "resources",
      {
        chips: searchChips.map((c) => `${c.field}:${c.value}`).sort(),
      },
    ],
    [searchChips],
  );

  // Use data table hook for pagination
  const {
    items: allResources,
    filteredCount: rawFilteredCount,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    error,
    refetch,
  } = usePaginatedData<Resource, Record<string, never>>({
    queryKey,
    queryFn: async (params): Promise<PaginatedResourcesResult> => {
      // Fetch all resources (adapter handles pagination)
      return fetchResources(params);
    },
    params: {},
    config: {
      pageSize: 50,
      staleTime: 60_000,
    },
  });

  // Apply SmartSearch chip filtering client-side
  // Uses shared filterByChips: same field = OR, different fields = AND
  const filteredResources = useMemo(
    () => filterByChips(allResources, searchChips, RESOURCE_SEARCH_FIELDS),
    [allResources, searchChips],
  );

  return {
    resources: filteredResources,
    allResources,
    filteredCount: searchChips.length > 0 ? filteredResources.length : rawFilteredCount,
    totalCount,
    isLoading,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  };
}
