/**
 * Headless hook for pool detail page behavior.
 *
 * Provides logic for viewing a single pool's details,
 * filtering resources by search and platform, etc.
 *
 * NOTE: This hook makes 2 API calls (pool + resources).
 * See BACKEND_TODOS.md#10 for the optimization opportunity.
 */

import { useMemo, useCallback } from "react";
import { matchesSearch } from "@/lib/utils";
import { usePool, usePoolResources, deriveResourceTypes, type Resource, type PlatformConfig } from "@/lib/api/adapter";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { isBackendResourceType } from "@/lib/constants/ui";
import {
  useUrlSearch,
  useUrlSetFilter,
  useUrlResourceTypeFilter,
  useActiveFilters,
  type FilterDefinition,
} from "@/lib/filters";
import type { ActiveFilter, PoolDetailFilterType, ResourceDisplayMode } from "./types";
import { useDisplayMode } from "./use-display-mode";

// =============================================================================
// Types
// =============================================================================

export interface UsePoolDetailOptions {
  poolName: string;
}

export interface UsePoolDetailReturn {
  // Pool data
  pool: ReturnType<typeof usePool>["pool"];
  platforms: string[];
  resourceTypes: BackendResourceType[];
  platformConfigs: Record<string, PlatformConfig>;

  // Resource data
  allResources: Resource[];
  filteredResources: Resource[];
  resourceCount: number;
  filteredResourceCount: number;

  // Unified filter state
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;

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
  activeFilters: ActiveFilter<PoolDetailFilterType>[];
  removeFilter: (filter: ActiveFilter<PoolDetailFilterType>) => void;
  clearAllFilters: () => void;
  hasActiveFilter: boolean;
  filterCount: number;

  // Query state
  isLoading: boolean;
  poolError: HTTPValidationError | null;
  resourcesError: HTTPValidationError | null;
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function usePoolDetail({ poolName }: UsePoolDetailOptions): UsePoolDetailReturn {
  // Fetch data
  const { pool, isLoading: poolLoading, error: poolError, refetch: refetchPool } = usePool(poolName);

  const {
    resources,
    platforms,
    isLoading: resourcesLoading,
    error: resourcesError,
    refetch: refetchResources,
  } = usePoolResources(poolName);

  // ==========================================================================
  // Filter State (URL-synced for shareable/bookmarkable URLs)
  // ==========================================================================

  // Search with deferred value for non-blocking updates
  // URL: /pools/[name]?q=search-term
  const search = useUrlSearch("q");

  // Platform filter (multi-select)
  // URL: /pools/[name]?platforms=linux&platforms=windows
  const platformFilter = useUrlSetFilter("platforms");

  // Resource type filter (single-select with type-safe validation)
  // URL: /pools/[name]?type=gpu
  const resourceTypeFilter = useUrlResourceTypeFilter("type");

  // Resource display mode (persisted to localStorage)
  const { displayMode, setDisplayMode } = useDisplayMode();

  // ==========================================================================
  // Derived Data
  // ==========================================================================

  // Derive resource types from all resources (not filtered)
  const resourceTypes = useMemo(() => deriveResourceTypes(resources), [resources]);

  // Filter resources by search, platform, AND resource type
  const filteredResources = useMemo(() => {
    let result = resources;

    // Filter by platform
    if (platformFilter.hasSelection) {
      result = result.filter((resource) => platformFilter.selected.has(resource.platform));
    }

    // Filter by resource type
    if (resourceTypeFilter.hasSelection) {
      result = result.filter((resource) => resourceTypeFilter.selected.has(resource.resourceType));
    }

    // Filter by search (use deferred value for non-blocking filtering)
    if (search.deferredValue.trim()) {
      result = result.filter((resource) =>
        matchesSearch(resource, search.deferredValue, (r) => [r.name, r.platform, r.resourceType]),
      );
    }

    return result;
  }, [
    resources,
    search.deferredValue,
    platformFilter.selected,
    platformFilter.hasSelection,
    resourceTypeFilter.selected,
    resourceTypeFilter.hasSelection,
  ]);

  // ==========================================================================
  // Active Filters (using shared active filters hook)
  // ==========================================================================

  const filterDefinitions = useMemo<FilterDefinition<PoolDetailFilterType>[]>(
    () => [
      {
        type: "search",
        getValues: () => (search.value.trim() ? [search.value] : []),
        getLabel: (v) => `"${v}"`,
        remove: () => search.clear(),
        clear: () => search.clear(),
      },
      {
        type: "platform",
        getValues: () => Array.from(platformFilter.selected),
        remove: (v) => platformFilter.toggle(v),
        clear: () => platformFilter.clear(),
      },
      {
        type: "resourceType",
        getValues: () => Array.from(resourceTypeFilter.selected),
        remove: (v) => {
          if (isBackendResourceType(v)) {
            resourceTypeFilter.toggle(v);
          }
        },
        clear: () => resourceTypeFilter.clear(),
      },
    ],
    [search, platformFilter, resourceTypeFilter],
  );

  const activeFiltersHook = useActiveFilters(filterDefinitions);

  // ==========================================================================
  // Refetch
  // ==========================================================================

  const refetch = useCallback(() => {
    refetchPool();
    refetchResources();
  }, [refetchPool, refetchResources]);

  // ==========================================================================
  // Return Interface
  // ==========================================================================

  return {
    // Pool data
    pool,
    platforms,
    resourceTypes,
    platformConfigs: pool?.platformConfigs ?? {},

    // Resource data
    allResources: resources,
    filteredResources,
    resourceCount: resources.length,
    filteredResourceCount: filteredResources.length,

    // Search behavior
    search: search.value,
    setSearch: search.setValue,
    clearSearch: search.clear,
    hasSearch: search.hasValue,

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
    activeFilters: activeFiltersHook.filters,
    removeFilter: activeFiltersHook.remove,
    clearAllFilters: activeFiltersHook.clearAll,
    hasActiveFilter: activeFiltersHook.hasFilters,
    filterCount: activeFiltersHook.count,

    // Query state
    isLoading: poolLoading || resourcesLoading,
    poolError,
    resourcesError,
    refetch,
  };
}
