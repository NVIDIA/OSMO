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
import type { SearchChip } from "@/lib/stores";
import { createResourceSearchFields } from "@/components/features/resources/lib";

// =============================================================================
// Types
// =============================================================================

interface UseResourcesDataParams {
  searchChips: SearchChip[];
}

interface UseResourcesDataReturn {
  resources: Resource[];
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
  const filteredResources = useMemo(() => {
    if (searchChips.length === 0) return allResources;

    return allResources.filter((resource) => {
      // All chips must match (AND logic)
      return searchChips.every((chip) => {
        // Find the field definition
        const field = searchFields.find((f) => f.id === chip.field || f.prefix === `${chip.field}:`);
        if (!field) {
          // Fallback: match against name
          return resource.name.toLowerCase().includes(chip.value.toLowerCase());
        }
        return field.match(resource, chip.value);
      });
    });
  }, [allResources, searchChips, searchFields]);

  return {
    resources: filteredResources,
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
