/**
 * Copyright (c) 2025-2026, NVIDIA CORPORATION. All rights reserved.
 *
 * NVIDIA CORPORATION and its licensors retain all intellectual property
 * and proprietary rights in and to this software, related documentation
 * and any modifications thereto. Any use, reproduction, disclosure or
 * distribution of this software and related documentation without an express
 * license agreement from NVIDIA CORPORATION is strictly prohibited.
 */

/**
 * Data hook for pools page with SmartSearch chip filtering.
 *
 * This hook encapsulates all data fetching and filtering logic,
 * preparing for future server-driven filtering. The UI layer
 * receives clean, pre-processed data.
 *
 * Architecture:
 * - Fetches pools and sharingGroups from adapter
 * - Creates context-aware search fields (for shared: filter)
 * - Applies client-side filtering (will become server-side later)
 * - Returns both filtered (for table) and unfiltered (for suggestions) data
 */

"use client";

import { useMemo } from "react";
import { usePools, type Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { filterByChips } from "@/components/smart-search";
import { createPoolSearchFields } from "../lib/pool-search-fields";

// =============================================================================
// Types
// =============================================================================

interface UsePoolsDataParams {
  searchChips: SearchChip[];
}

interface UsePoolsDataReturn {
  /** Filtered pools (after applying search chips) */
  pools: Pool[];
  /** All pools (unfiltered, for suggestions) */
  allPools: Pool[];
  /** Sharing groups for panel and shared: filter */
  sharingGroups: string[][];
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

// =============================================================================
// Hook
// =============================================================================

export function usePoolsData({ searchChips }: UsePoolsDataParams): UsePoolsDataReturn {
  // Fetch pools data from adapter
  // Note: When we move to server-side filtering, we'll pass searchChips here
  const { pools: allPools, sharingGroups, isLoading, error, refetch } = usePools();

  // Create context-aware search fields (shared: filter needs sharingGroups)
  const searchFields = useMemo(
    () => createPoolSearchFields(sharingGroups),
    [sharingGroups],
  );

  // Apply SmartSearch chip filtering client-side
  // Uses shared filterByChips: same field = OR, different fields = AND
  //
  // TODO: When backend supports filtering, move this to the adapter:
  // const { pools } = usePools({ filters: searchChips });
  const filteredPools = useMemo(
    () => filterByChips(allPools, searchChips, searchFields),
    [allPools, searchChips, searchFields],
  );

  return {
    pools: filteredPools,
    allPools,
    sharingGroups,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
