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
 * Headless hook for infinite scroll resources page behavior.
 *
 * Similar to useAllResources but with infinite scroll pagination support.
 * Provides:
 * - Paginated resource loading with cursor-based navigation
 * - Filter state management (pools, platforms, search, resource type)
 * - Infinite scroll controls (hasNextPage, fetchNextPage, etc.)
 *
 * Performance optimizations:
 * - Server-side pagination reduces initial load time
 * - useDeferredValue for non-blocking filter updates
 * - useCallback for stable function references
 * - Query key includes all filter params for cache coherence
 */

"use client";

import { useState, useMemo, useCallback, useDeferredValue, useTransition } from "react";
import { fetchPaginatedAllResources, type Resource, type PaginatedResourcesResult } from "@/lib/api/adapter";
import { useInfiniteDataTable } from "@/lib/pagination";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { StorageKeys } from "@/lib/constants/storage";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";
import type { ActiveFilter, AllResourcesFilterType, ResourceDisplayMode } from "./types";

// =============================================================================
// Types
// =============================================================================

export interface UseInfiniteResourcesReturn {
  // Resource data
  resources: Resource[];
  filteredResources: Resource[];
  loadedCount: number;
  totalCount?: number;

  // Available filter options (from first page response)
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

export function useInfiniteResources(): UseInfiniteResourcesReturn {
  // Local filter state
  const [search, setSearchState] = useState("");
  const [selectedPools, setSelectedPools] = useState<Set<string>>(new Set());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<Set<BackendResourceType>>(new Set());

  // Deferred search for non-blocking updates during typing
  const deferredSearch = useDeferredValue(search);

  // Transition for filter updates - keeps UI responsive
  const [, startFilterTransition] = useTransition();

  // Wrapped setSearch to use deferred updates
  const setSearch = useCallback((value: string) => {
    startFilterTransition(() => {
      setSearchState(value);
    });
  }, []);

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

  // Build query key that includes all filter params
  // When filters change, query key changes → pagination resets automatically
  const queryKey = useMemo(
    () => [
      "resources",
      "infinite",
      {
        pools: Array.from(selectedPools).sort(),
        platforms: Array.from(selectedPlatforms).sort(),
      },
    ],
    [selectedPools, selectedPlatforms],
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
      pools: selectedPools.size > 0 ? Array.from(selectedPools) : undefined,
      platforms: selectedPlatforms.size > 0 ? Array.from(selectedPlatforms) : undefined,
    },
    config: {
      pageSize: 50,
      staleTime: 60_000,
    },
  });

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
    if (selectedResourceTypes.size > 0) {
      result = result.filter((resource) => selectedResourceTypes.has(resource.resourceType));
    }

    // Filter by search (client-side, using deferred value for smooth typing)
    if (deferredSearch.trim()) {
      const query = deferredSearch.toLowerCase();
      result = result.filter(
        (resource) =>
          resource.name.toLowerCase().includes(query) ||
          resource.platform.toLowerCase().includes(query) ||
          resource.resourceType.toLowerCase().includes(query) ||
          resource.poolMemberships.some((m) => m.pool.toLowerCase().includes(query)),
      );
    }

    return result;
  }, [allResources, deferredSearch, selectedResourceTypes]);

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
  const clearSearch = useCallback(() => setSearchState(""), []);

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
        setSearchState("");
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
    setSearchState("");
    setSelectedPools(new Set());
    setSelectedPlatforms(new Set());
    setSelectedResourceTypes(new Set());
  }, []);

  const hasActiveFilter =
    selectedPools.size > 0 || selectedPlatforms.size > 0 || selectedResourceTypes.size > 0 || search.length > 0;

  return {
    // Resource data
    resources: allResources,
    filteredResources,
    loadedCount,
    totalCount,

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
