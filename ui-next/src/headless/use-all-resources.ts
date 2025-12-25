/**
 * Copyright (c) 2025, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Headless hook for viewing resources with filtering and infinite scroll.
 *
 * Provides:
 * - Paginated resource loading with cursor-based navigation
 * - Filter state management (pools, platforms, search, resource type)
 * - Infinite scroll controls for virtualized tables
 *
 * This hook demonstrates the composition pattern using:
 * - lib/pagination for infinite scroll primitives
 * - lib/filters for filter state management
 *
 * The same pattern can be used for workflows, tasks, pools, etc.
 */

"use client";

import { useState, useMemo, useCallback } from "react";
import { fetchPaginatedAllResources, type Resource, type PaginatedResourcesResult } from "@/lib/api/adapter";
import { useInfiniteDataTable } from "@/lib/pagination";
import { useSetFilter, useDeferredSearch, useActiveFilters, type FilterDefinition } from "@/lib/filters";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { StorageKeys } from "@/lib/constants/storage";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { AllResourcesFilterType, ResourceDisplayMode } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface UseAllResourcesReturn {
  // Resource data
  /** All loaded resources (before client-side filtering) */
  allResources: Resource[];
  /** Resources after all filters applied */
  filteredResources: Resource[];
  /** Total resources available (from API, if known) */
  resourceCount?: number;
  /** Number of resources after filtering */
  filteredResourceCount: number;
  /** Number of resources currently loaded */
  loadedCount: number;

  // Available filter options
  pools: string[];
  platforms: string[];
  resourceTypes: BackendResourceType[];

  // Unified filter state
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;

  selectedPools: Set<string>;
  togglePool: (pool: string) => void;
  clearPoolFilter: () => void;

  selectedPlatforms: Set<string>;
  togglePlatform: (platform: string) => void;
  clearPlatformFilter: () => void;

  selectedResourceTypes: Set<BackendResourceType>;
  toggleResourceType: (type: BackendResourceType) => void;
  clearResourceTypeFilter: () => void;

  // Resource display mode (free vs used)
  displayMode: ResourceDisplayMode;
  setDisplayMode: (mode: ResourceDisplayMode) => void;

  // Active filters (for chips display)
  activeFilters: { type: AllResourcesFilterType; value: string; label: string }[];
  removeFilter: (filter: { type: AllResourcesFilterType; value: string; label: string }) => void;
  clearAllFilters: () => void;
  hasActiveFilter: boolean;
  filterCount: number;

  // Infinite scroll state
  hasNextPage: boolean;
  fetchNextPage: () => void;
  isFetchingNextPage: boolean;

  // Query state
  isLoading: boolean;
  isRefetching: boolean;
  error: HTTPValidationError | null;
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

/** Type guard for BackendResourceType */
function isBackendResourceType(value: string): value is BackendResourceType {
  return (ALL_RESOURCE_TYPES as readonly string[]).includes(value);
}

export function useAllResources(): UseAllResourcesReturn {
  // ==========================================================================
  // Filter State (using generic filter primitives)
  // ==========================================================================

  // Search with deferred value for non-blocking updates
  const search = useDeferredSearch();

  // Set-based filters
  const poolFilter = useSetFilter<string>();
  const platformFilter = useSetFilter<string>();
  const resourceTypeFilter = useSetFilter<BackendResourceType>({ singleSelect: true });

  // ==========================================================================
  // Display Mode (persisted to localStorage)
  // ==========================================================================

  const [displayMode, setDisplayModeState] = useState<ResourceDisplayMode>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(StorageKeys.RESOURCE_DISPLAY_MODE);
      if (stored === "free" || stored === "used") {
        return stored;
      }
    }
    return "free";
  });

  const setDisplayMode = useCallback((mode: ResourceDisplayMode) => {
    setDisplayModeState(mode);
    localStorage.setItem(StorageKeys.RESOURCE_DISPLAY_MODE, mode);
  }, []);

  // ==========================================================================
  // Infinite Pagination
  // ==========================================================================

  // Build query key that includes all server-side filter params
  // When filters change, query key changes → pagination resets automatically
  const queryKey = useMemo(
    () => [
      "resources",
      "all",
      {
        pools: Array.from(poolFilter.selected).sort(),
        platforms: Array.from(platformFilter.selected).sort(),
      },
    ],
    [poolFilter.selected, platformFilter.selected],
  );

  // Use infinite pagination
  const {
    items: allResources,
    totalCount,
    loadedCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useInfiniteDataTable<Resource, { pools?: string[]; platforms?: string[] }>({
    queryKey,
    queryFn: async (params): Promise<PaginatedResourcesResult> => {
      return fetchPaginatedAllResources(params);
    },
    params: {
      pools: poolFilter.hasSelection ? Array.from(poolFilter.selected) : undefined,
      platforms: platformFilter.hasSelection ? Array.from(platformFilter.selected) : undefined,
    },
    config: {
      pageSize: 50,
      staleTime: 60_000,
    },
  });

  // ==========================================================================
  // Derived Data
  // ==========================================================================

  // Extract unique pools and platforms from loaded resources
  const { pools, platforms } = useMemo(() => {
    const poolSet = new Set<string>();
    const platformSet = new Set<string>();

    for (const resource of allResources) {
      platformSet.add(resource.platform);
      for (const membership of resource.poolMemberships) {
        poolSet.add(membership.pool);
      }
    }

    return {
      pools: Array.from(poolSet).sort(),
      platforms: Array.from(platformSet).sort(),
    };
  }, [allResources]);

  // Derive resource types from loaded resources
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    allResources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [allResources]);

  // Client-side filtering for search and resource type
  // Pool/platform filters are handled server-side via query params
  const filteredResources = useMemo(() => {
    let result = allResources;

    // Filter by resource type (client-side)
    if (resourceTypeFilter.hasSelection) {
      result = result.filter((resource) => resourceTypeFilter.selected.has(resource.resourceType));
    }

    // Filter by search (client-side, using deferred value for smooth typing)
    if (search.deferredValue.trim()) {
      const query = search.deferredValue.toLowerCase();
      result = result.filter(
        (resource) =>
          resource.name.toLowerCase().includes(query) ||
          resource.platform.toLowerCase().includes(query) ||
          resource.resourceType.toLowerCase().includes(query) ||
          resource.poolMemberships.some((m) => m.pool.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [allResources, search.deferredValue, resourceTypeFilter.selected, resourceTypeFilter.hasSelection]);

  // ==========================================================================
  // Active Filters (using generic active filters hook)
  // ==========================================================================

  const filterDefinitions = useMemo<FilterDefinition<AllResourcesFilterType>[]>(
    () => [
      {
        type: "search",
        getValues: () => (search.value.trim() ? [search.value] : []),
        getLabel: (v) => `"${v}"`,
        remove: () => search.clear(),
      },
      {
        type: "pool",
        getValues: () => Array.from(poolFilter.selected),
        remove: (v) => poolFilter.toggle(v),
      },
      {
        type: "platform",
        getValues: () => Array.from(platformFilter.selected),
        remove: (v) => platformFilter.toggle(v),
      },
      {
        type: "resourceType",
        getValues: () => Array.from(resourceTypeFilter.selected),
        remove: (v) => {
          if (isBackendResourceType(v)) {
            resourceTypeFilter.toggle(v);
          }
        },
      },
    ],
    [search, poolFilter, platformFilter, resourceTypeFilter],
  );

  const activeFilters = useActiveFilters(filterDefinitions);

  // ==========================================================================
  // Return Interface
  // ==========================================================================

  return {
    // Resource data
    allResources,
    filteredResources,
    resourceCount: totalCount,
    filteredResourceCount: filteredResources.length,
    loadedCount,

    // Available filter options
    pools,
    platforms,
    resourceTypes,

    // Search behavior
    search: search.value,
    setSearch: search.setValue,
    clearSearch: search.clear,
    hasSearch: search.hasValue,

    // Pool filter behavior
    selectedPools: poolFilter.selected,
    togglePool: poolFilter.toggle,
    clearPoolFilter: poolFilter.clear,

    // Platform filter behavior
    selectedPlatforms: platformFilter.selected,
    togglePlatform: platformFilter.toggle,
    clearPlatformFilter: platformFilter.clear,

    // Resource type filter behavior
    selectedResourceTypes: resourceTypeFilter.selected,
    toggleResourceType: resourceTypeFilter.toggle,
    clearResourceTypeFilter: resourceTypeFilter.clear,

    // Resource display mode
    displayMode,
    setDisplayMode,

    // Active filters
    activeFilters: activeFilters.filters,
    removeFilter: activeFilters.remove,
    clearAllFilters: activeFilters.clearAll,
    hasActiveFilter: activeFilters.hasFilters,
    filterCount: activeFilters.count,

    // Infinite scroll state
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,

    // Query state
    isLoading,
    isRefetching,
    error: error as HTTPValidationError | null,
    refetch,
  };
}
