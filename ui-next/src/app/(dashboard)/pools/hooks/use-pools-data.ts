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
 * Architecture:
 * - Converts SmartSearch chips to filter params
 * - Calls adapter (which handles client/server filtering transparently)
 * - Returns clean data for UI
 *
 * SHIM NOTE:
 * Currently filtering happens client-side in the adapter (pools-shim.ts).
 * When backend supports filtering, the adapter will pass filters to the API
 * and this hook remains unchanged.
 *
 * See: BACKEND_TODOS.md#12
 */

"use client";

import { useMemo } from "react";
import {
  useFilteredPools,
  type PoolFilterParams,
  type PoolMetadata,
} from "@/lib/api/adapter";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";

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
  /** Metadata for filter options (status counts, platforms, backends) */
  metadata: PoolMetadata | null;
  /** Whether any filters are active */
  hasActiveFilters: boolean;
  /** Total pools before filtering */
  total: number;
  /** Total pools after filtering */
  filteredTotal: number;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: Error | null;
  /** Refetch function */
  refetch: () => void;
}

// =============================================================================
// Chip to Filter Conversion
// =============================================================================

/**
 * Convert SmartSearch chips to pool filter params.
 *
 * This mapping stays the same whether filtering is client or server side.
 * The adapter handles where the filtering actually happens.
 */
function chipsToFilterParams(chips: SearchChip[]): PoolFilterParams {
  const params: PoolFilterParams = {};

  for (const chip of chips) {
    switch (chip.field) {
      case "status":
        params.statuses = [...(params.statuses ?? []), chip.value];
        break;
      case "platform":
        params.platforms = [...(params.platforms ?? []), chip.value];
        break;
      case "backend":
        params.backends = [...(params.backends ?? []), chip.value];
        break;
      case "shared":
        params.sharedWith = chip.value;
        break;
      case "search":
      case "name":
        // Both search and name fields map to text search
        params.search = chip.value;
        break;
    }
  }

  return params;
}

// =============================================================================
// Hook
// =============================================================================

export function usePoolsData({ searchChips }: UsePoolsDataParams): UsePoolsDataReturn {
  // Convert chips to filter params
  const filterParams = useMemo(
    () => chipsToFilterParams(searchChips),
    [searchChips],
  );

  // Use adapter hook (handles client/server filtering transparently)
  const {
    pools,
    allPools,
    sharingGroups,
    metadata,
    hasActiveFilters,
    total,
    filteredTotal,
    isLoading,
    error,
    refetch,
  } = useFilteredPools(filterParams);

  return {
    pools,
    allPools,
    sharingGroups,
    metadata,
    hasActiveFilters,
    total,
    filteredTotal,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
