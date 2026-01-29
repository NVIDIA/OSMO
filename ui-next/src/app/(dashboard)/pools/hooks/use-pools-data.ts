/**
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Data hook for pools page with FilterBar chip filtering.
 *
 * Architecture:
 * - Converts FilterBar chips to filter params
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
import { useFilteredPools, type PoolFilterParams, type PoolMetadata } from "@/lib/api/adapter";
import type { Pool } from "@/lib/api/adapter";
import type { SearchChip } from "@/stores";
import { chipsToParams, type ChipMappingConfig } from "@/lib/api/chip-filter-utils";

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
// Chip to Filter Mapping
// =============================================================================

/**
 * Mapping of FilterBar chip fields to pool filter params.
 *
 * This mapping stays the same whether filtering is client or server side.
 * The adapter handles where the filtering actually happens.
 */
const POOL_CHIP_MAPPING: ChipMappingConfig<PoolFilterParams> = {
  status: { type: "array", paramKey: "statuses" },
  platform: { type: "array", paramKey: "platforms" },
  backend: { type: "array", paramKey: "backends" },
  shared: { type: "single", paramKey: "sharedWith" },
  search: { type: "single", paramKey: "search" },
  pool: { type: "single", paramKey: "search" },
};

// =============================================================================
// Hook
// =============================================================================

export function usePoolsData({ searchChips }: UsePoolsDataParams): UsePoolsDataReturn {
  // Convert chips to filter params using shared utility
  const filterParams = useMemo(() => chipsToParams(searchChips, POOL_CHIP_MAPPING) as PoolFilterParams, [searchChips]);

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
