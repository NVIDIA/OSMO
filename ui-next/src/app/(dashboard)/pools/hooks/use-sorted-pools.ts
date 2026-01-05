/**
 * Copyright (c) 2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Hook to sort pools and build sharing map.
 *
 * This hook receives pre-filtered pools and:
 * - Sorts them by the current sort column
 * - Builds a sharing map for UI indicators
 *
 * Simplified from usePoolSections - no status grouping.
 */

import { useMemo } from "react";
import type { Pool } from "@/lib/api/adapter";
import type { SortState } from "@/components/data-table";
import type { PoolColumnId } from "../lib/pool-columns";

// =============================================================================
// Sorting
// =============================================================================

function sortPools(
  pools: Pool[],
  sort: SortState<PoolColumnId>,
  displayMode: "used" | "free",
): Pool[] {
  if (!sort.column) return pools;

  return [...pools].sort((a, b) => {
    let cmp = 0;
    switch (sort.column) {
      case "name":
        cmp = a.name.localeCompare(b.name);
        break;
      case "status":
        cmp = a.status.localeCompare(b.status);
        break;
      case "backend":
        cmp = a.backend.localeCompare(b.backend);
        break;
      case "quota":
        // Sort by available (free) or used based on displayMode
        cmp = displayMode === "free"
          ? a.quota.free - b.quota.free
          : a.quota.used - b.quota.used;
        break;
      case "capacity":
        // Sort by total available (totalFree) or totalUsage based on displayMode
        cmp = displayMode === "free"
          ? a.quota.totalFree - b.quota.totalFree
          : a.quota.totalUsage - b.quota.totalUsage;
        break;
      // "platforms" and "description" are not sortable - no case needed
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });
}

// =============================================================================
// Hook
// =============================================================================

interface UseSortedPoolsOptions {
  /** Pre-filtered pools from usePoolsData */
  pools: Pool[];
  /** Current sort state */
  sort: SortState<PoolColumnId>;
  /** Sharing groups for building sharing map */
  sharingGroups: string[][];
  /** Display mode for quota/capacity sorting */
  displayMode: "used" | "free";
}

interface UseSortedPoolsResult {
  /** Sorted pools */
  sortedPools: Pool[];
  /** Map of pool names that share resources */
  sharingMap: Map<string, boolean>;
}

export function useSortedPools({
  pools,
  sort,
  sharingGroups,
  displayMode,
}: UseSortedPoolsOptions): UseSortedPoolsResult {
  // Sort pools
  const sortedPools = useMemo(
    () => sortPools(pools, sort, displayMode),
    [pools, sort, displayMode],
  );

  // Build map of pools that are shared (for UI indicators)
  const sharingMap = useMemo(() => {
    const map = new Map<string, boolean>();
    for (const group of sharingGroups) {
      if (group.length > 1) {
        for (const poolName of group) {
          map.set(poolName, true);
        }
      }
    }
    return map;
  }, [sharingGroups]);

  return { sortedPools, sharingMap };
}
