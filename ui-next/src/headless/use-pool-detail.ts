/**
 * Headless hook for pool detail page behavior.
 *
 * Provides logic for viewing a single pool's details,
 * filtering resources by search and platform, etc.
 *
 * NOTE: This hook makes 2 API calls (pool + resources).
 * See BACKEND_TODOS.md#10 for the optimization opportunity.
 */

import { useState, useMemo, useCallback } from "react";
import { usePool, usePoolResources, type Resource, type PlatformConfig } from "@/lib/api/adapter";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
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

/** Type guard for BackendResourceType */
function isBackendResourceType(value: string): value is BackendResourceType {
  return (ALL_RESOURCE_TYPES as readonly string[]).includes(value);
}

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

  // Local state
  const [search, setSearch] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<Set<BackendResourceType>>(new Set());

  // Resource display mode (persisted to localStorage)
  const { displayMode, setDisplayMode } = useDisplayMode();

  // Derive resource types from all resources (not filtered)
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    resources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [resources]);

  // Filter resources by search, platform, AND resource type
  const filteredResources = useMemo(() => {
    let result = resources;

    // Filter by platform
    if (selectedPlatforms.size > 0) {
      result = result.filter((resource) => selectedPlatforms.has(resource.platform));
    }

    // Filter by resource type
    if (selectedResourceTypes.size > 0) {
      result = result.filter((resource) => selectedResourceTypes.has(resource.resourceType));
    }

    // Filter by search
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (resource) =>
          resource.name.toLowerCase().includes(query) ||
          resource.platform.toLowerCase().includes(query) ||
          resource.resourceType.toLowerCase().includes(query),
      );
    }

    return result;
  }, [resources, search, selectedPlatforms, selectedResourceTypes]);

  // Platform filter handlers
  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) {
        next.delete(platform);
      } else {
        next.add(platform);
      }
      return next;
    });
  }, []);

  const clearPlatformFilter = useCallback(() => {
    setSelectedPlatforms(new Set());
  }, []);

  // Resource type filter handlers (single-select: selecting same type deselects)
  const toggleResourceType = useCallback((type: BackendResourceType) => {
    setSelectedResourceTypes((prev) => {
      // If already selected, deselect (clear)
      if (prev.has(type)) {
        return new Set();
      }
      // Otherwise, select only this one
      return new Set([type]);
    });
  }, []);

  const clearResourceTypeFilter = useCallback(() => {
    setSelectedResourceTypes(new Set());
  }, []);

  // Search handlers
  const clearSearch = useCallback(() => setSearch(""), []);

  // Build active filters for chips display
  const activeFilters = useMemo<ActiveFilter<PoolDetailFilterType>[]>(() => {
    const filters: ActiveFilter<PoolDetailFilterType>[] = [];

    if (search.trim()) {
      filters.push({
        type: "search",
        value: search,
        label: `"${search}"`,
      });
    }

    selectedPlatforms.forEach((platform) => {
      filters.push({
        type: "platform",
        value: platform,
        label: platform,
      });
    });

    selectedResourceTypes.forEach((type) => {
      filters.push({
        type: "resourceType",
        value: type,
        label: type,
      });
    });

    return filters;
  }, [search, selectedPlatforms, selectedResourceTypes]);

  // Remove a specific filter
  const removeFilter = useCallback((filter: ActiveFilter<PoolDetailFilterType>) => {
    switch (filter.type) {
      case "search":
        setSearch("");
        break;
      case "platform":
        setSelectedPlatforms((prev) => {
          const next = new Set(prev);
          next.delete(filter.value);
          return next;
        });
        break;
      case "resourceType": {
        const resourceType = filter.value;
        if (isBackendResourceType(resourceType)) {
          setSelectedResourceTypes((prev) => {
            const next = new Set(prev);
            next.delete(resourceType);
            return next;
          });
        }
        break;
      }
    }
  }, []);

  // Clear all filters
  const clearAllFilters = useCallback(() => {
    setSearch("");
    setSelectedPlatforms(new Set());
    setSelectedResourceTypes(new Set());
  }, []);

  // Refetch all
  const refetch = useCallback(() => {
    refetchPool();
    refetchResources();
  }, [refetchPool, refetchResources]);

  const hasActiveFilter = selectedPlatforms.size > 0 || selectedResourceTypes.size > 0 || search.length > 0;

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
    search,
    setSearch,
    clearSearch,
    hasSearch: search.length > 0,

    // Platform filter behavior
    selectedPlatforms,
    togglePlatform,
    clearPlatformFilter,

    // Resource type filter behavior
    selectedResourceTypes,
    toggleResourceType,
    clearResourceTypeFilter,

    // Resource display mode
    displayMode,
    setDisplayMode,

    // Active filters
    activeFilters,
    removeFilter,
    clearAllFilters,
    hasActiveFilter,
    filterCount: activeFilters.length,

    // Query state
    isLoading: poolLoading || resourcesLoading,
    poolError,
    resourcesError,
    refetch,
  };
}
