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
 * Headless hook for the Resources page behavior.
 *
 * Provides logic for viewing all resources across pools,
 * with filtering by pool, platform, search, and resource type.
 *
 * This hook demonstrates the composition pattern using:
 * - lib/filters for filter state management
 *
 * The same pattern can be used for workflows, tasks, pools, etc.
 */

import { useState, useMemo, useCallback } from "react";
import { useAllResources as useAllResourcesQuery, type Resource } from "@/lib/api/adapter";
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
  allResources: Resource[];
  filteredResources: Resource[];
  resourceCount: number;
  filteredResourceCount: number;

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

  // Query state
  isLoading: boolean;
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
  // Data Fetching
  // ==========================================================================

  const { resources, pools, platforms, isLoading, error, refetch } = useAllResourcesQuery();

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
  // Derived Data
  // ==========================================================================

  // Derive resource types from all resources
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    resources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [resources]);

  // Filter resources by pool, platform, search, AND resource type
  // Uses deferredSearch for non-blocking search updates
  const filteredResources = useMemo(() => {
    let result = resources;

    // Filter by pools
    if (poolFilter.hasSelection) {
      result = result.filter((resource) => resource.poolMemberships.some((m) => poolFilter.selected.has(m.pool)));
    }

    // Filter by platform
    if (platformFilter.hasSelection) {
      result = result.filter((resource) => platformFilter.selected.has(resource.platform));
    }

    // Filter by resource type
    if (resourceTypeFilter.hasSelection) {
      result = result.filter((resource) => resourceTypeFilter.selected.has(resource.resourceType));
    }

    // Filter by search (using deferred value for smooth typing)
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
  }, [
    resources,
    search.deferredValue,
    poolFilter.selected,
    poolFilter.hasSelection,
    platformFilter.selected,
    platformFilter.hasSelection,
    resourceTypeFilter.selected,
    resourceTypeFilter.hasSelection,
  ]);

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
    allResources: resources,
    filteredResources,
    resourceCount: resources.length,
    filteredResourceCount: filteredResources.length,

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

    // Query state
    isLoading,
    error,
    refetch,
  };
}
