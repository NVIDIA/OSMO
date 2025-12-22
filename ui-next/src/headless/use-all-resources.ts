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
 */

import { useState, useMemo, useCallback } from "react";
import {
  useAllResources as useAllResourcesQuery,
  type Resource,
} from "@/lib/api/adapter";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { StorageKeys } from "@/lib/constants/storage";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { ActiveFilter, AllResourcesFilterType, ResourceDisplayMode } from "./types";

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
  activeFilters: ActiveFilter<AllResourcesFilterType>[];
  removeFilter: (filter: ActiveFilter<AllResourcesFilterType>) => void;
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
  // Fetch data
  const {
    resources,
    pools,
    platforms,
    isLoading,
    error,
    refetch,
  } = useAllResourcesQuery();

  // Local state
  const [search, setSearch] = useState("");
  const [selectedPools, setSelectedPools] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<Set<BackendResourceType>>(new Set());

  // Resource display mode (persisted to localStorage)
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

  // Derive resource types from all resources
  const resourceTypes = useMemo(() => {
    const types = new Set<BackendResourceType>();
    resources.forEach((resource) => types.add(resource.resourceType));
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [resources]);

  // Filter resources by pool, platform, search, AND resource type
  const filteredResources = useMemo(() => {
    let result = resources;

    // Filter by pools
    if (selectedPools.size > 0) {
      result = result.filter((resource) =>
        resource.poolMemberships.some((m) => selectedPools.has(m.pool))
      );
    }

    // Filter by platform
    if (selectedPlatforms.size > 0) {
      result = result.filter((resource) => selectedPlatforms.has(resource.platform));
    }

    // Filter by resource type
    if (selectedResourceTypes.size > 0) {
      result = result.filter((resource) =>
        selectedResourceTypes.has(resource.resourceType)
      );
    }

    // Filter by search
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (resource) =>
          resource.name.toLowerCase().includes(query) ||
          resource.platform.toLowerCase().includes(query) ||
          resource.resourceType.toLowerCase().includes(query) ||
          resource.poolMemberships.some((m) => m.pool.toLowerCase().includes(query))
      );
    }

    return result;
  }, [resources, search, selectedPools, selectedPlatforms, selectedResourceTypes]);

  // Pool filter handlers
  const togglePool = useCallback((pool: string) => {
    setSelectedPools((prev) => {
      const next = new Set(prev);
      if (next.has(pool)) {
        next.delete(pool);
      } else {
        next.add(pool);
      }
      return next;
    });
  }, []);

  const clearPoolFilter = useCallback(() => {
    setSelectedPools(new Set());
  }, []);

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
      if (prev.has(type)) {
        return new Set();
      }
      return new Set([type]);
    });
  }, []);

  const clearResourceTypeFilter = useCallback(() => {
    setSelectedResourceTypes(new Set());
  }, []);

  // Search handlers
  const clearSearch = useCallback(() => setSearch(""), []);

  // Build active filters for chips display
  const activeFilters = useMemo<ActiveFilter<AllResourcesFilterType>[]>(() => {
    const filters: ActiveFilter<AllResourcesFilterType>[] = [];

    if (search.trim()) {
      filters.push({
        type: "search",
        value: search,
        label: `"${search}"`,
      });
    }

    selectedPools.forEach((pool) => {
      filters.push({
        type: "pool",
        value: pool,
        label: pool,
      });
    });

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
  }, [search, selectedPools, selectedPlatforms, selectedResourceTypes]);

  // Remove a specific filter
  const removeFilter = useCallback((filter: ActiveFilter<AllResourcesFilterType>) => {
    switch (filter.type) {
      case "search":
        setSearch("");
        break;
      case "pool":
        setSelectedPools((prev) => {
          const next = new Set(prev);
          next.delete(filter.value);
          return next;
        });
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
    setSelectedPools(new Set());
    setSelectedPlatforms(new Set());
    setSelectedResourceTypes(new Set());
  }, []);

  const hasActiveFilter =
    selectedPools.size > 0 ||
    selectedPlatforms.size > 0 ||
    selectedResourceTypes.size > 0 ||
    search.length > 0;

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
    search,
    setSearch,
    clearSearch,
    hasSearch: search.length > 0,

    // Pool filter behavior
    selectedPools,
    togglePool,
    clearPoolFilter,

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
    isLoading,
    error,
    refetch,
  };
}
