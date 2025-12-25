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
 * Headless hook for viewing resources with filtering and pagination.
 *
 * ARCHITECTURE: This hook is written assuming a "perfect backend" that handles:
 * - Server-side pagination (cursor-based)
 * - Server-side filtering (pools, platforms, search, resource types)
 * - Accurate counts (total and filtered)
 *
 * The adapter layer (lib/api/adapter) provides shims for backend limitations.
 * When backend is updated, the adapter changes - this hook stays the same.
 *
 * See: lib/api/adapter/BACKEND_TODOS.md for required backend changes.
 */

"use client";

import { useMemo } from "react";
import {
  fetchResources,
  getResourceFilterOptions,
  type Resource,
  type PaginatedResourcesResult,
} from "@/lib/api/adapter";
import { useDataTable } from "@/lib/pagination";
import { useSetFilter, useDeferredSearch, useActiveFilters, type FilterDefinition } from "@/lib/filters";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { AllResourcesFilterType, ResourceDisplayMode } from "./types";
import { useDisplayMode } from "./use-display-mode";

// =============================================================================
// Types
// =============================================================================

export interface UseResourcesReturn {
  // Resource data
  /**
   * Resources to display (after all filters applied).
   * IDEAL: Server returns only matching resources.
   * SHIM: Adapter fetches all, filters client-side for search/resourceType.
   */
  resources: Resource[];

  /**
   * Count of resources matching current filters (the "X" in "X of Y").
   * IDEAL: Server returns accurate filtered count.
   * SHIM: Count of loaded+filtered resources (may be incomplete during pagination).
   */
  filteredCount?: number;

  /**
   * Total resources before any filters applied (the "Y" in "X of Y").
   * This value remains constant regardless of filters.
   */
  totalCount?: number;

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

  // Pagination state
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

export function useResources(): UseResourcesReturn {
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

  const { displayMode, setDisplayMode } = useDisplayMode();

  // ==========================================================================
  // Data Table with Pagination
  // ==========================================================================

  // Build query key that includes ALL filter params
  // Any change to filters resets pagination (adapter handles filtering)
  const queryKey = useMemo(
    () => [
      "resources",
      {
        pools: Array.from(poolFilter.selected).sort(),
        platforms: Array.from(platformFilter.selected).sort(),
        resourceTypes: Array.from(resourceTypeFilter.selected).sort(),
        search: search.deferredValue,
      },
    ],
    [poolFilter.selected, platformFilter.selected, resourceTypeFilter.selected, search.deferredValue],
  );

  // Filter params passed to adapter (handles client-side filtering shim)
  const filterParams = useMemo(
    () => ({
      pools: poolFilter.hasSelection ? Array.from(poolFilter.selected) : undefined,
      platforms: platformFilter.hasSelection ? Array.from(platformFilter.selected) : undefined,
      resourceTypes: resourceTypeFilter.hasSelection ? Array.from(resourceTypeFilter.selected) : undefined,
      search: search.deferredValue.trim() || undefined,
    }),
    [
      poolFilter.hasSelection,
      poolFilter.selected,
      platformFilter.hasSelection,
      platformFilter.selected,
      resourceTypeFilter.hasSelection,
      resourceTypeFilter.selected,
      search.deferredValue,
    ],
  );

  // Use data table hook - provides paginated data fetching
  // Adapter handles client-side filtering shim until backend supports it
  const {
    items: resources,
    filteredCount,
    totalCount,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useDataTable<Resource, typeof filterParams>({
    queryKey,
    queryFn: async (params): Promise<PaginatedResourcesResult> => {
      // Adapter handles the gap between ideal API and current backend
      // including client-side filtering shim (see adapter/pagination.ts)
      return fetchResources(params);
    },
    params: filterParams,
    config: {
      pageSize: 50,
      staleTime: 60_000,
    },
  });

  // ==========================================================================
  // Derived Data - Filter Options
  // ==========================================================================

  // Get filter options from adapter cache (unfiltered data)
  // This ensures options don't disappear when filters are applied
  // IDEAL: Backend provides these in a separate endpoint or as metadata
  // BACKEND TODO: Add /api/resources/filters endpoint returning available pools, platforms
  const { pools, platforms } = useMemo(() => {
    // Try to get from adapter cache first (unfiltered data)
    const cachedOptions = getResourceFilterOptions();
    if (cachedOptions) {
      return cachedOptions;
    }

    // Fallback: derive from currently loaded resources
    const poolSet = new Set<string>();
    const platformSet = new Set<string>();

    for (const resource of resources) {
      platformSet.add(resource.platform);
      for (const membership of resource.poolMemberships) {
        poolSet.add(membership.pool);
      }
    }

    return {
      pools: Array.from(poolSet).sort(),
      platforms: Array.from(platformSet).sort(),
    };
  }, [resources]);

  // Derive resource types from loaded resources
  // IDEAL: Backend provides this
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    resources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [resources]);

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
    // Resource data (primary interface)
    resources, // Filtered resources ready to display
    filteredCount, // Count matching filters (the "X" in "X of Y")
    totalCount, // Total before filters (the "Y" in "X of Y")

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

    // Pagination state
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
