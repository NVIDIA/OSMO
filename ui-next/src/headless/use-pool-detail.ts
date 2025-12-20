/**
 * Headless hook for pool detail page behavior.
 *
 * Provides logic for viewing a single pool's details,
 * filtering nodes by search and platform, etc.
 */

import { useState, useMemo, useCallback } from "react";
import { usePool, usePoolResources, type Node, type PlatformConfig } from "@/lib/api/adapter";
import type { HTTPValidationError } from "@/lib/api/generated";

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
  platformConfigs: Record<string, PlatformConfig>;

  // Node data
  allNodes: Node[];
  filteredNodes: Node[];
  nodeCount: number;
  filteredNodeCount: number;

  // Search behavior
  search: string;
  setSearch: (query: string) => void;
  clearSearch: () => void;
  hasSearch: boolean;

  // Platform filter behavior
  selectedPlatforms: Set<string>;
  togglePlatform: (platform: string) => void;
  selectAllPlatforms: () => void;
  clearPlatformFilter: () => void;
  isPlatformSelected: (platform: string) => boolean;
  hasActiveFilter: boolean;

  // Query state
  isLoading: boolean;
  poolError: HTTPValidationError | null;
  resourcesError: HTTPValidationError | null;
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

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

  // Filter nodes by search AND platform
  const filteredNodes = useMemo(() => {
    let result = nodes;

    // Filter by platform (if any selected)
    if (selectedPlatforms.size > 0) {
      result = result.filter((node) => selectedPlatforms.has(node.platform));
    }

    // Filter by search
    if (search.trim()) {
      const query = search.toLowerCase();
      result = result.filter(
        (node) =>
          node.nodeName.toLowerCase().includes(query) ||
          node.platform.toLowerCase().includes(query)
      );
    }

    return result;
  }, [nodes, search, selectedPlatforms]);

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

  const selectAllPlatforms = useCallback(() => {
    setSelectedPlatforms(new Set(platforms));
  }, [platforms]);

  const clearPlatformFilter = useCallback(() => {
    setSelectedPlatforms(new Set());
  }, []);

  const isPlatformSelected = useCallback(
    (platform: string) => selectedPlatforms.has(platform),
    [selectedPlatforms]
  );

  // Search handlers
  const clearSearch = useCallback(() => setSearch(""), []);

  // Refetch all
  const refetch = useCallback(() => {
    refetchPool();
    refetchResources();
  }, [refetchPool, refetchResources]);

  return {
    // Pool data
    pool,
    platforms,
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
    selectAllPlatforms,
    clearPlatformFilter,
    isPlatformSelected,
    hasActiveFilter: selectedPlatforms.size > 0 || search.length > 0,

    // Query state
    isLoading: poolLoading || resourcesLoading,
    poolError,
    resourcesError,
    refetch,
  };
}
