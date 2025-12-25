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

import { useState, useMemo, useCallback } from "react";
import { fetchResources, type Resource, type PaginatedResourcesResult } from "@/lib/api/adapter";
import { useDataTable } from "@/lib/pagination";
import { useSetFilter, useDeferredSearch, useActiveFilters, type FilterDefinition } from "@/lib/filters";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { StorageKeys } from "@/lib/constants/storage";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { AllResourcesFilterType, ResourceDisplayMode } from "./types";

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
   * Total resources matching current filters.
   * IDEAL: Server returns accurate filtered count.
   * SHIM: Count of loaded+filtered resources (may be incomplete during pagination).
   */
  totalCount?: number;

  /**
   * @deprecated Use `resources` instead. Kept for backward compatibility.
   * Will be removed once all components migrate.
   */
  filteredResources: Resource[];

  /**
   * @deprecated Use `totalCount` instead.
   */
  filteredCount: number;

  /**
   * @deprecated Implementation detail, will be removed.
   */
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
  // Data Table with Pagination
  // ==========================================================================

  // Build query key that includes ALL filter params
  // IDEAL: All filters are server-side, so any change resets pagination
  // SHIM: Only pools/platforms go to server; search/resourceType filtered client-side
  const queryKey = useMemo(
    () => [
      "resources",
      {
        pools: Array.from(poolFilter.selected).sort(),
        platforms: Array.from(platformFilter.selected).sort(),
        // IDEAL: Include these in query key when backend supports server-side filtering
        // search: search.deferredValue,
        // resourceTypes: Array.from(resourceTypeFilter.selected).sort(),
      },
    ],
    [poolFilter.selected, platformFilter.selected],
  );

  // IDEAL filter params - what we WOULD send to a perfect backend
  const filterParams = useMemo(
    () => ({
      pools: poolFilter.hasSelection ? Array.from(poolFilter.selected) : undefined,
      platforms: platformFilter.hasSelection ? Array.from(platformFilter.selected) : undefined,
      // BACKEND TODO: Add support for these server-side filters
      // search: search.deferredValue.trim() || undefined,
      // resourceTypes: resourceTypeFilter.hasSelection
      //   ? Array.from(resourceTypeFilter.selected)
      //   : undefined,
    }),
    [poolFilter.hasSelection, poolFilter.selected, platformFilter.hasSelection, platformFilter.selected],
  );

  // Use data table hook - provides paginated data fetching
  const {
    items: allLoadedResources,
    totalCount: serverTotalCount,
    loadedCount,
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

  // SHIM: Extract available filter options from loaded data
  // IDEAL: Backend provides these in a separate endpoint or as metadata
  // BACKEND TODO: Add /api/resources/filters endpoint returning available pools, platforms
  const { pools, platforms } = useMemo(() => {
    const poolSet = new Set<string>();
    const platformSet = new Set<string>();

    for (const resource of allLoadedResources) {
      platformSet.add(resource.platform);
      for (const membership of resource.poolMemberships) {
        poolSet.add(membership.pool);
      }
    }

    return {
      pools: Array.from(poolSet).sort(),
      platforms: Array.from(platformSet).sort(),
    };
  }, [allLoadedResources]);

  // SHIM: Derive resource types from loaded resources
  // IDEAL: Backend provides this
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    allLoadedResources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [allLoadedResources]);

  // ==========================================================================
  // Client-Side Filtering SHIM
  // ==========================================================================
  // SHIM: Filter client-side until backend supports server-side filtering
  // IDEAL: Remove this entire section - server returns only matching resources
  // BACKEND TODO: Add search and resourceTypes query params to /api/resources

  const resources = useMemo(() => {
    let result = allLoadedResources;

    // SHIM: Filter by resource type (should be server-side)
    if (resourceTypeFilter.hasSelection) {
      result = result.filter((resource) => resourceTypeFilter.selected.has(resource.resourceType));
    }

    // SHIM: Filter by search (should be server-side)
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
  }, [allLoadedResources, search.deferredValue, resourceTypeFilter.selected, resourceTypeFilter.hasSelection]);

  // SHIM: Calculate filtered count from client-side filtering
  // IDEAL: Server returns accurate count in response
  const totalCount = serverTotalCount;
  const filteredCount = resources.length;

  // Backward compatibility alias
  const filteredResources = resources;

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
    totalCount, // Total matching filters (from server when supported)

    // Backward compatibility (deprecated)
    filteredResources, // Same as resources
    filteredCount, // Same as resources.length
    loadedCount, // Implementation detail

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
