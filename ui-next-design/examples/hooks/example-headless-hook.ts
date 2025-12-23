/**
 * EXAMPLE: Headless Hook Pattern
 * 
 * This is a simplified version showing the key patterns for headless hooks.
 * Headless hooks contain ALL business logic - NO UI code.
 */

import { useState, useMemo, useCallback } from "react";
import { usePool, usePoolResources, type Resource } from "@/lib/api/adapter";
import { type BackendResourceType, type HTTPValidationError } from "@/lib/api/generated";
import { ALL_RESOURCE_TYPES } from "@/lib/constants/ui";

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

  // Resource data
  allResources: Resource[];
  filteredResources: Resource[];
  resourceCount: number;

  // Search behavior
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;

  // Platform filter behavior
  selectedPlatforms: Set<string>;
  togglePlatform: (platform: string) => void;
  clearPlatformFilter: () => void;

  // Resource type filter behavior
  selectedResourceTypes: Set<BackendResourceType>;
  toggleResourceType: (type: BackendResourceType) => void;

  // Active filter count (for badge display)
  filterCount: number;

  // Query state
  isLoading: boolean;
  error: HTTPValidationError | null;
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function usePoolDetail({
  poolName,
}: UsePoolDetailOptions): UsePoolDetailReturn {
  // Fetch data via adapter hooks
  const {
    pool,
    isLoading: poolLoading,
    error: poolError,
    refetch: refetchPool,
  } = usePool(poolName);

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

  // Memoized: Filter resources by all criteria
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
          resource.platform.toLowerCase().includes(query)
      );
    }

    return result;
  }, [resources, search, selectedPlatforms, selectedResourceTypes]);

  // Callbacks: Platform filter
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

  // Callbacks: Resource type filter (single-select)
  const toggleResourceType = useCallback((type: BackendResourceType) => {
    setSelectedResourceTypes((prev) => {
      // If already selected, deselect
      if (prev.has(type)) {
        return new Set();
      }
      // Otherwise, select only this one
      return new Set([type]);
    });
  }, []);

  // Callbacks: Search
  const clearSearch = useCallback(() => setSearch(""), []);

  // Callbacks: Refetch all
  const refetch = useCallback(() => {
    refetchPool();
    refetchResources();
  }, [refetchPool, refetchResources]);

  // Computed: Filter count for badge
  const filterCount = useMemo(() => {
    let count = 0;
    if (search.trim()) count++;
    count += selectedPlatforms.size;
    count += selectedResourceTypes.size;
    return count;
  }, [search, selectedPlatforms, selectedResourceTypes]);

  // Return everything the UI needs
  return {
    // Pool data
    pool,
    platforms,

    // Resource data
    allResources: resources,
    filteredResources,
    resourceCount: resources.length,

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

    // Filter count
    filterCount,

    // Query state
    isLoading: poolLoading || resourcesLoading,
    error: poolError || resourcesError,
    refetch,
  };
}
