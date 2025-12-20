/**
 * Headless hook for pools list behavior.
 *
 * Provides all business logic for listing, searching, filtering,
 * and grouping pools - without any styling.
 *
 * Use this hook in your themed component to get consistent behavior
 * while applying your own design.
 */

import { useState, useMemo, useCallback } from "react";
import { usePools, type Pool, type PoolStatus } from "@/lib/api/adapter";
import type { HTTPValidationError } from "@/lib/api/generated";
import {
  PoolStatus as PoolStatusEnum,
  PoolStatusDisplay,
  DefaultPoolStatusDisplay,
} from "@/lib/constants/ui";

// =============================================================================
// Types
// =============================================================================

export interface PoolGroup {
  /** Pool status for this group */
  status: PoolStatus;
  /** Pools in this group */
  pools: Pool[];
  /** Display icon (emoji) */
  icon: string;
  /** Display label */
  label: string;
}

export interface UsePoolsListOptions {
  /** Name of the user's default pool (for pinning) */
  defaultPoolName?: string;
}

export interface UsePoolsListReturn {
  // Data
  /** All pools (unfiltered) */
  allPools: Pool[];
  /** Filtered pools based on search */
  filteredPools: Pool[];
  /** Pools grouped by status */
  groupedPools: PoolGroup[];
  /** User's default pool (if set) */
  defaultPool: Pool | null;
  /** Total pool count */
  totalCount: number;
  /** Filtered pool count */
  filteredCount: number;

  // Search behavior
  /** Current search query */
  search: string;
  /** Update search query */
  setSearch: (query: string) => void;
  /** Clear search */
  clearSearch: () => void;
  /** Whether search is active */
  hasSearch: boolean;

  // Collapse behavior
  /** Toggle a section's collapsed state */
  toggleSection: (status: PoolStatus) => void;
  /** Check if a section is collapsed */
  isSectionCollapsed: (status: PoolStatus, poolCount: number) => boolean;

  // Query state
  /** Loading state */
  isLoading: boolean;
  /** Error from API (validation error) or null */
  error: HTTPValidationError | null;
  /** Refetch pools */
  refetch: () => void;
}

// =============================================================================
// Constants
// =============================================================================

/** Order in which status groups are displayed */
const STATUS_ORDER: PoolStatus[] = [
  PoolStatusEnum.ONLINE,
  PoolStatusEnum.MAINTENANCE,
  PoolStatusEnum.OFFLINE,
];

// =============================================================================
// Hook
// =============================================================================

export function usePoolsList(
  options: UsePoolsListOptions = {}
): UsePoolsListReturn {
  const { defaultPoolName } = options;

  // Fetch pools from API
  const { pools, isLoading, error, refetch } = usePools();

  // Local state
  const [search, setSearch] = useState("");
  const [manuallyToggled, setManuallyToggled] = useState<Set<PoolStatus>>(
    new Set()
  );

  // Filter by search
  const filteredPools = useMemo(() => {
    if (!search.trim()) return pools;
    const query = search.toLowerCase();
    return pools.filter(
      (pool) =>
        pool.name.toLowerCase().includes(query) ||
        pool.description.toLowerCase().includes(query)
    );
  }, [pools, search]);

  // Group by status
  const groupedPools = useMemo((): PoolGroup[] => {
    const groups: PoolGroup[] = [];

    for (const status of STATUS_ORDER) {
      const statusPools = filteredPools.filter((p) => p.status === status);
      // Show group if it has pools, or if no search is active (show empty groups)
      if (statusPools.length > 0 || !search) {
        const display = PoolStatusDisplay[status] ?? DefaultPoolStatusDisplay;
        groups.push({
          status,
          pools: statusPools,
          icon: display.icon,
          label: display.label,
        });
      }
    }

    return groups;
  }, [filteredPools, search]);

  // Default pool
  const defaultPool = useMemo(() => {
    if (!defaultPoolName) return null;
    return pools.find((p) => p.name === defaultPoolName) ?? null;
  }, [pools, defaultPoolName]);

  // Toggle section collapse
  const toggleSection = useCallback((status: PoolStatus) => {
    setManuallyToggled((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }, []);

  // Check if section is collapsed
  // Empty sections are collapsed by default, but user can toggle them
  const isSectionCollapsed = useCallback(
    (status: PoolStatus, poolCount: number): boolean => {
      const wasManuallyToggled = manuallyToggled.has(status);
      const isEmptyByDefault = poolCount === 0;

      // XOR logic: default state flipped if manually toggled
      return wasManuallyToggled ? !isEmptyByDefault : isEmptyByDefault;
    },
    [manuallyToggled]
  );

  // Clear search
  const clearSearch = useCallback(() => setSearch(""), []);

  return {
    // Data
    allPools: pools,
    filteredPools,
    groupedPools,
    defaultPool,
    totalCount: pools.length,
    filteredCount: filteredPools.length,

    // Search behavior
    search,
    setSearch,
    clearSearch,
    hasSearch: search.length > 0,

    // Collapse behavior
    toggleSection,
    isSectionCollapsed,

    // Query state
    isLoading,
    error,
    refetch,
  };
}
