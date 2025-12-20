/**
 * Headless hook for pool detail page behavior.
 *
 * Provides logic for viewing a single pool's details,
 * filtering nodes by search and platform, etc.
 */

import { useState, useMemo, useCallback } from "react";
import {
  usePool,
  usePoolResources,
  type Node,
  type PlatformConfig,
  type ResourceType,
} from "@/lib/api/adapter";
import type { HTTPValidationError } from "@/lib/api/generated";

// =============================================================================
// Types
// =============================================================================

export interface UsePoolDetailOptions {
  poolName: string;
}

/**
 * Represents an active filter that can be displayed and removed.
 */
export interface ActiveFilter {
  type: "search" | "platform" | "resourceType";
  value: string;
  label: string;
}

export interface UsePoolDetailReturn {
  // Pool data
  pool: ReturnType<typeof usePool>["pool"];
  platforms: string[];
  resourceTypes: ResourceType[];
  platformConfigs: Record<string, PlatformConfig>;

  // Node data
  allNodes: Node[];
  filteredNodes: Node[];
  nodeCount: number;
  filteredNodeCount: number;

  // Unified filter state
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;

  selectedPlatforms: Set<string>;
  togglePlatform: (platform: string) => void;
  clearPlatformFilter: () => void;

  selectedResourceTypes: Set<ResourceType>;
  toggleResourceType: (type: ResourceType) => void;
  clearResourceTypeFilter: () => void;

  // Active filters (for chips display)
  activeFilters: ActiveFilter[];
  removeFilter: (filter: ActiveFilter) => void;
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

/** All possible resource types for filtering */
const ALL_RESOURCE_TYPES: ResourceType[] = ["SHARED", "RESERVED", "UNUSED"];

export function usePoolDetail({
  poolName,
}: UsePoolDetailOptions): UsePoolDetailReturn {
  // Fetch data
  const {
    pool,
    isLoading: poolLoading,
    error: poolError,
    refetch: refetchPool,
  } = usePool(poolName);

  const {
    nodes,
    platforms,
    isLoading: resourcesLoading,
    error: resourcesError,
    refetch: refetchResources,
  } = usePoolResources(poolName);

  // Local state
  const [search, setSearch] = useState("");
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(
    new Set()
  );
  const [selectedResourceTypes, setSelectedResourceTypes] = useState<
    Set<ResourceType>
  >(new Set());

  // Derive available resource types from nodes
  const resourceTypes = useMemo(() => {
    const types = new Set<ResourceType>();
    nodes.forEach((node) => types.add(node.resourceType));
    // Return in consistent order
    return ALL_RESOURCE_TYPES.filter((t) => types.has(t));
  }, [nodes]);

  // Filter nodes by search, platform, AND resource type
  const filteredNodes = useMemo(() => {
    let result = nodes;

    // Filter by platform
    if (selectedPlatforms.size > 0) {
      result = result.filter((node) => selectedPlatforms.has(node.platform));
    }

    // Filter by resource type
    if (selectedResourceTypes.size > 0) {
      result = result.filter((node) =>
        selectedResourceTypes.has(node.resourceType)
      );
    }

    // Filter by search (matches node name, platform, resource type)
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (node) =>
          node.nodeName.toLowerCase().includes(query) ||
          node.platform.toLowerCase().includes(query) ||
          node.resourceType.toLowerCase().includes(query)
      );
    }

    return result;
  }, [nodes, search, selectedPlatforms, selectedResourceTypes]);

  // Platform filter handlers
  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      next.has(platform) ? next.delete(platform) : next.add(platform);
      return next;
    });
  }, []);

  const clearPlatformFilter = useCallback(() => {
    setSelectedPlatforms(new Set());
  }, []);

  // Resource type filter handlers
  const toggleResourceType = useCallback((type: ResourceType) => {
    setSelectedResourceTypes((prev) => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });
  }, []);

  const clearResourceTypeFilter = useCallback(() => {
    setSelectedResourceTypes(new Set());
  }, []);

  // Search handlers
  const clearSearch = useCallback(() => setSearch(""), []);

  // Build active filters for chips display
  const activeFilters = useMemo<ActiveFilter[]>(() => {
    const filters: ActiveFilter[] = [];

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
  const removeFilter = useCallback((filter: ActiveFilter) => {
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
      case "resourceType":
        setSelectedResourceTypes((prev) => {
          const next = new Set(prev);
          next.delete(filter.value as ResourceType);
          return next;
        });
        break;
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

  const hasActiveFilter =
    selectedPlatforms.size > 0 ||
    selectedResourceTypes.size > 0 ||
    search.length > 0;

  return {
    // Pool data
    pool,
    platforms,
    resourceTypes,
    platformConfigs: pool?.platformConfigs ?? {},

    // Node data
    allNodes: nodes,
    filteredNodes,
    nodeCount: nodes.length,
    filteredNodeCount: filteredNodes.length,

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
