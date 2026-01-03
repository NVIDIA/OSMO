/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Data hook for resources page with SmartSearch chip filtering.
 *
 * This hook fetches resources and applies client-side filtering
 * based on SmartSearch chips.
 */

"use client";

import { useMemo } from "react";
import {
  fetchResources,
  type Resource,
  type PaginatedResourcesResult,
} from "@/lib/api/adapter";
import { useDataTable } from "@/lib/pagination";
import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import { createResourceSearchFields } from "../lib/resource-search-fields";

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
  // Create search fields for matching
  const searchFields = useMemo(() => createResourceSearchFields(), []);

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
  } = useDataTable<Resource, Record<string, never>>({
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
    () => filterByChips(allResources, searchChips, searchFields),
    [allResources, searchChips, searchFields],
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
